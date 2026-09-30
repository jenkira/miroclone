import { describe, expect, it } from "vitest";
import { Board } from "./board-ops.js";
import * as Y from "yjs";
import { boardObjectSchema, MAX_OBJECTS_PER_BOARD } from "./objects.js";
import { buildTemplate, builtinTemplates, cloneWithNewIds, frameOrder, isBuiltinTemplate } from "./templates.js";

describe("built-in templates", () => {
  it("offers the six templates the PRD lists", () => {
    expect(builtinTemplates.map((t) => t.id).sort()).toEqual(["brainstorm", "flowchart", "kanban", "retrospective", "story-map", "swot"]);
  });

  it.each(builtinTemplates.map((t) => t.id))("%s builds valid, self-consistent objects", (id) => {
    const objs = buildTemplate(id);
    expect(objs.length).toBeGreaterThan(2);
    expect(objs.length).toBeLessThan(MAX_OBJECTS_PER_BOARD);
    for (const o of objs) expect(() => boardObjectSchema.parse(o)).not.toThrow();
    const ids = new Set(objs.map((o) => o.id));
    expect(ids.size).toBe(objs.length);
    for (const o of objs) if (o.type === "connector") { expect(ids.has(o.from)).toBe(true); expect(ids.has(o.to)).toBe(true); }
    expect(objs.some((o) => o.type === "sticky" && !o.text)).toBe(false);
  });

  it("names the columns and quadrants people expect", () => {
    const titles = (id: Parameters<typeof buildTemplate>[0]) => buildTemplate(id).filter((o) => o.type === "frame").map((o) => (o as { title: string }).title);
    expect(titles("retrospective")).toEqual(["Went well", "To improve", "Action items"]);
    expect(titles("kanban")).toEqual(["Backlog", "To do", "Doing", "Done"]);
    expect(titles("swot").sort()).toEqual(["Opportunities", "Strengths", "Threats", "Weaknesses"]);
  });

  it("gives new IDs on each build", () => {
    expect(buildTemplate("swot")[0]!.id).not.toBe(buildTemplate("swot")[0]!.id);
  });

  it("recognises built-in IDs only", () => {
    expect(isBuiltinTemplate("swot")).toBe(true);
    expect(isBuiltinTemplate("3f2a")).toBe(false);
  });
});

describe("cloneWithNewIds", () => {
  it("keeps connectors attached to the copies, and never reuses an ID", () => {
    const src = buildTemplate("flowchart");
    const copy = cloneWithNewIds(src);
    expect(copy).toHaveLength(src.length);
    const old = new Set(src.map((o) => o.id));
    expect(copy.every((o) => !old.has(o.id))).toBe(true);
    const ids = new Set(copy.map((o) => o.id));
    for (const o of copy) if (o.type === "connector") { expect(ids.has(o.from)).toBe(true); expect(ids.has(o.to)).toBe(true); }
  });
});

describe("frameOrder", () => {
  const f = (title: string, x: number, y: number) => ({ type: "frame" as const, title, x, y, width: 400, height: 300 });
  it("reads top to bottom, then left to right, and treats near-equal tops as one row", () => {
    const b = new Board(new Y.Doc());
    b.add(f("D", 0, 400)); b.add(f("B", 450, 20)); b.add(f("A", 0, 0)); b.add(f("E", 450, 405)); b.add(f("C", 900, 0));
    b.add({ type: "sticky", text: "ignored" });
    expect(frameOrder(b.list()).map((x) => x.title)).toEqual(["A", "B", "C", "D", "E"]);
  });
  it("gives nothing for a board with no frames", () => {
    expect(frameOrder([])).toEqual([]);
  });
});
