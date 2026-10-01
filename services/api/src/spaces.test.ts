import type { EntraClaims } from "@miroclone/shared";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "./app.js";
import { setup, signIn } from "./testutil.js";

const claims = (oid: string, isAdmin = false): EntraClaims => ({ oid, tid: "t1", name: oid, roles: [isAdmin ? "Whiteboard.Admin" : "Whiteboard.User"], amr: ["mfa"], groups: [] });
async function user(oid: string, isAdmin = false) {
  const s = setup(claims(oid, isAdmin));
  const cookies = { [SESSION_COOKIE]: (await signIn(s.app)).cookies[0]!.value };
  return { oid, call: (method: string, url: string, payload?: unknown) => s.app.inject({ method: method as never, url, cookies, payload: payload as never }) };
}
type U = Awaited<ReturnType<typeof user>>;
const mk = async (u: U, classification = "OFFICIAL") => (await u.call("POST", "/api/boards", { title: "B", classification })).json().id as string;
const share = (o: U, id: string, who: string, role: string) => o.call("PUT", `/api/boards/${id}/members`, { type: "user", principalId: who, role, name: who });

describe("organisation-wide visibility (IAM-8)", () => {
  it("gives everyone the chosen role, and ends when the owner turns it off", async () => {
    const owner = await user("v-owner"), other = await user("v-other");
    const id = await mk(owner);
    expect((await other.call("GET", `/api/boards/${id}`)).statusCode).toBe(404);
    expect((await owner.call("PUT", `/api/boards/${id}/visibility`, { role: "commenter" })).statusCode).toBe(200);
    expect((await other.call("GET", `/api/boards/${id}`)).statusCode).toBe(200);
    expect((await other.call("GET", `/api/boards/${id}/visibility`)).json().role).toBe("commenter");
    await owner.call("PUT", `/api/boards/${id}/visibility`, { role: null });
    expect((await other.call("GET", `/api/boards/${id}`)).statusCode).toBe(404);
  });

  it("doesn't put the board on everyone's dashboard", async () => {
    const owner = await user("v-owner2"), other = await user("v-other2");
    const id = await mk(owner);
    await owner.call("PUT", `/api/boards/${id}/visibility`, { role: "viewer" });
    const list = (await other.call("GET", "/api/boards")).json() as { id: string }[];
    expect(list.some((b) => b.id === id)).toBe(false);
  });

  it("blocks PROTECTED boards, and ends visibility when a board is raised to PROTECTED", async () => {
    const owner = await user("v-owner3"), other = await user("v-other3");
    const p = await mk(owner, "PROTECTED");
    expect((await owner.call("PUT", `/api/boards/${p}/visibility`, { role: "viewer" })).statusCode).toBe(400);
    const o = await mk(owner);
    await owner.call("PUT", `/api/boards/${o}/visibility`, { role: "viewer" });
    expect((await other.call("GET", `/api/boards/${o}`)).statusCode).toBe(200);
    await owner.call("PUT", `/api/boards/${o}/classification`, { classification: "PROTECTED" });
    expect((await other.call("GET", `/api/boards/${o}`)).statusCode).toBe(404);
  });

  it("lets only an owner change it", async () => {
    const owner = await user("v-owner4"), ed = await user("v-ed4");
    const id = await mk(owner);
    await share(owner, id, ed.oid, "editor");
    expect((await ed.call("PUT", `/api/boards/${id}/visibility`, { role: "viewer" })).statusCode).toBe(403);
  });
});

