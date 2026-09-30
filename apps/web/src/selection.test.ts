import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Board } from "@miroclone/shared";
import { contentOfSelection } from "./selection.js";

function setup() {
  const b = new Board(new Y.Doc());
  const frame = b.add({ type: "frame", title: "Col", x: 0, y: 0, width: 400, height: 400 });
  const inside1 = b.add({ type: "sticky", x: 50, y: 50, width: 100, height: 100 });
  const inside2 = b.add({ type: "sticky", x: 200, y: 200, width: 100, height: 100 });
  const outside = b.add({ type: "sticky", x: 600, y: 50, width: 100, height: 100 });
  const edge = b.add({ type: "sticky", x: 380, y: 50, width: 100, height: 100 });   // centre at x=430, outside
  const inner = b.add({ type: "connector", from: inside1.id, to: inside2.id });
  const crossing = b.add({ type: "connector", from: inside1.id, to: outside.id });
  return { b, frame, inside1, inside2, outside, edge, inner, crossing };
}

describe("contentOfSelection", () => {
  it("takes everything inside a selected frame, and connectors between those objects", () => {
    const s = setup();
    const got = new Set(contentOfSelection(s.b.list(), [s.frame.id]));
    expect(got).toEqual(new Set([s.frame.id, s.inside1.id, s.inside2.id, s.inner.id]));
  });
  it("leaves out objects that only touch the frame, and connectors that leave it", () => {
    const s = setup();
    const got = contentOfSelection(s.b.list(), [s.frame.id]);
    expect(got).not.toContain(s.edge.id);
    expect(got).not.toContain(s.crossing.id);
  });
  it("keeps a plain selection as it is, adding connectors between selected objects", () => {
    const s = setup();
    expect(new Set(contentOfSelection(s.b.list(), [s.inside1.id, s.inside2.id]))).toEqual(new Set([s.inside1.id, s.inside2.id, s.inner.id]));
    expect(contentOfSelection(s.b.list(), [s.outside.id])).toEqual([s.outside.id]);
  });
  it("returns nothing for no selection", () => {
    expect(contentOfSelection(setup().b.list(), [])).toEqual([]);
  });
});
