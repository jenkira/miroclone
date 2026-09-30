import { strongestRole, type BoardRole } from "@miroclone/shared";
import type { Db } from "./db.js";

export interface Actor { id: string; groups: string[] }

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
