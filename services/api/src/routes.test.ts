import { describe, expect, it, vi } from "vitest";
import { exportJson, importJson } from "@miroclone/shared";
import { loadDoc } from "@miroclone/server-core";
import { db, graphCalls } from "./testutil.js";
import type { EntraClaims } from "@miroclone/shared";
import { SESSION_COOKIE } from "./app.js";
import { setup, signIn } from "./testutil.js";

const claims = (oid: string, groups: string[] = []): EntraClaims =>
  ({ oid, tid: "t1", name: oid, roles: ["Whiteboard.User"], amr: ["mfa"], groups });

async function login(oid: string, groups?: string[], extra = {}, ttl = 3600, raw?: Partial<EntraClaims>) {
  const s = setup({ ...claims(oid, groups), ...raw }, { t: 1000 }, extra, ttl);
  const c = (await signIn(s.app)).cookies[0]!.value;
  return { ...s, cookies: { [SESSION_COOKIE]: c } };
}

describe("board routes", () => {
  it("requires a session", async () => {
    const { app } = setup(claims("x"));
    expect((await app.inject("/api/boards")).statusCode).toBe(401);
  });

  it("creates, lists, and opens a board", async () => {
    const a = await login("rt-ann");
    const created = await a.app.inject({ method: "POST", url: "/api/boards", cookies: a.cookies, payload: { title: "Plan", classification: "OFFICIAL" } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    const list = await a.app.inject({ url: "/api/boards", cookies: a.cookies });
    expect(list.json().some((b: { id: string }) => b.id === id)).toBe(true);
    const open = await a.app.inject({ url: `/api/boards/${id}`, cookies: a.cookies });
    expect(open.json()).toMatchObject({ title: "Plan", role: "owner", classification: "OFFICIAL" });
  });

  it("hides another user's board and rejects unknown classifications", async () => {
    const a = await login("rt-ann2");
    const b = await login("rt-bob");
    const id = (await a.app.inject({ method: "POST", url: "/api/boards", cookies: a.cookies, payload: { title: "P", classification: "PROTECTED" } })).json().id;
    expect((await b.app.inject({ url: `/api/boards/${id}`, cookies: b.cookies })).statusCode).toBe(404);
    const bad = await a.app.inject({ method: "POST", url: "/api/boards", cookies: a.cookies, payload: { title: "P", classification: "TOP_SECRET" } });
    expect(bad.statusCode).toBe(400);
  });

  it("shares with a group and enforces the lowered-classification rule", async () => {
    const a = await login("rt-ann3");
    const c = await login("rt-cy", ["g-eng"]);
    const id = (await a.app.inject({ method: "POST", url: "/api/boards", cookies: a.cookies, payload: { title: "P", classification: "PROTECTED" } })).json().id;
    await a.app.inject({ method: "PUT", url: `/api/boards/${id}/members`, cookies: a.cookies, payload: { type: "group", principalId: "g-eng", role: "viewer" } });
    expect((await c.app.inject({ url: `/api/boards/${id}`, cookies: c.cookies })).json().role).toBe("viewer");
    const denied = await c.app.inject({ method: "PUT", url: `/api/boards/${id}/classification`, cookies: c.cookies, payload: { classification: "OFFICIAL" } });
    expect(denied.statusCode).toBe(403);
    const noReason = await a.app.inject({ method: "PUT", url: `/api/boards/${id}/classification`, cookies: a.cookies, payload: { classification: "OFFICIAL", confirmed: true } });
    expect(noReason.statusCode).toBe(400);
  });
});

describe("export and import", () => {
  const exp = (a: Awaited<ReturnType<typeof login>>, id: string, format = "svg") =>
    a.app.inject({ method: "POST", url: `/api/boards/${id}/exports`, cookies: a.cookies, payload: { format } });
  const make = async (a: Awaited<ReturnType<typeof login>>, classification = "OFFICIAL") =>
    (await a.app.inject({ method: "POST", url: "/api/boards", cookies: a.cookies, payload: { title: "B", classification } })).json().id as string;

  it("records an audit event for each export", async () => {
    const a = await login("ex-ann");
    const id = await make(a);
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const res = await exp(a, id, "png");
    const lines = write.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"type":"audit"'));
    write.mockRestore();
    expect(res.statusCode).toBe(204);
    expect(lines.some((l) => l.includes('"action":"export"') && l.includes('"format":"png"'))).toBe(true);
  });

  it("applies the per-classification export policy", async () => {
    const policy = { exportPolicy: { PROTECTED: "owners" as const, SENSITIVE: "none" as const } };
    const owner = await login("ex-own", [], policy);
    const viewer = await login("ex-view", [], policy);
    const id = await make(owner, "PROTECTED");
    await owner.app.inject({ method: "PUT", url: `/api/boards/${id}/members`, cookies: owner.cookies, payload: { type: "user", principalId: "ex-view", role: "viewer" } });
    expect((await exp(owner, id)).statusCode).toBe(204);
    expect((await exp(viewer, id)).statusCode).toBe(403);
    const closed = await make(owner, "SENSITIVE");
    expect((await exp(owner, closed)).statusCode).toBe(403);
  });

  it("hides export for boards the user can't open, and rejects unknown formats", async () => {
    const a = await login("ex-a2"), b = await login("ex-b2");
    const id = await make(a);
    expect((await exp(b, id)).statusCode).toBe(404);
    expect((await exp(a, id, "exe")).statusCode).toBe(400);
  });

  it("imports a board file as a new board owned by the importer", async () => {
    const a = await login("im-ann");
    const file = exportJson(
      [{ id: "s1", type: "sticky", x: 1, y: 2, width: 100, height: 100, rotation: 0, index: "a0", locked: false, text: "Hi", color: "#fff475" }],
      { title: "Imported", classification: "PROTECTED" });
    expect(importJson(file).objects).toHaveLength(1);
    const res = await a.app.inject({ method: "POST", url: "/api/boards/import", cookies: a.cookies, payload: { file } });
    expect(res.statusCode).toBe(201);
    const id = res.json().id;
    const board = (await a.app.inject({ url: `/api/boards/${id}`, cookies: a.cookies })).json();
    expect(board).toMatchObject({ title: "Imported", classification: "PROTECTED", role: "owner" });
    expect((await loadDoc(db, id)).getMap("objects").get("s1")).toMatchObject({ text: "Hi" });
  });

  it("rejects a malformed import", async () => {
    const a = await login("im-bad");
    const res = await a.app.inject({ method: "POST", url: "/api/boards/import", cookies: a.cookies, payload: { file: "{}" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("people picker and sharing", () => {
  it("searches the directory as the signed-in user", async () => {
    const a = await login("pp-ann");
    graphCalls.length = 0;
    const res = await a.app.inject({ url: "/api/people?q=eng", cookies: a.cookies });
    expect(res.json()).toEqual([
      { type: "user", id: "u-eng", name: "Eng Person", email: "eng@x.test" },
      { type: "group", id: "g-eng", name: "Engineering" },
    ]);
    expect(graphCalls.every((c) => c.auth === "Bearer graph-at")).toBe(true);
  });

  it("refreshes an expiring Graph token and keeps the new one", async () => {
    const a = await login("pp-exp", [], {}, 10);
    graphCalls.length = 0;
    await a.app.inject({ url: "/api/people?q=eng", cookies: a.cookies });
    expect(graphCalls.every((c) => c.auth === "Bearer graph-at-2")).toBe(true);
  });

  it("requires a session", async () => {
    const { app } = setup(claims("x"));
    expect((await app.inject("/api/people?q=eng")).statusCode).toBe(401);
  });

  it("resolves group overage through Graph (IAM-9)", async () => {
    const owner = await login("ov-own");
    const big = await login("ov-big", [], {}, 3600, { _claim_names: { groups: "src1" } });
    const id = (await owner.app.inject({ method: "POST", url: "/api/boards", cookies: owner.cookies, payload: { title: "P", classification: "OFFICIAL" } })).json().id;
    await owner.app.inject({ method: "PUT", url: `/api/boards/${id}/members`, cookies: owner.cookies, payload: { type: "group", principalId: "g-big-2", role: "editor", name: "Big group" } });
    expect((await big.app.inject({ url: `/api/boards/${id}`, cookies: big.cookies })).json().role).toBe("editor");
  });

  it("lists members with names, and hides the list from non-members", async () => {
    const a = await login("ml-ann"), b = await login("ml-bob");
    const id = (await a.app.inject({ method: "POST", url: "/api/boards", cookies: a.cookies, payload: { title: "P", classification: "OFFICIAL" } })).json().id;
    await a.app.inject({ method: "PUT", url: `/api/boards/${id}/members`, cookies: a.cookies, payload: { type: "group", principalId: "g-eng", role: "viewer", name: "Engineering" } });
    const list = (await a.app.inject({ url: `/api/boards/${id}/members`, cookies: a.cookies })).json();
    expect(list).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "group", name: "Engineering", role: "viewer" }),
      expect.objectContaining({ type: "user", id: "ml-ann", role: "owner" }),
    ]));
    expect((await b.app.inject({ url: `/api/boards/${id}/members`, cookies: b.cookies })).statusCode).toBe(404);
  });
});
