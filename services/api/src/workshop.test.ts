import { appendUpdate, loadDoc } from "@miroclone/server-core";
import { Board, builtinTemplates, type EntraClaims } from "@miroclone/shared";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { SESSION_COOKIE } from "./app.js";
import { db, setup, signIn } from "./testutil.js";

const claims = (oid: string, isAdmin = false): EntraClaims => ({ oid, tid: "t1", name: oid, roles: [isAdmin ? "Whiteboard.Admin" : "Whiteboard.User"], amr: ["mfa"], groups: [] });
async function user(oid: string, isAdmin = false) {
  const s = setup(claims(oid, isAdmin));
  const cookies = { [SESSION_COOKIE]: (await signIn(s.app)).cookies[0]!.value };
  return { oid, call: (method: string, url: string, payload?: unknown) => s.app.inject({ method: method as never, url, cookies, payload: payload as never }) };
}
type U = Awaited<ReturnType<typeof user>>;
const mk = async (u: U, classification = "OFFICIAL", template?: string) => u.call("POST", "/api/boards", { title: "B", classification, template });
const share = (o: U, id: string, who: string, role: string) => o.call("PUT", `/api/boards/${id}/members`, { type: "user", principalId: who, role, name: who });
const objectCount = async (id: string) => (await loadDoc(db, id)).getMap("objects").size;

async function boardWithContent(owner: U, classification = "OFFICIAL") {
  const id = (await mk(owner, classification)).json().id as string;
  const doc = new Y.Doc(); const b = new Board(doc); const ups: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => ups.push(u));
  const a = b.add({ type: "sticky", text: "keep me" }), c = b.add({ type: "sticky", text: "me too" }), d = b.add({ type: "sticky", text: "left out" });
  b.add({ type: "connector", from: a.id, to: c.id });
  b.add({ type: "connector", from: a.id, to: d.id });
  for (const u of ups) await appendUpdate(db, id, u);
  return { id, ids: { a: a.id, c: c.id, d: d.id } };
}

describe("boards from templates", () => {
  it.each(builtinTemplates.map((t) => t.id))("starts a board from %s with its content stored", async (t) => {
    const u = await user(`w-${t}`);
    const res = await mk(u, "OFFICIAL", t);
    expect(res.statusCode).toBe(201);
    expect(await objectCount(res.json().id)).toBeGreaterThan(2);
  });

  it("refuses an unknown template, and leaves no empty board behind", async () => {
    const u = await user("w-unknown");
    const before = (await u.call("GET", "/api/boards")).json().length;
    expect((await mk(u, "OFFICIAL", "nonsense")).statusCode).toBe(404);
    expect((await mk(u, "OFFICIAL", "00000000-0000-0000-0000-000000000000")).statusCode).toBe(404);
    expect((await u.call("GET", "/api/boards")).json()).toHaveLength(before);
  });
});

