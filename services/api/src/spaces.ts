import { atLeast, boardRoles, type BoardRole } from "@miroclone/shared";
import type { Actor, Db } from "@miroclone/server-core";
import { Forbidden, Invalid, NotFound, roleOnBoard } from "./boards.js";

export type SpaceRole = BoardRole;

export interface SpaceRow { id: string; name: string; role: SpaceRole; boards: number }

const RANK = "CASE m.role WHEN 'owner' THEN 4 WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 ELSE 1 END";

async function spaceRole(db: Db, actor: Actor, spaceId: string): Promise<SpaceRole | undefined> {
  const { rows } = await db.query<{ role: SpaceRole }>(
    `SELECT m.role FROM space_members m WHERE m.space_id = $1 AND (
       (m.principal_type = 'user' AND m.principal_id = $2) OR
       (m.principal_type = 'group' AND m.principal_id = ANY($3::text[])))
     ORDER BY ${RANK} DESC LIMIT 1`,
    [spaceId, actor.id, actor.groups]);
  return rows[0]?.role;
}

async function requireSpace(db: Db, actor: Actor, spaceId: string, min: SpaceRole): Promise<SpaceRole> {
  const role = await spaceRole(db, actor, spaceId);
  if (!role) throw new NotFound();
  if (!atLeast(role, min)) throw new Forbidden();
  return role;
}

/** Creates a space. The creator owns it (BRD-3). */
export async function createSpace(db: Db, actor: Actor, name: string): Promise<string> {
  if (!name.trim() || name.trim().length > 100) throw new Invalid("A space name has 1 to 100 characters.");
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO spaces (name, created_by) VALUES ($1, $2) RETURNING id", [name.trim(), actor.id]);
  const id = rows[0]!.id;
  await db.query("INSERT INTO space_members (space_id, principal_type, principal_id, role) VALUES ($1, 'user', $2, 'owner')", [id, actor.id]);
  return id;
}

export async function listSpaces(db: Db, actor: Actor): Promise<SpaceRow[]> {
  const { rows } = await db.query<{ id: string; name: string; role: SpaceRole; boards: string }>(
    `SELECT s.id, s.name,
            (SELECT m.role FROM space_members m WHERE m.space_id = s.id AND (
               (m.principal_type = 'user' AND m.principal_id = $1) OR
               (m.principal_type = 'group' AND m.principal_id = ANY($2::text[])))
             ORDER BY ${RANK} DESC LIMIT 1) AS role,
            (SELECT count(*) FROM boards b WHERE b.space_id = s.id AND b.deleted_at IS NULL) AS boards
     FROM spaces s
     WHERE EXISTS (SELECT 1 FROM space_members m WHERE m.space_id = s.id AND (
             (m.principal_type = 'user' AND m.principal_id = $1) OR
             (m.principal_type = 'group' AND m.principal_id = ANY($2::text[]))))
     ORDER BY s.name`, [actor.id, actor.groups]);
  return rows.map((r) => ({ ...r, boards: Number(r.boards) }));
}

export async function renameSpace(db: Db, actor: Actor, id: string, name: string) {
  await requireSpace(db, actor, id, "owner");
  if (!name.trim() || name.trim().length > 100) throw new Invalid("A space name has 1 to 100 characters.");
  await db.query("UPDATE spaces SET name = $2 WHERE id = $1", [id, name.trim()]);
}

/** Deletes a space. Its boards stay and fall back to their own grants. */
export async function deleteSpace(db: Db, actor: Actor, id: string) {
  await requireSpace(db, actor, id, "owner");
  await db.query("DELETE FROM spaces WHERE id = $1", [id]);
}

export interface SpaceMember { type: "user" | "group"; id: string; name: string; role: SpaceRole }

export async function listSpaceMembers(db: Db, actor: Actor, id: string): Promise<SpaceMember[]> {
  await requireSpace(db, actor, id, "viewer");
  const { rows } = await db.query<SpaceMember>(
    `SELECT m.principal_type AS type, m.principal_id AS id, m.role,
            COALESCE(m.principal_name, u.display_name, m.principal_id) AS name
     FROM space_members m LEFT JOIN users u ON m.principal_type = 'user' AND u.id = m.principal_id
     WHERE m.space_id = $1 ORDER BY m.role DESC, name`, [id]);
  return rows;
}

export async function shareSpace(
  db: Db, actor: Actor, id: string, p: { type: "user" | "group"; id: string; role: SpaceRole; name?: string },
) {
  await requireSpace(db, actor, id, "owner");
  if (!["user", "group"].includes(p.type) || !p.id || !boardRoles.includes(p.role)) throw new Invalid("bad member");
  await db.query(
    `INSERT INTO space_members (space_id, principal_type, principal_id, role, principal_name) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (space_id, principal_type, principal_id) DO UPDATE SET role = $4, principal_name = COALESCE($5, space_members.principal_name)`,
    [id, p.type, p.id, p.role, p.name ?? null]);
}

export async function unshareSpace(db: Db, actor: Actor, id: string, p: { type: "user" | "group"; id: string }) {
  await requireSpace(db, actor, id, "owner");
  const owners = await db.query<{ n: string }>("SELECT count(*) AS n FROM space_members WHERE space_id = $1 AND role = 'owner'", [id]);
  const target = await db.query<{ role: string }>(
    "SELECT role FROM space_members WHERE space_id = $1 AND principal_type = $2 AND principal_id = $3", [id, p.type, p.id]);
  if (target.rows[0]?.role === "owner" && Number(owners.rows[0]!.n) <= 1) throw new Invalid("A space needs an owner.");
  await db.query("DELETE FROM space_members WHERE space_id = $1 AND principal_type = $2 AND principal_id = $3", [id, p.type, p.id]);
}

/**
 * Puts a board in a space, or takes it out with null (BRD-3). The person must own the board and be able to edit the space,
 * so nobody can give a board's access to people they don't control.
 */
export async function moveBoard(db: Db, actor: Actor, boardId: string, spaceId: string | null) {
  const role = await roleOnBoard(db, actor, boardId);
  if (!role) throw new NotFound();
  if (!atLeast(role, "owner")) throw new Forbidden();
  if (spaceId) await requireSpace(db, actor, spaceId, "editor");
  await db.query("UPDATE boards SET space_id = $2 WHERE id = $1", [boardId, spaceId]);
}
