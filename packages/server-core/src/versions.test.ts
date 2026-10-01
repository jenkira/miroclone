import { PGlite } from "@electric-sql/pglite";
import { Board } from "@miroclone/shared";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { migrate, type Db } from "./db.js";
import { appendUpdate } from "./persistence.js";
import { deleteVersion, listVersions, pruneAutoVersions, snapshot, snapshotChangedBoards, versionState } from "./versions.js";

let db: Db;
beforeAll(async () => {
  db = new PGlite() as unknown as Db;
  await migrate(db);
  await db.query("INSERT INTO users (id, tenant_id, display_name) VALUES ('ann', 't', 'Ann')");
});
beforeEach(async () => { await db.query("DELETE FROM boards"); });

async function boardWith(texts: string[]) {
  const id = (await db.query<{ id: string }>("INSERT INTO boards (title, classification, created_by) VALUES ('B', 'OFFICIAL', 'ann') RETURNING id")).rows[0]!.id;
  const doc = new Y.Doc();
  const b = new Board(doc);
  const updates: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => updates.push(u));
  for (const t of texts) b.add({ type: "sticky", text: t });
  for (const u of updates) await appendUpdate(db, id, u);
  return id;
}
const age = (id: string, minutes: number) => db.query("UPDATE boards SET updated_at = now() - ($2 || ' minutes')::interval WHERE id = $1", [id, String(minutes)]);

describe("versions", () => {
  it("saves a named version that rebuilds the board", async () => {
    const id = await boardWith(["one", "two"]);
    const vid = await snapshot(db, id, { kind: "named", name: "  Before workshop ", userId: "ann" });
    const list = await listVersions(db, id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "named", name: "Before workshop", objectCount: 2, createdByName: "Ann" });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, (await versionState(db, id, vid))!);
    expect([...doc.getMap("objects").values()].map((o) => (o as { text: string }).text).sort()).toEqual(["one", "two"]);
  });

  it("keeps a version as it was after the board changes", async () => {
    const id = await boardWith(["one"]);
    const vid = await snapshot(db, id, { kind: "named", name: "v1" });
    const doc = new Y.Doc();
    const b = new Board(doc); const ups: Uint8Array[] = [];
    doc.on("update", (u: Uint8Array) => ups.push(u));
    b.add({ type: "sticky", text: "later" });
    for (const u of ups) await appendUpdate(db, id, u);
    const old = new Y.Doc(); Y.applyUpdate(old, (await versionState(db, id, vid))!);
    expect(old.getMap("objects").size).toBe(1);
  });

  it("won't return a version through another board", async () => {
    const a = await boardWith(["a"]), b = await boardWith(["b"]);
    const vid = await snapshot(db, a, { kind: "named", name: "x" });
    expect(await versionState(db, b, vid)).toBeUndefined();
    expect(await deleteVersion(db, b, vid)).toBe(false);
    expect(await deleteVersion(db, a, vid)).toBe(true);
  });

  it("takes an automatic version of a changed board after a quiet moment", async () => {
    const id = await boardWith(["x"]);
    expect(await snapshotChangedBoards(db)).toBe(0);      // still being edited
    await age(id, 5);
    expect(await snapshotChangedBoards(db)).toBe(1);
    expect(await snapshotChangedBoards(db)).toBe(0);      // nothing new since
    expect((await listVersions(db, id))[0]).toMatchObject({ kind: "auto", name: null });
  });

  it("waits between automatic versions, and skips unchanged and deleted boards", async () => {
    const id = await boardWith(["x"]);
    await age(id, 5); await snapshotChangedBoards(db);
    await db.query("UPDATE boards SET updated_at = now() - interval '2 minutes' WHERE id = $1", [id]);
    expect(await snapshotChangedBoards(db)).toBe(0);      // changed, but the last version is under 10 minutes old
    await db.query("UPDATE board_versions SET created_at = now() - interval '20 minutes'");
    expect(await snapshotChangedBoards(db)).toBe(1);
    const gone = await boardWith(["y"]); await age(gone, 30);
    await db.query("UPDATE boards SET deleted_at = now() WHERE id = $1", [gone]);
    expect(await snapshotChangedBoards(db)).toBe(0);
    const empty = (await db.query<{ id: string }>("INSERT INTO boards (title, classification, created_by, updated_at) VALUES ('E', 'OFFICIAL', 'ann', now() - interval '1 hour') RETURNING id")).rows[0]!.id;
    expect(await snapshotChangedBoards(db)).toBe(0);      // a board with no content has nothing to save
    void empty;
  });

  it("prunes old automatic versions and never a named one", async () => {
    const id = await boardWith(["x"]);
    for (let i = 0; i < 5; i++) await snapshot(db, id, { kind: "auto" });
    await snapshot(db, id, { kind: "named", name: "keep me" });
    await db.query("UPDATE board_versions SET created_at = now() - interval '1 day' WHERE name = 'keep me'");
    expect(await pruneAutoVersions(db, 3)).toBe(2);
    const list = await listVersions(db, id);
    expect(list.filter((v) => v.kind === "auto")).toHaveLength(3);
    expect(list.some((v) => v.name === "keep me")).toBe(true);
  });
});
