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

export const boardObjectSchema = z.discriminatedUnion("type", [
  stickySchema,
  shapeSchema,
  textSchema,
  strokeSchema,
  connectorSchema,
  frameSchema,
  imageSchema,
]);
export type BoardObject = z.infer<typeof boardObjectSchema>;

/** Name of the Yjs map that holds all objects of a board. */
export const OBJECTS_MAP = "objects";
