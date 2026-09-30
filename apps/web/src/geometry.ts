import type { BoardObject } from "@miroclone/shared";

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

export function normaliseRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function contains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

export function rotatePoint(p: Point, about: Point, deg: number): Point {
  const a = rad(deg), c = Math.cos(a), s = Math.sin(a);
  const dx = p.x - about.x, dy = p.y - about.y;
  return { x: about.x + dx * c - dy * s, y: about.y + dx * s + dy * c };
}

export const centreOf = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** True when a world point lies inside an object, allowing for its rotation about its centre. */
export function containsRotated(o: Rect & { rotation: number }, p: Point): boolean {
  return contains(o, o.rotation ? rotatePoint(p, centreOf(o), -o.rotation) : p);
}

/** Returns the top-most non-connector object under a point. `objects` runs back to front. */
export function hitTest(objects: readonly BoardObject[], p: Point): BoardObject | undefined {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i]!;
    if (o.type !== "connector" && containsRotated(o, p)) return o;
  }
  return undefined;
}

export type Handle = "nw" | "ne" | "se" | "sw" | "rotate";
const dir: Record<Exclude<Handle, "rotate">, { hx: -1 | 1; hy: -1 | 1 }> = {
  nw: { hx: -1, hy: -1 }, ne: { hx: 1, hy: -1 }, se: { hx: 1, hy: 1 }, sw: { hx: -1, hy: 1 },
};
/** Distance from the top edge to the rotation handle, in screen pixels. */
export const ROTATE_OFFSET = 28;
export const MIN_SIZE = 10;

/** World positions of an object's handles. `zoom` keeps the rotation handle a constant distance away on screen. */
export function handlePositions(o: Rect & { rotation: number }, zoom = 1): Record<Handle, Point> {
  const c = centreOf(o);
  const at = (x: number, y: number) => (o.rotation ? rotatePoint({ x, y }, c, o.rotation) : { x, y });
  return {
    nw: at(o.x, o.y), ne: at(o.x + o.width, o.y), se: at(o.x + o.width, o.y + o.height), sw: at(o.x, o.y + o.height),
    rotate: at(c.x, o.y - ROTATE_OFFSET / zoom),
  };
}

/** Returns the handle under a point, within `radius` world units. */
export function hitHandle(o: Rect & { rotation: number }, p: Point, zoom: number, radius = 8): Handle | undefined {
  const r = radius / zoom;
  const hs = handlePositions(o, zoom);
  return (Object.keys(hs) as Handle[]).find((h) => Math.hypot(hs[h].x - p.x, hs[h].y - p.y) <= r);
}

/**
 * Resizes from a corner handle while the opposite corner stays fixed in the world, even for a rotated object.
 * `keepAspect` holds the ratio, as when a user holds Shift.
 */
export function resizeFromHandle(
  o: Rect & { rotation: number },
  handle: Exclude<Handle, "rotate">,
  to: Point,
  keepAspect = false,
): Rect {
  const { hx, hy } = dir[handle];
  const c = centreOf(o);
  const rot = (p: Point, d: number) => (o.rotation ? rotatePoint(p, c, d) : p);
  const anchor = rot({ x: c.x - (hx * o.width) / 2, y: c.y - (hy * o.height) / 2 }, o.rotation);
  // Express the pointer relative to the anchor, in the object's own (unrotated) axes.
  const local = rotatePoint(to, anchor, -o.rotation);
  let w = Math.max(MIN_SIZE, (local.x - anchor.x) * hx);
  let h = Math.max(MIN_SIZE, (local.y - anchor.y) * hy);
  if (keepAspect) {
    const k = Math.max(w / o.width, h / o.height);
    w = Math.max(MIN_SIZE, o.width * k); h = Math.max(MIN_SIZE, o.height * k);
  }
  const centre = rotatePoint({ x: anchor.x + (hx * w) / 2, y: anchor.y + (hy * h) / 2 }, anchor, o.rotation);
  return { x: centre.x - w / 2, y: centre.y - h / 2, width: w, height: h };
}

/** Angle in degrees for a rotation handle dragged to `to`. The handle sits above the top edge, so 0 means straight up. */
export function rotationFor(o: Rect, to: Point, snap = false): number {
  const c = centreOf(o);
  let deg = (Math.atan2(to.y - c.y, to.x - c.x) * 180) / Math.PI + 90;
  if (snap) deg = Math.round(deg / 15) * 15;
  return ((deg % 360) + 360) % 360;
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

export interface Guide { x1: number; y1: number; x2: number; y2: number }

/** Edges and centre lines of a rectangle, along one axis. */
const lines = (r: Rect, axis: "x" | "y") => axis === "x" ? [r.x, r.x + r.width / 2, r.x + r.width] : [r.y, r.y + r.height / 2, r.y + r.height];

/**
 * Finds the nudge that lines a moving box up with nearby boxes (CNV-12). It compares left, centre, and right edges,
 * and top, middle, and bottom edges, and picks the closest match within `threshold` on each axis.
 * The guides run between the matched boxes, so a person sees what the box snapped to.
 */
export function snapBox(box: Rect, others: readonly Rect[], threshold: number): { dx: number; dy: number; guides: Guide[] } {
  const best = (axis: "x" | "y") => {
    let found: { delta: number; at: number } | undefined;
    for (const o of others) for (const a of lines(box, axis)) for (const b of lines(o, axis)) {
      const delta = b - a;
      if (Math.abs(delta) <= threshold && (!found || Math.abs(delta) < Math.abs(found.delta))) found = { delta, at: b };
    }
    return found;
  };
  const bx = best("x"), by = best("y");
  const dx = bx?.delta ?? 0, dy = by?.delta ?? 0;
  const moved = { ...box, x: box.x + dx, y: box.y + dy };
  const guides: Guide[] = [];
  const eps = 0.5;
  if (bx) for (const o of others) if (lines(o, "x").some((l) => Math.abs(l - bx.at) < eps)) {
    guides.push({ x1: bx.at, x2: bx.at, y1: Math.min(o.y, moved.y), y2: Math.max(o.y + o.height, moved.y + moved.height) });
  }
  if (by) for (const o of others) if (lines(o, "y").some((l) => Math.abs(l - by.at) < eps)) {
    guides.push({ y1: by.at, y2: by.at, x1: Math.min(o.x, moved.x), x2: Math.max(o.x + o.width, moved.x + moved.width) });
  }
  return { dx, dy, guides };
}
