import { z } from "zod";

/** Maximum objects per board (PRF-2). */
export const MAX_OBJECTS_PER_BOARD = 20_000;

export const objectTypes = [
  "sticky",
  "shape",
  "text",
  "stroke",
  "connector",
  "frame",
  "image",
  "card",
  "table",
  "embed",
] as const;
export type ObjectType = (typeof objectTypes)[number];

const base = {
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number().default(0),
  /** Fractional index for stacking order (section 8.2). */
  index: z.string(),
  locked: z.boolean().default(false),
  groupId: z.string().optional(),
  /** The user ID of whoever added the object. Private mode uses it to show people their own content (WSH-7). */
  by: z.string().max(100).optional(),
};

export const stickySchema = z.object({
  ...base,
  type: z.literal("sticky"),
  text: z.string().default(""),
  color: z.string().default("#fff475"),
});

export const shapeSchema = z.object({
  ...base,
  type: z.literal("shape"),
  kind: z.enum(["rectangle", "rounded", "ellipse", "triangle", "diamond"]),
  fill: z.string().default("#ffffff"),
  stroke: z.string().default("#1a1a1a"),
  text: z.string().default(""),
  /** Marks a node of a mind map (CNV-15). The root has no parent. */
  mind: z.boolean().optional(),
  /** The node this one hangs from in a mind map. */
  parentId: z.string().optional(),
});

/** Links must be web or mail links. Other schemes, such as `javascript:`, never reach the page. */
export const isSafeLink = (v: string) => v.length <= 2048 && /^(https?:\/\/|mailto:)/i.test(v);

/**
 * Free text (CNV-4). Formatting applies to the whole object, and the content is plain text,
 * so no HTML is stored or rendered.
 */
export const textSchema = z.object({
  ...base,
  type: z.literal("text"),
  text: z.string().default(""),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  underline: z.boolean().default(false),
  size: z.number().min(8).max(200).default(18),
  color: z.string().default("#1a1a1a"),
  align: z.enum(["left", "center", "right"]).default("left"),
  list: z.enum(["none", "bullet", "number"]).default("none"),
  link: z.string().refine(isSafeLink, "Links must start with http://, https://, or mailto:").optional(),
});

export const strokeSchema = z.object({
  ...base,
  type: z.literal("stroke"),
  points: z.array(z.number()),
  color: z.string().default("#1a1a1a"),
  highlighter: z.boolean().default(false),
});

/** Connectors store the IDs of the objects they attach to (section 8.2). */
export const connectorSchema = z.object({
  ...base,
  type: z.literal("connector"),
  routing: z.enum(["straight", "elbow", "curved"]).default("straight"),
  from: z.string().min(1),
  to: z.string().min(1),
});

export const frameSchema = z.object({
  ...base,
  type: z.literal("frame"),
  title: z.string().default(""),
});

export const imageSchema = z.object({
  ...base,
  type: z.literal("image"),
  objectKey: z.string().min(1),
  mimeType: z.enum([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/svg+xml",
    "image/webp",
  ]),
});

/** A date in the form 2026-09-30. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(v)), "Not a real date");

/** A card with a title, description, assignee, due date, and tags (CNV-14). */
export const cardSchema = z.object({
  ...base,
  type: z.literal("card"),
  title: z.string().max(200).default(""),
  description: z.string().max(2000).default(""),
  /** The person's display name. A card doesn't grant access, so no account ID is stored. */
  assignee: z.string().max(100).default(""),
  due: isoDate.optional(),
  tags: z.array(z.string().min(1).max(30)).max(10).default([]),
  color: z.string().default("#ffffff"),
});

/** Limits for tables (CNV-16). */
export const MAX_TABLE_ROWS = 50, MAX_TABLE_COLS = 20, MAX_CELL_TEXT = 1000;

/**
 * A table with editable cells (CNV-16). Cells are stored row by row, and rows and columns share the object's width
 * and height equally. Concurrent edits to one table keep the last change, as for any other object.
 */
export const tableSchema = z.object({
  ...base,
  type: z.literal("table"),
  rows: z.number().int().min(1).max(MAX_TABLE_ROWS),
  cols: z.number().int().min(1).max(MAX_TABLE_COLS),
  cells: z.array(z.string().max(MAX_CELL_TEXT)),
  /** Whether the first row is a header. */
  header: z.boolean().default(true),
});

/** Embeds are links with a preview card, and PDF files (CNV-17). Links must be web addresses. */
export const isWebLink = (v: string) => v.length <= 2048 && /^https?:\/\//i.test(v);

export const embedSchema = z.object({
  ...base,
  type: z.literal("embed"),
  kind: z.enum(["link", "pdf"]),
  /** For a link, where it goes. */
  url: z.string().refine(isWebLink, "Links must start with http:// or https://").optional(),
  /** For a PDF, the ID of the stored file. */
  fileId: z.string().min(1).max(100).optional(),
  name: z.string().max(200).default(""),
  title: z.string().max(300).default(""),
  description: z.string().max(1000).default(""),
  pages: z.number().int().min(1).max(100000).optional(),
});

export const boardObjectSchema = z.discriminatedUnion("type", [
  stickySchema,
  shapeSchema,
  textSchema,
  strokeSchema,
  connectorSchema,
  frameSchema,
  imageSchema,
  cardSchema,
  tableSchema,
  embedSchema,
]).superRefine((o, ctx) => {
  // A table needs one cell for each row and column. Zod can't refine one member of a discriminated union, so the check sits here.
  if (o.type === "table" && o.cells.length !== o.rows * o.cols) ctx.addIssue({ code: "custom", path: ["cells"], message: "A table needs one cell for each row and column." });
  if (o.type === "embed" && o.kind === "link" && !o.url) ctx.addIssue({ code: "custom", path: ["url"], message: "A link needs an address." });
  if (o.type === "embed" && o.kind === "pdf" && !o.fileId) ctx.addIssue({ code: "custom", path: ["fileId"], message: "A PDF needs a stored file." });
});
export type BoardObject = z.infer<typeof boardObjectSchema>;

/** Name of the Yjs map that holds all objects of a board. */
export const OBJECTS_MAP = "objects";
