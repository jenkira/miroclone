import { tools, type Tool } from "./tools.js";

const labels: Record<Tool, string> = {
  select: "Select", sticky: "Sticky note", rectangle: "Rectangle", ellipse: "Ellipse", diamond: "Diamond",
  text: "Text", pen: "Pen", highlighter: "Highlighter", eraser: "Eraser", connector: "Connector", frame: "Frame",
};

export function Toolbar({ tool, onChange, disabled }: { tool: Tool; onChange: (t: Tool) => void; disabled: boolean }) {
  return (
    <div role="toolbar" aria-label="Drawing tools" style={{ display: "flex", gap: 4, padding: 4, background: "#fff", borderBottom: "1px solid #ddd" }}>
      {tools.map((t) => (
        <button key={t} aria-pressed={tool === t} disabled={disabled && t !== "select"} onClick={() => onChange(t)}
          style={{ fontWeight: tool === t ? 700 : 400 }}>
          {labels[t]}
        </button>
      ))}
    </div>
  );
}
