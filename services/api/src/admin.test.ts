import { appendUpdate } from "@miroclone/server-core";
import { Board, defaultClassifications, type EntraClaims } from "@miroclone/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { SESSION_COOKIE } from "./app.js";
import { db, setup, signIn } from "./testutil.js";

const claims = (oid: string, admin = false): EntraClaims => ({ oid, tid: "t1", name: oid, roles: [admin ? "Whiteboard.Admin" : "Whiteboard.User"], amr: ["mfa"], groups: [] });
async function user(oid: string, admin = false) {
  const s = setup(claims(oid, admin));
  const cookies = { [SESSION_COOKIE]: (await signIn(s.app)).cookies[0]!.value };
  return { oid, call: (method: string, url: string, payload?: unknown) => s.app.inject({ method: method as never, url, cookies, payload: payload as never }) };
}
type U = Awaited<ReturnType<typeof user>>;
const LIST = defaultClassifications.map((c) => ({ ...c }));
const put = (u: U, list: unknown[], def = "OFFICIAL") => u.call("PUT", "/api/admin/classifications", { list, default: def });

// The settings row is shared by every test, so put the built-in list back after each one.
// Boards that use a marking outside the built-in list would block saving the list again, so remove them too.
afterEach(async () => {
  await db.query("DELETE FROM settings WHERE key = 'classifications'");
  await db.query("DELETE FROM boards WHERE classification <> ALL($1::text[])", [LIST.map((c) => c.key)]);
});

describe("classification markings (PMK-1, PMK-7)", () => {
  it("gives everyone the list and the default for new boards", async () => {
    const u = await user("a-user");
    const r = (await u.call("GET", "/api/classifications")).json();
    expect(r.list.map((c: { key: string }) => c.key)).toEqual(["OFFICIAL", "OFFICIAL_SENSITIVE", "SENSITIVE", "PROTECTED"]);
    expect(r.default).toBe("OFFICIAL");
  });

  it("lets only a service administrator change it", async () => {
    const u = await user("a-plain"), admin = await user("a-admin", true);
    expect((await put(u, LIST)).statusCode).toBe(403);
    expect((await put(admin, LIST)).statusCode).toBe(200);
  });

  it("changes the list, the order, the colours, and the default, and the API follows", async () => {
    const admin = await user("a-cfg", true), u = await user("a-cfg-user");
    const list = [
      { key: "OFFICIAL", label: "OFFICIAL", level: 0, colour: "#2e7d32" },
      { key: "CONFIDENTIAL", label: "CONFIDENTIAL", level: 1, colour: "#6a1b9a" },
      { key: "PROTECTED", label: "PROTECTED", level: 2, colour: "#c62828" },
    ];
    expect((await put(admin, list, "CONFIDENTIAL")).statusCode).toBe(200);
    const r = (await u.call("GET", "/api/classifications")).json();
    expect(r.default).toBe("CONFIDENTIAL");
    expect(r.list[1].colour).toBe("#6a1b9a");
    // A new board with no marking gets the default. The removed markings are refused.
    const made = await u.call("POST", "/api/boards", { title: "B" });
    expect(made.statusCode).toBe(201);
    expect((await u.call("GET", `/api/boards/${made.json().id}`)).json().classification).toBe("CONFIDENTIAL");
    expect((await u.call("POST", "/api/boards", { title: "B", classification: "SENSITIVE" })).statusCode).toBe(400);
  });

  it("rejects lists that aren't valid", async () => {
    const admin = await user("a-bad", true);
    const ok = { key: "A", label: "A", level: 0, colour: "#000000" };
    for (const [list, def] of [
      [[], "A"], [[ok, ok], "A"], [[ok], "B"],
      [[{ ...ok, key: "lower" }], "lower"], [[{ ...ok, colour: "red" }], "A"], [[{ ...ok, level: -1 }], "A"],
      [[{ ...ok, level: 1.5 }], "A"], [[{ ...ok, label: " " }], "A"], [Array.from({ length: 21 }, (_, i) => ({ ...ok, key: `K${i}` })), "K0"],
    ] as [unknown[], string][]) expect((await put(admin, list, def)).statusCode).toBe(400);
    expect((await admin.call("PUT", "/api/admin/classifications", { list: "nonsense" })).statusCode).toBe(400);
    expect((await admin.call("PUT", "/api/admin/classifications", {})).statusCode).toBe(400);
  });

  it("won't remove a marking that boards or templates still use", async () => {
    const admin = await user("a-use", true);
    const board = (await admin.call("POST", "/api/boards", { title: "P", classification: "PROTECTED" })).json().id;
    const without = LIST.filter((c) => c.key !== "PROTECTED");
    const r = await put(admin, without);
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/PROTECTED is used by \d+ board/);
    expect((await put(admin, LIST.filter((c) => c.key !== "SENSITIVE"))).statusCode).toBe(200);   // nothing uses it
    void board;
  });

  it("treats markings at the same level as equivalent, so moving between them needs no reason (PMK-7)", async () => {
    const u = await user("a-eq");
    const id = (await u.call("POST", "/api/boards", { title: "E", classification: "SENSITIVE" })).json().id;
    const r = await u.call("PUT", `/api/boards/${id}/classification`, { classification: "OFFICIAL_SENSITIVE" });
    expect(r.statusCode).toBe(200);
    // A real drop still needs a reason.
    expect((await u.call("PUT", `/api/boards/${id}/classification`, { classification: "OFFICIAL", confirmed: true })).statusCode).toBe(400);
  });

  it("records each change in the audit log", async () => {
    const admin = await user("a-audit", true);
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await put(admin, LIST);
    const lines = write.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"action":"settings_change"'));
    write.mockRestore();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("PROTECTED:2");
  });
});

