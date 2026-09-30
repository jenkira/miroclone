import type { Db } from "./db.js";
import type { ObjectStore } from "./objectstore.js";

/** Days that a deleted board stays in the recycle bin (BRD-1). */
export const RECYCLE_DAYS = 30;

/**
 * Permanently removes boards that have sat in the recycle bin too long, and the stored files they reference.
 * Stored files go first, so a failure leaves the rows that point at them, and the next run tries again.
 */
export async function purgeExpiredBoards(db: Db, store?: ObjectStore): Promise<{ boards: number; files: number }> {
  const cutoff = `deleted_at < now() - ($1 || ' days')::interval`;
  const files = await db.query<{ object_key: string }>(
    `SELECT f.object_key FROM board_files f JOIN boards b ON b.id = f.board_id WHERE b.${cutoff}`, [String(RECYCLE_DAYS)]);
  if (store) for (const f of files.rows) await store.delete(f.object_key);
  const gone = await db.query(`DELETE FROM boards WHERE ${cutoff} RETURNING id`, [String(RECYCLE_DAYS)]);
  return { boards: gone.rows.length, files: store ? files.rows.length : 0 };
}
