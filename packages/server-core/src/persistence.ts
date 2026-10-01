import * as Y from "yjs";
import type { Db } from "./db.js";

/** Rebuilds a board's Yjs document from its stored updates (section 8.2). */
export async function loadDoc(db: Db, boardId: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const { rows } = await db.query<{ data: Uint8Array }>(
    "SELECT data FROM board_updates WHERE board_id = $1 ORDER BY seq", [boardId]);
  Y.transact(doc, () => { for (const r of rows) Y.applyUpdate(doc, new Uint8Array(r.data)); });
  return doc;
}

export async function appendUpdate(db: Db, boardId: string, update: Uint8Array): Promise<void> {
  await db.query("INSERT INTO board_updates (board_id, data) VALUES ($1, $2)", [boardId, update]);
  await db.query("UPDATE boards SET updated_at = now() WHERE id = $1", [boardId]);
}

/**
 * Merges stored updates into one snapshot once a board has more than `threshold`.
 * Only rows up to the highest seq read are replaced, so concurrent appends survive.
 */
export async function compact(db: Db, boardId: string, threshold = 200): Promise<boolean> {
  // Count first. Most calls end here, and they shouldn't read every stored update just to find that out.
  const head = await db.query<{ n: string; max: string }>("SELECT count(*) AS n, max(seq) AS max FROM board_updates WHERE board_id = $1", [boardId]);
  if (Number(head.rows[0]!.n) <= threshold) return false;
  // Only rows up to the highest seq counted are merged and removed, so an update that arrives meanwhile is kept.
  const { rows } = await db.query<{ seq: string; data: Uint8Array }>(
    "SELECT seq, data FROM board_updates WHERE board_id = $1 AND seq <= $2 ORDER BY seq", [boardId, head.rows[0]!.max]);
  const merged = Y.mergeUpdates(rows.map((r) => new Uint8Array(r.data)));
  const maxSeq = rows[rows.length - 1]!.seq;
  await db.query("DELETE FROM board_updates WHERE board_id = $1 AND seq <= $2", [boardId, maxSeq]);
  await db.query("INSERT INTO board_updates (board_id, data) VALUES ($1, $2)", [boardId, merged]);
  return true;
}

/**
 * Compacts every board that holds more than `threshold` stored updates, a few at a time. The worker runs this on a timer,
 * so merging large documents never takes time from the collaboration service's single thread (PRF-3, PRF-5).
 * Returns the number of boards compacted.
 */
export async function compactBusyBoards(db: Db, threshold = 200, limit = 10): Promise<number> {
  const { rows } = await db.query<{ board_id: string }>(
    "SELECT board_id FROM board_updates GROUP BY board_id HAVING count(*) > $1 ORDER BY count(*) DESC LIMIT $2", [threshold, limit]);
  let n = 0;
  for (const r of rows) if (await compact(db, r.board_id, threshold)) n++;
  return n;
}
