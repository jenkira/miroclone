import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { alignX, Board, distributeX } from "./board-ops.js";

const sticky = (extra = {}) => ({ type: "sticky" as const, ...extra });

describe("Board", () => {
  it("stacks new objects on top", () => {
    const b = new Board(new Y.Doc());
    const [a, c] = [b.add(sticky()), b.add(sticky())];
    expect(b.list().map((o) => o.id)).toEqual([a.id, c.id]);
    b.bringToFront(a.id);
    expect(b.list().at(-1)!.id).toBe(a.id);
    b.sendToBack(a.id);
    expect(b.list()[0]!.id).toBe(a.id);
  });

  it("doesn't move or delete locked objects", () => {
    const b = new Board(new Y.Doc());
    const a = b.add(sticky({ x: 10 }));
    b.setLocked([a.id], true);
    b.move([a.id], 50, 0); b.remove([a.id]);
    expect(b.get(a.id)?.x).toBe(10);
    b.setLocked([a.id], false);
    b.remove([a.id]);
    expect(b.get(a.id)).toBeUndefined();
  });

  it("deletes connectors with the objects they attach to", () => {
    const b = new Board(new Y.Doc());
    const [a, c] = [b.add(sticky()), b.add(sticky({ x: 300 }))];
    const k = b.add({ type: "connector", from: a.id, to: c.id });
    b.remove([a.id]);
    expect(b.get(k.id)).toBeUndefined();
    expect(b.get(c.id)).toBeDefined();
  });

  it("keeps connectors attached when objects move", () => {
    const b = new Board(new Y.Doc());
    const [a, c] = [b.add(sticky({ width: 100, height: 100 })), b.add(sticky({ x: 300, width: 100, height: 100 }))];
    const k = b.add({ type: "connector", from: a.id, to: c.id });
    b.move([c.id], 0, 200);
    expect(b.connectorEnds(k.id)).toEqual({ from: { x: 50, y: 50 }, to: { x: 350, y: 250 } });
  });

  it("groups and selects whole groups", () => {
    const b = new Board(new Y.Doc());
    const [a, c, d] = [b.add(sticky()), b.add(sticky()), b.add(sticky())];
    const g = b.group([a.id, c.id]);
    expect(b.expandGroups([a.id]).sort()).toEqual([a.id, c.id].sort());
    b.ungroup(g);
    expect(b.expandGroups([a.id])).toEqual([a.id]);
    expect(b.get(d.id)?.groupId).toBeUndefined();
  });

  it("rejects adds past the object limit", () => {
    const b = new Board(new Y.Doc());
    for (let i = 0; i < 3; i++) b.add(sticky());
    // Limit is 20,000, so fake a full board by stubbing size.
    Object.defineProperty(b.objects, "size", { value: 20_000 });
    expect(() => b.add(sticky())).toThrow("Board is full");
  });
});

describe("undo and redo", () => {
  it("undoes only this user's changes", () => {
    const docA = new Y.Doc(), docB = new Y.Doc();
    docA.on("update", (u: Uint8Array) => Y.applyUpdate(docB, u, "remote"));
    docB.on("update", (u: Uint8Array, origin: unknown) => { if (origin !== "remote") Y.applyUpdate(docA, u, "remote"); });
    const a = new Board(docA, "a"), b = new Board(docB, "b");
    const mine = a.add(sticky());
    const theirs = b.add(sticky());
    a.undo.undo();
    expect(a.get(mine.id)).toBeUndefined();
    expect(a.get(theirs.id)).toBeDefined();
    a.undo.redo();
    expect(a.get(mine.id)).toBeDefined();
  });
});

describe("copy and paste", () => {
  it("pastes across boards with new ids and remapped connectors", () => {
    const one = new Board(new Y.Doc()), two = new Board(new Y.Doc());
    const [a, c] = [one.add(sticky({ x: 0 })), one.add(sticky({ x: 200 }))];
    const k = one.add({ type: "connector", from: a.id, to: c.id });
    const clip = one.copy([a.id, c.id]);
    expect(clip.map((o) => o.id)).toContain(k.id);
    const ids = two.paste(clip);
    expect(ids).toHaveLength(3);
    const pastedConnector = two.list().find((o) => o.type === "connector")!;
    expect(pastedConnector.type === "connector" && [pastedConnector.from, pastedConnector.to].every((id) => two.get(id))).toBe(true);
    expect(two.list().some((o) => o.id === a.id)).toBe(false);
  });
});

describe("alignment", () => {
  const objs = [0, 100, 400].map((x, i) => ({ id: `o${i}`, type: "sticky", x, y: 0, width: 100, height: 100, rotation: 0, index: "a", locked: false, text: "", color: "#fff" } as never));
  it("aligns to the left edge", () => {
    expect(Object.values(alignX(objs, "left"))).toEqual([0, 0, 0]);
  });
  it("distributes evenly", () => {
    expect(distributeX(objs)).toEqual({ o0: 0, o1: 200, o2: 400 });
  });
});
