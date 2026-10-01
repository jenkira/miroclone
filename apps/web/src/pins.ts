import type { BoardObject } from "@miroclone/shared";
import type { Anchor, Thread } from "./api.js";
import type { Point } from "./geometry.js";

export interface Pin { id: string; x: number; y: number; resolved: boolean; count: number }

/**
 * Where a thread's pin sits. An object anchor follows the object's top-right corner. If the object was deleted,
 * the pin stays where the comment was first placed.
 */
export function anchorPoint(a: Anchor | null, get: (id: string) => BoardObject | undefined): Point | undefined {
  if (!a) return undefined;
  const o = a.objectId ? get(a.objectId) : undefined;
  if (o) return { x: o.x + o.width, y: o.y };
  return a.x !== undefined && a.y !== undefined ? { x: a.x, y: a.y } : undefined;
}

export function pinsFor(threads: readonly Thread[], get: (id: string) => BoardObject | undefined): Pin[] {
  const out: Pin[] = [];
  for (const t of threads) {
    const p = anchorPoint(t.anchor, get);
    if (p) out.push({ id: t.id, x: p.x, y: p.y, resolved: t.resolved, count: t.comments.length });
  }
  return out;
}

/** The pin under a point, within `radius` screen pixels at this zoom. */
export function pinAt(pins: readonly Pin[], p: Point, zoom: number, radius = 12): Pin | undefined {
  const r = radius / zoom;
  return [...pins].reverse().find((pin) => Math.hypot(pin.x - p.x, pin.y - p.y) <= r);
}
