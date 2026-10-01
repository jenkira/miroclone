import type { Db } from "./db.js";

export interface Retention {
  /** Archive a board nobody has opened for this many months. Null turns the rule off. */
  archiveAfterMonths: number | null;
}

export const noRetention: Retention = { archiveAfterMonths: null };

export async function loadRetention(db: Db): Promise<Retention> {
  const { rows } = await db.query<{ value: Retention }>("SELECT value FROM settings WHERE key = 'retention'");
  return rows[0]?.value ?? noRetention;
}

/** Validates and saves the retention rule (ADM-4). The rule takes between 1 and 120 months, or is off. */
export async function saveRetention(db: Db, userId: string, input: unknown): Promise<Retention> {
  const m = (input as { archiveAfterMonths?: unknown } | null)?.archiveAfterMonths;
  if (m !== null && !(typeof m === "number" && Number.isInteger(m) && m >= 1 && m <= 120)) throw new Error("archiveAfterMonths must be a whole number from 1 to 120, or null.");
  const value: Retention = { archiveAfterMonths: m as number | null };
  await db.query(
    `INSERT INTO settings (key, value, updated_by) VALUES ('retention', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = now()`, [JSON.stringify(value), userId]);
  return value;
}

/**
 * Archives boards that nobody has opened for the configured time (ADM-4). Boards in the recycle bin are left to the purge job.
 * Returns the IDs archived, so the caller can write an audit event for each.
 */
export async function archiveStaleBoards(db: Db): Promise<string[]> {
  const { archiveAfterMonths } = await loadRetention(db);
  if (!archiveAfterMonths) return [];
  const { rows } = await db.query<{ id: string }>(
    `UPDATE boards SET archived_at = now()
     WHERE archived_at IS NULL AND deleted_at IS NULL AND last_opened_at < now() - ($1 || ' months')::interval
     RETURNING id`, [String(archiveAfterMonths)]);
  return rows.map((r) => r.id);
}