describe("usage statistics (ADM-3)", () => {
  it("is for service administrators only", async () => {
    const u = await user("s-plain");
    expect((await u.call("GET", "/api/admin/stats")).statusCode).toBe(403);
  });

  it("counts users, boards by classification, and storage, without any board content", async () => {
    const admin = await user("s-admin", true);
    const id = (await admin.call("POST", "/api/boards", { title: "Secret title", classification: "PROTECTED" })).json().id;
    const doc = new Y.Doc(); const b = new Board(doc); const ups: Uint8Array[] = [];
    doc.on("update", (u: Uint8Array) => ups.push(u));
    b.add({ type: "sticky", text: "secret text" });
    for (const u of ups) await appendUpdate(db, id, u);
    const stats = (await admin.call("GET", "/api/admin/stats")).json();
    expect(stats.users.total).toBeGreaterThanOrEqual(1);
    expect(stats.users.activeLast7Days).toBeGreaterThanOrEqual(1);
    expect(stats.users.activeLast30Days).toBeGreaterThanOrEqual(stats.users.activeLast7Days);
    expect(stats.boards.byClassification.find((c: { classification: string }) => c.classification === "PROTECTED").count).toBeGreaterThanOrEqual(1);
    expect(stats.storage.documentBytes).toBeGreaterThan(0);
    expect(JSON.stringify(stats)).not.toMatch(/Secret title|secret text/);
  });

  it("counts a recycled board apart from live ones", async () => {
    const admin = await user("s-bin", true);
    const before = (await admin.call("GET", "/api/admin/stats")).json().boards;
    const id = (await admin.call("POST", "/api/boards", { title: "Gone", classification: "OFFICIAL" })).json().id;
    await admin.call("DELETE", `/api/boards/${id}`);
    const after = (await admin.call("GET", "/api/admin/stats")).json().boards;
    expect(after.inRecycleBin).toBe(before.inRecycleBin + 1);
    expect(after.total).toBe(before.total);
  });
});

describe("pasting into a lower classification (PMK-5)", () => {
  async function pair(tag: string) {
    const u = await user(`p-${tag}`);
    const high = (await u.call("POST", "/api/boards", { title: "High", classification: "PROTECTED" })).json().id as string;
    const low = (await u.call("POST", "/api/boards", { title: "Low", classification: "OFFICIAL" })).json().id as string;
    return { u, high, low };
  }
  const audit = async (fn: () => Promise<unknown>) => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await fn();
    const lines = write.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"action":"paste_downgrade"'));
    write.mockRestore();
    return lines;
  };

  it("records an audit event when the target is lower than the source", async () => {
    const { u, high, low } = await pair("a");
    let status = 0;
    const lines = await audit(async () => { status = (await u.call("POST", `/api/boards/${low}/paste-audit`, { fromBoardId: high, count: 4 })).statusCode; });
    expect(status).toBe(204);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"from":"PROTECTED"'); expect(lines[0]).toContain('"to":"OFFICIAL"'); expect(lines[0]).toContain('"objects":4');
  });

  it("refuses to record a paste that doesn't lower the classification, including between equivalent markings", async () => {
    const { u, high, low } = await pair("b");
    expect((await u.call("POST", `/api/boards/${high}/paste-audit`, { fromBoardId: low })).statusCode).toBe(400);
    expect((await u.call("POST", `/api/boards/${low}/paste-audit`, { fromBoardId: low })).statusCode).toBe(400);
    const a = (await u.call("POST", "/api/boards", { title: "x", classification: "SENSITIVE" })).json().id;
    const c = (await u.call("POST", "/api/boards", { title: "y", classification: "OFFICIAL_SENSITIVE" })).json().id;
    expect((await u.call("POST", `/api/boards/${c}/paste-audit`, { fromBoardId: a })).statusCode).toBe(400);
  });

  it("needs access to both boards, and edit rights on the target", async () => {
    const { u, high, low } = await pair("c");
    const stranger = await user("p-c-str"), viewer = await user("p-c-vw");
    expect((await stranger.call("POST", `/api/boards/${low}/paste-audit`, { fromBoardId: high })).statusCode).toBe(404);
    await u.call("PUT", `/api/boards/${low}/members`, { type: "user", principalId: viewer.oid, role: "viewer", name: "v" });
    await u.call("PUT", `/api/boards/${high}/members`, { type: "user", principalId: viewer.oid, role: "viewer", name: "v" });
    expect((await viewer.call("POST", `/api/boards/${low}/paste-audit`, { fromBoardId: high })).statusCode).toBe(403);
    expect((await u.call("POST", `/api/boards/${low}/paste-audit`, { fromBoardId: "not-a-uuid" })).statusCode).toBe(400);
  });
});
