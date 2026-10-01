import type { BoardObject } from "@miroclone/shared";

/**
 * The objects to save when someone saves a selection as a template. A selected frame brings everything inside it
 * (WSH-2), judged by the centre of each object. Connectors come along when both their ends do.
 */
export function contentOfSelection(objs: readonly BoardObject[], selected: readonly string[]): string[] {
  const keep = new Set(selected);
  for (const f of objs) {
    if (f.type !== "frame" || !keep.has(f.id)) continue;
    for (const o of objs) {
      if (o.id === f.id || o.type === "connector") continue;
      const cx = o.x + o.width / 2, cy = o.y + o.height / 2;
      if (cx >= f.x && cx <= f.x + f.width && cy >= f.y && cy <= f.y + f.height) keep.add(o.id);
    }
  }
  for (const o of objs) if (o.type === "connector" && keep.has(o.from) && keep.has(o.to)) keep.add(o.id);
  return [...keep];
}

const LABELS: Record<string, string> = { sticky: "Sticky note", shape: "Shape", text: "Text", stroke: "Drawing", connector: "Connector", frame: "Frame", image: "Image", card: "Card" };

/** Objects a keyboard user can move between, in reading order: top to bottom in rows, then left to right (section 7.3). */
export function focusOrder(objs: readonly BoardObject[]): BoardObject[] {
  const items = objs.filter((o) => o.type !== "connector" && o.type !== "stroke").sort((a, b) => a.y - b.y || a.x - b.x);
  // Objects whose tops are within 30 units of the row's first object count as one row.
  const rows: BoardObject[][] = [];
  for (const o of items) {
    const row = rows.at(-1);
    if (row && o.y - row[0]!.y <= 30) row.push(o); else rows.push([o]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : 1)));
}

/** The next object in the order, wrapping is not done: past the ends it returns undefined, so Tab can leave the canvas. */
export function stepFocus(order: readonly BoardObject[], currentId: string | undefined, backwards: boolean): BoardObject | undefined {
  if (!order.length) return undefined;
  const i = currentId ? order.findIndex((o) => o.id === currentId) : -1;
  if (i === -1) return backwards ? order.at(-1) : order[0];
  return order[i + (backwards ? -1 : 1)];
}

/** What a screen reader announces for an object: its type, its text, and where it sits in the order. */
export function describeObject(o: BoardObject, position: number, total: number): string {
  const text = o.type === "card" ? [o.title, o.assignee && `assigned to ${o.assignee}`, o.due && `due ${o.due}`, o.description].filter(Boolean).join(", ")
    : o.type === "frame" ? o.title
    : "text" in o ? o.text.replace(/\s+/g, " ").trim() : "";
  const label = LABELS[o.type] ?? o.type;
  return `${label}${text ? `: ${text.slice(0, 200)}` : ", empty"}${o.locked ? ", locked" : ""}. ${position} of ${total}.`;
}
