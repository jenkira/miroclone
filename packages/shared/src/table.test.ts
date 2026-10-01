import { describe, expect, it } from "vitest";
import { boardObjectSchema } from "./objects.js";
import { exportSvg } from "./export.js";
import { boardText } from "./search-text.js";
import { emptyTable, insertLine, removeAt, resizeTable, setCell } from "./table.js";

const base = { id: "t", type: "table" as const, x: 0, y: 0, rotation: 0, index: "a0", locked: false, header: true };
const table = (rows: number, cols: number, cells: string[]) => ({ ...base, rows, cols, cells, width: cols * 120, height: rows * 36 });
const t23 = { ...emptyTable(2, 3), cells: ["a", "b", "c", "d", "e", "f"] };

describe("tables (CNV-16)", () => {
  it("makes an empty table at the default size", () => {
    expect(emptyTable()).toMatchObject({ rows: 3, cols: 3, width: 360, height: 108 });
    expect(emptyTable().cells).toEqual(Array(9).fill(""));
  });

  it("keeps the text of the cells that remain when it grows or shrinks", () => {
    const grown = resizeTable(t23, 3, 4);
    expect(grown.cells).toEqual(["a", "b", "c", "", "d", "e", "f", "", "", "", "", ""]);
    expect(grown.width).toBe(480);
    expect(resizeTable(t23, 1, 2).cells).toEqual(["a", "b"]);
  });

  it("refuses sizes outside the limits", () => {
    expect(() => resizeTable(t23, 0, 3)).toThrow();
    expect(() => resizeTable(t23, 51, 3)).toThrow();
    expect(() => resizeTable(t23, 3, 21)).toThrow();
    expect(() => resizeTable(t23, 1.5, 3)).toThrow();
  });

  it("sets one cell without changing the others", () => {
    expect(setCell(t23, 1, 2, "X")).toEqual(["a", "b", "c", "d", "e", "X"]);
    expect(() => setCell(t23, 2, 0, "x")).toThrow();
  });

  it("inserts a row or column in the middle with the rest shifted, and at the end", () => {
    expect(insertLine(t23, "row", 1).cells).toEqual(["a", "b", "c", "", "", "", "d", "e", "f"]);
    expect(insertLine(t23, "col", 1).cells).toEqual(["a", "", "b", "c", "d", "", "e", "f"]);
    expect(insertLine(t23, "row").cells).toEqual(["a", "b", "c", "d", "e", "f", "", "", ""]);
    expect(insertLine(t23, "col")).toMatchObject({ cols: 4, width: 480 });
  });

  it("removes a row or column, and keeps at least one of each", () => {
    expect(removeAt(t23, "row", 0)).toMatchObject({ rows: 1, cells: ["d", "e", "f"], height: 36 });
    expect(removeAt(t23, "col", 1).cells).toEqual(["a", "c", "d", "f"]);
    expect(() => removeAt(removeAt(t23, "row", 0), "row", 0)).toThrow(/at least one/);
    expect(() => removeAt(t23, "col", 5)).toThrow();
  });

  it("is a valid object only when the cells match the size", () => {
    expect(boardObjectSchema.safeParse(table(2, 3, ["a", "b", "c", "d", "e", "f"])).success).toBe(true);
    expect(boardObjectSchema.safeParse(table(2, 3, ["a"])).success).toBe(false);
    expect(boardObjectSchema.safeParse(table(1, 1, ["x".repeat(1001)])).success).toBe(false);
  });

  it("is searchable and exports with escaped text", () => {
    const o = boardObjectSchema.parse(table(1, 2, ["Name <b>", "Owner"]));
    expect(boardText([o])).toContain("Owner");
    const svg = exportSvg([o], { classification: "OFFICIAL" });
    expect(svg).toContain("Name &lt;b&gt;");
    expect(svg).toContain("<line");
    expect(svg).not.toContain("<b>");
  });
});

describe("embeds (CNV-17)", () => {
  const base = { id: "e", type: "embed" as const, x: 0, y: 0, width: 260, height: 120, rotation: 0, index: "a0", locked: false };
  it("accepts a web link and a stored PDF, and refuses anything else", () => {
    expect(boardObjectSchema.safeParse({ ...base, kind: "link", url: "https://wiki.example.internal/page" }).success).toBe(true);
    expect(boardObjectSchema.safeParse({ ...base, kind: "pdf", fileId: "f1", name: "Plan.pdf", pages: 3 }).success).toBe(true);
    for (const url of ["javascript:alert(1)", "mailto:a@b.test", "ftp://x/y", "data:text/html,x"]) expect(boardObjectSchema.safeParse({ ...base, kind: "link", url }).success).toBe(false);
    expect(boardObjectSchema.safeParse({ ...base, kind: "link" }).success).toBe(false);
    expect(boardObjectSchema.safeParse({ ...base, kind: "pdf" }).success).toBe(false);
  });
  it("is searchable and exports as a card with escaped text and a safe link", () => {
    const o = boardObjectSchema.parse({ ...base, kind: "link", url: "https://wiki.example.internal/a?b=1&c=2", title: "Team <wiki>", description: "How we work" });
    expect(boardText([o])).toContain("Team <wiki>");
    const svg = exportSvg([o], { classification: "OFFICIAL" });
    expect(svg).toContain("Team &lt;wiki&gt;");
    expect(svg).toContain("wiki.example.internal");
    expect(svg).toContain('href="https://wiki.example.internal/a?b=1&amp;c=2"');
    const pdf = boardObjectSchema.parse({ ...base, kind: "pdf", fileId: "f1", name: "Plan.pdf", pages: 1 });
    expect(exportSvg([pdf], { classification: "OFFICIAL" })).toContain("PDF, 1 page");
  });
});
