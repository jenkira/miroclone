import { useEffect, useReducer } from "react";
import { insertLine, MAX_CELL_TEXT, MAX_TABLE_COLS, MAX_TABLE_ROWS, removeAt, setCell, type Board, type BoardObject } from "@miroclone/shared";

type Table = Extract<BoardObject, { type: "table" }>;

/** Edits the selected table's cells, rows, and columns (CNV-16). Each cell is a text field, so a keyboard and screen reader work. */
export function TableBar({ board, selection, readOnly }: { board: Board; selection: string[]; readOnly: boolean }) {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => { board.objects.observe(refresh); return () => board.objects.unobserve(refresh); }, [board]);
  const t = selection.length === 1 ? board.get(selection[0]!) : undefined;
  if (t?.type !== "table") return null;
  const apply = (patch: Partial<Table>) => board.update(t.id, patch);
  const run = (fn: () => Partial<Table>) => { try { apply(fn()); } catch { /* The buttons are off at the limits. */ } };

  return (
    <div role="group" aria-label="Table cells" style={{ padding: "4px 6px", background: "#f1f8ff", borderBottom: "1px solid #ddd", font: "13px system-ui", maxHeight: 220, overflow: "auto" }}>
      <div style={{ marginBottom: 4 }}>
        <button disabled={readOnly || t.rows >= MAX_TABLE_ROWS} onClick={() => run(() => insertLine(t, "row"))}>Add row</button>{" "}
        <button disabled={readOnly || t.cols >= MAX_TABLE_COLS} onClick={() => run(() => insertLine(t, "col"))}>Add column</button>{" "}
        <button disabled={readOnly || t.rows <= 1} onClick={() => run(() => removeAt(t, "row", t.rows - 1))}>Remove last row</button>{" "}
        <button disabled={readOnly || t.cols <= 1} onClick={() => run(() => removeAt(t, "col", t.cols - 1))}>Remove last column</button>{" "}
        <label><input type="checkbox" checked={t.header} disabled={readOnly} onChange={(e) => apply({ header: e.target.checked })} /> Header row</label>
      </div>
      <table style={{ borderCollapse: "collapse" }}>
        <caption className="sr-only">Cells of the selected table, row by row</caption>
        <tbody>
          {Array.from({ length: t.rows }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: t.cols }, (_, c) => (
                <td key={c} style={{ padding: 0 }}>
                  <input aria-label={`Row ${r + 1}, column ${c + 1}`} value={t.cells[r * t.cols + c] ?? ""} maxLength={MAX_CELL_TEXT} disabled={readOnly}
                    style={{ width: 110, fontWeight: t.header && r === 0 ? 700 : 400 }}
                    onChange={(e) => apply({ cells: setCell(t, r, c, e.target.value) })} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
