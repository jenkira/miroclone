import {
  atLeast,
  strongestRole,
  validateClassificationChange,
  type BoardRole,
} from "@miroclone/shared";
import type { Db } from "./db.js";

export interface Actor { id: string; groups: string[] }

export interface BoardRow {
  id: string;
  title: string;
  classification: string;
  created_by: string;
  updated_at: string;
  deleted_at: string | null;
  role: BoardRole;
  starred: boolean;
}

export const RECYCLE_DAYS = 30;

export class Forbidden extends Error {}
export class NotFound extends Error {}
export class Invalid extends Error {}

export async function upsertUser(
  db: Db,
  u: { id: string; tenantId: string; name: string; email?: string },
) {
  await db.query(
    `INSERT INTO users (id, tenant_id, display_name, email) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET display_name = $3, email = $4, last_sign_in_at = now()`,
    [u.id, u.tenantId, u.name, u.email ?? null],
  );
}

/** Strongest role from direct and group grants, or undefined (IAM-5, IAM-6). */
export async function roleOnBoard(db: Db, actor: Actor, boardId: string): Promise<BoardRole | undefined> {
  const { rows } = await db.query<{ role: BoardRole }>(
    `SELECT m.role FROM board_members m JOIN boards b ON b.id = m.board_id
     WHERE m.board_id = $1 AND b.deleted_at IS NULL AND (
       (m.principal_type = 'user' AND m.principal_id = $2) OR
       (m.principal_type = 'group' AND m.principal_id = ANY($3::text[])))`,
    [boardId, actor.id, actor.groups],
  );
  return strongestRole(rows.map((r) => r.role));
}

async function require(db: Db, actor: Actor, boardId: string, min: BoardRole): Promise<BoardRole> {
  const role = await roleOnBoard(db, actor, boardId);
  // A board the user can't open looks the same as a missing board.
  if (!role) throw new NotFound();
  if (!atLeast(role, min)) throw new Forbidden();
  return role;
}

export async function createBoard(db: Db, actor: Actor, title: string, classification: string): Promise<string> {
  if (!title.trim()) throw new Invalid("title is required");
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO boards (title, classification, created_by) VALUES ($1, $2, $3) RETURNING id",
    [title.trim(), classification, actor.id],
  );
  const id = rows[0]!.id;
  await db.query("INSERT INTO board_members VALUES ($1, 'user', $2, 'owner')", [id, actor.id]);
  return id;
}

export type BoardFilter = "recent" | "owned" | "shared" | "starred" | "deleted";

/** Lists the boards a user can open, for the dashboard (BRD-2). */
export async function listBoards(db: Db, actor: Actor, filter: BoardFilter = "recent"): Promise<BoardRow[]> {
  const { rows } = await db.query<BoardRow>(
    `SELECT b.id, b.title, b.classification, b.created_by, b.updated_at, b.deleted_at,
            (SELECT role FROM (
               SELECT m.role, CASE m.role WHEN 'owner' THEN 4 WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 ELSE 1 END AS r
               FROM board_members m WHERE m.board_id = b.id AND (
                 (m.principal_type = 'user' AND m.principal_id = $1) OR
                 (m.principal_type = 'group' AND m.principal_id = ANY($2::text[])))
               ORDER BY r DESC LIMIT 1) x) AS role,
            EXISTS (SELECT 1 FROM board_stars s WHERE s.board_id = b.id AND s.user_id = $1) AS starred
     FROM boards b
     WHERE EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = b.id AND (
             (m.principal_type = 'user' AND m.principal_id = $1) OR
             (m.principal_type = 'group' AND m.principal_id = ANY($2::text[]))))
       AND ${filter === "deleted" ? "b.deleted_at IS NOT NULL AND b.created_by = $1" : "b.deleted_at IS NULL"}
     ORDER BY b.updated_at DESC`,
    [actor.id, actor.groups],
  );
  return rows.filter((b) =>
    filter === "owned" ? b.role === "owner"
    : filter === "shared" ? b.role !== "owner"
    : filter === "starred" ? b.starred
    : true);
}

export async function renameBoard(db: Db, actor: Actor, id: string, title: string) {
  await require(db, actor, id, "editor");
  if (!title.trim()) throw new Invalid("title is required");
  await db.query("UPDATE boards SET title = $2, updated_at = now() WHERE id = $1", [id, title.trim()]);
}

/** Moves a board to the recycle bin (BRD-1). Only owners can delete. */
export async function deleteBoard(db: Db, actor: Actor, id: string) {
  await require(db, actor, id, "owner");
  await db.query("UPDATE boards SET deleted_at = now() WHERE id = $1", [id]);
}

export async function restoreBoard(db: Db, actor: Actor, id: string) {
  const { rows } = await db.query(
    "UPDATE boards SET deleted_at = NULL WHERE id = $1 AND created_by = $2 AND deleted_at IS NOT NULL RETURNING id",
    [id, actor.id],
  );
  if (!rows.length) throw new NotFound();
}

/** Permanently removes boards that have been in the recycle bin too long. */
export async function purgeExpired(db: Db): Promise<number> {
  const { rows } = await db.query(
    `DELETE FROM boards WHERE deleted_at < now() - ($1 || ' days')::interval RETURNING id`,
    [String(RECYCLE_DAYS)],
  );
  return rows.length;
}

export async function share(
  db: Db, actor: Actor, id: string,
  p: { type: "user" | "group"; id: string; role: BoardRole },
) {
  await require(db, actor, id, "owner");
  await db.query(
    `INSERT INTO board_members VALUES ($1, $2, $3, $4)
     ON CONFLICT (board_id, principal_type, principal_id) DO UPDATE SET role = $4`,
    [id, p.type, p.id, p.role],
  );
}

export async function unshare(db: Db, actor: Actor, id: string, p: { type: "user" | "group"; id: string }) {
  await require(db, actor, id, "owner");
  const { rows } = await db.query<{ n: string }>(
    "SELECT count(*) AS n FROM board_members WHERE board_id = $1 AND role = 'owner'", [id]);
  const target = await db.query<{ role: string }>(
    "SELECT role FROM board_members WHERE board_id = $1 AND principal_type = $2 AND principal_id = $3",
    [id, p.type, p.id]);
  if (target.rows[0]?.role === "owner" && Number(rows[0]!.n) <= 1) throw new Invalid("A board needs an owner.");
  await db.query("DELETE FROM board_members WHERE board_id = $1 AND principal_type = $2 AND principal_id = $3", [id, p.type, p.id]);
}

/** Changes a board's classification (PMK-3). Returns the previous value for the audit log. */
export async function setClassification(
  db: Db, actor: Actor, id: string, to: string,
  opts: { confirmed?: boolean; reason?: string },
): Promise<{ from: string; to: string }> {
  await require(db, actor, id, "owner");
  const { rows } = await db.query<{ classification: string }>("SELECT classification FROM boards WHERE id = $1", [id]);
  const from = rows[0]!.classification;
  const check = validateClassificationChange(from, to, opts);
  if (!check.ok) throw new Invalid(check.error);
  await db.query("UPDATE boards SET classification = $2, updated_at = now() WHERE id = $1", [id, to]);
  return { from, to };
}

export async function setStar(db: Db, actor: Actor, id: string, starred: boolean) {
  await require(db, actor, id, "viewer");
  if (starred) await db.query("INSERT INTO board_stars VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, actor.id]);
  else await db.query("DELETE FROM board_stars WHERE board_id = $1 AND user_id = $2", [id, actor.id]);
}