describe("ownership transfer (BRD-5)", () => {
  it("hands ownership to another person, and the previous owner becomes an editor", async () => {
    const a = await user("t-a"), b = await user("t-b");
    const id = await mk(a);
    expect((await a.call("POST", `/api/boards/${id}/transfer`, { userId: b.oid })).statusCode).toBe(200);
    const members = (await b.call("GET", `/api/boards/${id}/members`)).json() as { id: string; role: string }[];
    expect(members.find((m) => m.id === b.oid)?.role).toBe("owner");
    expect(members.find((m) => m.id === a.oid)?.role).toBe("editor");
    expect((await a.call("DELETE", `/api/boards/${id}`)).statusCode).toBe(403);
  });

  it("refuses a person who hasn't signed in, and a non-owner", async () => {
    const a = await user("t-c"), ed = await user("t-d");
    const id = await mk(a);
    await share(a, id, ed.oid, "editor");
    expect((await a.call("POST", `/api/boards/${id}/transfer`, { userId: "nobody-yet" })).statusCode).toBe(400);
    expect((await ed.call("POST", `/api/boards/${id}/transfer`, { userId: ed.oid })).statusCode).toBe(403);
  });

  it("lets a service administrator reassign a board they can't open", async () => {
    const a = await user("t-e"), admin = await user("t-admin", true), heir = await user("t-heir");
    const id = await mk(a);
    expect((await admin.call("GET", `/api/boards/${id}`)).statusCode).toBe(404);
    expect((await admin.call("POST", `/api/boards/${id}/transfer`, { userId: heir.oid })).statusCode).toBe(200);
    expect((await heir.call("DELETE", `/api/boards/${id}`)).statusCode).toBeLessThan(300);
  });
});

describe("spaces (BRD-3)", () => {
  it("shares every board in a space with the space's members", async () => {
    const owner = await user("s-owner"), member = await user("s-member");
    const space = (await owner.call("POST", "/api/spaces", { name: "Team" })).json().id as string;
    const id = await mk(owner);
    await owner.call("PUT", `/api/boards/${id}/space`, { spaceId: space });
    expect((await member.call("GET", `/api/boards/${id}`)).statusCode).toBe(404);
    await owner.call("PUT", `/api/spaces/${space}/members`, { type: "user", principalId: member.oid, role: "editor", name: member.oid });
    expect((await member.call("GET", `/api/boards/${id}`)).statusCode).toBe(200);
    const listed = (await member.call("GET", "/api/boards")).json() as { id: string; space_id: string; role: string }[];
    expect(listed.find((b) => b.id === id)).toMatchObject({ space_id: space, role: "editor" });
    expect((await member.call("GET", "/api/spaces")).json()).toEqual([{ id: space, name: "Team", role: "editor", boards: 1 }]);
    // Removing the member ends access.
    await owner.call("DELETE", `/api/spaces/${space}/members/user/${member.oid}`);
    expect((await member.call("GET", `/api/boards/${id}`)).statusCode).toBe(404);
  });

  it("maps a space owner to editor on the boards, not board owner", async () => {
    const owner = await user("s-o2"), so = await user("s-so");
    const space = (await owner.call("POST", "/api/spaces", { name: "Ops" })).json().id as string;
    const id = await mk(owner);
    await owner.call("PUT", `/api/boards/${id}/space`, { spaceId: space });
    await owner.call("PUT", `/api/spaces/${space}/members`, { type: "user", principalId: so.oid, role: "owner" });
    expect((await so.call("PUT", `/api/boards/${id}/classification`, { classification: "SENSITIVE" })).statusCode).toBe(403);
    expect((await so.call("PATCH", `/api/boards/${id}`, { title: "Renamed" })).statusCode).toBeLessThan(300);
  });

  it("stops a person moving a board into a space they can't edit, or out of a board they don't own", async () => {
    const a = await user("s-a"), b = await user("s-b");
    const space = (await a.call("POST", "/api/spaces", { name: "Mine" })).json().id as string;
    const theirs = await mk(b);
    expect((await b.call("PUT", `/api/boards/${theirs}/space`, { spaceId: space })).statusCode).toBe(404);
    await a.call("PUT", `/api/spaces/${space}/members`, { type: "user", principalId: b.oid, role: "viewer" });
    expect((await b.call("PUT", `/api/boards/${theirs}/space`, { spaceId: space })).statusCode).toBe(403);
    const mine = await mk(a);
    await share(a, mine, b.oid, "editor");
    expect((await b.call("PUT", `/api/boards/${mine}/space`, { spaceId: null })).statusCode).toBe(403);
  });

  it("keeps the boards when a space is deleted, with their own grants", async () => {
    const a = await user("s-del"), m = await user("s-delm");
    const space = (await a.call("POST", "/api/spaces", { name: "Temp" })).json().id as string;
    const id = await mk(a);
    await a.call("PUT", `/api/boards/${id}/space`, { spaceId: space });
    await a.call("PUT", `/api/spaces/${space}/members`, { type: "user", principalId: m.oid, role: "viewer" });
    expect((await m.call("DELETE", `/api/spaces/${space}`)).statusCode).toBe(403);
    expect((await a.call("DELETE", `/api/spaces/${space}`)).statusCode).toBe(200);
    expect((await a.call("GET", `/api/boards/${id}`)).statusCode).toBe(200);
    expect((await m.call("GET", `/api/boards/${id}`)).statusCode).toBe(404);
  });

  it("keeps at least one owner", async () => {
    const a = await user("s-last");
    const space = (await a.call("POST", "/api/spaces", { name: "Solo" })).json().id as string;
    expect((await a.call("DELETE", `/api/spaces/${space}/members/user/${a.oid}`)).statusCode).toBe(400);
  });
});

