import { describe, expect, it } from "vitest";
import { centreOf, containsRotated, handlePositions, hitHandle, resizeFromHandle, rotatePoint, rotationFor } from "./geometry.js";
import { fitRect, MAX_ZOOM, MIN_ZOOM } from "./viewport.js";

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6); expect(a.y).toBeCloseTo(b.y, 6);
};
const box = (rotation = 0) => ({ x: 100, y: 100, width: 200, height: 100, rotation });

describe("rotation", () => {
  it("rotates a point about a centre", () => {
    close(rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 90), { x: 0, y: 10 });
  });
  it("hit tests a rotated rectangle", () => {
    // A 200x100 box turned 90 degrees covers 100 wide and 200 tall around its centre (200,150).
    expect(containsRotated(box(90), { x: 200, y: 60 })).toBe(true);
    expect(containsRotated(box(90), { x: 290, y: 150 })).toBe(false);
    expect(containsRotated(box(0), { x: 290, y: 150 })).toBe(true);
  });
  it("finds the rotation angle for a pointer, straight up being zero", () => {
    expect(rotationFor(box(), { x: 200, y: 0 })).toBeCloseTo(0);
    expect(rotationFor(box(), { x: 500, y: 150 })).toBeCloseTo(90);
    expect(rotationFor(box(), { x: 500, y: 160 }, true) % 15).toBe(0);
  });
});

describe("handles", () => {
  it("places the rotate handle above the top edge at a constant screen distance", () => {
    close(handlePositions(box(), 1).rotate, { x: 200, y: 72 });
    close(handlePositions(box(), 2).rotate, { x: 200, y: 86 });
  });
  it("hits a corner within the radius", () => {
    expect(hitHandle(box(), { x: 102, y: 98 }, 1)).toBe("nw");
    expect(hitHandle(box(), { x: 200, y: 200 }, 1)).toBeUndefined();
  });
});

describe("resize", () => {
  it("keeps the opposite corner fixed", () => {
    const r = resizeFromHandle(box(), "se", { x: 400, y: 300 });
    expect(r).toEqual({ x: 100, y: 100, width: 300, height: 200 });
    const n = resizeFromHandle(box(), "nw", { x: 50, y: 40 });
    expect(n).toEqual({ x: 50, y: 40, width: 250, height: 160 });
  });
  it("keeps the opposite corner fixed in the world for a rotated object", () => {
    const o = box(30);
    const before = handlePositions(o).nw;
    const r = resizeFromHandle(o, "se", rotatePoint({ x: 420, y: 260 }, centreOf(o), 30));
    const after = handlePositions({ ...r, rotation: 30 }).nw;
    close(after, before);
  });
  it("never shrinks below the minimum, and can't flip", () => {
    const r = resizeFromHandle(box(), "se", { x: 0, y: 0 });
    expect(r.width).toBe(10); expect(r.height).toBe(10);
  });
  it("holds the aspect ratio", () => {
    const r = resizeFromHandle(box(), "se", { x: 500, y: 150 }, true);
    expect(r.width / r.height).toBeCloseTo(2);
  });
});

describe("fitRect", () => {
  it("centres the rectangle and scales it to fit", () => {
    const v = fitRect({ x: 0, y: 0, width: 1000, height: 500 }, 1000, 600, 0);
    expect(v.zoom).toBeCloseTo(1);
    expect(v.x).toBeCloseTo(0); expect(v.y).toBeCloseTo(50);
  });
  it("clamps zoom for tiny and huge content", () => {
    expect(fitRect({ x: 0, y: 0, width: 1, height: 1 }, 1000, 1000).zoom).toBe(MAX_ZOOM);
    expect(fitRect({ x: 0, y: 0, width: 1e7, height: 1e7 }, 1000, 1000).zoom).toBe(MIN_ZOOM);
  });
});
