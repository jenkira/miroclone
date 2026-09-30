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
