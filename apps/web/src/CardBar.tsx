import { useEffect, useReducer } from "react";
import { isoDate, type Board, type BoardObject } from "@miroclone/shared";

type Card = Extract<BoardObject, { type: "card" }>;

/** Edits the selected card's title, description, assignee, due date, and tags (CNV-14). */
export function CardBar({ board, selection, readOnly }: { board: Board; selection: string[]; readOnly: boolean }) {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => { board.objects.observe(refresh); return () => board.objects.unobserve(refresh); }, [board]);
  const card = selection.length === 1 ? board.get(selection[0]!) : undefined;
  if (card?.type !== "card") return null;
  const set = (patch: Partial<Card>) => board.update(card.id, patch);
  return (
    <form role="group" aria-label="Card details" onSubmit={(e) => e.preventDefault()}
      style={{ display: "flex", gap: 8, padding: "4px 6px", background: "#f1f8ff", borderBottom: "1px solid #ddd", alignItems: "center", flexWrap: "wrap", font: "13px system-ui" }}>
      <label>Title <input value={card.title} maxLength={200} disabled={readOnly} onChange={(e) => set({ title: e.target.value })} /></label>
      <label>Assignee <input value={card.assignee} maxLength={100} disabled={readOnly} style={{ width: 120 }} onChange={(e) => set({ assignee: e.target.value })} /></label>
      <label>Due <input type="date" value={card.due ?? ""} disabled={readOnly}
        onChange={(e) => set({ due: isoDate.safeParse(e.target.value).success ? e.target.value : undefined })} /></label>
      <label>Tags <input defaultValue={card.tags.join(", ")} key={card.id} disabled={readOnly} placeholder="bug, urgent" style={{ width: 140 }}
        onChange={(e) => set({ tags: e.target.value.split(",").map((t) => t.trim().replace(/^#/, "").slice(0, 30)).filter(Boolean).slice(0, 10) })} /></label>
      <label>Description <textarea value={card.description} rows={1} maxLength={2000} disabled={readOnly} style={{ verticalAlign: "middle" }} onChange={(e) => set({ description: e.target.value })} /></label>
    </form>
  );
}
