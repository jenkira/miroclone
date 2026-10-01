import { z } from "zod";
import { defaultClassifications, type Classification } from "@miroclone/shared";
import type { Db } from "@miroclone/server-core";
import { Invalid } from "./boards.js";

export interface ClassificationConfig { list: Classification[]; default: string }

export const builtinConfig: ClassificationConfig = { list: [...defaultClassifications], default: "OFFICIAL" };

const entry = z.object({
  key: z.string().regex(/^[A-Z0-9_]{1,40}$/, "Keys use capital letters, digits, and underscores."),
  label: z.string().trim().min(1).max(60),
  level: z.number().int().min(0).max(20),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colours are six-digit hex values such as #c62828."),
});
const configSchema = z.object({ list: z.array(entry).min(1).max(20), default: z.string() });

/** Reads the configured markings, or the built-in list when an administrator hasn't changed them. */
export async function loadClassifications(db: Db): Promise<ClassificationConfig> {
  const { rows } = await db.query<{ value: ClassificationConfig }>("SELECT value FROM settings WHERE key = 'classifications'");
  return rows[0]?.value ?? builtinConfig;
}

/**
 * Saves the markings. Markings with the same level count as equivalent, for example OFFICIAL: Sensitive under the
 * PSPF and SENSITIVE under the QGISCF (PMK-7). A marking that boards still use can't be removed.
 */
export async function saveClassifications(db: Db, userId: string, input: unknown): Promise<ClassificationConfig> {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) throw new Invalid(parsed.error.issues[0]?.message ?? "That list isn't valid.");
  const cfg = parsed.data;
  const keys = cfg.list.map((c) => c.key);
  if (new Set(keys).size !== keys.length) throw new Invalid("Each marking needs its own key.");
  if (!keys.includes(cfg.default)) throw new Invalid("The default must be one of the markings.");
  const used = await db.query<{ classification: string; n: string }>("SELECT classification, count(*) AS n FROM boards GROUP BY classification");
  for (const u of used.rows) {
    if (!keys.includes(u.classification)) throw new Invalid(`${u.classification} is used by ${u.n} board${u.n === "1" ? "" : "s"}, so it can't be removed.`);
  }
  const tpl = await db.query<{ classification: string }>("SELECT DISTINCT classification FROM org_templates");
  for (const t of tpl.rows) if (!keys.includes(t.classification)) throw new Invalid(`${t.classification} is used by an organisation template, so it can't be removed.`);
  await db.query(
    `INSERT INTO settings (key, value, updated_by) VALUES ('classifications', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = now()`, [JSON.stringify(cfg), userId]);
  return cfg;
}

/** Hosts that link previews may fetch from (CNV-17). Empty by default, so no preview calls anything until an administrator allows a host. */
export async function loadPreviewHosts(db: Db): Promise<string[]> {
  const { rows } = await db.query<{ value: string[] }>("SELECT value FROM settings WHERE key = 'link_preview_hosts'");
  return rows[0]?.value ?? [];
}

export async function savePreviewHosts(db: Db, userId: string, input: unknown): Promise<string[]> {
  const parsed = z.array(z.string().trim().toLowerCase().regex(/^(\*\.)?[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/, "Use host names such as wiki.example.internal or *.example.internal.")).max(100).safeParse(input);
  if (!parsed.success) throw new Invalid(parsed.error.issues[0]?.message ?? "That list isn't valid.");
  const hosts = [...new Set(parsed.data)];
  await db.query(
    `INSERT INTO settings (key, value, updated_by) VALUES ('link_preview_hosts', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = now()`, [JSON.stringify(hosts), userId]);
  return hosts;
}

export interface Marker { key: string; label: string }

const markerEntry = z.object({
  key: z.string().regex(/^[A-Z0-9_]{1,40}$/, "Keys use capital letters, digits, and underscores."),
  label: z.string().trim().min(1).max(60),
});

/** Reads the information management markers and caveats the agency uses (PMK-6). The list starts empty. */
export async function loadMarkers(db: Db): Promise<Marker[]> {
  const { rows } = await db.query<{ value: Marker[] }>("SELECT value FROM settings WHERE key = 'markers'");
  return rows[0]?.value ?? [];
}

/** Saves the marker list. A marker that a board still carries can't be removed. */
export async function saveMarkers(db: Db, userId: string, input: unknown): Promise<Marker[]> {
  const parsed = z.array(markerEntry).max(30).safeParse(input);
  if (!parsed.success) throw new Invalid(parsed.error.issues[0]?.message ?? "That list isn't valid.");
  const keys = parsed.data.map((m) => m.key);
  if (new Set(keys).size !== keys.length) throw new Invalid("Each marker needs its own key.");
  const used = await db.query<{ key: string; n: string }>("SELECT m AS key, count(*) AS n FROM boards, unnest(markers) AS m GROUP BY m");
  for (const u of used.rows) {
    if (!keys.includes(u.key)) throw new Invalid(`${u.key} is on ${u.n} board${u.n === "1" ? "" : "s"}, so it can't be removed.`);
  }
  await db.query(
    `INSERT INTO settings (key, value, updated_by) VALUES ('markers', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = now()`, [JSON.stringify(parsed.data), userId]);
  return parsed.data;
}

export interface UsageStats {
  users: { total: number; activeLast7Days: number; activeLast30Days: number };
  boards: { total: number; inRecycleBin: number; byClassification: { classification: string; count: number }[] };
  storage: { documentBytes: number; versionBytes: number; fileBytes: number; fileCount: number };
  activity: { comments: number; templates: number };
}

/** Usage numbers for service administrators (ADM-3). They count things, and show no board content. */
export async function usageStats(db: Db): Promise<UsageStats> {
  const n = async (sql: string) => Number((await db.query<{ n: string | null }>(sql)).rows[0]?.n ?? 0);
  const by = await db.query<{ classification: string; n: string }>("SELECT classification, count(*) AS n FROM boards WHERE deleted_at IS NULL GROUP BY classification ORDER BY classification");
  return {
    users: {
      total: await n("SELECT count(*) AS n FROM users"),
      activeLast7Days: await n("SELECT count(*) AS n FROM users WHERE last_sign_in_at > now() - interval '7 days'"),
      activeLast30Days: await n("SELECT count(*) AS n FROM users WHERE last_sign_in_at > now() - interval '30 days'"),
    },
    boards: {
      total: await n("SELECT count(*) AS n FROM boards WHERE deleted_at IS NULL"),
      inRecycleBin: await n("SELECT count(*) AS n FROM boards WHERE deleted_at IS NOT NULL"),
      byClassification: by.rows.map((r) => ({ classification: r.classification, count: Number(r.n) })),
    },
    storage: {
      documentBytes: await n("SELECT sum(octet_length(data)) AS n FROM board_updates"),
      versionBytes: await n("SELECT sum(octet_length(state)) AS n FROM board_versions"),
      fileBytes: await n("SELECT sum(size_bytes) AS n FROM board_files"),
      fileCount: await n("SELECT count(*) AS n FROM board_files"),
    },
    activity: { comments: await n("SELECT count(*) AS n FROM comments"), templates: await n("SELECT count(*) AS n FROM org_templates") },
  };
}
