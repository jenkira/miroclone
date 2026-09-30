import { Server } from "@hocuspocus/server";
import {
  appendUpdate, compact, Counter, createRegistry, Gauge, Histogram, LATENCY_BUCKETS, loadDoc, withSpan,
  type Db, type Registry, type Tracing,
} from "@miroclone/server-core";
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
      try { return await loadDoc(opts.db, documentName); } finally { end(); }
    }),
    async onChange({ documentName, update }) {
      sizes.observe(update.byteLength);
      await span("collab.persist_update", async () => {
        const end = persist.startTimer();
        try { await appendUpdate(opts.db, documentName, update); await compact(opts.db, documentName); }
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