describe("organisation templates", () => {
  it("saves a template from the board's own stored content, for editors and owners only", async () => {
    const owner = await user("t-own"), ed = await user("t-ed"), vw = await user("t-vw"), stranger = await user("t-str");
    const { id } = await boardWithContent(owner);
    await share(owner, id, ed.oid, "editor"); await share(owner, id, vw.oid, "viewer");
    expect((await vw.call("POST", "/api/templates", { boardId: id, name: "Nope" })).statusCode).toBe(403);
    expect((await stranger.call("POST", "/api/templates", { boardId: id, name: "Nope" })).statusCode).toBe(404);
    expect((await owner.call("POST", "/api/templates", { boardId: id, name: "  " })).statusCode).toBe(400);
    const saved = await ed.call("POST", "/api/templates", { boardId: id, name: "Team kickoff" });
    expect(saved.statusCode).toBe(201);
    const list = (await stranger.call("GET", "/api/templates")).json();
    expect(list.builtin).toHaveLength(6);
    expect(list.organisation.find((t: { id: string }) => t.id === saved.json().id)).toMatchObject({ name: "Team kickoff", objectCount: 5, classification: "OFFICIAL", createdByName: "t-ed", mine: false });
  });

  it("saves a selection, keeping a connector only when both ends are kept", async () => {
    const owner = await user("t-sel");
    const { id, ids } = await boardWithContent(owner);
    const r = await owner.call("POST", "/api/templates", { boardId: id, name: "Part", objectIds: [ids.a, ids.c] });
    const t = (await owner.call("GET", "/api/templates")).json().organisation.find((x: { id: string }) => x.id === r.json().id);
    expect(t.objectCount).toBe(3);                 // two stickies and the connector between them
    expect((await owner.call("POST", "/api/templates", { boardId: id, name: "Empty", objectIds: ["nothing-here"] })).statusCode).toBe(400);
  });

  it("starts a board from it with new IDs, and won't start lower than its classification", async () => {
    const owner = await user("t-cls"), other = await user("t-use");
    const src = await boardWithContent(owner, "PROTECTED");
    const tid = (await owner.call("POST", "/api/templates", { boardId: src.id, name: "Secret kickoff" })).json().id;
    expect((await other.call("GET", "/api/templates")).json().organisation.find((t: { id: string }) => t.id === tid).classification).toBe("PROTECTED");
    const low = await mk(other, "OFFICIAL", tid);
    expect(low.statusCode).toBe(400);
    expect(low.json().error).toContain("PROTECTED");
    const ok = await mk(other, "PROTECTED", tid);
    expect(ok.statusCode).toBe(201);
    const fresh = (await loadDoc(db, ok.json().id)).getMap("objects");
    expect(fresh.size).toBe(5);
    const original = (await loadDoc(db, src.id)).getMap("objects");
    for (const k of fresh.keys()) expect(original.has(k)).toBe(false);
  });

  it("lets the author delete, and other users can't", async () => {
    const a = await user("t-del-a"), b = await user("t-del-b");
    const { id } = await boardWithContent(a);
    const tid = (await a.call("POST", "/api/templates", { boardId: id, name: "Mine" })).json().id;
    expect((await b.call("DELETE", `/api/templates/${tid}`)).statusCode).toBe(403);
    expect((await a.call("DELETE", `/api/templates/${tid}`)).statusCode).toBe(200);
    expect((await a.call("DELETE", `/api/templates/${tid}`)).statusCode).toBe(404);
    expect((await a.call("DELETE", "/api/templates/not-a-uuid")).statusCode).toBe(404);
  });

  it("lets an administrator delete any template", async () => {
    const a = await user("t-adm-a"), admin = await user("t-adm", true);
    const { id } = await boardWithContent(a);
    const tid = (await a.call("POST", "/api/templates", { boardId: id, name: "Old" })).json().id;
    expect((await admin.call("DELETE", `/api/templates/${tid}`)).statusCode).toBe(200);
  });
});

