import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as boards from "./boards.js";
import { migrate, type Db } from "./db.js";

const ann = { id: "ann", groups: ["g-eng"] };
const bob = { id: "bob", groups: [] };
const cy = { id: "cy", groups: ["g-eng"] };
let db: Db;

beforeAll(async () => {
  db = new PGlite() as unknown as Db;
  await migrate(db);
});

beforeEach(async () => {
  await db.query("TRUNCATE users CASCADE");
  for (const u of [ann, bob, cy]) await boards.upsertUser(db, { id: u.id, tenantId: "t", name: u.id });
});

describe("migrations", () => {
  it("applies once", async () => {
    expect(await migrate(db)).toEqual([]);
  });
});

describe("boards", () => {
  it("makes the creator the owner", async () => {
    const id = await boards.createBoard(db, ann, "Plan", "OFFICIAL");
    expect(await boards.roleOnBoard(db, ann, id)).toBe("owner");
    expect(await boards.roleOnBoard(db, bob, id)).toBeUndefined();
  });

  it("hides boards from users without a grant", async () => {
    const id = await boards.createBoard(db, ann, "Secret", "PROTECTED");
    expect(await boards.listBoards(db, bob)).toHaveLength(0);
    await expect(boards.renameBoard(db, bob, id, "x")).rejects.toBeInstanceOf(boards.NotFound);
  });

  it("shares with a user and a group and takes the strongest role", async () => {
    const id = await boards.createBoard(db, ann, "Plan", "OFFICIAL");
    await boards.share(db, ann, id, { type: "group", id: "g-eng", role: "viewer" });
    await boards.share(db, ann, id, { type: "user", id: "cy", role: "editor" });
    expect(await boards.roleOnBoard(db, cy, id)).toBe("editor");
    expect((await boards.listBoards(db, cy, "shared"))[0]?.role).toBe("editor");
    expect(await boards.listBoards(db, cy, "owned")).toHaveLength(0);
  });

  it("lets only owners share or delete", async () => {
    const id = await boards.createBoard(db, ann, "Plan", "OFFICIAL");
    await boards.share(db, ann, id, { type: "user", id: "bob", role: "editor" });
    await expect(boards.share(db, bob, id, { type: "user", id: "cy", role: "viewer" })).rejects.toBeInstanceOf(boards.Forbidden);
    await expect(boards.deleteBoard(db, bob, id)).rejects.toBeInstanceOf(boards.Forbidden);
  });

  it("keeps at least one owner", async () => {
    const id = await boards.createBoard(db, ann, "Plan", "OFFICIAL");
    await expect(boards.unshare(db, ann, id, { type: "user", id: "ann" })).rejects.toBeInstanceOf(boards.Invalid);
  });

  it("recycles and restores boards, and purges after 30 days", async () => {
    const id = await boards.createBoard(db, ann, "Old", "OFFICIAL");
    await boards.deleteBoard(db, ann, id);
    expect(await boards.listBoards(db, ann)).toHaveLength(0);
    expect(await boards.listBoards(db, ann, "deleted")).toHaveLength(1);
    await boards.restoreBoard(db, ann, id);
    expect(await boards.listBoards(db, ann)).toHaveLength(1);
    await boards.deleteBoard(db, ann, id);
    expect(await boards.purgeExpired(db)).toBe(0);
    await db.query("UPDATE boards SET deleted_at = now() - interval '31 days'");
    expect(await boards.purgeExpired(db)).toBe(1);
  });

  it("requires a reason to lower a classification", async () => {
    const id = await boards.createBoard(db, ann, "Plan", "PROTECTED");
    await expect(boards.setClassification(db, ann, id, "OFFICIAL", { confirmed: true })).rejects.toBeInstanceOf(boards.Invalid);
    expect(await boards.setClassification(db, ann, id, "OFFICIAL", { confirmed: true, reason: "Public data" })).toEqual({ from: "PROTECTED", to: "OFFICIAL" });
  });

  it("lists starred boards", async () => {
    const id = await boards.createBoard(db, ann, "Plan", "OFFICIAL");
    await boards.setStar(db, ann, id, true);
    expect(await boards.listBoards(db, ann, "starred")).toHaveLength(1);
    await boards.setStar(db, ann, id, false);
    expect(await boards.listBoards(db, ann, "starred")).toHaveLength(0);
  });
});
