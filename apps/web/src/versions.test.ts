import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Board } from "@miroclone/shared";
import { applyVersion, snippetParts } from "./versions.js";

const stateOf = (b: Board) => btoa(String.fromCharCode(...Y.encodeStateAsUpdate(b.doc)));

describe("applyVersion", () => {
  it("restores a saved state onto another board's live document, and undo reverts it", () => {
    const saved = new Board(new Y.Doc());
    saved.add({ type: "sticky", text: "kept" });
    const state = stateOf(saved);
    const live = new Board(new Y.Doc());
    live.add({ type: "sticky", text: "newer" });
    expect(applyVersion(live, state)).toEqual({ removed: 1, added: 1, changed: 0 });
    expect(live.list().map((o) => (o as { text: string }).text)).toEqual(["kept"]);
    live.undo.undo();
    expect(live.list().map((o) => (o as { text: string }).text)).toEqual(["newer"]);
  });
});

describe("snippetParts", () => {
  it("separates matched words, and never passes markup through as markup", () => {
    expect(snippetParts("a \u0001budget\u0002 <b>review</b>")).toEqual([
      { text: "a ", match: false }, { text: "budget", match: true }, { text: " <b>review</b>", match: false },
    ]);
    expect(snippetParts("")).toEqual([]);
  });
});
