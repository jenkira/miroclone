import { boardText, OBJECTS_MAP, type BoardObject } from "@miroclone/shared";
import type { Actor } from "./access.js";
import type { Db } from "./db.js";
import { loadDoc } from "./persistence.js";

export interface SearchHit { id: string; title: string; classification: string; role: string; snippet: string; rank: number }

/** Markers around matched words in a snippet. The client splits on them, so nothing is ever treated as HTML. */
export const MARK_START = "\u0001";
export const MARK_END = "\u0002";

/** Rebuilds one board's search entry from its title and content (BRD-4). */
export async function indexBoard(db: Db, boardId: string): Promise<void> {
  const b = await db.query<{ title: string }>("SELECT title FROM boards WHERE id = $1 AND deleted_at IS NULL", [boardId]);
  if (!b.rows[0]) return;
  const doc = await loadDoc(db, boardId);
  const body = boardText([...doc.getMap<BoardObject>(OBJECTS_MAP).values()]);
  // The title counts for more than the content, so a title match ranks first.
  await db.query(
    `INSERT INTO board_search (board_id, body, tsv, indexed_at)
     VALUES ($1, $2, setweight(to_tsvector('simple', $3), 'A') || setweight(to_tsvector('simple', $2), 'B'), now())
     ON CONFLICT (board_id) DO UPDATE SET body = EXCLUDED.body, tsv = EXCLUDED.tsv, indexed_at = now()`,
    [boardId, body, b.rows[0].title]);
}

/** Indexes boards that are new or changed since they were indexed. Returns how many. */
export async function indexStaleBoards(db: Db, limit = 100): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT b.id FROM boards b LEFT JOIN board_search s ON s.board_id = b.id
     WHERE b.deleted_at IS NULL AND (s.board_id IS NULL OR b.updated_at > s.indexed_at)
     ORDER BY b.updated_at LIMIT $1`, [limit]);
  for (const r of rows) await indexBoard(db, r.id);
  return rows.length;
}

/** Turns what a person typed into a safe prefix query, such as `budg:* & rev:*`. Nothing else reaches the query parser. */
export function toTsQuery(input: string): string | undefined {
  const words = (input.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).slice(0, 8).map((w) => w.slice(0, 40));
  return words.length ? words.map((w) => `${w}:*`).join(" & ") : undefined;
}

/** Searches board titles and text. Only boards the user can open are returned. */
export async function searchBoards(db: Db, actor: Actor, input: string, limit = 20): Promise<SearchHit[]> {
  const q = toTsQuery(input);
  if (!q) return [];
  const { rows } = await db.query<{ id: string; title: string; classification: string; role: string; snippet: string; rank: number }>(
    `SELECT b.id, b.title, b.classification, acc.role,
            ts_headline('simple', s.body, to_tsquery('simple', $3), 'StartSel=${MARK_START},StopSel=${MARK_END},MaxFragments=2,MaxWords=14,MinWords=5') AS snippet,
            ts_rank(s.tsv, to_tsquery('simple', $3)) AS rank
     FROM board_search s
     JOIN boards b ON b.id = s.board_id AND b.deleted_at IS NULL
     JOIN LATERAL (
       SELECT m.role FROM board_members m
       WHERE m.board_id = b.id AND ((m.principal_type = 'user' AND m.principal_id = $1) OR (m.principal_type = 'group' AND m.principal_id = ANY($2::text[])))
       ORDER BY CASE m.role WHEN 'owner' THEN 4 WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 ELSE 1 END DESC LIMIT 1
     ) acc ON true
     WHERE s.tsv @@ to_tsquery('simple', $3)
     ORDER BY rank DESC, b.updated_at DESC LIMIT $4`,
    [actor.id, actor.groups, q, limit]);
  return rows.map((r) => ({ ...r, rank: Number(r.rank) }));
}
