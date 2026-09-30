import * as Y from "yjs";
import { OBJECTS_MAP } from "@miroclone/shared";
import type { Db } from "./db.js";
import { loadDoc } from "./persistence.js";

export interface VersionInfo { id: string; kind: "auto" | "named"; name: string | null; objectCount: number; createdBy: string | null; createdByName: string | null; createdAt: string; bytes: number }

/** Saves the board as it is now. A named version is kept until someone deletes it, and automatic ones are pruned. */
export async function snapshot(db: Db, boardId: string, opts: { kind: "auto" | "named"; name?: string; userId?: string }): Promise<string> {
  const doc = await loadDoc(db, boardId);
  const state = Y.encodeStateAsUpdate(doc);
  const count = doc.getMap(OBJECTS_MAP).size;
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO board_versions (board_id, kind, name, state, object_count, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    [boardId, opts.kind, opts.name?.trim() || null, state, count, opts.userId ?? null]);
  return rows[0]!.id;
}

export async function listVersions(db: Db, boardId: string): Promise<VersionInfo[]> {
  const { rows } = await db.query<{ id: string; kind: "auto" | "named"; name: string | null; object_count: number; created_by: string | null; display_name: string | null; created_at: string; bytes: number }>(
    `SELECT v.id, v.kind, v.name, v.object_count, v.created_by, u.display_name, v.created_at, octet_length(v.state) AS bytes
     FROM board_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.board_id = $1 ORDER BY v.created_at DESC, v.id`, [boardId]);
  return rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name, objectCount: r.object_count, createdBy: r.created_by, createdByName: r.display_name, createdAt: r.created_at, bytes: Number(r.bytes) }));
}

/** The saved state of one version of one board, or undefined. The board ID in the query stops cross-board reads. */
export async function versionState(db: Db, boardId: string, versionId: string): Promise<Uint8Array | undefined> {
  const { rows } = await db.query<{ state: Uint8Array }>("SELECT state FROM board_versions WHERE id = $1 AND board_id = $2", [versionId, boardId]);
  return rows[0] ? new Uint8Array(rows[0].state) : undefined;
}

export async function deleteVersion(db: Db, boardId: string, versionId: string): Promise<boolean> {
  const { rows } = await db.query("DELETE FROM board_versions WHERE id = $1 AND board_id = $2 RETURNING id", [versionId, boardId]);
  return rows.length > 0;
}

/**
 * Takes an automatic version of each board that changed since its last version, at most once per interval.
 * Boards that still have changes arriving wait for a quiet moment, so a version isn't a half-finished edit.
 */
export async function snapshotChangedBoards(db: Db, opts: { minIntervalMinutes?: number; quietSeconds?: number } = {}): Promise<number> {
  const interval = String(opts.minIntervalMinutes ?? 10), quiet = String(opts.quietSeconds ?? 60);
  const { rows } = await db.query<{ id: string }>(
    `SELECT b.id FROM boards b
     WHERE b.deleted_at IS NULL
       AND b.updated_at < now() - ($2 || ' seconds')::interval
       AND EXISTS (SELECT 1 FROM board_updates u WHERE u.board_id = b.id)
       AND b.updated_at > COALESCE((SELECT max(v.created_at) FROM board_versions v WHERE v.board_id = b.id), 'epoch'::timestamptz)
       AND COALESCE((SELECT max(v.created_at) FROM board_versions v WHERE v.board_id = b.id AND v.kind = 'auto'), 'epoch'::timestamptz) < now() - ($1 || ' minutes')::interval
     LIMIT 100`, [interval, quiet]);
  for (const r of rows) await snapshot(db, r.id, { kind: "auto" });
  return rows.length;
}

/** Keeps the newest `keep` automatic versions of each board. Named versions stay. */
export async function pruneAutoVersions(db: Db, keep = 50): Promise<number> {
  const { rows } = await db.query(
    `DELETE FROM board_versions WHERE id IN (
       SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY board_id ORDER BY created_at DESC) AS n FROM board_versions WHERE kind = 'auto') x WHERE n > $1
     ) RETURNING id`, [keep]);
  return rows.length;
}
