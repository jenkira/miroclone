import { generateKeyBetween } from "fractional-indexing";
import * as Y from "yjs";
import { boardObjectSchema, MAX_OBJECTS_PER_BOARD, OBJECTS_MAP, type BoardObject } from "./objects.js";

type Input = Record<string, unknown> & { type: BoardObject["type"] };

export class BoardLimitError extends Error {}

/** Operations on a board's Yjs document. Every change goes through these, so the rules live in one place. */
export class Board {
  readonly objects: Y.Map<BoardObject>;
  /** Tracks only this client's changes, so undo never reverts other users' work (CNV-10). */
  readonly undo: Y.UndoManager;

  /**
   * When set, `list()` returns only the objects it accepts. Private mode uses it to hide other people's content on this
   * client (WSH-7). It filters the view only: the objects are still in the document.
   */
  private viewFilter: ((o: BoardObject) => boolean) | null = null;

  constructor(readonly doc: Y.Doc, readonly origin: unknown = "local", readonly author?: string) {
    this.objects = doc.getMap<BoardObject>(OBJECTS_MAP);
    this.undo = new Y.UndoManager(this.objects, { trackedOrigins: new Set([origin]), captureTimeout: 300 });
  }

  private tx<T>(fn: () => T): T {
    return this.doc.transact(fn, this.origin) as T;
  }

  /**
   * Starts a new undo step. Discrete actions call it so quick successive actions don't merge.
   * Drags (`move`) and text edits (`update`) don't, so they merge into one step.
   */
  private step<T>(fn: () => T): T {
    this.undo.stopCapturing();
    return this.tx(fn);
  }

  get(id: string): BoardObject | undefined { return this.objects.get(id); }

  setViewFilter(fn: ((o: BoardObject) => boolean) | null) { this.viewFilter = fn; }

  /** True when this client's view includes the object. */
  visible(o: BoardObject): boolean { return !this.viewFilter || this.viewFilter(o); }

