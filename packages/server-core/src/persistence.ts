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
  const { rows } = await db.query<{ seq: string; data: Uint8Array }>(
    "SELECT seq, data FROM board_updates WHERE board_id = $1 ORDER BY seq", [boardId]);
  if (rows.length <= threshold) return false;
  const merged = Y.mergeUpdates(rows.map((r) => new Uint8Array(r.data)));
  const maxSeq = rows[rows.length - 1]!.seq;
  await db.query("DELETE FROM board_updates WHERE board_id = $1 AND seq <= $2", [boardId, maxSeq]);
  await db.query("INSERT INTO board_updates (board_id, data) VALUES ($1, $2)", [boardId, merged]);
  return true;
}
