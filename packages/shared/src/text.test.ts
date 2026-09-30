import { describe, expect, it } from "vitest";
import { formatDue, isOverdue, listLines, wrapText } from "./text.js";

describe("wrapText", () => {
  it("wraps at word boundaries", () => {
    expect(wrapText("one two three four", 9)).toEqual(["one two", "three", "four"]);
  });
  it("breaks a word that is longer than a line", () => {
    expect(wrapText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });
  it("keeps paragraph breaks", () => {
    expect(wrapText("a\n\nb", 10)).toEqual(["a", "", "b"]);
  });
});

describe("due dates", () => {
  it("formats a date in the long Australian form", () => {
    expect(formatDue("2026-09-30")).toBe("30 September 2026");
    expect(formatDue("2027-01-05")).toBe("5 January 2027");
  });
  it("finds an overdue card", () => {
    expect(isOverdue("2026-09-29", "2026-09-30")).toBe(true);
    expect(isOverdue("2026-09-30", "2026-09-30")).toBe(false);
    expect(isOverdue(undefined, "2026-09-30")).toBe(false);
  });
});

describe("listLines", () => {
  it("numbers paragraphs", () => {
    expect(listLines("a\nb", "number")).toEqual(["1. a", "2. b"]);
  });
});
