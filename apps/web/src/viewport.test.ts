import { describe, expect, it } from "vitest";
import { MAX_ZOOM, MIN_ZOOM, minimapLayout, minimapToWorld, screenToWorld, zoomAt } from "./viewport.js";

describe("viewport", () => {
  it("keeps the point under the cursor fixed while zooming", () => {
    const v = { x: 10, y: 20, zoom: 1 };
    const before = screenToWorld(v, 300, 200);
    const after = screenToWorld(zoomAt(v, 300, 200, 2), 300, 200);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
  it("clamps zoom to 1% and 400%", () => {
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, 0, 0, 1e6).zoom).toBe(MAX_ZOOM);
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, 0, 0, 1e-6).zoom).toBe(MIN_ZOOM);
  });
});

describe("minimapLayout (CNV-13)", () => {
  const view = { x: 0, y: 0, width: 1000, height: 500 };
  it("fits the view alone when the board is empty", () => {
    const l = minimapLayout(undefined, view, 200, 100);
    expect(l.scale).toBeCloseTo(0.2);
    expect(minimapToWorld(l, 0, 0)).toEqual({ x: 0, y: 0 });
  });
  it("grows to hold content outside the view", () => {
    const l = minimapLayout({ x: 2000, y: 0, width: 1000, height: 500 }, view, 300, 100);
    expect(l.scale).toBeCloseTo(0.1);
    // The whole 3000 by 500 area fits in 300 wide, so nothing maps outside the minimap.
    expect(minimapToWorld(l, 300, 0).x).toBeCloseTo(3000);
  });
  it("centres the area in the spare space", () => {
    const l = minimapLayout(undefined, { x: 0, y: 0, width: 100, height: 100 }, 200, 100);
    expect(l.scale).toBeCloseTo(1);
    expect(l.originX).toBeCloseTo(-50);
  });
  it("maps a click back to the world point and round-trips", () => {
    const l = minimapLayout({ x: -500, y: -500, width: 1000, height: 1000 }, view, 180, 120);
    const p = minimapToWorld(l, 90, 60);
    expect(p.x * l.scale - l.originX * l.scale).toBeCloseTo(90);
  });
});
