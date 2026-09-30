import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Board } from "./board-ops.js";
import { boundsOf, exportJson, rotatedExtent, exportSvg, importJson } from "./export.js";

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
  it("includes rotated objects in the export bounds", () => {
    // A 300x100 box turned 90 degrees around (150, 50) covers x 100..200 and y -100..200.
    const e = rotatedExtent({ x: 0, y: 0, width: 300, height: 100, rotation: 90 });
    expect(e.x).toBeCloseTo(100); expect(e.y).toBeCloseTo(-100); expect(e.width).toBeCloseTo(100); expect(e.height).toBeCloseTo(300);
    const b = new Board(new Y.Doc());
    b.add({ type: "sticky", x: 0, y: 0, width: 300, height: 100, rotation: 90 });
    expect(boundsOf(b.list(), 0).y).toBeCloseTo(-100);
    expect(rotatedExtent({ x: 0, y: 0, width: 300, height: 100, rotation: 0 })).toEqual({ x: 0, y: 0, width: 300, height: 100 });
  });
  it("frames an empty board", () => {
    expect(boundsOf([]).width).toBeGreaterThan(0);
  });
});

describe("image export", () => {
  const img = () => {
    const b = new Board(new Y.Doc());
    b.add({ type: "image", objectKey: "file-1", mimeType: "image/png", x: 0, y: 0, width: 50, height: 40 });
    return b.list();
  };
  it("embeds the image bytes when given, and shows a placeholder otherwise", () => {
    expect(exportSvg(img(), { classification: "OFFICIAL", images: { "file-1": "data:image/png;base64,AAAA" } })).toContain('<image href="data:image/png;base64,AAAA"');
    expect(exportSvg(img(), { classification: "OFFICIAL" })).not.toContain("<image");
  });
  it("embeds only image data URIs", () => {
    for (const bad of ["https://evil.test/x.png", 'data:text/html;base64,AAAA', 'data:image/png;base64,AA" onload="x']) {
      expect(exportSvg(img(), { classification: "OFFICIAL", images: { "file-1": bad } })).not.toContain("<image");
    }
  });
});

describe("text export", () => {
  const text = (extra: Record<string, unknown>) => {
    const b = new Board(new Y.Doc());
    b.add({ type: "text", x: 0, y: 0, width: 200, height: 60, text: "one\ntwo", ...extra });
    return exportSvg(b.list(), { classification: "OFFICIAL" });
  };
  it("applies formatting and list markers", () => {
    const svg = text({ bold: true, italic: true, underline: true, size: 24, align: "center", list: "number" });
    expect(svg).toContain('font-weight="700"');
    expect(svg).toContain('font-style="italic"');
    expect(svg).toContain('text-decoration="underline"');
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain("1. one");
    expect(svg).toContain("2. two");
  });
  it("wraps a safe link and refuses an unsafe one", () => {
    expect(text({ link: "https://example.test/a?b=1&c=2" })).toContain('<a href="https://example.test/a?b=1&amp;c=2">');
    const b = new Board(new Y.Doc());
    expect(() => b.add({ type: "text", link: "javascript:alert(1)" })).toThrow();
    expect(() => b.add({ type: "text", link: "data:text/html,x" })).toThrow();
  });
  it("rotates an object about its centre", () => {
    const b = new Board(new Y.Doc());
    b.add({ type: "sticky", x: 0, y: 0, width: 100, height: 100, rotation: 45 });
    expect(exportSvg(b.list(), { classification: "OFFICIAL" })).toContain('transform="rotate(45 50 50)"');
  });
  it("escapes text content", () => {
    expect(text({ text: "<img onerror=x>" })).toContain("&lt;img onerror=x&gt;");
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
