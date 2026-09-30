import type { BoardObject } from "@miroclone/shared";

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

export function normaliseRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function contains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/** Returns the top-most non-connector object under a point. `objects` runs back to front. */
export function hitTest(objects: readonly BoardObject[], p: Point): BoardObject | undefined {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i]!;
    if (o.type !== "connector" && contains(o, p)) return o;
  }
  return undefined;
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

/** Converts absolute stroke points to a bounding box and points relative to its origin. */
export function strokeFromPoints(points: Point[]): { x: number; y: number; width: number; height: number; points: number[] } {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return {
    x, y,
    width: Math.max(1, Math.max(...xs) - x),
    height: Math.max(1, Math.max(...ys) - y),
    points: points.flatMap((p) => [p.x - x, p.y - y]),
  };
}

/** Removes strokes that the eraser path touches (CNV-5). */
export function strokesHit(objects: readonly BoardObject[], p: Point, radius = 8): string[] {
  return objects.filter((o) => {
    if (o.type !== "stroke") return false;
    for (let i = 0; i + 1 < o.points.length; i += 2) {
      if (Math.hypot(o.x + o.points[i]! - p.x, o.y + o.points[i + 1]! - p.y) <= radius) return true;
    }
    return false;
  }).map((o) => o.id);
}
