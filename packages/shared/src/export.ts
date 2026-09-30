import { z } from "zod";
import { boardObjectSchema, MAX_OBJECTS_PER_BOARD, type BoardObject } from "./objects.js";
import { findClassification, type Classification } from "./classification.js";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const plain = (html: string) => html.replace(/<[^>]*>/g, "");
/** Colours come from user data, so only accept hex values in exported markup. */
const colour = (c: string, fallback: string) => (/^#[0-9a-fA-F]{3,8}$/.test(c) ? c : fallback);

export interface Bounds { x: number; y: number; width: number; height: number }

export function boundsOf(objs: readonly BoardObject[], pad = 40): Bounds {
  const visible = objs.filter((o) => o.type !== "connector");
  if (!visible.length) return { x: 0, y: 0, width: 400, height: 300 };
  const x = Math.min(...visible.map((o) => o.x)), y = Math.min(...visible.map((o) => o.y));
  const r = Math.max(...visible.map((o) => o.x + o.width)), b = Math.max(...visible.map((o) => o.y + o.height));
  return { x: x - pad, y: y - pad, width: r - x + pad * 2, height: b - y + pad * 2 };
}

function shapeMarkup(o: BoardObject, byId: Map<string, BoardObject>): string {
  const t = (text: string) => text
    ? `<text x="${o.x + 8}" y="${o.y + 24}" font-size="16" font-family="sans-serif" fill="#1a1a1a">${esc(text)}</text>` : "";
  switch (o.type) {
    case "sticky":
      return `<rect x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" fill="${colour(o.color, "#fff475")}" stroke="#bdbdbd"/>${t(o.text)}`;
    case "shape": {
      const fill = colour(o.fill, "#fff"), stroke = colour(o.stroke, "#1a1a1a");
      const a = `fill="${fill}" stroke="${stroke}" stroke-width="2"`;
      const cx = o.x + o.width / 2, cy = o.y + o.height / 2, r = o.x + o.width, b = o.y + o.height;
      const body = o.kind === "ellipse" ? `<ellipse cx="${cx}" cy="${cy}" rx="${o.width / 2}" ry="${o.height / 2}" ${a}/>`
        : o.kind === "triangle" ? `<polygon points="${cx},${o.y} ${r},${b} ${o.x},${b}" ${a}/>`
        : o.kind === "diamond" ? `<polygon points="${cx},${o.y} ${r},${cy} ${cx},${b} ${o.x},${cy}" ${a}/>`
        : `<rect x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" rx="${o.kind === "rounded" ? 12 : 0}" ${a}/>`;
      return body + t(o.text);
    }
    case "text":
      return t(plain(o.html));
    case "stroke": {
      const pts: string[] = [];
      for (let i = 0; i + 1 < o.points.length; i += 2) pts.push(`${o.x + o.points[i]!},${o.y + o.points[i + 1]!}`);
      return `<polyline points="${pts.join(" ")}" fill="none" stroke="${colour(o.color, "#1a1a1a")}" stroke-width="${o.highlighter ? 14 : 3}" stroke-opacity="${o.highlighter ? 0.4 : 1}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    case "frame":
      return `<rect x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" fill="#fff" fill-opacity="0.4" stroke="#607d8b" stroke-width="2"/><text x="${o.x}" y="${o.y - 6}" font-size="14" font-family="sans-serif" fill="#455a64">${esc(o.title)}</text>`;
    case "connector": {
      const a = byId.get(o.from), b = byId.get(o.to);
      if (!a || !b) return "";
      return `<line x1="${a.x + a.width / 2}" y1="${a.y + a.height / 2}" x2="${b.x + b.width / 2}" y2="${b.y + b.height / 2}" stroke="#1a1a1a" stroke-width="2"/>`;
    }
    case "image":
      // Image bytes stay in object storage, so an export shows a labelled placeholder.
      return `<rect x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" fill="#eee" stroke="#9e9e9e"/>`;
  }
}

/**
 * Builds an SVG with the classification in a header and footer and in the file's metadata (PMK-4).
 * Everything user-supplied is escaped, and no script or external reference is emitted (section 7.4).
 */
export function exportSvg(
  objs: readonly BoardObject[],
  opts: { classification: string; title?: string; bounds?: Bounds; classifications?: readonly Classification[] },
): string {
  const c = findClassification(opts.classification, opts.classifications);
  const bar = 28;
  const b = opts.bounds ?? boundsOf(objs);
  const byId = new Map(objs.map((o) => [o.id, o]));
  const body = [...objs].sort((p, q) => (p.index < q.index ? -1 : 1)).map((o) => shapeMarkup(o, byId)).join("");
  const banner = (y: number) =>
    `<rect x="${b.x}" y="${y}" width="${b.width}" height="${bar}" fill="${colour(c.colour, "#000")}"/>` +
    `<text x="${b.x + b.width / 2}" y="${y + 19}" text-anchor="middle" font-size="16" font-weight="700" font-family="sans-serif" fill="#fff">${esc(c.label)}</text>`;
  const top = b.y - bar, h = b.height + bar * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x} ${top} ${b.width} ${h}" width="${b.width}" height="${h}" data-classification="${esc(c.key)}">` +
    `<title>${esc(opts.title ?? "Board")} (${esc(c.label)})</title>` +
    `<metadata>classification=${esc(c.key)}</metadata>` +
    `<rect x="${b.x}" y="${top}" width="${b.width}" height="${h}" fill="#f5f5f5"/>` +
    banner(top) + body + banner(b.y + b.height) + `</svg>`;
}

// --- Whole-board JSON (EXP-3) ---

export const BOARD_FILE_FORMAT = "miroclone-board";

export const boardFileSchema = z.object({
  format: z.literal(BOARD_FILE_FORMAT),
  version: z.literal(1),
  title: z.string(),
  classification: z.string(),
  objects: z.array(boardObjectSchema).max(MAX_OBJECTS_PER_BOARD),
});
export type BoardFile = z.infer<typeof boardFileSchema>;

export function exportJson(objs: readonly BoardObject[], meta: { title: string; classification: string }): string {
  const file: BoardFile = { format: BOARD_FILE_FORMAT, version: 1, ...meta, objects: [...objs] };
  return JSON.stringify(file, null, 2);
}

/** Parses and validates a board file. Throws a readable error for anything malformed. */
export function importJson(text: string, classifications?: readonly Classification[]): BoardFile {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("The file isn't valid JSON."); }
  const r = boardFileSchema.safeParse(raw);
  if (!r.success) throw new Error(`The file isn't a Miroclone board: ${r.error.issues[0]?.path.join(".") ?? ""} ${r.error.issues[0]?.message ?? ""}`.trim());
  findClassification(r.data.classification, classifications); // Throws on an unknown marking.
  return r.data;
}
