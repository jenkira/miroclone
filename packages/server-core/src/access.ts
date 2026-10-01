import { strongestRole, type BoardRole } from "@miroclone/shared";
import type { Db } from "./db.js";

export interface Actor { id: string; groups: string[] }

/**
 * Strongest role from direct, group, space, and organisation-wide grants, or undefined (IAM-5, IAM-6, IAM-8, BRD-3).
 * An archived board gives viewers' rights to everyone, unless the caller asks to ignore the archive, as restoring does.
 */
export async function roleOnBoard(db: Db, actor: Actor, boardId: string, opts: { ignoreArchive?: boolean } = {}): Promise<BoardRole | undefined> {
  const { rows } = await db.query<{ role: BoardRole; archived: boolean }>(
    `SELECT m.role, b.archived_at IS NOT NULL AS archived FROM board_access m JOIN boards b ON b.id = m.board_id
     WHERE m.board_id = $1 AND b.deleted_at IS NULL AND (
       (m.principal_type = 'user' AND m.principal_id = $2) OR
       (m.principal_type = 'group' AND m.principal_id = ANY($3::text[])) OR
       m.principal_type = 'org')`,
    [boardId, actor.id, actor.groups],
  );
  const role = strongestRole(rows.map((r) => r.role));
  // An archived board is read-only for everyone, in the API and in collaboration, until its owner restores it (ADM-4).
  return role && rows[0]?.archived && !opts.ignoreArchive ? "viewer" : role;
}
