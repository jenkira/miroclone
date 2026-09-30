import { PGlite } from "@electric-sql/pglite";
import { migrate, type Db } from "./db.js";
import { beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { appendUpdate, compact, loadDoc } from "./persistence.js";

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
});
