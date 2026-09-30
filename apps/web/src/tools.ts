import type { BoardObject } from "@miroclone/shared";
import { hitTest, normaliseRect, strokeFromPoints, type Point } from "./geometry.js";

export const tools = ["select", "sticky", "card", "rectangle", "ellipse", "diamond", "text", "pen", "highlighter", "eraser", "connector", "frame", "comment", "vote"] as const;
export type Tool = (typeof tools)[number];

export type NewObject = Record<string, unknown> & { type: BoardObject["type"] };

/** Minimum drag, in world units, before a drag counts as drawing a shape. */
const MIN_DRAG = 6;

/**
 * Turns a finished gesture into a new object. Returns undefined when the gesture makes nothing,
 * for example a connector that doesn't start and end on objects.
 */
export function objectForGesture(
  tool: Tool,
  path: Point[],
  objects: readonly BoardObject[],
): NewObject | undefined {
  const start = path[0], end = path.at(-1);
  if (!start || !end) return undefined;
  const dragged = Math.hypot(end.x - start.x, end.y - start.y) >= MIN_DRAG;

  switch (tool) {
    case "sticky":
      return { type: "sticky", x: start.x - 80, y: start.y - 80, width: 160, height: 160, text: "" };
    case "card":
      return { type: "card", x: start.x - 120, y: start.y - 80, width: 240, height: 160, title: "New card" };
    case "text":
      return { type: "text", x: start.x, y: start.y, width: 200, height: 40, text: "" };
    case "rectangle":
    case "ellipse":
    case "diamond": {
      const r = dragged ? normaliseRect(start, end) : { x: start.x - 60, y: start.y - 40, width: 120, height: 80 };
      return { type: "shape", kind: tool, ...r };
    }
    case "frame": {
      const r = dragged ? normaliseRect(start, end) : { x: start.x - 200, y: start.y - 150, width: 400, height: 300 };
      return { type: "frame", ...r, title: "Frame" };
    }
    case "pen":
    case "highlighter":
      return path.length < 2 ? undefined : {
        type: "stroke", ...strokeFromPoints(path),
        highlighter: tool === "highlighter",
        color: tool === "highlighter" ? "#ffeb3b" : "#1a1a1a",
      };
    case "connector": {
      const from = hitTest(objects, start), to = hitTest(objects, end);
      if (!from || !to || from.id === to.id) return undefined;
      return { type: "connector", routing: "straight", from: from.id, to: to.id, x: 0, y: 0, width: 1, height: 1 };
    }
    default:
      return undefined;
  }
}
