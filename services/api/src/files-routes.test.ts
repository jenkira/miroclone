import { describe, expect, it, vi } from "vitest";
import type { EntraClaims } from "@miroclone/shared";
import { SESSION_COOKIE } from "./app.js";
import { MAX_UPLOAD_BYTES } from "./files.js";
import { purgeExpiredBoards } from "@miroclone/server-core";
import { MemoryObjectStore } from "@miroclone/server-core";
import type { Scanner } from "./scanner.js";
import { db, setup, signIn } from "./testutil.js";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("pixels")]);
const EICAR = Buffer.concat([PNG, Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")]);

const scanner: Scanner = { scan: async (d) => (Buffer.from(d).includes("EICAR") ? { clean: false, signature: "Eicar-Signature" } : { clean: true }) };
const claims = (oid: string): EntraClaims => ({ oid, tid: "t1", name: oid, roles: ["Whiteboard.User"], amr: ["mfa"], groups: [] });

async function user(oid: string, extra: Record<string, unknown> = {}) {
  const s = setup(claims(oid), { t: 1000 }, extra);
  const c = (await signIn(s.app)).cookies[0]!.value;
  return { app: s.app, cookies: { [SESSION_COOKIE]: c } };
}
type U = Awaited<ReturnType<typeof user>>;
const newBoard = async (u: U) => (await u.app.inject({ method: "POST", url: "/api/boards", cookies: u.cookies, payload: { title: "B", classification: "OFFICIAL" } })).json().id as string;
const upload = (u: U, id: string, body: Buffer, type = "image/png") =>
  u.app.inject({ method: "POST", url: `/api/boards/${id}/files`, cookies: u.cookies, headers: { "content-type": type }, payload: body });

function fixture(name: string) {
  const store = new MemoryObjectStore();
  return { store, deps: { store, scanner }, name };
}

describe("file upload", () => {
  it("stores a scanned image and serves it to a board member with safe headers", async () => {
    const { store, deps } = fixture("a");
    const owner = await user("f-own", deps), viewer = await user("f-view", deps);
    const id = await newBoard(owner);
    await owner.app.inject({ method: "PUT", url: `/api/boards/${id}/members`, cookies: owner.cookies, payload: { type: "user", principalId: "f-view", role: "viewer" } });

    const up = await upload(owner, id, PNG);
    expect(up.statusCode).toBe(201);
    const { id: fileId, mimeType } = up.json();
    expect(mimeType).toBe("image/png");
    expect([...store.objects.keys()]).toEqual([`boards/${id}/${fileId}`]);

    const dl = await viewer.app.inject({ url: `/api/boards/${id}/files/${fileId}`, cookies: viewer.cookies });
    expect(dl.statusCode).toBe(200);
    expect(dl.rawPayload.equals(PNG)).toBe(true);
    expect(dl.headers["content-type"]).toBe("image/png");
    expect(dl.headers["x-content-type-options"]).toBe("nosniff");
    expect(String(dl.headers["content-security-policy"])).toContain("sandbox");
  });

  it("lets only editors upload, and hides the board from non-members", async () => {
    const { deps } = fixture("b");
    const owner = await user("p-own", deps), viewer = await user("p-view", deps), stranger = await user("p-str", deps);
    const id = await newBoard(owner);
    await owner.app.inject({ method: "PUT", url: `/api/boards/${id}/members`, cookies: owner.cookies, payload: { type: "user", principalId: "p-view", role: "viewer" } });
    expect((await upload(viewer, id, PNG)).statusCode).toBe(403);
    expect((await upload(stranger, id, PNG)).statusCode).toBe(404);
  });

  it("refuses malware, stores nothing, and audits it", async () => {
    const { store, deps } = fixture("c");
    const u = await user("m-own", deps);
    const id = await newBoard(u);
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const res = await upload(u, id, EICAR);
    const audit = write.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"action":"upload"'));
    write.mockRestore();
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("malware_found");
    expect(store.objects.size).toBe(0);
    expect(audit.some((l) => l.includes('"allowed":false') && l.includes("Eicar-Signature"))).toBe(true);
  });

  it("checks the content, not the declared type", async () => {
    const { deps } = fixture("d");
    const u = await user("t-own", deps);
    const id = await newBoard(u);
    expect((await upload(u, id, Buffer.from("<html><script>alert(1)</script></html>"))).statusCode).toBe(415);
    expect((await upload(u, id, Buffer.from("<html></html>"), "image/png")).statusCode).toBe(415);
    expect((await upload(u, id, PNG, "image/jpeg")).statusCode).toBe(415);
    expect((await upload(u, id, PNG, "application/octet-stream")).statusCode).toBe(201);
  });

  it("refuses an SVG with active content and accepts a plain one", async () => {
    const { deps } = fixture("e");
    const u = await user("s-own", deps);
    const id = await newBoard(u);
    const bad = await upload(u, id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "image/svg+xml");
    expect(bad.statusCode).toBe(422);
    expect(bad.json().reason).toBe("script");
    expect((await upload(u, id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>'), "image/svg+xml")).statusCode).toBe(201);
  });

  it("fails closed when the scanner is down or missing", async () => {
    const down = fixture("f");
    const u = await user("c-own", { store: down.store, scanner: { scan: async () => { throw new Error("connection refused"); } } });
    const id = await newBoard(u);
    expect((await upload(u, id, PNG)).statusCode).toBe(503);
    expect(down.store.objects.size).toBe(0);
    const none = await user("n-own", { store: new MemoryObjectStore() });
    const id2 = await newBoard(none);
    expect((await upload(none, id2, PNG)).statusCode).toBe(503);
  });

  it("won't serve a file through another board, or for a bad ID", async () => {
    const { deps } = fixture("g");
    const u = await user("x-own", deps);
    const a = await newBoard(u), b = await newBoard(u);
    const { id: fileId } = (await upload(u, a, PNG)).json();
    expect((await u.app.inject({ url: `/api/boards/${b}/files/${fileId}`, cookies: u.cookies })).statusCode).toBe(404);
    expect((await u.app.inject({ url: `/api/boards/${a}/files/not-a-uuid`, cookies: u.cookies })).statusCode).toBe(404);
    expect((await u.app.inject({ url: `/api/boards/${a}/files/${fileId}`, cookies: u.cookies })).statusCode).toBe(200);
  });

  it("rejects an upload over the size limit", async () => {
    const { deps } = fixture("h");
    const u = await user("z-own", deps);
    const id = await newBoard(u);
    expect((await upload(u, id, Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD_BYTES)]))).statusCode).toBe(413);
  });
});

describe("purge", () => {
  it("deletes stored files along with expired boards", async () => {
    const { store, deps } = fixture("i");
    const u = await user("g-own", deps);
    const id = await newBoard(u);
    await upload(u, id, PNG);
    expect(store.objects.size).toBe(1);
    await u.app.inject({ method: "DELETE", url: `/api/boards/${id}`, cookies: u.cookies });
    expect(await purgeExpiredBoards(db, store)).toEqual({ boards: 0, files: 0 });
    await db.query("UPDATE boards SET deleted_at = now() - interval '31 days' WHERE id = $1", [id]);
    expect(await purgeExpiredBoards(db, store)).toEqual({ boards: 1, files: 1 });
    expect(store.objects.size).toBe(0);
  });
});
