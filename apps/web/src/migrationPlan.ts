/** One board in the migration tool's manifest.json. */
export interface PlanBoard {
  folder: string;
  miroBoardId: string;
  title: string;
  ownerName?: string;
  ownerEmail?: string;
  objects: number;
  totals: { items: number; converted: number; approximated: number; placeholder: number; error: number };
  error?: string;
}

/** Reads manifest.json from the migration tool. Throws a readable error for anything else. */
export function parseManifest(text: string): PlanBoard[] {
  let raw: { format?: unknown; boards?: unknown };
  try { raw = JSON.parse(text); } catch { throw new Error("manifest.json isn't valid JSON."); }
  if (raw?.format !== "miroclone-migration" || !Array.isArray(raw.boards)) throw new Error("This folder wasn't written by the migration tool. Choose the output folder that holds manifest.json.");
  return raw.boards.filter((b): b is PlanBoard => !!b && typeof b.folder === "string" && typeof b.miroBoardId === "string" && typeof b.title === "string");
}

/** Encodes bytes as base64 in chunks, so a large image doesn't overflow the call stack. */
export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/**
 * Splits the paths from a folder picker into the manifest and each board's files.
 * Paths start with the folder the person chose, so that first segment is dropped.
 */
export function organise(paths: string[]): { manifest?: string; boards: Map<string, { board?: string; files: string[] }> } {
  const boards = new Map<string, { board?: string; files: string[] }>();
  let manifest: string | undefined;
  for (const p of paths) {
    const parts = p.split("/").slice(1);
    if (parts.length === 1 && parts[0] === "manifest.json") { manifest = p; continue; }
    const [folder, ...rest] = parts;
    if (!folder || !rest.length) continue;
    const entry = boards.get(folder) ?? { files: [] };
    const tail = rest.join("/");
    if (tail === "board.json") entry.board = p;
    else if (rest[0] === "files" && rest.length === 2) entry.files.push(p);
    boards.set(folder, entry);
  }
  return { manifest, boards };
}
