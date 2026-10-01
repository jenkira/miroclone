import { PGlite } from "@electric-sql/pglite";
import { Board } from "@miroclone/shared";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { migrate, type Db } from "./db.js";
import { appendUpdate } from "./persistence.js";
import { indexBoard, indexStaleBoards, MARK_END, MARK_START, searchBoards, toTsQuery } from "./search.js";

let db: Db;
const ann = { id: "ann", groups: ["g-eng"] }, bob = { id: "bob", groups: [] }, eve = { id: "eve", groups: ["g-eng"] };

beforeAll(async () => {
  db = new PGlite() as unknown as Db;
  await migrate(db);
  await db.query("INSERT INTO users (id, tenant_id, display_name) VALUES ('ann','t','Ann'),('bob','t','Bob'),('eve','t','Eve')");
});
beforeEach(async () => { await db.query("DELETE FROM boards"); });

async function board(title: string, texts: string[], owner = "ann") {
  const id = (await db.query<{ id: string }>("INSERT INTO boards (title, classification, created_by) VALUES ($1, 'OFFICIAL', $2) RETURNING id", [title, owner])).rows[0]!.id;
  await db.query("INSERT INTO board_members VALUES ($1, 'user', $2, 'owner')", [id, owner]);
  const doc = new Y.Doc(); const b = new Board(doc); const ups: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => ups.push(u));
  for (const t of texts) b.add({ type: "sticky", text: t });
  for (const u of ups) await appendUpdate(db, id, u);
  await indexBoard(db, id);
  return id;
}

describe("toTsQuery", () => {
  it("builds a prefix query from words only", () => {
    expect(toTsQuery("Budget rev")).toBe("budget:* & rev:*");
    expect(toTsQuery("  ")).toBeUndefined();
    expect(toTsQuery("'; DROP TABLE boards; --")).toBe("drop:* & table:* & boards:*");
    expect(toTsQuery("a & b | !c <-> (d)")).toBe("a:* & b:* & c:* & d:*");
    expect(toTsQuery("café 42")).toBe("café:* & 42:*");
  });
  it("limits the number and length of words", () => {
    expect(toTsQuery("a b c d e f g h i j")!.split(" & ")).toHaveLength(8);
    expect(toTsQuery("x".repeat(100))).toBe(`${"x".repeat(40)}:*`);
  });
});

describe("searchBoards", () => {
  it("finds boards by title and by text, with prefix matching", async () => {
    await board("Quarterly planning", ["Budget review", "Hiring"]);
    await board("Retro", ["Went well: deployment"]);
    expect((await searchBoards(db, ann, "quart")).map((h) => h.title)).toEqual(["Quarterly planning"]);
    expect((await searchBoards(db, ann, "budg")).map((h) => h.title)).toEqual(["Quarterly planning"]);
    expect((await searchBoards(db, ann, "deploy")).map((h) => h.title)).toEqual(["Retro"]);
    expect(await searchBoards(db, ann, "nothing here")).toEqual([]);
  });

  it("requires every word to match", async () => {
    await board("A", ["alpha beta"]);
    await board("B", ["alpha gamma"]);
    expect((await searchBoards(db, ann, "alpha beta")).map((h) => h.title)).toEqual(["A"]);
  });

  it("shows only boards the user can open", async () => {
    const id = await board("Secret plan", ["launch codename"]);
    expect(await searchBoards(db, bob, "codename")).toEqual([]);
    await db.query("INSERT INTO board_members VALUES ($1, 'user', 'bob', 'viewer')", [id]);
    expect((await searchBoards(db, bob, "codename"))[0]).toMatchObject({ id, role: "viewer" });
    // A group grant counts, and the strongest role wins.
    await db.query("INSERT INTO board_members VALUES ($1, 'group', 'g-eng', 'editor')", [id]);
    expect((await searchBoards(db, eve, "codename"))[0]).toMatchObject({ id, role: "editor" });
  });

  it("drops a board from results once it is deleted or access is removed", async () => {
    const id = await board("Temp", ["findme"]);
    expect(await searchBoards(db, ann, "findme")).toHaveLength(1);
    await db.query("UPDATE boards SET deleted_at = now() WHERE id = $1", [id]);
    expect(await searchBoards(db, ann, "findme")).toEqual([]);
    await db.query("UPDATE boards SET deleted_at = NULL WHERE id = $1", [id]);
    await db.query("DELETE FROM board_members WHERE board_id = $1", [id]);
    expect(await searchBoards(db, ann, "findme")).toEqual([]);
  });

  it("ranks a title match above a text match, and marks matched words in the snippet", async () => {
    await board("Notes", ["roadmap details are here"]);
    await board("Roadmap", ["something else"]);
    const hits = await searchBoards(db, ann, "roadmap");
    expect(hits.map((h) => h.title)).toEqual(["Roadmap", "Notes"]);
    expect(hits[1]!.snippet).toContain(`${MARK_START}roadmap${MARK_END}`);
  });

  it("is safe against query syntax and SQL in the search text", async () => {
    await board("Boards", ["x"]);
    for (const q of ["'; DROP TABLE boards; --", "a & | ! ( )", ":*", "\\"]) await expect(searchBoards(db, ann, q)).resolves.toBeDefined();
    expect((await db.query("SELECT count(*) AS n FROM boards")).rows[0]).toMatchObject({ n: 1 });
  });
});

describe("indexing", () => {
  it("picks up new content and renames, and skips boards that are current", async () => {
    const id = await board("Old title", ["first"]);
    expect(await indexStaleBoards(db)).toBe(0);
    // The board changes after its entry was made, so the entry is older than the board.
    await db.query("UPDATE board_search SET indexed_at = now() - interval '1 minute' WHERE board_id = $1", [id]);
    await db.query("UPDATE boards SET title = 'Fresh name', updated_at = now() WHERE id = $1", [id]);
    expect(await indexStaleBoards(db)).toBe(1);
    expect((await searchBoards(db, ann, "fresh")).map((h) => h.id)).toEqual([id]);
    expect(await searchBoards(db, ann, "old")).toEqual([]);
    expect(await indexStaleBoards(db)).toBe(0);
  });

  it("indexes a board that has no entry yet, including an empty one", async () => {
    const id = (await db.query<{ id: string }>("INSERT INTO boards (title, classification, created_by) VALUES ('Brand new', 'OFFICIAL', 'ann') RETURNING id")).rows[0]!.id;
    await db.query("INSERT INTO board_members VALUES ($1, 'user', 'ann', 'owner')", [id]);
    expect(await indexStaleBoards(db)).toBe(1);
    expect((await searchBoards(db, ann, "brand")).map((h) => h.id)).toEqual([id]);
  });
});
