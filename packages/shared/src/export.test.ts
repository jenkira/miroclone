import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Board } from "./board-ops.js";
import { boundsOf, exportJson, exportSvg, importJson } from "./export.js";

function sample() {
  const b = new Board(new Y.Doc());
  const a = b.add({ type: "sticky", x: 0, y: 0, width: 100, height: 100, text: `<script>alert("x")</script> & co` });
  const c = b.add({ type: "shape", kind: "diamond", x: 300, y: 0, width: 100, height: 100 });
  b.add({ type: "connector", from: a.id, to: c.id });
  return b.list();
}

describe("exportSvg", () => {
  it("marks the classification in a header, footer, and metadata", () => {
    const svg = exportSvg(sample(), { classification: "PROTECTED", title: "Plan" });
    expect(svg.match(/>PROTECTED</g)).toHaveLength(2);
    expect(svg).toContain('data-classification="PROTECTED"');
    expect(svg).toContain("<metadata>classification=PROTECTED</metadata>");
  });
  it("escapes user text and emits no script", () => {
    const svg = exportSvg(sample(), { classification: "OFFICIAL" });
    expect(svg).not.toContain("<script");
    expect(svg).toContain("&lt;script&gt;");
  });
  it("ignores colours that aren't hex values", () => {
    const b = new Board(new Y.Doc());
    b.add({ type: "sticky", color: 'red" onload="x' });
    expect(exportSvg(b.list(), { classification: "OFFICIAL" })).not.toContain("onload");
  });
  it("draws connectors between objects", () => {
    expect(exportSvg(sample(), { classification: "OFFICIAL" })).toContain("<line");
  });
  it("rejects an unknown classification", () => {
    expect(() => exportSvg(sample(), { classification: "SECRET" })).toThrow();
  });
  it("frames an empty board", () => {
    expect(boundsOf([]).width).toBeGreaterThan(0);
  });
});

describe("board JSON", () => {
  it("round-trips objects with the classification", () => {
    const objs = sample();
    const file = importJson(exportJson(objs, { title: "Plan", classification: "PROTECTED" }));
    expect(file.classification).toBe("PROTECTED");
    expect(file.objects).toHaveLength(objs.length);
  });
  it("rejects malformed files", () => {
    expect(() => importJson("not json")).toThrow("valid JSON");
    expect(() => importJson(JSON.stringify({ format: "other" }))).toThrow("isn't a Miroclone board");
    expect(() => importJson(exportJson([], { title: "T", classification: "SECRET" }))).toThrow();
  });
});
