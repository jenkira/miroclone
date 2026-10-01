import * as Y from "yjs";
import { OBJECTS_MAP, type Board, type BoardObject } from "@miroclone/shared";

/** Reads the objects out of a saved version's Yjs state. */
export function objectsFromState(base64: string): BoardObject[] {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bytes);
  return [...doc.getMap<BoardObject>(OBJECTS_MAP).values()];
}

/** Puts a saved version on the board as one undoable edit. Returns what changed. */
export function applyVersion(board: Board, base64: string) {
  return board.restoreObjects(objectsFromState(base64));
}

/** Splits a search snippet on the markers around matched words, so matches can be shown in bold without any HTML. */
export function snippetParts(snippet: string): { text: string; match: boolean }[] {
  const out: { text: string; match: boolean }[] = [];
  let match = false;
  for (const piece of snippet.split(/([\u0001\u0002])/)) {
    if (piece === "\u0001") match = true;
    else if (piece === "\u0002") match = false;
    else if (piece) out.push({ text: piece, match });
  }
  return out;
}
