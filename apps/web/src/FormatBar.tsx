import { useEffect, useReducer } from "react";
import { isSafeLink, type Board, type BoardObject } from "@miroclone/shared";
import { fitTextHeight, type CanvasApi } from "./Canvas.js";

type TextObject = Extract<BoardObject, { type: "text" }>;

/** Formatting for selected text objects (CNV-4), and zoom controls (CNV-1). */
export function FormatBar({ board, selection, readOnly, api }: { board: Board; selection: string[]; readOnly: boolean; api: { current: CanvasApi | null } }) {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => { board.objects.observe(refresh); return () => board.objects.unobserve(refresh); }, [board]);

  const texts = selection.map((id) => board.get(id)).filter((o): o is TextObject => o?.type === "text");
  const first = texts[0];
  const set = (patch: Partial<TextObject>) => texts.forEach((t) => { board.update(t.id, patch); fitTextHeight(board, t.id); });

  const toggle = (key: "bold" | "italic" | "underline", label: string, style: React.CSSProperties) => (
    <button aria-pressed={!!first?.[key]} aria-label={label} title={label} style={style} disabled={readOnly} onClick={() => set({ [key]: !first![key] })}>{label[0]}</button>
  );

  return (
    <div role="toolbar" aria-label="Format and view" style={{ display: "flex", gap: 6, padding: "2px 4px", background: "#fafafa", borderBottom: "1px solid #ddd", alignItems: "center", minHeight: 28 }}>
      <button onClick={() => api.current?.fit()}>Zoom to fit</button>
      <button onClick={() => api.current?.fitSelection()} disabled={selection.length === 0}>Zoom to selection</button>
      {first && (
        <>
          <span aria-hidden>|</span>
          {toggle("bold", "Bold", { fontWeight: 700 })}
          {toggle("italic", "Italic", { fontStyle: "italic" })}
          {toggle("underline", "Underline", { textDecoration: "underline" })}
          <label>Size <input type="number" min={8} max={200} value={first.size} disabled={readOnly} style={{ width: 54 }} onChange={(e) => set({ size: Math.min(200, Math.max(8, Number(e.target.value) || 18)) })} /></label>
          <label>Colour <input type="color" value={/^#[0-9a-f]{6}$/i.test(first.color) ? first.color : "#1a1a1a"} disabled={readOnly} onChange={(e) => set({ color: e.target.value })} /></label>
          <label>Align <select value={first.align} disabled={readOnly} onChange={(e) => set({ align: e.target.value as TextObject["align"] })}><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select></label>
          <label>List <select value={first.list} disabled={readOnly} onChange={(e) => set({ list: e.target.value as TextObject["list"] })}><option value="none">None</option><option value="bullet">Bullets</option><option value="number">Numbers</option></select></label>
          <label>Link <input type="url" placeholder="https://" value={first.link ?? ""} disabled={readOnly} style={{ width: 160 }}
            onChange={(e) => { const v = e.target.value.trim(); set({ link: v && isSafeLink(v) ? v : undefined }); }} /></label>
        </>
      )}
    </div>
  );
}
