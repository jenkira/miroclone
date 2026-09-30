import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The subset of a PostgreSQL client that the API uses. `pg` and PGlite both fit. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Runs several statements. PGlite needs it for migrations; `pg` runs them through `query`. */
  exec?(sql: string): Promise<unknown>;
}

const migrationsDir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "migrations");

/** Applies each `NNN_name.sql` file once, in order. */
export async function migrate(db: Db, dir = migrationsDir): Promise<string[]> {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const done = new Set((await db.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    await (db.exec ? db.exec(sql) : db.query(sql));
    await db.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    applied.push(file);
  }
  return applied;
}
