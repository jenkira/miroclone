import * as Y from "yjs";
import { Board } from "./board-ops.js";
import type { BoardObject } from "./objects.js";

export const builtinTemplates = [
  { id: "retrospective", name: "Retrospective", description: "Three columns: went well, to improve, and action items." },
  { id: "kanban", name: "Kanban", description: "Backlog, to do, doing, and done." },
  { id: "brainstorm", name: "Brainstorm", description: "A topic in the middle with ideas around it." },
  { id: "flowchart", name: "Flowchart", description: "Start, steps, a decision, and an end." },
  { id: "story-map", name: "User story map", description: "Activities across the top, stories below, and release lines." },
  { id: "swot", name: "SWOT analysis", description: "Strengths, weaknesses, opportunities, and threats." },
] as const;
export type BuiltinTemplateId = (typeof builtinTemplates)[number]["id"];

const YELLOW = "#fff475", BLUE = "#a6ccf5", GREEN = "#b3e6b3", PINK = "#f5a6c8", ORANGE = "#ffc266";

type Add = (input: Record<string, unknown> & { type: BoardObject["type"] }) => BoardObject;

function frame(add: Add, title: string, x: number, y: number, width: number, height: number) {
  return add({ type: "frame", title, x, y, width, height });
}
const sticky = (add: Add, text: string, x: number, y: number, color = YELLOW) =>
  add({ type: "sticky", text, x, y, width: 160, height: 120, color });

const builders: Record<BuiltinTemplateId, (add: Add) => void> = {
  retrospective(add) {
    [["Went well", GREEN], ["To improve", PINK], ["Action items", BLUE]].forEach(([title, colour], i) => {
      const x = i * 460;
      frame(add, title!, x, 0, 420, 640);
      sticky(add, "Add a note here", x + 30, 50, colour);
    });
  },
  kanban(add) {
    ["Backlog", "To do", "Doing", "Done"].forEach((title, i) => {
      const x = i * 360;
      frame(add, title, x, 0, 320, 700);
      sticky(add, i === 0 ? "First card" : "", x + 80, 50);
    });
  },
  brainstorm(add) {
    const topic = add({ type: "shape", kind: "ellipse", text: "Topic", x: 0, y: 0, width: 240, height: 140, fill: "#ffffff" });
    const spots: [number, number][] = [[-420, -260], [0, -340], [420, -260], [-420, 260], [0, 340], [420, 260]];
    spots.forEach(([dx, dy], i) => {
      const s = sticky(add, `Idea ${i + 1}`, dx + 40, dy + 10, [YELLOW, BLUE, GREEN, PINK, ORANGE, YELLOW][i]);
      add({ type: "connector", from: topic.id, to: s.id });
    });
  },
  flowchart(add) {
    const start = add({ type: "shape", kind: "rounded", text: "Start", x: 0, y: 0, width: 180, height: 80 });
    const step = add({ type: "shape", kind: "rectangle", text: "Do the work", x: 0, y: 160, width: 180, height: 80 });
    const decide = add({ type: "shape", kind: "diamond", text: "Done?", x: -10, y: 320, width: 200, height: 140 });
    const again = add({ type: "shape", kind: "rectangle", text: "Fix it", x: 320, y: 350, width: 180, height: 80 });
    const end = add({ type: "shape", kind: "rounded", text: "End", x: 0, y: 540, width: 180, height: 80 });
    for (const [a, b] of [[start, step], [step, decide], [decide, end], [decide, again], [again, step]] as const) add({ type: "connector", from: a.id, to: b.id });
  },
  "story-map"(add) {
    frame(add, "Release 1", 0, 330, 1000, 240);
    frame(add, "Release 2", 0, 590, 1000, 240);
    ["Sign in", "Find items", "Buy", "Get help"].forEach((t, i) => {
      sticky(add, t, 20 + i * 240, 60, ORANGE);
      sticky(add, "Story", 20 + i * 240, 360, YELLOW);
      sticky(add, "Story", 20 + i * 240, 620, YELLOW);
    });
    add({ type: "text", text: "Activities across the top. Stories below, in priority order.", x: 0, y: -40, width: 620, height: 40 });
  },
  swot(add) {
    [["Strengths", 0, 0, GREEN], ["Weaknesses", 520, 0, PINK], ["Opportunities", 0, 520, BLUE], ["Threats", 520, 520, ORANGE]].forEach(([title, x, y, colour]) => {
      frame(add, title as string, x as number, y as number, 500, 500);
      sticky(add, "Add a note here", (x as number) + 30, (y as number) + 50, colour as string);
    });
  },
};

/** Builds the objects of a built-in template (WSH-1). Every call gives new IDs, and every object passes the model's checks. */
export function buildTemplate(id: BuiltinTemplateId): BoardObject[] {
  const b = new Board(new Y.Doc());
  const add: Add = (input) => b.add(input);
  builders[id](add);
  // Drop empty placeholder notes, so a template doesn't leave blank stickies.
  const blank = b.list().filter((o) => o.type === "sticky" && !o.text).map((o) => o.id);
  b.remove(blank);
  return b.list();
}

export const isBuiltinTemplate = (id: string): id is BuiltinTemplateId => builtinTemplates.some((t) => t.id === id);

/** Copies objects with new IDs, for saving or applying a template without sharing IDs between boards (WSH-2). */
export function cloneWithNewIds(objs: readonly BoardObject[]): BoardObject[] {
  const b = new Board(new Y.Doc());
  const ids = new Map(objs.map((o) => [o.id, crypto.randomUUID()]));
  for (const o of objs) {
    const copy = { ...o, id: ids.get(o.id)! } as Record<string, unknown> & { type: BoardObject["type"] };
    if (o.type === "connector") { copy.from = ids.get(o.from) ?? o.from; copy.to = ids.get(o.to) ?? o.to; }
    if (o.groupId) copy.groupId = `g-${ids.get(o.id)!.slice(0, 8)}`;
    b.add(copy);
  }
  return b.list();
}

/**
 * Frames in presentation order: top to bottom in rows, then left to right (WSH-5).
 * Frames whose tops are within half a frame height of each other count as one row.
 */
export function frameOrder(objs: readonly BoardObject[]): Extract<BoardObject, { type: "frame" }>[] {
  const frames = objs.filter((o): o is Extract<BoardObject, { type: "frame" }> => o.type === "frame");
  const byTop = [...frames].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: (typeof frames)[] = [];
  for (const f of byTop) {
    const row = rows.find((r) => Math.abs(r[0]!.y - f.y) <= Math.min(r[0]!.height, f.height) / 2);
    if (row) row.push(f); else rows.push([f]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.x - b.x));
}
