import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Board, type BoardObject } from "@miroclone/shared";
import { contentOfSelection, describeObject, focusOrder, stepFocus } from "./selection.js";

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

describe("keyboard focus order (section 7.3)", () => {
  const o = (id: string, x: number, y: number, extra: Record<string, unknown> = {}): BoardObject => ({ id, type: "sticky", x, y, width: 100, height: 100, rotation: 0, index: "a0", locked: false, text: id, color: "#fff", ...extra }) as unknown as BoardObject;
  const objs: BoardObject[] = [o("d", 300, 210), o("b", 300, 10), o("a", 0, 0), o("c", 0, 200), { ...o("line", 0, 0), type: "connector" } as unknown as BoardObject, { ...o("pen", 0, 0), type: "stroke" } as unknown as BoardObject];

  it("reads top to bottom in rows, then left to right, and skips connectors and drawings", () => {
    expect(focusOrder(objs).map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("treats objects that are nearly level as one row", () => {
    expect(focusOrder([o("right", 200, 20), o("left", 0, 40)]).map((x) => x.id)).toEqual(["left", "right"]);
  });
  it("steps forward and back, and stops at the ends so Tab can leave the canvas", () => {
    const order = focusOrder(objs);
    expect(stepFocus(order, undefined, false)?.id).toBe("a");
    expect(stepFocus(order, undefined, true)?.id).toBe("d");
    expect(stepFocus(order, "b", false)?.id).toBe("c");
    expect(stepFocus(order, "b", true)?.id).toBe("a");
    expect(stepFocus(order, "d", false)).toBeUndefined();
    expect(stepFocus(order, "a", true)).toBeUndefined();
    expect(stepFocus([], undefined, false)).toBeUndefined();
  });
  it("describes an object with its type, text, and place", () => {
    expect(describeObject(o("hello  there", 0, 0), 2, 9)).toBe("Sticky note: hello there. 2 of 9.");
    expect(describeObject(o("", 0, 0, { text: "", locked: true }), 1, 1)).toBe("Sticky note, empty, locked. 1 of 1.");
    const card = { ...o("c", 0, 0), type: "card", title: "Fix login", assignee: "Ann", due: "2026-09-30", description: "Soon", text: undefined } as unknown as BoardObject;
    expect(describeObject(card, 1, 1)).toBe("Card: Fix login, assigned to Ann, due 2026-09-30, Soon. 1 of 1.");
  });
});
