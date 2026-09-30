import { describe, expect, it } from "vitest";
import { MAX_ZOOM, MIN_ZOOM, screenToWorld, zoomAt } from "./viewport.js";

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