describe("thumbnails (BRD-2)", () => {
  it("returns a sandboxed image for someone who can open the board, and nothing for anyone else", async () => {
    const owner = await user("th-owner"), other = await user("th-other");
    const id = await mk(owner);
    const ok = await owner.call("GET", `/api/boards/${id}/thumbnail`);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toBe("image/svg+xml");
    expect(ok.headers["content-security-policy"]).toContain("sandbox");
    expect((await other.call("GET", `/api/boards/${id}/thumbnail`)).statusCode).toBe(404);
  });
});

describe("markers and caveats (PMK-6)", () => {
  it("lets an administrator list them, an owner choose them, and returns them with the board", async () => {
    const admin = await user("mk-admin", true), owner = await user("mk-owner"), other = await user("mk-other");
    expect((await owner.call("PUT", "/api/admin/markers", [{ key: "X", label: "X" }])).statusCode).toBe(403);
    expect((await admin.call("PUT", "/api/admin/markers", [{ key: "CABINET", label: "Cabinet" }, { key: "SIC", label: "Staff-in-confidence" }])).statusCode).toBe(200);
    expect((await other.call("GET", "/api/markers")).json().map((m: { key: string }) => m.key)).toEqual(["CABINET", "SIC"]);
    const id = await mk(owner, "PROTECTED");
    expect((await owner.call("PUT", `/api/boards/${id}/markers`, { markers: ["CABINET", "CABINET"] })).json()).toEqual({ markers: ["CABINET"] });
    expect((await owner.call("GET", `/api/boards/${id}`)).json().markers).toEqual(["CABINET"]);
    await admin.call("PUT", "/api/admin/markers", [{ key: "CABINET", label: "Cabinet" }, { key: "SIC", label: "Staff-in-confidence" }]);
  });

  it("refuses an unknown marker, a non-owner, and removing a marker that a board carries", async () => {
    const admin = await user("mk-admin2", true), owner = await user("mk-owner2"), editor = await user("mk-editor2");
    await admin.call("PUT", "/api/admin/markers", [{ key: "CABINET", label: "Cabinet" }]);
    const id = await mk(owner);
    await share(owner, id, editor.oid, "editor");
    expect((await owner.call("PUT", `/api/boards/${id}/markers`, { markers: ["NOPE"] })).statusCode).toBe(400);
    expect((await editor.call("PUT", `/api/boards/${id}/markers`, { markers: ["CABINET"] })).statusCode).toBe(403);
    await owner.call("PUT", `/api/boards/${id}/markers`, { markers: ["CABINET"] });
    expect((await admin.call("PUT", "/api/admin/markers", [])).statusCode).toBe(400);
    await owner.call("PUT", `/api/boards/${id}/markers`, { markers: [] });
    // The first test's board still carries CABINET, so it stays in the list. Once nothing carries a marker, it can go.
    expect((await admin.call("PUT", "/api/admin/markers", [{ key: "CABINET", label: "Cabinet" }, { key: "A", label: "A" }])).statusCode).toBe(200);
    expect((await admin.call("PUT", "/api/admin/markers", [{ key: "CABINET", label: "Cabinet" }, { key: "A", label: "A" }, { key: "A", label: "B" }])).statusCode).toBe(400);
  });
});
