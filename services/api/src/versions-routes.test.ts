import { appendUpdate, indexStaleBoards } from "@miroclone/server-core";
import { Board, type EntraClaims } from "@miroclone/shared";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { SESSION_COOKIE } from "./app.js";
import { db, setup, signIn } from "./testutil.js";

const claims = (oid: string, groups: string[] = []): EntraClaims => ({ oid, tid: "t1", name: oid, roles: ["Whiteboard.User"], amr: ["mfa"], groups });
async function user(oid: string, groups: string[] = []) {
  const s = setup(claims(oid, groups));
  const cookies = { [SESSION_COOKIE]: (await signIn(s.app)).cookies[0]!.value };
  return { oid, call: (method: string, url: string, payload?: unknown) => s.app.inject({ method: method as never, url, cookies, payload: payload as never }) };
}
type U = Awaited<ReturnType<typeof user>>;

/** A board owned by `owner`, holding the given sticky notes in its stored document. */
async function boardWith(owner: U, texts: string[], title = "Board") {
  const id = (await owner.call("POST", "/api/boards", { title, classification: "OFFICIAL" })).json().id as string;
  const doc = new Y.Doc(); const b = new Board(doc); const ups: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => ups.push(u));
  for (const t of texts) b.add({ type: "sticky", text: t });
  for (const u of ups) await appendUpdate(db, id, u);
  return id;
}
const share = (owner: U, id: string, oid: string, role: string) => owner.call("PUT", `/api/boards/${id}/members`, { type: "user", principalId: oid, role, name: oid });

describe("version history routes", () => {
  it("saves a named version, lists it, and returns its state for a restore", async () => {
    const owner = await user("v-own");
    const id = await boardWith(owner, ["one", "two"]);
    expect((await owner.call("POST", `/api/boards/${id}/versions`, { name: "" })).statusCode).toBe(400);
    expect((await owner.call("POST", `/api/boards/${id}/versions`, { name: "x".repeat(101) })).statusCode).toBe(400);
    const v = await owner.call("POST", `/api/boards/${id}/versions`, { name: "Before the workshop" });
    expect(v.statusCode).toBe(201);
    const list = (await owner.call("GET", `/api/boards/${id}/versions`)).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "named", name: "Before the workshop", objectCount: 2 });
    expect(list[0]).not.toHaveProperty("state");

    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const r = await owner.call("POST", `/api/boards/${id}/versions/${v.json().id}/restore`);
    const audit = write.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"action":"version_restore"'));
    write.mockRestore();
    expect(r.statusCode).toBe(200);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(Buffer.from(r.json().state, "base64")));
    expect(doc.getMap("objects").size).toBe(2);
    expect(audit).toHaveLength(1);
  });

  it("limits versions to editors and owners, and hides them from strangers", async () => {
    const owner = await user("v2-own"), ed = await user("v2-ed"), vw = await user("v2-vw"), cm = await user("v2-cm"), stranger = await user("v2-str");
    const id = await boardWith(owner, ["x"]);
    await share(owner, id, ed.oid, "editor"); await share(owner, id, vw.oid, "viewer"); await share(owner, id, cm.oid, "commenter");
    const vid = (await owner.call("POST", `/api/boards/${id}/versions`, { name: "v" })).json().id;
    expect((await ed.call("POST", `/api/boards/${id}/versions`, { name: "by editor" })).statusCode).toBe(201);
    for (const u of [vw, cm]) {
      expect((await u.call("GET", `/api/boards/${id}/versions`)).statusCode).toBe(403);
      expect((await u.call("POST", `/api/boards/${id}/versions`, { name: "no" })).statusCode).toBe(403);
      expect((await u.call("POST", `/api/boards/${id}/versions/${vid}/restore`)).statusCode).toBe(403);
    }
    expect((await stranger.call("GET", `/api/boards/${id}/versions`)).statusCode).toBe(404);
    expect((await ed.call("DELETE", `/api/boards/${id}/versions/${vid}`)).statusCode).toBe(403);
    expect((await owner.call("DELETE", `/api/boards/${id}/versions/${vid}`)).statusCode).toBe(200);
  });

  it("won't restore a version through another board, or for a bad ID", async () => {
    const owner = await user("v3-own");
    const a = await boardWith(owner, ["a"]), b = await boardWith(owner, ["b"]);
    const vid = (await owner.call("POST", `/api/boards/${a}/versions`, { name: "a1" })).json().id;
    expect((await owner.call("POST", `/api/boards/${b}/versions/${vid}/restore`)).statusCode).toBe(404);
    expect((await owner.call("POST", `/api/boards/${a}/versions/nope/restore`)).statusCode).toBe(404);
  });
});

describe("search route", () => {
  it("finds content on boards the user can open, and nothing else", async () => {
    const ann = await user("s-ann"), bob = await user("s-bob");
    const id = await boardWith(ann, ["Kestrel launch checklist"], "Private plan");
    await indexStaleBoards(db);
    expect((await ann.call("GET", "/api/search?q=kestrel")).json().map((h: { id: string }) => h.id)).toEqual([id]);
    expect((await bob.call("GET", "/api/search?q=kestrel")).json()).toEqual([]);
    await share(ann, id, bob.oid, "viewer");
    const hit = (await bob.call("GET", "/api/search?q=kestrel")).json()[0];
    expect(hit).toMatchObject({ id, title: "Private plan", role: "viewer" });
  });

  it("needs a session, and copes with odd input", async () => {
    const { app } = setup(claims("x"));
    expect((await app.inject("/api/search?q=a")).statusCode).toBe(401);
    const u = await user("s-odd");
    for (const q of ["", "%20", "'; drop table boards; --", "a".repeat(500)]) expect((await u.call("GET", `/api/search?q=${encodeURIComponent(q)}`)).statusCode).toBe(200);
  });
});
