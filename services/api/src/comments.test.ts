import { describe, expect, it } from "vitest";
import type { EntraClaims } from "@miroclone/shared";
import { SESSION_COOKIE } from "./app.js";
import { mentionsIn } from "./comments.js";
import { setup, signIn } from "./testutil.js";

const claims = (oid: string, name = oid): EntraClaims => ({ oid, tid: "t1", name, roles: ["Whiteboard.User"], amr: ["mfa"], groups: [] });
async function user(oid: string, name = oid) {
  const s = setup(claims(oid, name));
  const c = (await signIn(s.app)).cookies[0]!.value;
  const cookies = { [SESSION_COOKIE]: c };
  const call = (method: string, url: string, payload?: unknown) => s.app.inject({ method: method as never, url, cookies, payload: payload as never });
  return { oid, call };
}
type U = Awaited<ReturnType<typeof user>>;

/** An owner with a board, plus users who hold the given roles on it. */
async function setupBoard(tag: string, roles: Record<string, string>) {
  const owner = await user(`${tag}-own`, "Owner");
  const id = (await owner.call("POST", "/api/boards", { title: "Board", classification: "PROTECTED" })).json().id as string;
  const users: Record<string, U> = {};
  for (const [name, role] of Object.entries(roles)) {
    users[name] = await user(`${tag}-${name}`, name);
    await owner.call("PUT", `/api/boards/${id}/members`, { type: "user", principalId: users[name]!.oid, role, name });
  }
  return { owner, id, users };
}

describe("mentions", () => {
  it("parses tokens and removes duplicates", () => {
    expect(mentionsIn("Hi @[Ann](u1) and @[Bob](u2), again @[Ann](u1)")).toEqual(["u1", "u2"]);
    expect(mentionsIn("no mention @ here, [x](y)")).toEqual([]);
  });
});

