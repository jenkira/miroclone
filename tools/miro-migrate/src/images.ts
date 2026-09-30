import type { ImageRef } from "./convert.js";

/** The largest image the tool keeps. It matches the upload limit in the product. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

const ext: Record<ImageRef["mimeType"], string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/svg+xml": "svg", "image/webp": "webp" };

/** Identifies an image by its first bytes, not by what a server says it is. */
export function detectImage(b: Uint8Array): ImageRef["mimeType"] | undefined {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(new TextDecoder().decode(b.slice(0, 512)))) return "image/svg+xml";
  return undefined;
}

export const extensionFor = (mime: ImageRef["mimeType"]) => ext[mime];
