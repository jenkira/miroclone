import { generateKeyBetween } from "fractional-indexing";
import { boardObjectSchema, MAX_OBJECTS_PER_BOARD, type BoardObject } from "@miroclone/shared";
import { htmlToText } from "./html.js";
import type { MiroBoard, MiroItem } from "./miro-types.js";

export type Outcome = "converted" | "approximated" | "placeholder" | "error";
export interface ReportItem { id: string; type: string; outcome: Outcome; detail?: string }

/** An image the caller already downloaded. The file name is relative to the board's folder. */
export interface ImageRef { fileName: string; mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/svg+xml" | "image/webp" }
export type ImageResult = ImageRef | { error: string };

export interface Conversion {
  title: string;
  objects: BoardObject[];
  items: ReportItem[];
}

/**
 * Miro's named sticky note colours, as close as the published palette allows. Miro doesn't document exact values,
 * so these are approximations, and the report says so when one is used.
 */
export const STICKY_COLOURS: Record<string, string> = {
  gray: "#d9dadf", light_yellow: "#fff9b1", yellow: "#f5d128", orange: "#ff9d48", light_green: "#d5f692",
  green: "#c9df56", dark_green: "#93d275", cyan: "#6cd8fa", light_pink: "#f5d6e4", pink: "#f16c7f",
  violet: "#cb8ff9", red: "#f24726", light_blue: "#a6ccf5", blue: "#2d9bf0", dark_blue: "#7c9ce6", black: "#1a1a1a",
};

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v) ? v : fallback);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown, fallback: number) => { const n = typeof v === "string" ? Number(v) : v; return typeof n === "number" && Number.isFinite(n) ? n : fallback; };
const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const safeId = (id: string) => `miro-${id.replace(/[^\w-]/g, "_")}`;

const SHAPES: Record<string, "rectangle" | "rounded" | "ellipse" | "triangle" | "diamond"> = {
  rectangle: "rectangle", round_rectangle: "rounded", circle: "ellipse", triangle: "triangle", rhombus: "diamond",
};
const ROUTING: Record<string, "straight" | "elbow" | "curved"> = { straight: "straight", elbowed: "elbow", curved: "curved" };

/** Rough height for text in a box, since Miro text items often have no height. */
function textBoxHeight(text: string, width: number, size: number): number {
  const perLine = Math.max(1, Math.floor((width - 16) / (size * 0.55)));
  const lines = text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
  return Math.max(size + 16, Math.ceil(lines * size * 1.25) + 16);
}

interface Box { x: number; y: number; width: number; height: number }

/**
 * Converts one Miro board into Miroclone objects (MIG-2), with a placeholder for anything unsupported (MIG-3)
 * and a record of what happened to every item (MIG-4). It never throws for bad content: a bad item becomes an
 * error entry and a placeholder, so one odd item can't stop a board from migrating.
 */
