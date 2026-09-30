import { Texture } from "pixi.js";
import { api } from "./api.js";

type Loader = (fileId: string) => Promise<Texture>;
let loader: Loader | undefined;
const cache = new Map<string, Promise<Texture>>();

/** Tells the renderer where a board's images come from. Local boards have none, so they show placeholders. */
export function useBoardImages(boardId: string | undefined) {
  cache.clear();
  loader = boardId
    ? (fileId) => {
        const key = `${boardId}/${fileId}`;
        let t = cache.get(key);
        if (!t) {
          // Shown through an <img>, where scripts in an SVG can't run.
          t = api.fetchFile(boardId, fileId).then(async (blob) => {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.src = url;
            await img.decode();
            return Texture.from(img);
          });
          cache.set(key, t);
          t.catch(() => cache.delete(key));
        }
        return t;
      }
    : undefined;
}

export const imageLoader = () => loader;

export const ACCEPTED = ["image/png", "image/jpeg", "image/gif", "image/svg+xml", "image/webp"];
export const MAX_BYTES = 25 * 1024 * 1024;

/** Explains an upload failure in words that a person can act on. */
export function uploadMessage(status: number | undefined): string {
  switch (status) {
    case 413: return "That file is over 25 MB.";
    case 415: return "Only PNG, JPEG, GIF, SVG, and WebP images are supported.";
    case 422: return "That file was blocked. It failed the malware scan or contains content that isn't allowed.";
    case 403: return "You can view this board but not add to it.";
    case 503: return "Image upload isn't available right now.";
    default: return "The image couldn't be added.";
  }
}

/** Natural size of an image blob, scaled down to fit `max` on its longer side. */
export async function sizeFor(blob: Blob, max = 400): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || 300, h = img.naturalHeight || 150;
    const k = Math.min(1, max / Math.max(w, h));
    return { width: Math.max(10, Math.round(w * k)), height: Math.max(10, Math.round(h * k)) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
