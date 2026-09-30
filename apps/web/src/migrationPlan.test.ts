import { describe, expect, it } from "vitest";
import { organise, parseManifest, toBase64 } from "./migrationPlan.js";

describe("parseManifest", () => {
  const board = { folder: "Plan-1", miroBoardId: "1", title: "Plan", objects: 3, totals: { items: 3, converted: 3, approximated: 0, placeholder: 0, error: 0 } };
  it("reads the boards", () => {
    expect(parseManifest(JSON.stringify({ format: "miroclone-migration", version: 1, boards: [board, { nonsense: true }] }))).toEqual([board]);
  });
  it("refuses other files with a clear message", () => {
    expect(() => parseManifest("{")).toThrow(/valid JSON/);
    expect(() => parseManifest(JSON.stringify({ format: "miroclone-board" }))).toThrow(/migration tool/);
  });
});

describe("toBase64", () => {
  it("matches the standard encoding, including for data bigger than one chunk", () => {
    expect(toBase64(new TextEncoder().encode("hello").buffer)).toBe("aGVsbG8=");
    const big = new Uint8Array(100_000).map((_, i) => i % 251);
    expect(Buffer.from(toBase64(big.buffer), "base64").equals(Buffer.from(big))).toBe(true);
  });
});

describe("organise", () => {
  it("groups each board's file and images by folder, and finds the manifest", () => {
    const r = organise(["out/manifest.json", "out/A-1/board.json", "out/A-1/report.md", "out/A-1/files/x.png", "out/B-2/board.json", "out/B-2/files/deep/y.png"]);
    expect(r.manifest).toBe("out/manifest.json");
    expect(r.boards.get("A-1")).toEqual({ board: "out/A-1/board.json", files: ["out/A-1/files/x.png"] });
    expect(r.boards.get("B-2")).toEqual({ board: "out/B-2/board.json", files: [] });
  });
});