describe("comment threads", () => {
  it("lets a commenter start a thread anchored to an object, and members read it", async () => {
    const { owner, id, users } = await setupBoard("c1", { cm: "commenter", vw: "viewer" });
    const res = await users.cm!.call("POST", `/api/boards/${id}/comments`, { body: "Why this?", anchor: { objectId: "o1", x: 10, y: 20 } });
    expect(res.statusCode).toBe(201);
    const threads = (await users.vw!.call("GET", `/api/boards/${id}/comments`)).json();
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ id: res.json().threadId, anchor: { objectId: "o1", x: 10, y: 20 }, resolved: false });
    expect(threads[0].comments[0]).toMatchObject({ body: "Why this?", authorName: "cm" });
    void owner;
  });

  it("stops viewers and strangers from posting", async () => {
    const { id, users } = await setupBoard("c2", { vw: "viewer" });
    const stranger = await user("c2-str");
    expect((await users.vw!.call("POST", `/api/boards/${id}/comments`, { body: "hi" })).statusCode).toBe(403);
    expect((await stranger.call("POST", `/api/boards/${id}/comments`, { body: "hi" })).statusCode).toBe(404);
    expect((await stranger.call("GET", `/api/boards/${id}/comments`)).statusCode).toBe(404);
  });

  it("rejects empty, oversized, and badly anchored comments", async () => {
    const { owner, id } = await setupBoard("c3", {});
    const post = (b: unknown) => owner.call("POST", `/api/boards/${id}/comments`, b);
    expect((await post({ body: "   " })).statusCode).toBe(400);
    expect((await post({ body: "x".repeat(4001) })).statusCode).toBe(400);
    expect((await post({ body: "ok", anchor: { x: "nope" } })).statusCode).toBe(400);
    expect((await post({ body: "ok", anchor: { objectId: "x".repeat(65) } })).statusCode).toBe(400);
    expect((await post({ body: "ok", threadId: "00000000-0000-0000-0000-000000000000" })).statusCode).toBe(404);
  });

  it("replies join the thread, and a reply can't attach to a thread on another board", async () => {
    const { owner, id } = await setupBoard("c4", {});
    const other = (await owner.call("POST", "/api/boards", { title: "Other", classification: "OFFICIAL" })).json().id;
    const t = (await owner.call("POST", `/api/boards/${id}/comments`, { body: "first" })).json().threadId;
    expect((await owner.call("POST", `/api/boards/${id}/comments`, { body: "second", threadId: t })).statusCode).toBe(201);
    expect((await owner.call("POST", `/api/boards/${other}/comments`, { body: "sneaky", threadId: t })).statusCode).toBe(404);
    const threads = (await owner.call("GET", `/api/boards/${id}/comments`)).json();
    expect(threads[0].comments.map((c: { body: string }) => c.body)).toEqual(["first", "second"]);
  });

  it("resolves and reopens a thread", async () => {
    const { owner, id, users } = await setupBoard("c5", { cm: "commenter", vw: "viewer" });
    const t = (await owner.call("POST", `/api/boards/${id}/comments`, { body: "q" })).json().threadId;
    expect((await users.vw!.call("PUT", `/api/boards/${id}/threads/${t}/resolved`, { resolved: true })).statusCode).toBe(403);
    await users.cm!.call("PUT", `/api/boards/${id}/threads/${t}/resolved`, { resolved: true });
    expect((await owner.call("GET", `/api/boards/${id}/comments`)).json()[0]).toMatchObject({ resolved: true, resolvedBy: "c5-cm" });
    await owner.call("PUT", `/api/boards/${id}/threads/${t}/resolved`, { resolved: false });
    expect((await owner.call("GET", `/api/boards/${id}/comments`)).json()[0].resolved).toBe(false);
  });

  it("lets authors edit their own comments, and editors delete any", async () => {
    const { owner, id, users } = await setupBoard("c6", { cm: "commenter", ed: "editor" });
    const t = (await users.cm!.call("POST", `/api/boards/${id}/comments`, { body: "mine" })).json();
    const reply = (await users.cm!.call("POST", `/api/boards/${id}/comments`, { body: "reply", threadId: t.threadId })).json();
    expect((await users.cm!.call("PATCH", `/api/boards/${id}/comments/${reply.id}`, { body: "edited" })).statusCode).toBe(200);
    expect((await owner.call("PATCH", `/api/boards/${id}/comments/${reply.id}`, { body: "hijack" })).statusCode).toBe(403);
    const c = (await owner.call("GET", `/api/boards/${id}/comments`)).json()[0].comments[1];
    expect(c.body).toBe("edited"); expect(c.editedAt).not.toBeNull();
    const other = (await users.ed!.call("POST", `/api/boards/${id}/comments`, { body: "ed's" })).json();
    expect((await users.cm!.call("DELETE", `/api/boards/${id}/comments/${other.id}`)).statusCode).toBe(403);
    expect((await owner.call("DELETE", `/api/boards/${id}/comments/${other.id}`)).statusCode).toBe(200);
    await users.cm!.call("DELETE", `/api/boards/${id}/comments/${t.id}`);
    expect((await owner.call("GET", `/api/boards/${id}/comments`)).json()).toEqual([]);
  });
});

