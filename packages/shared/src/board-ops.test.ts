import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { alignX, Board, distributeX } from "./board-ops.js";
import { boardText } from "./search-text.js";

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

describe("undo steps", () => {
  it("keeps quick successive actions as separate steps", () => {
    const b = new Board(new Y.Doc());
    const a = b.add(sticky());
    const c = b.add(sticky());
    b.remove([c.id]);
    b.undo.undo();
    expect(b.get(c.id)).toBeDefined();
    b.undo.undo();
    expect(b.get(c.id)).toBeUndefined();
    expect(b.get(a.id)).toBeDefined();
  });
  it("merges a drag into one step", () => {
    const b = new Board(new Y.Doc());
    const a = b.add(sticky({ x: 0 }));
    b.undo.stopCapturing();
    for (let i = 0; i < 5; i++) b.move([a.id], 10, 0);
    b.undo.undo();
    expect(b.get(a.id)?.x).toBe(0);
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

describe("restoreObjects", () => {
  it("returns the board to a saved version, and undo puts the newer content back", () => {
    const b = new Board(new Y.Doc());
    const keep = b.add(sticky({ x: 0, text: "original" }));
    const gone = b.add(sticky({ x: 50 }));
    const saved = b.list().map((o) => ({ ...o }));
    b.update(keep.id, { text: "edited" } as never);
    const added = b.add(sticky({ x: 99 }));
    b.remove([gone.id]);
    expect(b.restoreObjects(saved)).toEqual({ removed: 1, added: 1, changed: 1 });
    expect(b.get(added.id)).toBeUndefined();
    expect(b.get(gone.id)).toBeDefined();
    expect((b.get(keep.id) as { text: string }).text).toBe("original");
    b.undo.undo();
    expect(b.get(added.id)).toBeDefined();
    expect((b.get(keep.id) as { text: string }).text).toBe("edited");
  });
  it("leaves unchanged objects alone", () => {
    const b = new Board(new Y.Doc());
    b.add(sticky());
    expect(b.restoreObjects(b.list())).toEqual({ removed: 0, added: 0, changed: 0 });
  });
  it("refuses a version that holds an invalid object", () => {
    const b = new Board(new Y.Doc());
    expect(() => b.restoreObjects([{ id: "x", type: "text", link: "javascript:alert(1)" } as never])).toThrow();
  });
});

describe("boardText", () => {
  it("collects searchable text from every object that has any", () => {
    const b = new Board(new Y.Doc());
    b.add({ type: "sticky", text: "Budget review" });
    b.add({ type: "shape", kind: "rectangle", text: "Risks" });
    b.add({ type: "text", text: "Owner: Ann", link: "https://example.test/doc" });
    b.add({ type: "frame", title: "Sprint 12" });
    b.add({ type: "stroke", points: [0, 0, 1, 1] });
    expect(boardText(b.list()).split("\n")).toEqual(["Budget review", "Risks", "Owner: Ann", "https://example.test/doc", "Sprint 12"]);
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

describe("addMany", () => {
  it("adds every object in one undo step, in stacking order", () => {
    const b = new Board(new Y.Doc());
    b.addMany([{ type: "sticky", text: "a" }, { type: "sticky", text: "b" }, { type: "sticky", text: "c" }]);
    expect(b.list().map((o) => (o as { text: string }).text)).toEqual(["a", "b", "c"]);
    b.undo.undo();
    expect(b.list()).toHaveLength(0);
  });
  it("adds nothing when it wouldn't fit", () => {
    const b = new Board(new Y.Doc());
    expect(() => b.addMany(Array.from({ length: 20001 }, () => ({ type: "sticky" as const })))).toThrow(/full/);
    expect(b.list()).toHaveLength(0);
  });
});

describe("authors and the view filter (WSH-7)", () => {
  it("records the author on every object the client adds, including pasted copies", () => {
    const doc = new Y.Doc();
    const ann = new Board(doc, "a", "ann"), bob = new Board(doc, "b", "bob");
    const note = ann.add({ type: "sticky", text: "x" });
    expect(note.by).toBe("ann");
    const [copy] = bob.paste([note]);
    expect(bob.get(copy!)!.by).toBe("bob");
    expect(ann.addMany([{ type: "sticky" }])[0]!.by).toBe("ann");
  });
  it("leaves the author off when the board has none", () => {
    expect(new Board(new Y.Doc()).add({ type: "sticky" }).by).toBeUndefined();
  });
  it("hides objects from list() while a filter is set, and not from get()", () => {
    const doc = new Y.Doc();
    const ann = new Board(doc, "a", "ann"), bob = new Board(doc, "b", "bob");
    const a = ann.add({ type: "sticky", text: "ann's" }), b = bob.add({ type: "sticky", text: "bob's" });
    ann.setViewFilter((o) => o.by === "ann");
    expect(ann.list().map((o) => o.id)).toEqual([a.id]);
    expect(ann.get(b.id)).toBeDefined();
    expect(bob.list()).toHaveLength(2);
    ann.setViewFilter(null);
    expect(ann.list()).toHaveLength(2);
  });
});

describe("mind maps (CNV-15)", () => {
  const fresh = () => new Board(new Y.Doc());
  const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

  it("starts with a root, and adds children to its right, each joined by a connector", () => {
    const b = fresh();
    const root = b.addMindRoot({ x: 0, y: 0 });
    const a = b.addMindChild(root.id, "A"), c = b.addMindChild(root.id, "B");
    expect(a).toMatchObject({ parentId: root.id, mind: true, text: "A" });
    expect(a.x).toBeGreaterThan(root.x + root.width);
    expect(c.y).toBeGreaterThan(a.y);
    expect(b.list().filter((o) => o.type === "connector")).toHaveLength(2);
    expect(b.mindChildren(root.id).map((o) => (o as { text: string }).text)).toEqual(["A", "B"]);
  });

  it("adds a sibling just below a node, on the same parent, and keeps the nodes from overlapping", () => {
    const b = fresh();
    const root = b.addMindRoot({ x: 0, y: 0 });
    const a = b.addMindChild(root.id, "A");
    b.addMindChild(root.id, "C");
    const sib = b.addMindSibling(a.id, "B");
    expect(sib.parentId).toBe(root.id);
    expect(b.mindChildren(root.id).map((o) => (o as { text: string }).text)).toEqual(["A", "B", "C"]);
    const nodes = b.list().filter((o) => o.type === "shape");
    for (const x of nodes) for (const y of nodes) if (x.id < y.id) expect(overlap(x, y)).toBe(false);
  });

  it("gives the root a child instead of a sibling", () => {
    const b = fresh();
    const root = b.addMindRoot({ x: 0, y: 0 });
    expect(b.addMindSibling(root.id, "x").parentId).toBe(root.id);
  });

  it("lays out deeper branches without overlap, with each parent level with its children", () => {
    const b = fresh();
    const root = b.addMindRoot({ x: 0, y: 0 });
    const a = b.addMindChild(root.id, "A"), c = b.addMindChild(root.id, "B");
    for (let i = 0; i < 4; i++) b.addMindChild(a.id, `a${i}`);
    b.addMindChild(c.id, "b0");
    const nodes = b.list().filter((o) => o.type === "shape");
    for (const x of nodes) for (const y of nodes) if (x.id < y.id) expect(overlap(x, y)).toBe(false);
    const kids = b.mindChildren(a.id);
    const mid = (kids[0]!.y + kids.at(-1)!.y + kids.at(-1)!.height) / 2;
    expect(b.get(a.id)!.y + b.get(a.id)!.height / 2).toBeCloseTo(mid, 0);
  });

  it("moves a branch with its parent, and deletes a branch with its connectors", () => {
    const b = fresh();
    const root = b.addMindRoot({ x: 0, y: 0 });
    const a = b.addMindChild(root.id, "A");
    const a1 = b.addMindChild(a.id, "A1");
    const before = b.get(a1.id)!;
    b.move([a.id], 100, 50);
    expect(b.get(a1.id)).toMatchObject({ x: before.x + 100, y: before.y + 50 });
    b.remove([a.id]);
    expect(b.get(a.id)).toBeUndefined();
    expect(b.get(a1.id)).toBeUndefined();
    expect(b.list().filter((o) => o.type === "connector")).toHaveLength(0);
    expect(b.get(root.id)).toBeDefined();
  });

  it("finds the root of a deep node, and refuses a node that isn't in a mind map", () => {
    const b = fresh();
    const root = b.addMindRoot({ x: 0, y: 0 });
    const deep = b.addMindChild(b.addMindChild(root.id).id);
    expect(b.mindRoot(deep.id)).toBe(root.id);
    const plain = b.add({ type: "shape", kind: "rectangle" });
    expect(() => b.addMindChild(plain.id)).toThrow(/mind map/);
  });

  it("undoes adding a node and its connector in one step", () => {
    const b = fresh();
    const root = b.addMindRoot({ x: 0, y: 0 });
    b.addMindChild(root.id, "A");
    b.undo.undo();
    expect(b.list().map((o) => o.type)).toEqual(["shape"]);
  });
});
