import { tools, type Tool } from "./tools.js";

const labels: Record<Tool, string> = {
  select: "Select", sticky: "Sticky note", card: "Card", table: "Table", mindmap: "Mind map", rectangle: "Rectangle", ellipse: "Ellipse", diamond: "Diamond",
  text: "Text", pen: "Pen", highlighter: "Highlighter", eraser: "Eraser", connector: "Connector", frame: "Frame", comment: "Comment", vote: "Vote",
};

/** `disabled` turns off the drawing tools. Selecting always works. Commenting needs `canComment`, and voting needs `canVote`. */
export function Toolbar({ tool, onChange, disabled, canComment = false, canVote = false }: { tool: Tool; onChange: (t: Tool) => void; disabled: boolean; canComment?: boolean; canVote?: boolean }) {
  /** Commenting and voting follow their own permissions. Every other tool except Select needs edit rights. */
  const isDisabled = (t: Tool) => (t === "vote" ? !canVote : t === "comment" ? !canComment : t === "select" ? false : disabled);
  return (
    <div role="toolbar" aria-label="Drawing tools" style={{ display: "flex", gap: 4, padding: 4, background: "#fff", borderBottom: "1px solid #ddd" }}>
      {tools.map((t) => (
        <button key={t} aria-pressed={tool === t} disabled={isDisabled(t)} onClick={() => onChange(t)}
          style={{ fontWeight: tool === t ? 700 : 400 }}>
          {labels[t]}
        </button>
      ))}
    </div>
  );
}
