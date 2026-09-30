import { useState } from "react";
import { boundsOf, exportJson, exportSvg, type Board } from "@miroclone/shared";

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Renders the marked SVG onto a canvas, so the PNG carries the same header and footer (PMK-4). */
export function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = Math.min(width * scale, 16384);
      c.height = Math.min(height * scale, 16384);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("The board couldn't be drawn.")); };
    img.src = url;
  });
}

type Format = "png" | "svg" | "json";

/** Exports the board, or the current selection, in the browser. `authorise` checks policy and records the audit event first. */
export function ExportMenu({ board, title, classification, selection, authorise }: {
  board: Board; title: string; classification: string; selection: () => string[];
  authorise: (format: Format, scope: string) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const run = async (format: Format) => {
    setMessage("");
    const ids = selection();
    const scope = ids.length ? "selection" : "board";
    try {
      await authorise(format, scope);
      const all = board.list();
      const objs = ids.length ? all.filter((o) => ids.includes(o.id) || (o.type === "connector" && ids.includes(o.from) && ids.includes(o.to))) : all;
      const base = title.replace(/[^\w.-]+/g, "_") || "board";
      if (format === "json") return download(`${base}.json`, new Blob([exportJson(all, { title, classification })], { type: "application/json" }));
      const svg = exportSvg(objs, { classification, title });
      if (format === "svg") return download(`${base}.svg`, new Blob([svg], { type: "image/svg+xml" }));
      const b = boundsOf(objs);
      download(`${base}.png`, await svgToPng(svg, b.width, b.height + 56));
    } catch (e) {
      setMessage((e as { status?: number }).status === 403 ? "Export isn't allowed for this classification." : "The export failed.");
    }
  };
  return (
    <span role="group" aria-label="Export">
      Export: {(["png", "svg", "json"] as const).map((f) => <button key={f} onClick={() => run(f)}>{f.toUpperCase()}</button>)}
      <span role="alert">{message}</span>
    </span>
  );
}
