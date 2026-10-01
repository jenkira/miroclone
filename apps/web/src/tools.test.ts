import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Board } from "@miroclone/shared";
import { hitTest, strokesHit } from "./geometry.js";
import { objectForGesture } from "./tools.js";

const board = () => new Board(new Y.Doc());

describe("objectForGesture", () => {
  it("places a sticky centred on the click", () => {
    expect(objectForGesture("sticky", [{ x: 100, y: 100 }], [])).toMatchObject({ type: "sticky", x: 20, y: 20, width: 160 });
  });
  it("draws a shape from a drag, in any direction", () => {
    expect(objectForGesture("rectangle", [{ x: 200, y: 200 }, { x: 100, y: 50 }], [])).toMatchObject({ kind: "rectangle", x: 100, y: 50, width: 100, height: 150 });
  });
  it("uses a default size for a click", () => {
    expect(objectForGesture("ellipse", [{ x: 0, y: 0 }], [])).toMatchObject({ width: 120, height: 80 });
  });
  it("makes a stroke with relative points", () => {
    const o = objectForGesture("pen", [{ x: 10, y: 10 }, { x: 30, y: 20 }], []);
    expect(o).toMatchObject({ type: "stroke", x: 10, y: 10, points: [0, 0, 20, 10] });
  });
  it("only connects two different objects", () => {
    const b = board();
    const a = b.add({ type: "sticky", x: 0, y: 0 });
    const c = b.add({ type: "sticky", x: 300, y: 0 });
    const objs = b.list();
    expect(objectForGesture("connector", [{ x: 10, y: 10 }, { x: 310, y: 10 }], objs)).toMatchObject({ from: a.id, to: c.id });
    expect(objectForGesture("connector", [{ x: 10, y: 10 }, { x: 20, y: 20 }], objs)).toBeUndefined();
    expect(objectForGesture("connector", [{ x: 10, y: 10 }, { x: 900, y: 900 }], objs)).toBeUndefined();
  });
  it("makes a schema-valid object for every drawing tool", () => {
    for (const t of ["sticky", "text", "rectangle", "ellipse", "diamond", "frame"] as const) {
      const b = board();
      const o = objectForGesture(t, [{ x: 0, y: 0 }, { x: 50, y: 50 }], [])!;
      expect(() => b.add(o as never)).not.toThrow();
    }
  });
});

describe("hit testing", () => {
  it("returns the top-most object", () => {
    const b = board();
    b.add({ type: "sticky", x: 0, y: 0 });
    const top = b.add({ type: "sticky", x: 50, y: 50 });
    expect(hitTest(b.list(), { x: 60, y: 60 })?.id).toBe(top.id);
    expect(hitTest(b.list(), { x: 500, y: 500 })).toBeUndefined();
  });
  it("finds strokes near the eraser", () => {
    const b = board();
    const s = b.add({ type: "stroke", x: 0, y: 0, width: 50, height: 50, points: [0, 0, 50, 50] });
    expect(strokesHit(b.list(), { x: 50, y: 52 })).toEqual([s.id]);
    expect(strokesHit(b.list(), { x: 200, y: 200 })).toEqual([]);
  });
});
