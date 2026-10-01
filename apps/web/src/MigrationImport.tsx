import { useState } from "react";
import { api, type Marking } from "./api.js";
import { organise, parseManifest, toBase64, type PlanBoard } from "./migrationPlan.js";

interface Row extends PlanBoard { selected: boolean; classification: string; status: string; newId?: string }

/** Imports boards converted by the Miro migration tool. The administrator sets each owner and classification (MIG-5). */
export function MigrationImport({ markings, fallback }: { markings: Marking[]; fallback: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [files, setFiles] = useState<Map<string, File>>(new Map());
  const [layout, setLayout] = useState<ReturnType<typeof organise> | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const choose = async (list: FileList | null) => {
    setMessage(""); setRows([]);
    if (!list?.length) return;
    const byPath = new Map([...list].map((f) => [f.webkitRelativePath, f]));
    const l = organise([...byPath.keys()]);
    try {
      if (!l.manifest) throw new Error("This folder has no manifest.json. Choose the output folder from the migration tool.");
      const boards = parseManifest(await byPath.get(l.manifest)!.text());
      setFiles(byPath); setLayout(l);
      setRows(boards.map((b) => ({ ...b, selected: !b.error && l.boards.has(b.folder), classification: fallback, status: b.error ? `Not exported: ${b.error}` : "" })));
    } catch (e) { setMessage((e as Error).message); }
  };

  const edit = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const run = async () => {
    setBusy(true); setMessage("");
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      if (!r.selected || r.newId) continue;
      edit(i, { status: "Importing…" });
      try {
        const entry = layout!.boards.get(r.folder)!;
        const board = await files.get(entry.board!)!.text();
        // Files are named from the board's folder, as board.json refers to them.
        const prefix = `${entry.board!.slice(0, entry.board!.lastIndexOf("/") + 1)}`;
        const imgs = await Promise.all(entry.files.map(async (p) => ({ name: p.slice(prefix.length), data: toBase64(await files.get(p)!.arrayBuffer()) })));
        const res = await api.importMigrated({ board, classification: r.classification, ownerEmail: r.ownerEmail?.trim() || undefined, sourceId: r.miroBoardId, files: imgs });
        edit(i, {
          newId: res.id, selected: false,
          status: `Imported${res.ownerResolved ? "" : ", owned by you because no person matched the email"}${res.imageProblems.length ? `. ${res.imageProblems.length} images became placeholders` : ""}.`,
        });
      } catch (e) {
        const s = (e as { status?: number }).status;
        edit(i, { status: s === 409 ? "Already imported." : s === 400 ? "The board file or classification isn't valid." : "The import failed." });
      }
    }
    setBusy(false);
  };

  const chosen = rows.filter((r) => r.selected).length;
  return (
    <section aria-label="Miro migration import">
      <h2>Import migrated boards</h2>
      <p>Choose the output folder from the migration tool. The page lists each board, and you set its owner and classification before you import.</p>
      <label>Migration folder{" "}
        <input type="file" {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} multiple onChange={(e) => void choose(e.target.files)} />
      </label>
      <p role="alert">{message}</p>
      {rows.length > 0 && (
        <>
          <table>
            <caption>Table 4. Boards to import</caption>
            <thead><tr><th scope="col">Import</th><th scope="col">Board</th><th scope="col">Owner email</th><th scope="col">Classification</th><th scope="col">Items</th><th scope="col">Result</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.miroBoardId}>
                  <td><input type="checkbox" aria-label={`Import ${r.title}`} checked={r.selected} disabled={!!r.error || !!r.newId} onChange={(e) => edit(i, { selected: e.target.checked })} /></td>
                  <td>{r.newId ? <a href={`#/board/${r.newId}`}>{r.title}</a> : r.title}</td>
                  <td><input type="email" aria-label={`Owner email for ${r.title}`} value={r.ownerEmail ?? ""} placeholder={r.ownerName ?? "No owner in Miro data"} onChange={(e) => edit(i, { ownerEmail: e.target.value })} /></td>
                  <td>
                    <select aria-label={`Classification for ${r.title}`} value={r.classification} onChange={(e) => edit(i, { classification: e.target.value })}>
                      {markings.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </select>
                  </td>
                  <td>{r.totals.items} ({r.totals.placeholder} placeholders, {r.totals.error} errors)</td>
                  <td>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button disabled={busy || chosen === 0} onClick={() => void run()}>Import {chosen} {chosen === 1 ? "board" : "boards"}</button>
        </>
      )}
    </section>
  );
}
