import { describe, expect, it } from "vitest";
import type { EntraClaims } from "@miroclone/shared";
import { SESSION_COOKIE } from "./app.js";
import { setup, signIn } from "./testutil.js";

const claims = (oid: string, groups: string[] = []): EntraClaims =>
  ({ oid, tid: "t1", name: oid, roles: ["Whiteboard.User"], amr: ["mfa"], groups });

async function login(oid: string, groups?: string[]) {
  const s = setup(claims(oid, groups));
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
