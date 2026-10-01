import { PGlite } from "@electric-sql/pglite";
import { migrate, type Db } from "./db.js";
import { beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { appendUpdate, compact, compactBusyBoards, loadDoc } from "./persistence.js";

let db: Db;
let boardId: string;

beforeAll(async () => {
  db = new PGlite() as unknown as Db;
  await migrate(db);
  await db.query("INSERT INTO users (id, tenant_id, display_name) VALUES ('u', 't', 'U')");
  boardId = (await db.query<{ id: string }>("INSERT INTO boards (title, classification, created_by) VALUES ('B', 'OFFICIAL', 'u') RETURNING id")).rows[0]!.id;
});

function edit(doc: Y.Doc, n: number, prefix = "o") {
  const updates: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => updates.push(u));
  for (let i = 0; i < n; i++) doc.getMap("objects").set(`${prefix}${i}`, { i });
  return updates;
}

describe("persistence", () => {
  it("round-trips a document through stored updates", async () => {
    const src = new Y.Doc();
    for (const u of edit(src, 5)) await appendUpdate(db, boardId, u);
    const loaded = await loadDoc(db, boardId);
    expect(loaded.getMap("objects").size).toBe(5);
  });

  it("compacts many updates into one without changing the document", async () => {
    const src = await loadDoc(db, boardId);
    for (const u of edit(src, 10, "p")) await appendUpdate(db, boardId, u);
    expect(await compact(db, boardId, 100)).toBe(false);
    expect(await compact(db, boardId, 5)).toBe(true);
    const n = (await db.query<{ n: string }>("SELECT count(*) AS n FROM board_updates WHERE board_id = $1", [boardId])).rows[0]!.n;
    expect(Number(n)).toBe(1);
    expect((await loadDoc(db, boardId)).getMap("objects").size).toBe(15);
  });

  it("reads no update data when the board is under the threshold", async () => {
    const src = await loadDoc(db, boardId);
    for (const u of edit(src, 3, "q")) await appendUpdate(db, boardId, u);
    const seen: string[] = [];
    const spy = { ...db, query: (sql: string, params?: unknown[]) => { seen.push(sql); return db.query(sql, params as never); } } as typeof db;
    expect(await compact(spy, boardId, 200)).toBe(false);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("count(*)");
    expect(seen[0]).not.toContain("data");
  });

  it("keeps an update that arrives after the count", async () => {
    const src = await loadDoc(db, boardId);
    const first = edit(src, 4, "r");
    for (const u of first) await appendUpdate(db, boardId, u);
    let late: Uint8Array | undefined;
    const lateEdit = edit(src, 1, "late")[0]!;
    // The late update lands between the count and the merge.
    const racing = { ...db, query: async (sql: string, params?: unknown[]) => {
      const r = await db.query(sql, params as never);
      if (sql.includes("count(*)") && !late) { late = lateEdit; await appendUpdate(db, boardId, lateEdit); }
      return r;
    } } as typeof db;
    expect(await compact(racing, boardId, 2)).toBe(true);
    const objects = (await loadDoc(db, boardId)).getMap("objects");
    expect([...objects.keys()].some((k) => k.startsWith("late"))).toBe(true);
  });

  it("compacts only the boards over the threshold", async () => {
    const busy = (await db.query<{ id: string }>("INSERT INTO boards (title, classification, created_by) VALUES ('busy', 'OFFICIAL', 'u') RETURNING id")).rows[0]!.id;
    const quiet = (await db.query<{ id: string }>("INSERT INTO boards (title, classification, created_by) VALUES ('quiet', 'OFFICIAL', 'u') RETURNING id")).rows[0]!.id;
    for (const u of edit(await loadDoc(db, busy), 8, "b")) await appendUpdate(db, busy, u);
    for (const u of edit(await loadDoc(db, quiet), 2, "c")) await appendUpdate(db, quiet, u);
    const count = async (id: string) => Number((await db.query<{ n: string }>("SELECT count(*) AS n FROM board_updates WHERE board_id = $1", [id])).rows[0]!.n);
    expect(await compactBusyBoards(db, 5, 10)).toBeGreaterThanOrEqual(1);
    expect(await count(busy)).toBe(1);
    expect(await count(quiet)).toBe(2);
    expect((await loadDoc(db, busy)).getMap("objects").size).toBe(8);
  });
});
