import { tools, type Tool } from "./tools.js";

const labels: Record<Tool, string> = {
  select: "Select", sticky: "Sticky note", rectangle: "Rectangle", ellipse: "Ellipse", diamond: "Diamond",
  text: "Text", pen: "Pen", highlighter: "Highlighter", eraser: "Eraser", connector: "Connector", frame: "Frame", comment: "Comment",
};

/** `disabled` turns off the drawing tools. Selecting always works, and commenting works when `canComment` is set. */
export function Toolbar({ tool, onChange, disabled, canComment = false }: { tool: Tool; onChange: (t: Tool) => void; disabled: boolean; canComment?: boolean }) {
  return (
    <div role="toolbar" aria-label="Drawing tools" style={{ display: "flex", gap: 4, padding: 4, background: "#fff", borderBottom: "1px solid #ddd" }}>
      {tools.map((t) => (
        <button key={t} aria-pressed={tool === t} disabled={disabled && t !== "select" && !(t === "comment" && canComment)} onClick={() => onChange(t)}
          style={{ fontWeight: tool === t ? 700 : 400 }}>
          {labels[t]}
        </button>
      ))}
    </div>
  );
}
