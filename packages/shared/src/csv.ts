/** The most rows one CSV import adds. */
export const MAX_CSV_ROWS = 500;
/** The longest text a sticky note takes from a CSV cell. */
export const MAX_CSV_TEXT = 2000;

/** Parses CSV as RFC 4180 describes it: quoted fields, doubled quotes, and line breaks inside quotes. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, started = false;
  const endField = () => { row.push(field); field = ""; started = false; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"' && !started) { quoted = true; started = true; }
    else if (c === ",") endField();
    else if (c === "\r") { if (text[i + 1] === "\n") i++; endRow(); }
    else if (c === "\n") endRow();
    else { field += c; started = true; }
  }
  if (field !== "" || row.length || started) endRow();
  // A file's last line break doesn't make an empty row.
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

const NAMED: Record<string, string> = {
  yellow: "#fff475", orange: "#ffb74d", green: "#aed581", blue: "#81d4fa", pink: "#f48fb1", purple: "#ce93d8", grey: "#e0e0e0", gray: "#e0e0e0",
};

export interface CsvImport {
  notes: { text: string; color: string }[];
  /** Rows with no text. */
  skipped: number;
  /** Notes whose text was cut to the limit. */
  truncated: number;
}

/**
 * Reads sticky notes from a CSV file (EXP-4). The first column holds the text. A header row is optional: if it names
 * a `text` column, that column is used, and a `colour` or `color` column sets each note's colour by name or hex value.
 * Throws a readable error when the file has too many rows.
 */
export function notesFromCsv(input: string): CsvImport {
  let rows = parseCsv(input);
  let textCol = 0, colourCol = -1;
  const header = rows[0]?.map((h) => h.trim().toLowerCase());
  if (header?.some((h) => ["text", "note", "notes", "sticky", "content"].includes(h))) {
    textCol = Math.max(0, header.findIndex((h) => ["text", "note", "notes", "sticky", "content"].includes(h)));
    colourCol = header.findIndex((h) => h === "colour" || h === "color");
    rows = rows.slice(1);
  }
  if (rows.length > MAX_CSV_ROWS) throw new Error(`The file has ${rows.length} rows. One import adds at most ${MAX_CSV_ROWS}.`);
  const notes: CsvImport["notes"] = [];
  let skipped = 0, truncated = 0;
  for (const r of rows) {
    const text = (r[textCol] ?? "").trim();
    if (!text) { skipped++; continue; }
    const c = (colourCol >= 0 ? r[colourCol] ?? "" : "").trim().toLowerCase();
    const color = /^#[0-9a-f]{6}$/.test(c) ? c : NAMED[c] ?? "#fff475";
    if (text.length > MAX_CSV_TEXT) truncated++;
    notes.push({ text: text.slice(0, MAX_CSV_TEXT), color });
  }
  return { notes, skipped, truncated };
}
