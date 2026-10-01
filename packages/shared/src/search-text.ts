import type { BoardObject } from "./objects.js";

/**
 * The text a person would search for on a board: sticky notes, shapes, text objects, cards, and frame titles (BRD-4).
 * Links are included, because people search for them. Everything comes back as plain text.
 */
export function boardText(objs: Iterable<BoardObject>): string {
  const parts: string[] = [];
  for (const o of objs) {
    switch (o.type) {
      case "sticky":
      case "shape":
        if (o.text) parts.push(o.text);
        break;
      case "text":
        if (o.text) parts.push(o.text);
        if (o.link) parts.push(o.link);
        break;
      case "card":
        for (const v of [o.title, o.description, o.assignee, ...o.tags]) if (v) parts.push(v);
        break;
      case "table":
        for (const c of o.cells) if (c) parts.push(c);
        break;
      case "embed":
        for (const v of [o.title, o.name, o.description, o.url]) if (v) parts.push(v);
        break;
      case "frame":
        if (o.title) parts.push(o.title);
        break;
    }
  }
  return parts.join("\n");
}
