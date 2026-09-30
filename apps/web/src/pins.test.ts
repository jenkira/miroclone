import { describe, expect, it } from "vitest";
import type { BoardObject } from "@miroclone/shared";
import type { Thread } from "./api.js";
import { anchorPoint, pinAt, pinsFor } from "./pins.js";

const obj = { id: "o1", x: 100, y: 50, width: 40, height: 30 } as BoardObject;
const get = (id: string) => (id === "o1" ? obj : undefined);
const thread = (id: string, anchor: Thread["anchor"], resolved = false): Thread => ({ id, anchor, resolved, resolvedBy: null, comments: [{} as never, {} as never] });

describe("anchorPoint", () => {
  it("follows an object's top-right corner", () => {
    expect(anchorPoint({ objectId: "o1", x: 5, y: 5 }, get)).toEqual({ x: 140, y: 50 });
  });
  it("falls back to the placed point when the object is gone", () => {
    expect(anchorPoint({ objectId: "gone", x: 5, y: 6 }, get)).toEqual({ x: 5, y: 6 });
  });
  it("uses a plain point, and gives nothing when there is no anchor", () => {
    expect(anchorPoint({ x: 1, y: 2 }, get)).toEqual({ x: 1, y: 2 });
    expect(anchorPoint(null, get)).toBeUndefined();
    expect(anchorPoint({ objectId: "gone" }, get)).toBeUndefined();
  });
});

describe("pins", () => {
  it("builds a pin per anchored thread, with its comment count", () => {
    const pins = pinsFor([thread("a", { x: 1, y: 1 }), thread("b", null), thread("c", { objectId: "o1" }, true)], get);
    expect(pins).toEqual([{ id: "a", x: 1, y: 1, resolved: false, count: 2 }, { id: "c", x: 140, y: 50, resolved: true, count: 2 }]);
  });
  it("hits a pin within a constant screen distance", () => {
    const pins = [{ id: "a", x: 100, y: 100, resolved: false, count: 1 }];
    expect(pinAt(pins, { x: 105, y: 100 }, 1)?.id).toBe("a");
    expect(pinAt(pins, { x: 105, y: 100 }, 4)).toBeUndefined();
    expect(pinAt(pins, { x: 300, y: 300 }, 1)).toBeUndefined();
  });
});
