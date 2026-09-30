import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { PGlite } from "@electric-sql/pglite";
import { migrate, type Db } from "@miroclone/server-core";
import type { BoardRole } from "@miroclone/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import WebSocket from "ws";
import type { AccessResolver } from "./auth.js";
import { createRegistry } from "@miroclone/server-core";
import { createCollabServer } from "./server.js";

// The cookie value names the user, and each user has a fixed role.
const roles: Record<string, BoardRole | undefined> = { editor: "editor", viewer: "viewer", nobody: undefined };
const resolver: AccessResolver = {
  userFromCookie: async (c) => (c ? { id: c, name: c, groups: [] } : undefined),
  roleOnBoard: async (u) => roles[u.id],
};

const registry = createRegistry("collab-test");
let server: ReturnType<typeof createCollabServer>;
let db: Db;
let boardId: string;
const port = 18234;

beforeAll(async () => {
  db = new PGlite() as unknown as Db;
  await migrate(db);
  await db.query("INSERT INTO users (id, tenant_id, display_name) VALUES ('u', 't', 'U')");
  boardId = (await db.query<{ id: string }>("INSERT INTO boards (title, classification, created_by) VALUES ('B', 'OFFICIAL', 'u') RETURNING id")).rows[0]!.id;
  server = createCollabServer({ port, resolver, db, registry });
  await server.listen();
});
afterAll(async () => { await server.destroy(); });

function connect(user: string) {
  const doc = new Y.Doc();
  // Node has no cookie jar for WebSocket, so the test sets the header directly.
  class Ws extends WebSocket {
    constructor(url: string) { super(url, { headers: { cookie: user } }); }
  }
  // The session cookie is the credential. The provider needs some token, or the server never starts authentication.
  const websocketProvider = new HocuspocusProviderWebsocket({ url: `ws://127.0.0.1:${port}`, WebSocketPolyfill: Ws as never });
  const provider = new HocuspocusProvider({ name: boardId, document: doc, websocketProvider, token: "cookie" });
  const synced = new Promise<void>((res) => provider.on("synced", () => res()));
  const denied = new Promise<void>((res) => provider.on("authenticationFailed", () => res()));
  return { doc, provider, websocketProvider, synced, denied };
}
function close(...cs: ReturnType<typeof connect>[]) {
  for (const c of cs) { c.provider.destroy(); c.websocketProvider.destroy(); }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("collaboration over WebSocket", () => {
  it("syncs an editor's change to a viewer and persists it", async () => {
    const e = connect("editor"); await e.synced;
    const v = connect("viewer"); await v.synced;
    e.doc.getMap("objects").set("a", { t: "sticky" });
    await wait(500);
    expect(v.doc.getMap("objects").get("a")).toEqual({ t: "sticky" });
    expect((await loadDocRows()).length).toBeGreaterThan(0);
    close(e, v);
  });

  it("drops updates from a viewer", async () => {
    const e = connect("editor"); await e.synced;
    const v = connect("viewer"); await v.synced;
    v.doc.getMap("objects").set("evil", { t: "sticky" });
    await wait(500);
    expect(e.doc.getMap("objects").get("evil")).toBeUndefined();
    close(e, v);
  });

  it("rejects a user with no board role", async () => {
    const n = connect("nobody");
    await n.denied;
    expect(n.doc.getMap("objects").size).toBe(0);
    close(n);
  });
});

async function loadDocRows() {
  return (await db.query("SELECT 1 FROM board_updates WHERE board_id = $1", [boardId])).rows;
}

/** The value of the first series whose name starts with `name` and that has every label. */
function value(text: string, name: string, labels: Record<string, string> = {}): number | undefined {
  for (const l of text.split("\n")) {
    if (!l.startsWith(name + "{") && !l.startsWith(name + " ")) continue;
    if (Object.entries(labels).every(([k, v]) => l.includes(`${k}="${v}"`))) return Number(l.slice(l.lastIndexOf(" ") + 1));
  }
  return undefined;
}

describe("metrics (section 8.6)", () => {
  it("reports live connections and loaded boards, and counts each outcome", async () => {
    const before = await registry.metrics();
    const e = connect("editor"); await e.synced;
    const v = connect("viewer"); await v.synced;
    const n = connect("nobody"); await n.denied;
    e.doc.getMap("objects").set("m1", { t: "sticky", text: "x".repeat(300) });
    await wait(500);
    const text = await registry.metrics();
    expect(value(text, "collab_connections")).toBeGreaterThanOrEqual(2);
    expect(value(text, "collab_documents")).toBeGreaterThanOrEqual(1);
    const inc = (name: string, labels: Record<string, string>) => (value(text, name, labels) ?? 0) - (value(before, name, labels) ?? 0);
    expect(inc("collab_auth_total", { result: "allowed" })).toBeGreaterThanOrEqual(1);
    expect(inc("collab_auth_total", { result: "allowed_readonly" })).toBeGreaterThanOrEqual(1);
    expect(inc("collab_auth_total", { result: "forbidden" })).toBeGreaterThanOrEqual(1);
    expect((value(text, "collab_update_bytes_count") ?? 0) - (value(before, "collab_update_bytes_count") ?? 0)).toBeGreaterThanOrEqual(1);
    expect((value(text, "collab_persist_seconds_count") ?? 0)).toBeGreaterThanOrEqual(1);
    expect(value(text, "collab_persist_errors_total") ?? 0).toBe(0);
    close(e, v, n);
    await wait(600);
    expect(value(await registry.metrics(), "collab_connections")).toBeLessThan(value(text, "collab_connections")!);
  });
});