export function convertBoard(miro: MiroBoard, opts: { images?: Record<string, ImageResult> } = {}): Conversion {
  const items: ReportItem[] = [];
  const objects: BoardObject[] = [];
  const members = new Map(miro.members.map((m) => [m.id, m.name ?? ""]));
  const ids = new Map<string, string>(); // Miro item ID to the new object ID.
  let last: string | null = null;
  const nextIndex = () => (last = generateKeyBetween(last, null));

  // Frames go first, so they sit behind the content, and their positions are known for the items inside them.
  const frames = miro.items.filter((i) => i.type === "frame");
  const others = miro.items.filter((i) => i.type !== "frame");
  const frameBoxes = new Map<string, Box>();

  const centre = (i: MiroItem, w: number, h: number): Box => {
    const p = i.position ?? {};
    let cx = num(p.x, 0), cy = num(p.y, 0);
    const parent = i.parent?.id ? frameBoxes.get(i.parent.id) : undefined;
    // Items inside a frame can be positioned from the frame's top-left corner instead of the board's centre.
    if (parent && p.relativeTo === "parent_top_left") { cx += parent.x; cy += parent.y; }
    return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
  };

  const record = (item: MiroItem, outcome: Outcome, detail?: string) => items.push({ id: item.id, type: item.type, outcome, ...(detail ? { detail } : {}) });

  const add = (item: MiroItem, raw: Record<string, unknown>, outcome: "converted" | "approximated", detail?: string): boolean => {
    if (objects.length >= MAX_OBJECTS_PER_BOARD) { record(item, "error", `The board already holds ${MAX_OBJECTS_PER_BOARD} objects, which is the limit.`); return false; }
    const parsed = boardObjectSchema.safeParse({ id: safeId(item.id), rotation: num(item.geometry?.rotation, 0), index: nextIndex(), ...raw });
    if (!parsed.success) {
      const why = `${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? "is not valid"}`.trim();
      placeholder(item, `${why}`, "error");
      return false;
    }
    objects.push(parsed.data);
    ids.set(item.id, parsed.data.id);
    record(item, outcome, detail);
    return true;
  };

  /** Puts a grey sticky note where the item was, with its original type as text (MIG-3). */
  function placeholder(item: MiroItem, why: string, outcome: "placeholder" | "error" = "placeholder") {
    if (objects.length >= MAX_OBJECTS_PER_BOARD) { record(item, "error", `The board already holds ${MAX_OBJECTS_PER_BOARD} objects, which is the limit.`); return; }
    const w = Math.max(120, Math.min(num(item.geometry?.width, 160), 600));
    const h = Math.max(80, Math.min(num(item.geometry?.height, w), 600));
    const box = centre(item, w, h);
    const label = cap(htmlToText(str(item.data?.title) || str(item.data?.content)), 200);
    const text = `Unsupported Miro item: ${item.type}${label ? `\n${label}` : ""}`;
    const parsed = boardObjectSchema.safeParse({
      id: safeId(item.id), type: "sticky", ...box, color: "#e0e0e0", text, index: nextIndex(),
    });
    if (parsed.success) { objects.push(parsed.data); ids.set(item.id, parsed.data.id); }
    record(item, outcome, why);
  }

  const common = (i: MiroItem, w: number, h: number) => centre(i, w, h);

  for (const f of frames) {
    const w = num(f.geometry?.width, 400), h = num(f.geometry?.height, 300);
    const box = common(f, w, h);
    frameBoxes.set(f.id, box);
    add(f, { type: "frame", ...box, title: cap(htmlToText(str(f.data?.title)), 500) }, "converted");
  }

  for (const i of others) {
    try {
      switch (i.type) {
        case "sticky_note": {
          const w = num(i.geometry?.width, 199), h = num(i.geometry?.height, w);
          const fill = str(i.style?.fillColor);
          const known = STICKY_COLOURS[fill];
          const colour = HEX.test(fill) ? fill : known ?? "#fff475";
          const approx = !HEX.test(fill) && fill ? (known ? `Colour "${fill}" is approximate.` : `Colour "${fill}" isn't known, so the default yellow is used.`) : "";
          add(i, { type: "sticky", ...common(i, w, h), text: cap(htmlToText(str(i.data?.content)), 10000), color: colour }, approx ? "approximated" : "converted", approx || undefined);
          break;
        }
        case "shape": {
          const kind = str(i.data?.shape);
          const w = num(i.geometry?.width, 120), h = num(i.geometry?.height, 80);
          const mapped = SHAPES[kind];
          add(i, {
            type: "shape", kind: mapped ?? "rectangle", ...common(i, w, h),
            fill: hex(i.style?.fillColor, "#ffffff"), stroke: hex(i.style?.borderColor, "#1a1a1a"),
            text: cap(htmlToText(str(i.data?.content)), 10000),
          }, mapped ? "converted" : "approximated", mapped ? undefined : `The shape "${kind || "unknown"}" is drawn as a rectangle.`);
          break;
        }
        case "text": {
          const text = cap(htmlToText(str(i.data?.content)), 10000);
          const size = Math.min(200, Math.max(8, Math.round(num(i.style?.fontSize, 18))));
          const w = num(i.geometry?.width, 200), h = num(i.geometry?.height, textBoxHeight(text, w, size));
          const align = ["left", "center", "right"].includes(str(i.style?.textAlign)) ? str(i.style?.textAlign) : "left";
          add(i, { type: "text", ...common(i, w, h), text, size, color: hex(i.style?.color, "#1a1a1a"), align }, "converted");
          break;
        }
        case "card": {
          const w = num(i.geometry?.width, 240), h = num(i.geometry?.height, 160);
          const uid = str((i.data?.assignee as { userId?: unknown } | undefined)?.userId);
          const name = uid ? members.get(uid) ?? "" : "";
          const due = /^(\d{4}-\d{2}-\d{2})/.exec(str(i.data?.dueDate))?.[1];
          const notes = [uid && !name ? "The assignee isn't a board member, so no name is kept." : "", "Tags aren't migrated."].filter(Boolean);
          add(i, {
            type: "card", ...common(i, w, h), title: cap(htmlToText(str(i.data?.title)), 200),
            description: cap(htmlToText(str(i.data?.description)), 2000), assignee: cap(name, 100), ...(due ? { due } : {}),
            color: hex(i.style?.cardTheme, "#ffffff"),
          }, uid && !name ? "approximated" : "converted", uid && !name ? notes[0] : undefined);
          break;
        }
        case "image": {
          const got = opts.images?.[i.id];
          if (!got) { placeholder(i, "The image wasn't downloaded."); break; }
          if ("error" in got) { placeholder(i, `The image couldn't be kept: ${got.error}`); break; }
          const w = num(i.geometry?.width, 300), h = num(i.geometry?.height, w * 0.75);
          add(i, { type: "image", ...common(i, w, h), objectKey: `file:${got.fileName}`, mimeType: got.mimeType }, "converted");
          break;
        }
        default:
          placeholder(i, `Miroclone has no equivalent for "${i.type}".`);
      }
    } catch (err) {
      placeholder(i, `The item couldn't be read: ${(err as Error).message}`, "error");
    }
  }

  // Connectors last, so they sit on top, and only when both ends came across.
  for (const c of miro.connectors) {
    const item: MiroItem = { id: c.id, type: "connector" };
    const from = c.startItem?.id ? ids.get(c.startItem.id) : undefined, to = c.endItem?.id ? ids.get(c.endItem.id) : undefined;
    if (!from || !to) { record(item, "error", "One end isn't attached to an item that was migrated, so the connector was left out."); continue; }
    const shape = str(c.shape);
    const routing = ROUTING[shape] ?? "straight";
    const captions = (c.captions ?? []).some((x) => htmlToText(x.content));
    // A missing shape means straight. Only a shape that's present and unknown counts as a difference.
    const unknownShape = !!shape && !ROUTING[shape];
    add(item, { type: "connector", routing, from, to, x: 0, y: 0, width: 1, height: 1 },
      captions || unknownShape ? "approximated" : "converted",
      captions ? "Connector captions aren't migrated." : unknownShape ? `The routing "${shape}" is drawn as a straight line.` : undefined);
  }

  return { title: miro.info.name || "Untitled board", objects, items };
}
