import { useEffect, useReducer, useState } from "react";
import type { Board, BoardObject } from "@miroclone/shared";
import { api } from "./api.js";

type Embed = Extract<BoardObject, { type: "embed" }>;

/** Opens the selected link, or previews the selected PDF in a window on the page (CNV-17). */
export function EmbedBar({ board, boardId, selection }: { board: Board; boardId: string; selection: string[] }) {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => { board.objects.observe(refresh); return () => board.objects.unobserve(refresh); }, [board]);
  // Free the preview's memory when it closes.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const o = selection.length === 1 ? board.get(selection[0]!) : undefined;
  if (o?.type !== "embed") return null;
  const e: Embed = o;

  /** The file comes from this site with the session cookie, then the browser shows it from a local address, typed as a PDF. */
  const load = async () => (await api.fetchFile(boardId, e.fileId!)).slice(0, undefined, "application/pdf");

  return (
    <>
      <div role="group" aria-label="Link or PDF" style={{ display: "flex", gap: 8, padding: "4px 6px", background: "#f1f8ff", borderBottom: "1px solid #ddd", alignItems: "center", font: "13px system-ui" }}>
        {e.kind === "link" && e.url && <a href={e.url} target="_blank" rel="noopener noreferrer">Open {new URL(e.url).host}</a>}
        {e.kind === "pdf" && (
          <>
            <button onClick={async () => { setMessage(""); try { setPreview({ url: URL.createObjectURL(await load()), name: e.name || "PDF file" }); } catch { setMessage("The PDF couldn't be loaded."); } }}>Preview PDF</button>
            <button onClick={async () => {
              setMessage("");
              try { const url = URL.createObjectURL(await load()); const a = Object.assign(document.createElement("a"), { href: url, download: e.name || "file.pdf" }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
              catch { setMessage("The PDF couldn't be loaded."); }
            }}>Download</button>
          </>
        )}
        <span role="alert">{message}</span>
      </div>
      {preview && (
        <div role="dialog" aria-modal="true" aria-label={`Preview of ${preview.name}`} style={{ position: "fixed", inset: 0, background: "#0008", display: "grid", placeItems: "center", zIndex: 20 }}>
          <div style={{ background: "#fff", width: "min(900px, 92vw)", height: "88vh", display: "flex", flexDirection: "column", padding: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", font: "14px system-ui" }}><strong>{preview.name}</strong><button autoFocus onClick={() => setPreview(null)}>Close preview</button></div>
            <iframe title={preview.name} src={preview.url} style={{ flex: 1, border: 0 }} />
          </div>
        </div>
      )}
    </>
  );
}
