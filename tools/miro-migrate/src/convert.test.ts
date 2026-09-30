import { describe, expect, it } from "vitest";
import { boardObjectSchema } from "@miroclone/shared";
import { convertBoard } from "./convert.js";
import { htmlToText } from "./html.js";
import type { MiroBoard, MiroItem } from "./miro-types.js";

const board = (items: MiroItem[], connectors: MiroBoard["connectors"] = [], members: MiroBoard["members"] = []): MiroBoard => ({ info: { id: "b1", name: "Plan" }, items, connectors, members });
const at = (x: number, y: number, extra = {}) => ({ position: { x, y, origin: "center" }, ...extra });

describe("htmlToText (MIG-2)", () => {
  it("keeps paragraphs as lines, drops tags, and decodes entities", () => {
    expect(htmlToText("<p>One &amp; two</p><p>Three<br/>four</p>")).toBe("One & two\nThree\nfour");
    expect(htmlToText("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>")).toBe("<script>alert(1)</script>");
    expect(htmlToText("<p>caf&#233; &#x1F600;</p>")).toBe("café 😀");
  });
  it("strips markup that would otherwise reach a board", () => {
    expect(htmlToText(`<p onclick="x()">Hi <a href="javascript:alert(1)">there</a><script>bad()</script></p>`)).toBe("Hi therebad()");
  });
  it("copes with nothing", () => {
    expect(htmlToText(undefined)).toBe("");
    expect(htmlToText("")).toBe("");
  });
});

