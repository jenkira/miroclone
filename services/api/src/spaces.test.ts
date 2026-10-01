import { archiveStaleBoards } from "@miroclone/server-core";
import type { EntraClaims } from "@miroclone/shared";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "./app.js";
import { db, setup, signIn } from "./testutil.js";

const claims = (oid: string, isAdmin = false): EntraClaims => ({ oid, tid: "t1", name: oid, roles: [isAdmin ? "Whiteboard.Admin" : "Whiteboard.User"], amr: ["mfa"], groups: [] });
async function user(oid: string, isAdmin = false, extra: Parameters<typeof setup>[2] = {}) {
  const s = setup(claims(oid, isAdmin), { t: 1000 }, extra);
  const cookies = { [SESSION_COOKIE]: (await signIn(s.app)).cookies[0]!.value };
  return {
    oid,
    call: (method: string, url: string, payload?: unknown) => s.app.inject({ method: method as never, url, cookies, payload: payload as never }),
    /** A request with its own headers and a raw body, as an upload needs. */
    raw: (method: string, url: string, payload: Buffer, headers: Record<string, string>) => s.app.inject({ method: method as never, url, cookies, headers, payload }),
  };
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

describe("retention and archiving (ADM-4)", () => {
  const age = (id: string, months: number) => db.query("UPDATE boards SET last_opened_at = now() - ($2 || ' months')::interval WHERE id = $1", [id, String(months)]);

  it("is set by administrators only, and takes a whole number of months or off", async () => {
    const admin = await user("rt-admin", true), plain = await user("rt-plain");
    expect((await plain.call("PUT", "/api/admin/retention", { archiveAfterMonths: 12 })).statusCode).toBe(403);
    for (const bad of [0, -1, 1.5, 121, "12"]) expect((await admin.call("PUT", "/api/admin/retention", { archiveAfterMonths: bad })).statusCode).toBe(400);
    expect((await admin.call("PUT", "/api/admin/retention", { archiveAfterMonths: 12 })).json()).toEqual({ archiveAfterMonths: 12 });
    expect((await admin.call("GET", "/api/admin/retention")).json()).toEqual({ archiveAfterMonths: 12 });
    await admin.call("PUT", "/api/admin/retention", { archiveAfterMonths: null });
  });

  it("archives only boards nobody has opened for the time, and not when the rule is off", async () => {
    const admin = await user("rt-admin2", true), owner = await user("rt-owner");
    const stale = await mk(owner), fresh = await mk(owner), binned = await mk(owner);
    await age(stale, 14); await age(fresh, 2); await age(binned, 14);
    await owner.call("DELETE", `/api/boards/${binned}`);
    await admin.call("PUT", "/api/admin/retention", { archiveAfterMonths: null });
    expect(await archiveStaleBoards(db)).toEqual([]);
    await admin.call("PUT", "/api/admin/retention", { archiveAfterMonths: 12 });
    expect(await archiveStaleBoards(db)).toContain(stale);
    const archived = await archiveStaleBoards(db);
    expect(archived).not.toContain(fresh);
    expect(archived).not.toContain(binned);
    const rows = (await db.query<{ id: string; archived_at: string | null }>("SELECT id, archived_at FROM boards WHERE id = ANY($1::uuid[])", [[stale, fresh, binned]])).rows;
    expect(rows.find((r) => r.id === stale)!.archived_at).not.toBeNull();
    expect(rows.find((r) => r.id === fresh)!.archived_at).toBeNull();
    expect(rows.find((r) => r.id === binned)!.archived_at).toBeNull();
    await admin.call("PUT", "/api/admin/retention", { archiveAfterMonths: null });
  });

  it("makes an archived board read-only for everyone, hides it from the default lists, and lets its owner restore it", async () => {
    const owner = await user("rt-owner2"), editor = await user("rt-editor2");
    const id = await mk(owner);
    await share(owner, id, editor.oid, "editor");
    expect((await owner.call("POST", `/api/boards/${id}/archive`)).statusCode).toBe(200);
    expect((await owner.call("GET", `/api/boards/${id}`)).json()).toMatchObject({ role: "viewer", canRestore: true });
    expect((await editor.call("GET", `/api/boards/${id}`)).json()).toMatchObject({ role: "viewer", canRestore: false });
    expect((await owner.call("PATCH", `/api/boards/${id}`, { title: "No" })).statusCode).toBe(403);
    expect((await owner.call("PUT", `/api/boards/${id}/members`, { type: "user", principalId: "x", role: "viewer" })).statusCode).toBe(403);
    const recent = (await owner.call("GET", "/api/boards")).json() as { id: string }[];
    expect(recent.some((b) => b.id === id)).toBe(false);
    const list = (await owner.call("GET", "/api/boards?filter=archived")).json() as { id: string }[];
    expect(list.some((b) => b.id === id)).toBe(true);
    expect((await editor.call("POST", `/api/boards/${id}/unarchive`)).statusCode).toBe(403);
    expect((await owner.call("POST", `/api/boards/${id}/unarchive`)).statusCode).toBe(200);
    expect((await owner.call("GET", `/api/boards/${id}`)).json()).toMatchObject({ role: "owner", archived_at: null });
    expect((await owner.call("PATCH", `/api/boards/${id}`, { title: "Yes" })).statusCode).toBe(200);
  });

  it("lets an owner delete an archived board, and keeps a restored board from being archived again at once", async () => {
    const owner = await user("rt-owner3");
    const id = await mk(owner);
    await age(id, 30);
    await owner.call("POST", `/api/boards/${id}/archive`);
    await owner.call("POST", `/api/boards/${id}/unarchive`);
    const { rows } = await db.query<{ months: string }>("SELECT extract(day from now() - last_opened_at) AS months FROM boards WHERE id = $1", [id]);
    expect(Number(rows[0]!.months)).toBe(0);
    await owner.call("POST", `/api/boards/${id}/archive`);
    expect((await owner.call("DELETE", `/api/boards/${id}`)).statusCode).toBe(200);
  });

  it("restarts the clock when a board is opened, at most once an hour", async () => {
    const owner = await user("rt-owner4");
    const id = await mk(owner);
    await age(id, 3);
    await owner.call("GET", `/api/boards/${id}`);
    const { rows } = await db.query<{ days: string }>("SELECT extract(day from now() - last_opened_at) AS days FROM boards WHERE id = $1", [id]);
    expect(Number(rows[0]!.days)).toBe(0);
  });
});

describe("link previews and PDF uploads (CNV-17)", () => {
  const page = (title: string) => new Response(`<head><title>${title}</title></head>`, { headers: { "content-type": "text/html" } });

  it("fetches only from hosts an administrator allowed, and only for people who can edit", async () => {
    const calls: string[] = [];
    const previewDeps = { fetchImpl: (async (u: string) => { calls.push(u); return page("Handbook"); }) as unknown as typeof fetch, resolve: async () => ["10.0.0.5"] };
    const admin = await user("lp-admin", true, { previewDeps }), owner = await user("lp-owner", false, { previewDeps }), viewer = await user("lp-viewer", false, { previewDeps });
    const id = await mk(owner);
    await share(owner, id, viewer.oid, "viewer");
    const get = (u: typeof owner, url: string) => u.call("GET", `/api/boards/${id}/link-preview?url=${encodeURIComponent(url)}`);

    // Nothing is allowed at first, so nothing is fetched.
    expect((await get(owner, "https://wiki.corp.internal/h")).json()).toMatchObject({ title: "wiki.corp.internal", fetched: false });
    expect(calls).toEqual([]);

    expect((await owner.call("PUT", "/api/admin/link-preview-hosts", ["wiki.corp.internal"])).statusCode).toBe(403);
    expect((await admin.call("PUT", "/api/admin/link-preview-hosts", ["Wiki.Corp.Internal", "*.docs.internal", "wiki.corp.internal"])).json()).toEqual(["wiki.corp.internal", "*.docs.internal"]);
    expect((await get(owner, "https://wiki.corp.internal/h")).json()).toMatchObject({ title: "Handbook", fetched: true });
    expect(calls).toEqual(["https://wiki.corp.internal/h"]);
    // A repeat comes from the cache.
    await get(owner, "https://wiki.corp.internal/h");
    expect(calls).toHaveLength(1);

    expect((await get(owner, "https://example.com/")).json().fetched).toBe(false);
    expect((await get(viewer, "https://wiki.corp.internal/h")).statusCode).toBe(403);
    expect((await get(owner, "javascript:alert(1)")).statusCode).toBe(400);
    await admin.call("PUT", "/api/admin/link-preview-hosts", []);
  });

  it("refuses host entries that aren't host names", async () => {
    const admin = await user("lp-admin2", true);
    for (const bad of ["http://wiki", "wiki/path", "a b", "-x", ""]) expect((await admin.call("PUT", "/api/admin/link-preview-hosts", [bad])).statusCode).toBe(400);
  });

  it("hides the board from someone with no access", async () => {
    const owner = await user("lp-owner2"), stranger = await user("lp-stranger");
    const id = await mk(owner);
    expect((await stranger.call("GET", `/api/boards/${id}/link-preview?url=https://x.test/`)).statusCode).toBe(404);
  });

  it("stores a PDF through the upload checks, reports its pages, and refuses an active one", async () => {
    const files = new Map<string, Uint8Array>();
    const store = { put: async (k: string, b: Uint8Array) => { files.set(k, b); }, get: async (k: string) => files.get(k), delete: async (k: string) => { files.delete(k); } };
    const scanner = { scan: async () => ({ clean: true }) };
    const owner = await user("pdf-owner", false, { store, scanner });
    const id = await mk(owner);
    const up = (body: string, type = "application/pdf") => owner.raw("POST", `/api/boards/${id}/files`, Buffer.from(body, "latin1"), { "content-type": type });
    const good = await up("%PDF-1.4\n1 0 obj << /Type /Pages >> endobj 2 0 obj << /Type /Page >> endobj 3 0 obj << /Type /Page >> endobj\n%%EOF");
    expect(good.statusCode).toBe(201);
    expect(good.json()).toMatchObject({ mimeType: "application/pdf", pages: 2 });
    expect([...files.keys()]).toHaveLength(1);
    const bad = await up("%PDF-1.4\n1 0 obj << /OpenAction << /S /JavaScript /JS (x) >> >> endobj");
    expect(bad.statusCode).toBe(422);
    expect(bad.json()).toMatchObject({ error: "pdf_not_allowed" });
    expect((await up("%PDF-1.4\n", "image/png")).statusCode).toBe(415);
    expect(files.size).toBe(1);
  });
});

describe("Teams notifications switch (COL-9)", () => {
  it("is off by default, changes only for administrators, and takes only true or false", async () => {
    const admin = await user("tm-admin", true), plain = await user("tm-plain");
    expect((await plain.call("GET", "/api/admin/teams-notifications")).statusCode).toBe(403);
    expect((await plain.call("PUT", "/api/admin/teams-notifications", { enabled: true })).statusCode).toBe(403);
    expect((await admin.call("GET", "/api/admin/teams-notifications")).json()).toEqual({ enabled: false });
    expect((await admin.call("PUT", "/api/admin/teams-notifications", { enabled: "yes" })).statusCode).toBe(400);
    expect((await admin.call("PUT", "/api/admin/teams-notifications", { enabled: true })).json()).toEqual({ enabled: true });
    expect((await admin.call("GET", "/api/admin/teams-notifications")).json()).toEqual({ enabled: true });
    await admin.call("PUT", "/api/admin/teams-notifications", { enabled: false });
    expect((await admin.call("GET", "/api/admin/teams-notifications")).json()).toEqual({ enabled: false });
  });
});