describe("voting", () => {
  async function room(tag: string) {
    const owner = await user(`${tag}-own`), cm = await user(`${tag}-cm`), vw = await user(`${tag}-vw`), cm2 = await user(`${tag}-cm2`);
    const id = (await mk(owner)).json().id as string;
    await share(owner, id, cm.oid, "commenter"); await share(owner, id, vw.oid, "viewer"); await share(owner, id, cm2.oid, "commenter");
    return { owner, cm, vw, cm2, id };
  }

  it("lets an editor start a session, validates the limit, and allows only one at a time", async () => {
    const { owner, cm, id } = await room("v1");
    expect((await cm.call("POST", `/api/boards/${id}/votes/session`, { limit: 3 })).statusCode).toBe(403);
    for (const limit of [0, 51, 2.5, "x"]) expect((await owner.call("POST", `/api/boards/${id}/votes/session`, { limit })).statusCode).toBe(400);
    const s = await owner.call("POST", `/api/boards/${id}/votes/session`, { limit: 3, anonymous: true });
    expect(s.statusCode).toBe(201);
    expect(s.json().session).toMatchObject({ limit: 3, anonymous: true, state: "open" });
    expect((await owner.call("POST", `/api/boards/${id}/votes/session`, { limit: 3 })).statusCode).toBe(400);
  });

  it("limits each person's votes, and stops two quick votes from passing the limit", async () => {
    const { owner, cm, id } = await room("v2");
    await owner.call("POST", `/api/boards/${id}/votes/session`, { limit: 3 });
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => cm.call("POST", `/api/boards/${id}/votes`, { objectId: `o${i % 2}` })));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(3);
    expect(results.filter((r) => r.statusCode === 400)).toHaveLength(3);
    const st = (await cm.call("GET", `/api/boards/${id}/votes`)).json();
    expect(st.mine).toHaveLength(3);
    expect(st.remaining).toBe(0);
  });

  it("keeps votes private until the session closes", async () => {
    const { owner, cm, cm2, id } = await room("v3");
    await owner.call("POST", `/api/boards/${id}/votes/session`, { limit: 2 });
    await cm.call("POST", `/api/boards/${id}/votes`, { objectId: "a" });
    await cm2.call("POST", `/api/boards/${id}/votes`, { objectId: "a" });
    const seen = (await cm2.call("GET", `/api/boards/${id}/votes`)).json();
    expect(seen.results).toBeNull();
    expect(seen.mine).toEqual(["a"]);
    expect(seen.remaining).toBe(1);
  });

  it("shows named results after closing, most votes first", async () => {
    const { owner, cm, cm2, id } = await room("v4");
    await owner.call("POST", `/api/boards/${id}/votes/session`, { limit: 2, anonymous: false });
    await cm.call("POST", `/api/boards/${id}/votes`, { objectId: "a" });
    await cm2.call("POST", `/api/boards/${id}/votes`, { objectId: "a" });
    await cm2.call("POST", `/api/boards/${id}/votes`, { objectId: "b" });
    const closed = (await owner.call("POST", `/api/boards/${id}/votes/close`)).json();
    expect(closed.session.state).toBe("closed");
    expect(closed.results).toEqual([{ objectId: "a", count: 2, voters: ["v4-cm", "v4-cm2"] }, { objectId: "b", count: 1, voters: ["v4-cm2"] }]);
  });

  it("never reveals who voted in an anonymous session, to anyone", async () => {
    const { owner, cm, id } = await room("v5");
    await owner.call("POST", `/api/boards/${id}/votes/session`, { limit: 2, anonymous: true });
    await cm.call("POST", `/api/boards/${id}/votes`, { objectId: "a" });
    await owner.call("POST", `/api/boards/${id}/votes/close`);
    for (const u of [owner, cm]) {
      const body = JSON.stringify((await u.call("GET", `/api/boards/${id}/votes`)).json());
      expect(body).toContain('"count":1');
      expect(body).not.toContain("v5-cm");
      expect(body).not.toContain("voters");
    }
  });

  it("lets commenters vote but not viewers, and not after the session closes", async () => {
    const { owner, vw, cm, id } = await room("v6");
    expect((await cm.call("POST", `/api/boards/${id}/votes`, { objectId: "a" })).statusCode).toBe(400);   // nothing open yet
    await owner.call("POST", `/api/boards/${id}/votes/session`, { limit: 2 });
    expect((await vw.call("POST", `/api/boards/${id}/votes`, { objectId: "a" })).statusCode).toBe(403);
    expect((await vw.call("GET", `/api/boards/${id}/votes`)).statusCode).toBe(200);
    expect((await cm.call("POST", `/api/boards/${id}/votes`, { objectId: "" })).statusCode).toBe(400);
    expect((await cm.call("POST", `/api/boards/${id}/votes`, { objectId: "x".repeat(65) })).statusCode).toBe(400);
    await owner.call("POST", `/api/boards/${id}/votes/close`);
    expect((await cm.call("POST", `/api/boards/${id}/votes`, { objectId: "a" })).statusCode).toBe(400);
    expect((await owner.call("POST", `/api/boards/${id}/votes/close`)).statusCode).toBe(400);
  });

  it("lets a person take a vote back, and a new session can start after one closes", async () => {
    const { owner, cm, id } = await room("v7");
    await owner.call("POST", `/api/boards/${id}/votes/session`, { limit: 2 });
    await cm.call("POST", `/api/boards/${id}/votes`, { objectId: "a" });
    await cm.call("POST", `/api/boards/${id}/votes`, { objectId: "a" });
    const back = await cm.call("DELETE", `/api/boards/${id}/votes`, { objectId: "a" });
    expect(back.json()).toMatchObject({ mine: ["a"], remaining: 1 });
    await owner.call("POST", `/api/boards/${id}/votes/close`);
    const again = await owner.call("POST", `/api/boards/${id}/votes/session`, { limit: 5 });
    expect(again.statusCode).toBe(201);
    expect(again.json().mine).toEqual([]);
  });

  it("hides voting from people who can't open the board", async () => {
    const { id } = await room("v8");
    const stranger = await user("v8-str");
    expect((await stranger.call("GET", `/api/boards/${id}/votes`)).statusCode).toBe(404);
    expect((await stranger.call("POST", `/api/boards/${id}/votes`, { objectId: "a" })).statusCode).toBe(404);
  });
});

describe("server time", () => {
  it("returns the server clock", async () => {
    const { app } = setup(claims("x"));
    const r = (await app.inject("/api/time")).json();
    expect(Math.abs(r.now - Date.now())).toBeLessThan(5000);
  });
});
