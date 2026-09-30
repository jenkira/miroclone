import { IndexeddbPersistence } from "y-indexeddb";
import type * as Y from "yjs";
import { clearClipboard } from "./Canvas.js";

/** Every cache database starts with this prefix, so one sweep can remove them all (COL-10). */
export const CACHE_PREFIX = "miroclone:";
const REGISTRY = "miroclone:registry";

function remember(name: string) {
  try {
    const names = new Set<string>(JSON.parse(localStorage.getItem(REGISTRY) ?? "[]"));
    names.add(name);
    localStorage.setItem(REGISTRY, JSON.stringify([...names]));
  } catch { /* Storage can be blocked. The prefix sweep still works. */ }
}

/**
 * Keeps a copy of the board in this browser, so the user can reload and keep editing offline (COL-5).
 * Returns a function that stops the cache. It doesn't delete it. Only `clearOfflineCache` does.
 */
export function cacheBoard(boardId: string, doc: Y.Doc): () => void {
  const name = `${CACHE_PREFIX}board:${boardId}`;
  remember(name);
  const p = new IndexeddbPersistence(name, doc);
  return () => { void p.destroy(); };
}

/**
 * Deletes every cached board and the in-tab clipboard. Call it on sign-out and when a session ends,
 * because the cache holds board content, up to PROTECTED (COL-10).
 */
export async function clearOfflineCache(): Promise<void> {
  clearClipboard();
  const names = new Set<string>();
  try {
    for (const n of JSON.parse(localStorage.getItem(REGISTRY) ?? "[]") as string[]) names.add(n);
    localStorage.removeItem(REGISTRY);
  } catch { /* ignore */ }
  try {
    for (const d of (await indexedDB.databases?.()) ?? []) if (d.name?.startsWith(CACHE_PREFIX)) names.add(d.name);
  } catch { /* Older browsers lack indexedDB.databases(). The registry covers them. */ }
  await Promise.all([...names].map((n) => new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(n);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  })));
}
