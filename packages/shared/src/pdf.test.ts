import { describe, expect, it } from "vitest";
import { buildPdf, jpegSize } from "./pdf.js";

// A minimal JPEG header with a 640 by 480 start-of-frame, which is all the size reader looks at.
const jpeg = (w: number, h: number) => new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x0b, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xd9,
]);
const text = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

describe("jpegSize", () => {
  it("reads the size, and refuses bytes that aren't a JPEG", () => {
    expect(jpegSize(jpeg(640, 480))).toEqual({ width: 640, height: 480 });
    expect(jpegSize(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
  });
  it("skips a DHT segment, which isn't a frame header", () => {
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xc4, 0x00, 0x04, 0, 0, ...jpeg(10, 20).slice(8)]);
    expect(jpegSize(b)).toEqual({ width: 10, height: 20 });
  });
});

describe("buildPdf", () => {
  const pdf = buildPdf([{ jpeg: jpeg(800, 600), width: 800, height: 600 }, { jpeg: jpeg(400, 300), width: 400, height: 300 }], { title: "Plan (v2)", classification: "PROTECTED" });
  const s = text(pdf);

  it("writes a header, a page per image, and an end marker", () => {
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(s).toContain("/Count 2");
    expect((s.match(/\/Type \/Page /g) ?? []).length).toBe(2);
    expect(s).toContain("/MediaBox [0 0 600 450]");
    expect(s).toContain("/Filter /DCTDecode");
  });

  it("points every cross-reference entry at its object", () => {
    const start = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(start, start + 4)).toBe("xref");
    const rows = s.slice(start).split("\n").filter((l) => /^\d{10} 00000 n/.test(l));
    expect(rows.length).toBe(4 + 2 * 3 - 1);
    rows.forEach((row, i) => expect(s.slice(Number(row.slice(0, 10))).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });

  it("escapes the title and records the classification in the properties", () => {
    expect(s).toContain("/Title (Plan \\(v2\\))");
    expect(s).toContain("/Subject (PROTECTED)");
  });

  it("encodes a title with non-ASCII characters as UTF-16", () => {
    expect(text(buildPdf([{ jpeg: jpeg(1, 1), width: 1, height: 1 }], { title: "Café", classification: "OFFICIAL" }))).toContain("/Title <FEFF00430061006600E9>");
  });

  it("records the image's own pixel size, which can differ from the page size", () => {
    const t = text(buildPdf([{ jpeg: jpeg(1600, 1200), width: 800, height: 600 }], { title: "x", classification: "OFFICIAL" }));
    expect(t).toContain("/MediaBox [0 0 600 450]");
    expect(t).toContain("/Width 1600 /Height 1200");
  });

  it("refuses an empty document", () => {
    expect(() => buildPdf([], { title: "x", classification: "OFFICIAL" })).toThrow();
  });
});
