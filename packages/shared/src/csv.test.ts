import { describe, expect, it } from "vitest";
import { MAX_CSV_ROWS, MAX_CSV_TEXT, notesFromCsv, parseCsv } from "./csv.js";

describe("parseCsv", () => {
  it("reads plain rows, with either kind of line break and a final break", () => {
    expect(parseCsv("a,b\r\nc,d\n")).toEqual([["a", "b"], ["c", "d"]]);
  });
  it("reads quoted fields with commas, doubled quotes, and line breaks", () => {
    expect(parseCsv('"one, two","say ""hi""","line\nbreak"')).toEqual([["one, two", 'say "hi"', "line\nbreak"]]);
  });
  it("keeps empty fields, and drops blank lines", () => {
    expect(parseCsv("a,,c\n\nd")).toEqual([["a", "", "c"], ["d"]]);
  });
  it("ignores a byte order mark", () => {
    expect(parseCsv("﻿a,b")).toEqual([["a", "b"]]);
  });
  it("copes with an unclosed quote by taking the rest as text", () => {
    expect(parseCsv('a,"b\nc')).toEqual([["a", "b\nc"]]);
  });
});

describe("notesFromCsv (EXP-4)", () => {
  it("takes the first column when there's no header", () => {
    expect(notesFromCsv("First idea\nSecond idea,ignored").notes.map((n) => n.text)).toEqual(["First idea", "Second idea"]);
  });
  it("uses a text column and a colour column from the header", () => {
    const r = notesFromCsv("id,Text,Colour\n1,Fix login,blue\n2,Write docs,#ff0000\n3,Other,nonsense");
    expect(r.notes).toEqual([
      { text: "Fix login", color: "#81d4fa" },
      { text: "Write docs", color: "#ff0000" },
      { text: "Other", color: "#fff475" },
    ]);
  });
  it("skips rows with no text and counts them", () => {
    const r = notesFromCsv("text\nA\n\n,\n  \nB");
    expect(r.notes.map((n) => n.text)).toEqual(["A", "B"]);
    expect(r.skipped).toBe(2);
  });
  it("cuts long text and counts it", () => {
    const r = notesFromCsv("x".repeat(MAX_CSV_TEXT + 50));
    expect(r.notes[0]!.text).toHaveLength(MAX_CSV_TEXT);
    expect(r.truncated).toBe(1);
  });
  it("refuses a file with too many rows", () => {
    expect(() => notesFromCsv(Array.from({ length: MAX_CSV_ROWS + 1 }, (_, i) => `n${i}`).join("\n"))).toThrow(/at most 500/);
  });
  it("keeps markup as plain text, because boards render text only", () => {
    expect(notesFromCsv("<script>alert(1)</script>").notes[0]!.text).toBe("<script>alert(1)</script>");
  });
});
