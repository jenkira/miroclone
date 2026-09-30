import { useEffect, useState } from "react";
import type { Board } from "@miroclone/shared";
import { api, type VersionInfo } from "./api.js";
import { applyVersion } from "./versions.js";

const when = (iso: string) => new Date(iso).toLocaleString("en-AU");

/** Saved versions of a board (BRD-6). Editors save named versions and restore any version. */
export function HistoryPanel({ boardId, board, canDelete }: { boardId: string; board: Board; canDelete: boolean }) {
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const load = () => api.versions(boardId).then(setVersions).catch(() => setMessage("The history couldn't be loaded."));
  useEffect(() => { void load(); }, [boardId]);

  const save = async () => {
    setMessage("");
    try { await api.saveVersion(boardId, name.trim()); setName(""); await load(); setMessage("Version saved."); }
    catch { setMessage("The version couldn't be saved."); }
  };

  const restore = async (v: VersionInfo) => {
    const label = v.name ?? when(v.createdAt);
    if (!confirm(`Restore "${label}"? The board changes for everyone. You can undo with Ctrl+Z, and a named version keeps this moment safe first.`)) return;
    setMessage("");
    try {
      // Keep where the board is now, so the restore can be reversed even after a reload.
      await api.saveVersion(boardId, `Before restoring ${label}`.slice(0, 100));
      const { state } = await api.restoreVersion(boardId, v.id);
      const r = applyVersion(board, state);
      setMessage(`Restored. ${r.added} added, ${r.removed} removed, ${r.changed} changed. Press Ctrl+Z to undo.`);
      await load();
    } catch { setMessage("The restore failed."); }
  };

  return (
    <aside aria-label="Version history" style={{ width: 300, borderLeft: "1px solid #ddd", padding: 8, overflow: "auto", background: "#fafafa", font: "14px system-ui" }}>
      <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>Version history</h2>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) void save(); }}>
        <label>Name this version <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Before the workshop" /></label>{" "}
        <button type="submit" disabled={!name.trim()}>Save version</button>
      </form>
      <p role="status">{message}</p>
      <p><small>The app also saves the board automatically after changes.</small></p>
      <ul style={{ padding: 0, listStyle: "none" }}>
        {versions.map((v) => (
          <li key={v.id} style={{ borderBottom: "1px solid #ddd", padding: "6px 0" }}>
            <strong>{v.name ?? "Automatic version"}</strong><br />
            <small>{when(v.createdAt)}{v.createdByName ? ` by ${v.createdByName}` : ""}, {v.objectCount} objects</small><br />
            <button onClick={() => restore(v)}>Restore</button>{" "}
            {canDelete && v.kind === "named" && <button onClick={() => { if (confirm("Delete this version?")) void api.deleteVersion(boardId, v.id).then(load); }}>Delete</button>}
          </li>
        ))}
      </ul>
      {versions.length === 0 && <p>No versions yet.</p>}
    </aside>
  );
}