describe("notifications", () => {
  it("notifies a mentioned member, and shows only what they can open", async () => {
    const { owner, id, users } = await setupBoard("n1", { cm: "commenter" });
    await owner.call("POST", `/api/boards/${id}/comments`, { body: `Please look @[cm](${users.cm!.oid})` });
    const list = (await users.cm!.call("GET", "/api/notifications")).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "mention", boardId: id, classification: "PROTECTED", actorName: "Owner", read: false });
    expect((await owner.call("GET", "/api/notifications")).json()).toEqual([]);
  });

  it("ignores mentions of people who can't open the board, and self-mentions", async () => {
    const { owner, id } = await setupBoard("n2", {});
    const outsider = await user("n2-out");
    await owner.call("POST", `/api/boards/${id}/comments`, { body: `@[x](${outsider.oid}) and @[me](${owner.oid})` });
    expect((await outsider.call("GET", "/api/notifications")).json()).toEqual([]);
    expect((await owner.call("GET", "/api/notifications")).json()).toEqual([]);
  });

  it("lets a person who opened a board through a group be mentioned", async () => {
    const { owner, id } = await setupBoard("n3", {});
    const viaGroup = await user("n3-grp", "Group Person");
    await owner.call("PUT", `/api/boards/${id}/members`, { type: "group", principalId: "g-any", role: "commenter", name: "G" });
    // The group member isn't listed until they open the board.
    const s = setup({ ...claims("n3-grp", "Group Person"), groups: ["g-any"] });
    const cookie = (await signIn(s.app)).cookies[0]!.value;
    expect((await owner.call("GET", `/api/boards/${id}/mentionable`)).json().some((p: { id: string }) => p.id === "n3-grp")).toBe(false);
    await s.app.inject({ url: `/api/boards/${id}`, cookies: { [SESSION_COOKIE]: cookie } });
    expect((await owner.call("GET", `/api/boards/${id}/mentionable`)).json().some((p: { id: string }) => p.id === "n3-grp")).toBe(true);
    await owner.call("POST", `/api/boards/${id}/comments`, { body: "@[G](n3-grp)" });
    const n = await s.app.inject({ url: "/api/notifications", cookies: { [SESSION_COOKIE]: cookie } });
    expect(n.json()).toHaveLength(1);
    void viaGroup;
  });

  it("notifies earlier participants of a reply, with a mention taking precedence", async () => {
    const { owner, id, users } = await setupBoard("n4", { a: "commenter", b: "commenter" });
    const t = (await users.a!.call("POST", `/api/boards/${id}/comments`, { body: "start" })).json().threadId;
    await users.b!.call("POST", `/api/boards/${id}/comments`, { body: "me too", threadId: t });
    await owner.call("POST", `/api/boards/${id}/comments`, { body: `ping @[a](${users.a!.oid})`, threadId: t });
    const kinds = async (u: U) => (await u.call("GET", "/api/notifications")).json().map((n: { kind: string }) => n.kind).sort();
    // a started the thread: a hears b's reply, and the owner's message mentions a.
    expect(await kinds(users.a!)).toEqual(["mention", "reply"]);
    // b joined the thread: b hears the owner's message as a reply. b's own reply notifies b of nothing.
    expect(await kinds(users.b!)).toEqual(["reply"]);
    expect(await kinds(owner)).toEqual([]);
  });

  it("marks notifications read, one or all", async () => {
    const { owner, id, users } = await setupBoard("n5", { cm: "commenter" });
    for (const w of ["one", "two", "three"]) await owner.call("POST", `/api/boards/${id}/comments`, { body: `${w} @[cm](${users.cm!.oid})` });
    const first = (await users.cm!.call("GET", "/api/notifications")).json();
    expect(first).toHaveLength(3);
    await users.cm!.call("POST", "/api/notifications/read", { ids: [first[0].id] });
    expect((await users.cm!.call("GET", "/api/notifications")).json().filter((n: { read: boolean }) => n.read)).toHaveLength(1);
    await users.cm!.call("POST", "/api/notifications/read", {});
    expect((await users.cm!.call("GET", "/api/notifications")).json().every((n: { read: boolean }) => n.read)).toBe(true);
  });

  it("hides notifications after access is removed", async () => {
    const { owner, id, users } = await setupBoard("n6", { cm: "commenter" });
    await owner.call("POST", `/api/boards/${id}/comments`, { body: `@[cm](${users.cm!.oid})` });
    await owner.call("DELETE", `/api/boards/${id}/members/user/${users.cm!.oid}`);
    expect((await users.cm!.call("GET", "/api/notifications")).json()).toEqual([]);
  });
});
