import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { roleOnBoard } from "./access.js";
import { migrate, type Db } from "./db.js";

let db: Db;
let board: string;
const owner = { id: "o", groups: [] };

beforeAll(async () => {
  db = new PGlite() as unknown as Db;
  await migrate(db);
  await db.query("INSERT INTO users (id, tenant_id, display_name) VALUES ('o', 't', 'O')");
  board = (await db.query<{ id: string }>("INSERT INTO boards (title, classification, created_by) VALUES ('B', 'OFFICIAL', 'o') RETURNING id")).rows[0]!.id;
  await db.query("INSERT INTO board_members (board_id, principal_type, principal_id, role) VALUES ($1, 'user', 'o', 'owner')", [board]);
});

describe("roleOnBoard and archived boards (ADM-4)", () => {
  it("gives the real role until the board is archived", async () => {
    expect(await roleOnBoard(db, owner, board)).toBe("owner");
  });
  it("caps every role at viewer once archived, unless the caller ignores the archive", async () => {
    await db.query("UPDATE boards SET archived_at = now() WHERE id = $1", [board]);
    expect(await roleOnBoard(db, owner, board)).toBe("viewer");
    expect(await roleOnBoard(db, owner, board, { ignoreArchive: true })).toBe("owner");
  });
  it("still hides the board from people with no access", async () => {
    expect(await roleOnBoard(db, { id: "x", groups: [] }, board)).toBeUndefined();
    expect(await roleOnBoard(db, { id: "x", groups: [] }, board, { ignoreArchive: true })).toBeUndefined();
  });
});