  /** Objects from back to front, as this client sees them. */
  list(): BoardObject[] {
    return [...this.objects.values()].filter((o) => this.visible(o)).sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : a.id < b.id ? -1 : 1));
  }

  add(input: Input): BoardObject {
    if (this.objects.size >= MAX_OBJECTS_PER_BOARD) throw new BoardLimitError("Board is full.");
    return this.step(() => {
      const top = this.list().at(-1)?.index ?? null;
      const obj = boardObjectSchema.parse({
        id: crypto.randomUUID(),
        x: 0, y: 0, width: 100, height: 100,
        ...input,
        // Whoever adds an object is its author, even when it's a pasted copy of someone else's.
        ...(this.author ? { by: this.author } : {}),
        index: generateKeyBetween(top, null),
      });
      this.objects.set(obj.id, obj);
      return obj;
    });
  }

  /** Adds many objects as one undo step. Throws before adding any if the board can't hold them all. */
  addMany(inputs: Input[]): BoardObject[] {
    if (this.objects.size + inputs.length > MAX_OBJECTS_PER_BOARD) throw new BoardLimitError("Board is full.");
    return this.step(() => {
      let last = this.list().at(-1)?.index ?? null;
      return inputs.map((input) => {
        const obj = boardObjectSchema.parse({ id: crypto.randomUUID(), x: 0, y: 0, width: 100, height: 100, ...input, ...(this.author ? { by: this.author } : {}), index: (last = generateKeyBetween(last, null)) });
        this.objects.set(obj.id, obj);
        return obj;
      });
    });
  }

  update(id: string, patch: Partial<BoardObject>): void {
    this.tx(() => {
      const cur = this.objects.get(id);
      if (!cur || cur.locked && !("locked" in patch)) return;
      this.objects.set(id, boardObjectSchema.parse({ ...cur, ...patch, id, type: cur.type }));
    });
  }

  move(ids: string[], dx: number, dy: number): void {
    this.tx(() => {
      for (const id of ids) {
        const o = this.objects.get(id);
        if (o && !o.locked) this.update(id, { x: o.x + dx, y: o.y + dy });
      }
    });
  }

  /** Deletes objects, and any connector that attached to them. */
  remove(ids: string[]): void {
    this.step(() => {
      const gone = new Set(ids.filter((id) => !this.objects.get(id)?.locked));
      for (const o of this.objects.values()) {
        if (o.type === "connector" && (gone.has(o.from) || gone.has(o.to))) gone.add(o.id);
      }
      for (const id of gone) this.objects.delete(id);
    });
  }

  bringToFront(id: string): void {
    this.step(() => {
      const top = this.list().at(-1);
      if (top && top.id !== id) this.update(id, { index: generateKeyBetween(top.index, null) });
    });
  }

  sendToBack(id: string): void {
    this.step(() => {
      const bottom = this.list()[0];
      if (bottom && bottom.id !== id) this.update(id, { index: generateKeyBetween(null, bottom.index) });
    });
  }

  group(ids: string[]): string {
    const groupId = crypto.randomUUID();
    this.step(() => { for (const id of ids) this.update(id, { groupId }); });
    return groupId;
  }

  ungroup(groupId: string): void {
    this.step(() => {
      for (const o of this.objects.values()) if (o.groupId === groupId) this.update(o.id, { groupId: undefined });
    });
  }

  setLocked(ids: string[], locked: boolean): void {
    this.step(() => { for (const id of ids) this.update(id, { locked }); });
  }

  /** Returns the ids in a selection, expanded to whole groups. */
  expandGroups(ids: string[]): string[] {
    const groups = new Set(ids.map((id) => this.objects.get(id)?.groupId).filter(Boolean));
    return this.list().filter((o) => ids.includes(o.id) || (o.groupId && groups.has(o.groupId))).map((o) => o.id);
  }

  /**
   * Replaces the board's contents with a saved version, as one undoable step (BRD-6).
   * It runs as a normal edit, so connected users see it and the server applies its usual role checks.
   * Returns how many objects were removed, added, and changed.
   */
  restoreObjects(saved: readonly BoardObject[]): { removed: number; added: number; changed: number } {
    return this.step(() => {
      const want = new Map(saved.map((o) => [o.id, boardObjectSchema.parse(o)]));
      let removed = 0, added = 0, changed = 0;
      for (const id of [...this.objects.keys()]) {
        if (!want.has(id)) { this.objects.delete(id); removed++; }
      }
      for (const [id, o] of want) {
        const cur = this.objects.get(id);
        if (!cur) { this.objects.set(id, o); added++; }
        else if (JSON.stringify(cur) !== JSON.stringify(o)) { this.objects.set(id, o); changed++; }
      }
      return { removed, added, changed };
    });
  }

  /** Connector end points, from the centres of the objects it attaches to (CNV-6). */
  connectorEnds(id: string): { from: { x: number; y: number }; to: { x: number; y: number } } | undefined {
    const c = this.objects.get(id);
    if (c?.type !== "connector") return undefined;
    const a = this.objects.get(c.from), b = this.objects.get(c.to);
    if (!a || !b) return undefined;
    const centre = (o: BoardObject) => ({ x: o.x + o.width / 2, y: o.y + o.height / 2 });
    return { from: centre(a), to: centre(b) };
  }

  /** Copies objects to a portable clipboard payload, including the connectors between them (CNV-11). */
  copy(ids: string[]): BoardObject[] {
    const set = new Set(this.expandGroups(ids));
    return this.list().filter((o) => set.has(o.id) || (o.type === "connector" && set.has(o.from) && set.has(o.to)));
  }

  /** Pastes a clipboard payload with new ids, offset so it doesn't hide the original. Works across boards. */
  paste(items: BoardObject[], offset = 20): string[] {
    return this.step(() => {
      const ids = new Map(items.map((o) => [o.id, crypto.randomUUID()]));
      const groups = new Map<string, string>();
      const created: string[] = [];
      for (const o of items) {
        const copy: Input = { ...o, id: ids.get(o.id), x: o.x + offset, y: o.y + offset };
        if (o.groupId) copy.groupId = groups.get(o.groupId) ?? groups.set(o.groupId, crypto.randomUUID()).get(o.groupId);
        if (o.type === "connector") {
          copy.from = ids.get(o.from) ?? o.from;
          copy.to = ids.get(o.to) ?? o.to;
        }
        const pasted = this.add(copy);
        created.push(pasted.id);
      }
      return created;
    });
  }
}

/** Aligns objects to an edge or centre (CNV-12). */
export function alignX(objs: BoardObject[], to: "left" | "centre" | "right"): Record<string, number> {
  const left = Math.min(...objs.map((o) => o.x));
  const right = Math.max(...objs.map((o) => o.x + o.width));
  return Object.fromEntries(objs.map((o) => [o.id,
    to === "left" ? left : to === "right" ? right - o.width : (left + right) / 2 - o.width / 2]));
}

/** Spaces objects evenly between the outermost two along x (CNV-12). */
export function distributeX(objs: BoardObject[]): Record<string, number> {
  const sorted = [...objs].sort((a, b) => a.x - b.x);
  if (sorted.length < 3) return Object.fromEntries(sorted.map((o) => [o.id, o.x]));
  const first = sorted[0]!, last = sorted.at(-1)!;
  const span = last.x + last.width - first.x;
  const gap = (span - sorted.reduce((n, o) => n + o.width, 0)) / (sorted.length - 1);
  let x = first.x;
  return Object.fromEntries(sorted.map((o) => { const out = [o.id, x] as const; x += o.width + gap; return out; }));
}
