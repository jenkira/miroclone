import { Server } from "@hocuspocus/server";
import {
  appendUpdate, compact, Counter, createRegistry, Gauge, Histogram, LATENCY_BUCKETS, loadDoc, withSpan,
  type Db, type Registry, type Tracing,
} from "@miroclone/server-core";
import { canEditContent, WORKSHOP_MAP, type BoardRole } from "@miroclone/shared";
import type { Document } from "@hocuspocus/server";
import { authenticate, type AccessResolver } from "./auth.js";

/** Update sizes in bytes, from a small edit to a large paste or a restored board. */
const SIZE_BUCKETS = [100, 500, 1_000, 5_000, 25_000, 100_000, 500_000, 2_000_000];

export function createCollabServer(opts: { port: number; resolver: AccessResolver; db: Db; registry?: Registry; tracing?: Tracing }) {
  const registry = opts.registry ?? createRegistry("collab");
  const tracer = opts.tracing?.tracer;
  const reuse = <T,>(name: string, make: () => T) => (registry.getSingleMetric(name) as T | undefined) ?? make();
  const auth = reuse("collab_auth_total", () => new Counter({ name: "collab_auth_total", help: "WebSocket authentication by result", labelNames: ["result"], registers: [registry] }));
  const persist = reuse("collab_persist_seconds", () => new Histogram({ name: "collab_persist_seconds", help: "Time to store one update", buckets: LATENCY_BUCKETS, registers: [registry] }));
  const load = reuse("collab_load_seconds", () => new Histogram({ name: "collab_load_seconds", help: "Time to load a board from storage", buckets: LATENCY_BUCKETS, registers: [registry] }));
  const sizes = reuse("collab_update_bytes", () => new Histogram({ name: "collab_update_bytes", help: "Size of each update", buckets: SIZE_BUCKETS, registers: [registry] }));
  const errors = reuse("collab_persist_errors_total", () => new Counter({ name: "collab_persist_errors_total", help: "Updates that could not be stored", registers: [registry] }));

  /**
   * While a board is locked, only the person who locked it can edit (WSH-7). The lock lives in the document's workshop map,
   * and this turns every other connection read-only, so the server enforces it and a changed browser can't skip it.
   * Everyone else keeps the read-only state their role gave them.
   */
  const applyLock = (document: Document) => {
    const lock = document.getMap(WORKSHOP_MAP).get("lock") as { by?: string } | undefined;
    for (const c of document.getConnections()) {
      const ctx = c.context as { user?: { id: string }; role?: BoardRole };
      c.readOnly = !canEditContent(ctx.role ?? "viewer") || (!!lock && ctx.user?.id !== lock.by);
    }
  };

  const span = <T,>(name: string, fn: () => Promise<T>) => (tracer ? withSpan(tracer, name, {}, fn) : fn());

  const server = Server.configure({
    port: opts.port,
    quiet: true,
    async onAuthenticate({ documentName, requestHeaders, connection }) {
      return span("collab.authenticate", async () => {
        try {
          const result = await authenticate(opts.resolver, documentName, requestHeaders.cookie);
          connection.readOnly = result.readOnly;
          auth.inc({ result: result.readOnly ? "allowed_readonly" : "allowed" });
          return { user: result.user, role: result.role };
        } catch (e) {
          const m = (e as Error).message;
          auth.inc({ result: m === "unauthenticated" || m === "forbidden" ? m : "error" });
          throw e;
        }
      });
    },
    onLoadDocument: ({ documentName }) => span("collab.load_document", async () => {
      const end = load.startTimer();
      try {
        const doc = await loadDoc(opts.db, documentName);
        // If the worker isn't running, updates would pile up, so a board that opens with a long backlog is compacted once, in the background.
        void compact(opts.db, documentName, 1000).catch(() => {});
        return doc;
      } finally { end(); }
    }),
    // A person who joins while the board is locked is read-only from the start.
    async connected({ documentName, instance }) { const d = instance.documents.get(documentName); if (d) applyLock(d); },
    // If the person who locked the board leaves, the lock goes with them. Otherwise a closed laptop would lock everyone out.
    async onDisconnect({ documentName, instance, context }) {
      const d = instance.documents.get(documentName);
      const lock = d?.getMap(WORKSHOP_MAP).get("lock") as { by?: string } | undefined;
      if (!d || !lock || lock.by !== context?.user?.id) return;
      if (d.getConnections().some((c) => (c.context as { user?: { id: string } }).user?.id === lock.by)) return;
      d.getMap(WORKSHOP_MAP).delete("lock");
      applyLock(d);
    },
    async onChange({ documentName, update, document, context }) {
      // A lock names the person who set it. If it names someone else, it's forged, so remove it.
      const lock = document.getMap(WORKSHOP_MAP).get("lock") as { by?: string } | undefined;
      if (lock && context?.user?.id && lock.by !== context.user.id) document.getMap(WORKSHOP_MAP).delete("lock");
      applyLock(document);
      sizes.observe(update.byteLength);
      await span("collab.persist_update", async () => {
        const end = persist.startTimer();
        // The worker compacts stored updates on a timer. Merging a large board here would stall every connection on this pod.
        try { await appendUpdate(opts.db, documentName, update); }
        catch (e) { errors.inc(); throw e; }
        finally { end(); }
      });
    },
  });

  // Live counts come from the server itself each time the metrics are read.
  reuse("collab_connections", () => new Gauge({ name: "collab_connections", help: "Open WebSocket connections", registers: [registry], collect() { this.set(server.getConnectionsCount()); } }));
  reuse("collab_documents", () => new Gauge({ name: "collab_documents", help: "Boards held in memory", registers: [registry], collect() { this.set(server.getDocumentsCount()); } }));
  return Object.assign(server, { registry });
}