describe("convertBoard", () => {
  it("converts a sticky note, keeping text and colour, and turns a centre position into a corner", () => {
    const r = convertBoard(board([{ id: "1", type: "sticky_note", data: { content: "<p>Hello</p>" }, style: { fillColor: "light_green" }, ...at(100, 200), geometry: { width: 200 } }]));
    expect(r.objects[0]).toMatchObject({ type: "sticky", text: "Hello", x: 0, y: 100, width: 200, height: 200 });
    expect(r.items[0]).toMatchObject({ outcome: "approximated" });
    expect(r.items[0]!.detail).toContain("light_green");
  });

  it("keeps an exact hex colour without noting a difference", () => {
    const r = convertBoard(board([{ id: "1", type: "sticky_note", data: { content: "x" }, style: { fillColor: "#ff00aa" }, ...at(0, 0), geometry: { width: 100 } }]));
    expect(r.objects[0]).toMatchObject({ color: "#ff00aa" });
    expect(r.items[0]!.outcome).toBe("converted");
  });

  it("maps shapes, and draws an unknown shape as a rectangle with a note", () => {
    const r = convertBoard(board([
      { id: "a", type: "shape", data: { shape: "round_rectangle", content: "<p>A</p>" }, style: { fillColor: "#ffffff", borderColor: "#123456" }, ...at(0, 0), geometry: { width: 100, height: 50 } },
      { id: "b", type: "shape", data: { shape: "circle" }, ...at(0, 0), geometry: { width: 100, height: 100 } },
      { id: "c", type: "shape", data: { shape: "star" }, ...at(0, 0), geometry: { width: 100, height: 100 } },
    ]));
    expect(r.objects.map((o) => (o as { kind?: string }).kind)).toEqual(["rounded", "ellipse", "rectangle"]);
    expect(r.objects[0]).toMatchObject({ stroke: "#123456", text: "A" });
    expect(r.items.map((i) => i.outcome)).toEqual(["converted", "converted", "approximated"]);
  });

  it("converts text with its size and alignment, and works out a height when Miro gives none", () => {
    const r = convertBoard(board([{ id: "t", type: "text", data: { content: "<p>Heading</p>" }, style: { fontSize: "32", textAlign: "center", color: "#ff0000" }, ...at(50, 50), geometry: { width: 300 } }]));
    expect(r.objects[0]).toMatchObject({ type: "text", size: 32, align: "center", color: "#ff0000", text: "Heading" });
    expect((r.objects[0] as { height: number }).height).toBeGreaterThan(32);
  });

  it("converts a card with its assignee name, due date, and colour", () => {
    const r = convertBoard(board(
      [{ id: "c", type: "card", data: { title: "Fix it", description: "<p>Soon</p>", assignee: { userId: "u1" }, dueDate: "2026-09-30T00:00:00.000Z" }, style: { cardTheme: "#2d9bf0" }, ...at(0, 0), geometry: { width: 240, height: 120 } }],
      [], [{ id: "u1", name: "Ann Author" }]));
    expect(r.objects[0]).toMatchObject({ type: "card", title: "Fix it", description: "Soon", assignee: "Ann Author", due: "2026-09-30", color: "#2d9bf0" });
    expect(r.items[0]!.outcome).toBe("converted");
  });

  it("notes an assignee who isn't a board member", () => {
    const r = convertBoard(board([{ id: "c", type: "card", data: { title: "x", assignee: { userId: "gone" } }, ...at(0, 0) }]));
    expect(r.objects[0]).toMatchObject({ assignee: "" });
    expect(r.items[0]).toMatchObject({ outcome: "approximated" });
  });

  it("puts frames behind their content, and places items from a frame's top-left corner", () => {
    const r = convertBoard(board([
      { id: "s", type: "sticky_note", data: { content: "in" }, parent: { id: "f" }, position: { x: 100, y: 100, relativeTo: "parent_top_left" }, geometry: { width: 100 } },
      { id: "f", type: "frame", data: { title: "Stage" }, ...at(1000, 1000), geometry: { width: 400, height: 300 } },
    ]));
    expect(r.objects.map((o) => o.type)).toEqual(["frame", "sticky"]);
    expect(r.objects[0]).toMatchObject({ x: 800, y: 850, title: "Stage" });
    // The sticky's centre sits 100 right and 100 down from the frame's corner at (800, 850).
    expect(r.objects[1]).toMatchObject({ x: 850, y: 900 });
    expect(r.objects[0]!.index < r.objects[1]!.index).toBe(true);
  });

  it("keeps rotation", () => {
    const r = convertBoard(board([{ id: "s", type: "sticky_note", data: { content: "x" }, ...at(0, 0), geometry: { width: 100, rotation: 45 } }]));
    expect(r.objects[0]!.rotation).toBe(45);
  });

  it("replaces an unsupported item with a placeholder that names its type (MIG-3)", () => {
    const r = convertBoard(board([{ id: "e", type: "embed", data: { title: "Roadmap video", url: "https://example.test/v" }, ...at(0, 0), geometry: { width: 300, height: 200 } }]));
    expect(r.objects[0]).toMatchObject({ type: "sticky", color: "#e0e0e0", x: -150, y: -100 });
    expect((r.objects[0] as { text: string }).text).toContain("Unsupported Miro item: embed");
    expect((r.objects[0] as { text: string }).text).toContain("Roadmap video");
    expect((r.objects[0] as { text: string }).text).not.toContain("example.test");
    expect(r.items[0]).toMatchObject({ type: "embed", outcome: "placeholder" });
  });

  it("converts an image when the file was downloaded, and uses a placeholder when it wasn't", () => {
    const items: MiroItem[] = [
      { id: "i1", type: "image", ...at(0, 0), geometry: { width: 200, height: 100 } },
      { id: "i2", type: "image", ...at(0, 0) },
      { id: "i3", type: "image", ...at(0, 0) },
    ];
    const r = convertBoard(board(items), { images: { i1: { fileName: "files/i1.png", mimeType: "image/png" }, i2: { error: "the file is larger than 25 MB" } } });
    expect(r.objects[0]).toMatchObject({ type: "image", objectKey: "file:files/i1.png", mimeType: "image/png" });
    expect(r.items.map((i) => i.outcome)).toEqual(["converted", "placeholder", "placeholder"]);
    expect(r.items[1]!.detail).toContain("25 MB");
  });

  it("joins connectors to the converted items, and leaves out one with a missing end", () => {
    const r = convertBoard(
      board([
        { id: "a", type: "sticky_note", data: { content: "a" }, ...at(0, 0), geometry: { width: 100 } },
        { id: "b", type: "sticky_note", data: { content: "b" }, ...at(300, 0), geometry: { width: 100 } },
      ], [
        { id: "c1", startItem: { id: "a" }, endItem: { id: "b" }, shape: "elbowed" },
        { id: "c2", startItem: { id: "a" }, endItem: { id: "nope" } },
        { id: "c3", startItem: { id: "a" }, endItem: { id: "b" }, captions: [{ content: "<p>yes</p>" }] },
      ]));
    const cons = r.objects.filter((o) => o.type === "connector");
    expect(cons).toHaveLength(2);
    expect(cons[0]).toMatchObject({ from: "miro-a", to: "miro-b", routing: "elbow" });
    expect(r.items.filter((i) => i.type === "connector").map((i) => i.outcome)).toEqual(["converted", "error", "approximated"]);
  });

  it("turns a bad item into an error and a placeholder instead of stopping", () => {
    const r = convertBoard(board([
      { id: "bad", type: "sticky_note", data: { content: "x" }, ...at(0, 0), geometry: { width: -5 } },
      { id: "ok", type: "sticky_note", data: { content: "fine" }, ...at(0, 0), geometry: { width: 100 } },
    ]));
    expect(r.items.map((i) => i.outcome)).toEqual(["error", "converted"]);
    expect(r.objects).toHaveLength(2);
    expect((r.objects[0] as { text: string }).text).toContain("Unsupported Miro item: sticky_note");
  });

  it("produces objects that pass the product's own schema, with unique IDs and increasing indexes", () => {
    const r = convertBoard(board([
      { id: "1", type: "sticky_note", data: { content: "a" }, ...at(0, 0), geometry: { width: 100 } },
      { id: "2", type: "shape", data: { shape: "rectangle" }, ...at(0, 0), geometry: { width: 100, height: 100 } },
      { id: "3", type: "frame", data: { title: "F" }, ...at(0, 0), geometry: { width: 100, height: 100 } },
      { id: "4", type: "document", ...at(0, 0) },
    ]));
    for (const o of r.objects) expect(boardObjectSchema.safeParse(o).success).toBe(true);
    expect(new Set(r.objects.map((o) => o.id)).size).toBe(r.objects.length);
    const idx = r.objects.map((o) => o.index);
    expect([...idx].sort()).toEqual(idx);
  });

  it("truncates very long text, so it fits the product's limits", () => {
    const r = convertBoard(board([{ id: "c", type: "card", data: { title: "t".repeat(500), description: "d".repeat(5000) }, ...at(0, 0) }]));
    expect((r.objects[0] as { title: string }).title.length).toBeLessThanOrEqual(200);
    expect((r.objects[0] as { description: string }).description.length).toBeLessThanOrEqual(2000);
  });
});
