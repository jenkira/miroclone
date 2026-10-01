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
const roles: Record<string, BoardRole | undefined> = { editor: "editor", editor2: "editor", viewer: "viewer", nobody: undefined };
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

describe("locking the board (WSH-7)", () => {
  const setLock = (c: ReturnType<typeof connect>, by: string | null) => (by ? c.doc.getMap("workshop").set("lock", { by, name: by }) : c.doc.getMap("workshop").delete("lock"));

  it("makes every other editor read-only until the person who locked it unlocks", async () => {
    const a = connect("editor"); await a.synced;
    const b = connect("editor2"); await b.synced;
    const v = connect("viewer"); await v.synced;
    setLock(a, "editor");
    await wait(400);
    expect(b.doc.getMap("workshop").get("lock")).toEqual({ by: "editor", name: "editor" });
    b.doc.getMap("objects").set("blocked", { t: "x" });
    await wait(400);
    expect(a.doc.getMap("objects").get("blocked")).toBeUndefined();
    a.doc.getMap("objects").set("allowed", { t: "x" });
    await wait(400);
    expect(v.doc.getMap("objects").get("allowed")).toEqual({ t: "x" });

    // Another editor can't lift the lock.
    setLock(b, null);
    await wait(400);
    expect(a.doc.getMap("workshop").get("lock")).toBeDefined();

    setLock(a, null);
    await wait(400);
    // The real client turns its tools off during a lock. This test edited anyway, which leaves a gap in its own history,
    // so it checks the unlocked board with a fresh connection.
    const b2 = connect("editor2"); await b2.synced;
    b2.doc.getMap("objects").set("after", { t: "x" });
    await wait(400);
    expect(a.doc.getMap("objects").get("after")).toEqual({ t: "x" });
    close(a, b, v, b2);
  });

  it("makes a person who joins during the lock read-only", async () => {
    const a = connect("editor"); await a.synced;
    setLock(a, "editor");
    await wait(400);
    const late = connect("editor2"); await late.synced;
    late.doc.getMap("objects").set("late", { t: "x" });
    await wait(400);
    expect(a.doc.getMap("objects").get("late")).toBeUndefined();
    setLock(a, null);
    await wait(300);
    close(a, late);
  });

  it("ends the lock when the person who set it leaves", async () => {
    const a = connect("editor"); await a.synced;
    const b = connect("editor2"); await b.synced;
    setLock(a, "editor");
    await wait(400);
    expect(b.doc.getMap("workshop").get("lock")).toBeDefined();
    close(a);
    await wait(800);
    expect(b.doc.getMap("workshop").get("lock")).toBeUndefined();
    close(b);
    const c = connect("editor2"); await c.synced;
    c.doc.getMap("objects").set("free", { t: "x" });
    await wait(400);
    const d = connect("editor"); await d.synced;
    expect(d.doc.getMap("objects").get("free")).toEqual({ t: "x" });
    close(c, d);
  });

  it("removes a lock that names someone else", async () => {
    const a = connect("editor"); await a.synced;
    const b = connect("editor2"); await b.synced;
    setLock(b, "editor");
    await wait(500);
    expect(a.doc.getMap("workshop").get("lock")).toBeUndefined();
    b.doc.getMap("objects").set("still", { t: "x" });
    await wait(400);
    expect(a.doc.getMap("objects").get("still")).toEqual({ t: "x" });
    close(a, b);
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
