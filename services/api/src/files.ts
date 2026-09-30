export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/svg+xml", "image/webp"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/** Largest upload, in bytes (CNV-8). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/** Finds an image type from the file's first bytes. The declared type is never trusted. */
export function detectImageType(b: Uint8Array): ImageType | undefined {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38]) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "image/gif";
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  const head = Buffer.from(b.subarray(0, 1024)).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg")) || (head.startsWith("<!doctype svg"))) return "image/svg+xml";
  return undefined;
}

/**
 * Patterns that make an SVG active or able to load other content. The browser only ever shows SVG
 * through an <img> element, where scripts don't run, so this check is a second layer (section 7.4).
 */
const SVG_DENY: [RegExp, string][] = [
  [/<\s*script/i, "script"],
  [/<\s*foreignObject/i, "foreignObject"],
  [/<\s*iframe|<\s*embed|<\s*object/i, "embedded content"],
  [/\son[a-z]+\s*=/i, "event handler"],
  [/javascript\s*:/i, "javascript: URL"],
  [/<!ENTITY/i, "entity declaration"],
  [/@import/i, "external style reference"],
];

/** A reference may point inside the file (#id) or hold a raster image inline. Anything else loads other content. */
const LOCAL_REF = /^(#|data:image\/(?:png|jpeg|gif|webp);base64,)/i;

/** Returns the reason an SVG is refused, or undefined when it's acceptable. */
export function svgProblem(b: Uint8Array): string | undefined {
  const text = Buffer.from(b).toString("utf8");
  for (const [re, why] of SVG_DENY) if (re.test(text)) return why;
  for (const m of text.matchAll(/(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    if (!LOCAL_REF.test((m[1] ?? m[2] ?? "").trim())) return "external reference";
  }
  for (const m of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)) {
    if (!LOCAL_REF.test((m[1] ?? m[2] ?? m[3] ?? "").trim())) return "external style reference";
  }
  return undefined;
}
