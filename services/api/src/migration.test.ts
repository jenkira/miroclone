import { exportJson, type BoardObject, type EntraClaims } from "@miroclone/shared";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "./app.js";
import { db, graphCalls, setup, signIn } from "./testutil.js";

const claims = (oid: string, isAdmin = false): EntraClaims => ({ oid, tid: "t1", name: oid, roles: [isAdmin ? "Whiteboard.Admin" : "Whiteboard.User"], amr: ["mfa"], groups: [] });
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

/** An in-memory store and a scanner that flags files that hold "EICAR". */
function storage() {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    store: { put: async (k: string, b: Uint8Array) => { files.set(k, b); }, get: async (k: string) => files.get(k), delete: async (k: string) => { files.delete(k); } },
    scanner: { scan: async (b: Uint8Array) => (Buffer.from(b).includes("EICAR") ? { clean: false, signature: "Eicar" } : { clean: true }) },
  };
}

async function user(oid: string, isAdmin = false, extra = {}) {
  const s = setup(claims(oid, isAdmin), { t: 1000 }, extra);
  const cookies = { [SESSION_COOKIE]: (await signIn(s.app)).cookies[0]!.value };
  return { oid, call: (method: string, url: string, payload?: unknown) => s.app.inject({ method: method as never, url, cookies, payload: payload as never }) };
}

const base = { index: "a0", rotation: 0, locked: false };
const sticky = (id: string, text: string): BoardObject => ({ ...base, id, type: "sticky", x: 0, y: 0, width: 100, height: 100, text, color: "#fff475" });
const image = (id: string, name: string): BoardObject => ({ ...base, id, type: "image", x: 200, y: 0, width: 100, height: 100, objectKey: `file:${name}`, mimeType: "image/png" });
const file = (objs: BoardObject[], title = "Migrated") => exportJson(objs, { title, classification: "OFFICIAL" });
const imp = (u: Awaited<ReturnType<typeof user>>, body: Record<string, unknown>) => u.call("POST", "/api/admin/migration/import", { classification: "SENSITIVE", ...body });

describe("bulk import of migrated boards (MIG-5)", () => {
  it("is for administrators only", async () => {
    const plain = await user("mig-plain");
    expect((await imp(plain, { board: file([sticky("a", "x")]) })).statusCode).toBe(403);
  });

  it("sets the classification, and makes the matching person the owner", async () => {
    const owner = await user("mig-owner");   // Signs in, so the users table has them.
    await db.query("UPDATE users SET email = 'owner@example.test' WHERE id = 'mig-owner'");
    const admin = await user("mig-admin", true);
    const r = await imp(admin, { board: file([sticky("a", "hello")], "Q3 Plan"), ownerEmail: "Owner@Example.test", classification: "PROTECTED" });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ ownerId: "mig-owner", ownerResolved: true, objects: 1 });
    const id = r.json().id as string;
    const board = (await owner.call("GET", `/api/boards/${id}`)).json();
    expect(board).toMatchObject({ title: "Q3 Plan", classification: "PROTECTED" });
    expect((await owner.call("GET", `/api/boards/${id}/members`)).json()).toEqual([expect.objectContaining({ id: "mig-owner", role: "owner" })]);
    // The administrator isn't a member, so they don't see board content they didn't need to.
    expect((await admin.call("GET", `/api/boards/${id}`)).statusCode).toBe(404);
  });

  it("finds a person who hasn't signed in yet in the directory, and creates their record", async () => {
    const admin = await user("mig-admin2", true);
    const before = graphCalls.length;
    // The fake directory returns eng@x.test as u-eng.
    const r = await imp(admin, { board: file([sticky("a", "x")]), ownerEmail: "eng@x.test" });
    expect(r.json()).toMatchObject({ ownerId: "u-eng", ownerResolved: true });
    expect(graphCalls.slice(before).some((c) => c.url.includes("/users?") && c.url.includes("filter"))).toBe(true);
    expect((await db.query("SELECT email, tenant_id FROM users WHERE id = 'u-eng'")).rows[0]).toMatchObject({ email: "eng@x.test", tenant_id: "t1" });
  });

  it("keeps the board with the administrator when no one matches", async () => {
    const admin = await user("mig-admin3", true);
    const r = await imp(admin, { board: file([sticky("a", "x")]), ownerEmail: "nobody@example.test" });
    expect(r.json()).toMatchObject({ ownerId: "mig-admin3", ownerResolved: false });
    expect((await admin.call("GET", `/api/boards/${r.json().id}`)).statusCode).toBe(200);
  });

  it("refuses an unknown classification and a bad file", async () => {
    const admin = await user("mig-admin4", true);
    expect((await imp(admin, { board: file([sticky("a", "x")]), classification: "TOP_SECRET" })).statusCode).toBe(400);
    expect((await imp(admin, { board: "not json" })).statusCode).toBe(400);
    expect((await imp(admin, { board: JSON.stringify({ format: "other" }) })).statusCode).toBe(400);
  });

  it("refuses a second import of the same Miro board, but allows it again after the board is deleted", async () => {
    const admin = await user("mig-admin5", true);
    const body = { board: file([sticky("a", "x")]), sourceId: `miro-${Date.now()}` };
    const first = await imp(admin, body);
    expect(first.statusCode).toBe(201);
    expect((await imp(admin, body)).statusCode).toBe(409);
    await admin.call("DELETE", `/api/boards/${first.json().id}`);
    expect((await imp(admin, body)).statusCode).toBe(201);
  });

  describe("images", () => {
    it("stores a clean image through the upload checks, and points the board at it", async () => {
      const st = storage();
      const admin = await user("mig-admin6", true, { store: st.store, scanner: st.scanner });
      const r = await imp(admin, { board: file([image("i", "files/a.png")]), files: [{ name: "files/a.png", data: PNG.toString("base64") }] });
      expect(r.json()).toMatchObject({ images: 1, imageProblems: [] });
      const id = r.json().id as string;
      const row = (await db.query<{ id: string; mime_type: string }>("SELECT id, mime_type FROM board_files WHERE board_id = $1", [id])).rows;
      expect(row).toHaveLength(1);
      expect(row[0]!.mime_type).toBe("image/png");
      expect([...st.files.keys()][0]).toBe(`boards/${id}/${row[0]!.id}`);
    });

    it("replaces an image with a placeholder when it fails a check, and reports why", async () => {
      const st = storage();
      const admin = await user("mig-admin7", true, { store: st.store, scanner: st.scanner });
      const r = await imp(admin, {
        board: file([image("m", "files/missing.png"), image("v", "files/virus.png"), image("t", "files/text.png"), sticky("s", "keep")]),
        files: [
          { name: "files/virus.png", data: Buffer.concat([PNG, Buffer.from("EICAR")]).toString("base64") },
          { name: "files/text.png", data: Buffer.from("<html>hi</html>").toString("base64") },
        ],
      });
      expect(r.statusCode).toBe(201);
      expect(r.json().images).toBe(0);
      expect(r.json().imageProblems.map((p: { name: string }) => p.name).sort()).toEqual(["files/missing.png", "files/text.png", "files/virus.png"]);
      expect(st.files.size).toBe(0);
      expect(r.json().objects).toBe(4);
    });

    it("stores nothing when uploads are unavailable", async () => {
      const admin = await user("mig-admin8", true);
      const r = await imp(admin, { board: file([image("i", "files/a.png")]), files: [{ name: "files/a.png", data: PNG.toString("base64") }] });
      expect(r.json().images).toBe(0);
      expect(r.json().imageProblems[0].reason).toContain("unavailable");
    });
  });
});
