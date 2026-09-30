import { useState } from "react";
import { boundsOf, buildPdf, exportJson, exportSvg, frameOrder, rotatedExtent, type Board, type BoardObject } from "@miroclone/shared";

function toDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

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

/** Renders the marked SVG to a JPEG for a PDF page. JPEG has no transparency, so the page starts white. */
async function svgToJpeg(svg: string, width: number, height: number): Promise<{ jpeg: Uint8Array; width: number; height: number }> {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    await new Promise<void>((ok, fail) => { img.onload = () => ok(); img.onerror = () => fail(new Error("The board couldn't be drawn.")); img.src = url; });
  } finally { URL.revokeObjectURL(url); }
  const scale = Math.min(2, 4096 / Math.max(width, height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(width * scale)); c.height = Math.max(1, Math.round(height * scale));
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.9));
  if (!blob) throw new Error("JPEG encoding failed");
  const jpeg = new Uint8Array(await blob.arrayBuffer());
  // The page keeps the on-screen size, and the image gives it the extra detail.
  return { jpeg, width: Math.round(width), height: Math.round(height) };
}

/** An object belongs to a frame's page when its box overlaps the frame. */
const inFrame = (f: { x: number; y: number; width: number; height: number }, o: BoardObject) => {
  const b = rotatedExtent(o);
  return b.x < f.x + f.width && b.x + b.width > f.x && b.y < f.y + f.height && b.y + b.height > f.y;
};

type Format = "png" | "svg" | "json" | "pdf";

/** Exports the board, or the current selection, in the browser. `authorise` checks policy and records the audit event first. */
export function ExportMenu({ board, title, classification, selection, authorise, loadImage }: {
  board: Board; title: string; classification: string; selection: () => string[];
  /** Returns an image file's bytes, so the export can embed it. */
  loadImage?: (fileId: string) => Promise<Blob>;
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
      const images: Record<string, string> = {};
      if (loadImage) {
        await Promise.all(objs.filter((o) => o.type === "image").map(async (o) => {
          try { images[(o as { objectKey: string }).objectKey] = await toDataUri(await loadImage((o as { objectKey: string }).objectKey)); } catch { /* A placeholder shows instead. */ }
        }));
      }
      if (format === "pdf") {
        // One page per frame, in presentation order. A board without frames, or a selection, is one page.
        const frames = ids.length ? [] : frameOrder(all);
        const areas = frames.length ? frames.map((f) => ({ bounds: { x: f.x, y: f.y, width: f.width, height: f.height }, objs: all.filter((o) => o.type === "frame" ? o.id === f.id : o.type === "connector" ? false : inFrame(f, o)), label: f.title }))
          : [{ bounds: boundsOf(objs), objs, label: title }];
        const pages = [];
        for (const a of areas) {
          // Connectors go on a page when both ends are there.
          const here = new Set(a.objs.map((o) => o.id));
          const withLinks = [...a.objs, ...all.filter((o) => o.type === "connector" && here.has(o.from) && here.has(o.to))];
          pages.push(await svgToJpeg(exportSvg(withLinks, { classification, title: a.label || title, images, bounds: a.bounds }), a.bounds.width, a.bounds.height + 56));
        }
        return download(`${base}.pdf`, new Blob([buildPdf(pages, { title, classification }) as BlobPart], { type: "application/pdf" }));
      }
      const svg = exportSvg(objs, { classification, title, images });
      if (format === "svg") return download(`${base}.svg`, new Blob([svg], { type: "image/svg+xml" }));
      const b = boundsOf(objs);
      download(`${base}.png`, await svgToPng(svg, b.width, b.height + 56));
    } catch (e) {
      setMessage((e as { status?: number }).status === 403 ? "Export isn't allowed for this classification." : "The export failed.");
    }
  };
  return (
    <span role="group" aria-label="Export">
      Export: {(["png", "svg", "pdf", "json"] as const).map((f) => <button key={f} onClick={() => run(f)}>{f.toUpperCase()}</button>)}
      <span role="alert">{message}</span>
    </span>
  );
}
