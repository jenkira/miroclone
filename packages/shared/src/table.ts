import { MAX_TABLE_COLS, MAX_TABLE_ROWS } from "./objects.js";

/** Default cell size in world units. */
export const CELL_W = 120, CELL_H = 36;

export interface TableShape { rows: number; cols: number; cells: string[]; width: number; height: number }

/** A new empty table. */
export function emptyTable(rows = 3, cols = 3): TableShape {
  return { rows, cols, cells: Array(rows * cols).fill(""), width: cols * CELL_W, height: rows * CELL_H };
}

/**
 * Resizes a table to `rows` by `cols`, keeping the text in the cells that remain and the size of each cell.
 * New cells are empty. Throws when the size is outside the limits.
 */
export function resizeTable(t: TableShape, rows: number, cols: number): TableShape {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1 || rows > MAX_TABLE_ROWS || cols > MAX_TABLE_COLS) {
    throw new Error(`A table has 1 to ${MAX_TABLE_ROWS} rows and 1 to ${MAX_TABLE_COLS} columns.`);
  }
  const cellW = t.width / t.cols, cellH = t.height / t.rows;
  const cells: string[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push(r < t.rows && c < t.cols ? t.cells[r * t.cols + c] ?? "" : "");
  return { rows, cols, cells, width: cellW * cols, height: cellH * rows };
}

/** Sets one cell and returns the new cell list. */
export function setCell(t: Pick<TableShape, "rows" | "cols" | "cells">, row: number, col: number, text: string): string[] {
  if (row < 0 || col < 0 || row >= t.rows || col >= t.cols) throw new Error("That cell isn't in the table.");
  const cells = [...t.cells];
  cells[row * t.cols + col] = text;
  return cells;
}

/** Inserts a row or column before `at`, or at the end when `at` is omitted. Rows and columns are removed with `removeAt`. */
export function insertLine(t: TableShape, axis: "row" | "col", at?: number): TableShape {
  const rows = t.rows + (axis === "row" ? 1 : 0), cols = t.cols + (axis === "col" ? 1 : 0);
  const grown = resizeTable(t, rows, cols);
  const pos = at ?? (axis === "row" ? t.rows : t.cols);
  if (pos >= (axis === "row" ? t.rows : t.cols)) return grown;
  // Shift cells at and after the new line one place along, so the new line is empty.
  const cells = Array<string>(rows * cols).fill("");
  for (let r = 0; r < t.rows; r++) for (let c = 0; c < t.cols; c++) {
    const nr = axis === "row" && r >= pos ? r + 1 : r, nc = axis === "col" && c >= pos ? c + 1 : c;
    cells[nr * cols + nc] = t.cells[r * t.cols + c] ?? "";
  }
  return { ...grown, cells };
}

/** Removes a row or column. A table keeps at least one of each. */
export function removeAt(t: TableShape, axis: "row" | "col", at: number): TableShape {
  const count = axis === "row" ? t.rows : t.cols;
  if (count <= 1) throw new Error("A table needs at least one row and one column.");
  if (at < 0 || at >= count) throw new Error("That row or column isn't in the table.");
  const rows = t.rows - (axis === "row" ? 1 : 0), cols = t.cols - (axis === "col" ? 1 : 0);
  const cells: string[] = [];
  for (let r = 0; r < t.rows; r++) for (let c = 0; c < t.cols; c++) {
    if ((axis === "row" && r === at) || (axis === "col" && c === at)) continue;
    cells.push(t.cells[r * t.cols + c] ?? "");
  }
  return { rows, cols, cells, width: (t.width / t.cols) * cols, height: (t.height / t.rows) * rows };
}
