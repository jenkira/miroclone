import { Container, Graphics, Text } from "pixi.js";
import type * as Y from "yjs";
import { boardObjectSchema, type Board, type BoardObject } from "@miroclone/shared";

const plain = (html: string) => html.replace(/<[^>]*>/g, "");
const hex = (c: string) => Number.parseInt(c.replace("#", ""), 16);

export interface Drawn { node: Container; text?: Text }

/** Draws one board object into a display container. */
export function drawObject(o: BoardObject, board: Board): Drawn {
  const c = new Container();
  let textNode: Text | undefined;
  c.position.set(o.x, o.y);
  c.rotation = (o.rotation * Math.PI) / 180;
  const g = new Graphics();
  c.addChild(g);

  const label = (text: string, w: number, size = 16) => {
    if (!text) return;
    const t = new Text({ text, style: { fontSize: size, wordWrap: true, wordWrapWidth: w - 16, fill: 0x1a1a1a } });
    t.position.set(8, 8);
    c.addChild(t);
    textNode = t;
  };

  switch (o.type) {
    case "sticky":
      g.rect(0, 0, o.width, o.height).fill(hex(o.color)).stroke({ width: 1, color: 0xbdbdbd });
      label(o.text, o.width);
      break;
    case "shape": {
      const { width: w, height: h } = o;
      if (o.kind === "rectangle") g.rect(0, 0, w, h);
      else if (o.kind === "rounded") g.roundRect(0, 0, w, h, 12);
      else if (o.kind === "ellipse") g.ellipse(w / 2, h / 2, w / 2, h / 2);
      else if (o.kind === "triangle") g.poly([w / 2, 0, w, h, 0, h]);
      else g.poly([w / 2, 0, w, h / 2, w / 2, h, 0, h / 2]);
      g.fill(hex(o.fill)).stroke({ width: 2, color: hex(o.stroke) });
      label(o.text, w);
      break;
    }
    case "text":
      label(plain(o.html), o.width);
      break;
    case "stroke": {
      const pts = o.points;
      if (pts.length >= 4) {
        g.moveTo(pts[0]!, pts[1]!);
        for (let i = 2; i + 1 < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]!);
        g.stroke({ width: o.highlighter ? 14 : 3, color: hex(o.color), alpha: o.highlighter ? 0.4 : 1, cap: "round", join: "round" });
      }
      break;
    }
    case "frame": {
      g.rect(0, 0, o.width, o.height).fill({ color: 0xffffff, alpha: 0.4 }).stroke({ width: 2, color: 0x607d8b });
      const t = new Text({ text: o.title, style: { fontSize: 14, fill: 0x455a64 } });
      t.position.set(0, -20);
      c.addChild(t);
      break;
    }
    case "image":
      // Image loading arrives with the upload pipeline. A placeholder keeps layout correct.
      g.rect(0, 0, o.width, o.height).fill(0xeeeeee).stroke({ width: 1, color: 0x9e9e9e });
      break;
    case "connector": {
      const ends = board.connectorEnds(o.id);
      c.position.set(0, 0);
      c.rotation = 0;
      if (ends) g.moveTo(ends.from.x, ends.from.y).lineTo(ends.to.x, ends.to.y).stroke({ width: 2, color: 0x1a1a1a });
      break;
    }
  }
  return { node: c, text: textNode };
}

/** Fills schema defaults, so a half-formed preview object draws like a real one. */
export function withDefaults(o: Record<string, unknown>): BoardObject | undefined {
  const r = boardObjectSchema.safeParse({ id: "preview", index: "z", x: 0, y: 0, width: 1, height: 1, ...o });
  return r.success ? r.data : undefined;
}

/** Below this zoom, text is too small to read, so the scene hides it to save draw time. */
export const TEXT_MIN_ZOOM = 0.25;

interface Node extends Drawn { box: { x: number; y: number; width: number; height: number }; connector: boolean }

/**
 * Keeps display objects in step with the board. A change redraws only the objects it touched,
 * and culling hides objects outside the viewport (PRF-1).
 */
export class Scene {
  private nodes = new Map<string, Node>();
  constructor(private layer: Container, private board: Board) {}

  private put(o: BoardObject) {
    this.nodes.get(o.id)?.node.destroy({ children: true });
    const d = drawObject(o, this.board);
    this.nodes.set(o.id, { ...d, box: { x: o.x, y: o.y, width: o.width, height: o.height }, connector: o.type === "connector" });
    this.layer.addChild(d.node);
  }

  /** Builds every node. Use it for the first draw. */
  rebuild() {
    for (const n of this.nodes.values()) n.node.destroy({ children: true });
    this.nodes.clear();
    for (const o of this.board.list()) this.put(o);
  }

  /** Applies one Yjs change event. */
  apply(event: Y.YMapEvent<BoardObject>) {
    let reorder = false;
    for (const [id, change] of event.changes.keys) {
      if (change.action === "delete") {
        this.nodes.get(id)?.node.destroy({ children: true });
        this.nodes.delete(id);
        continue;
      }
      const o = this.board.get(id);
      if (!o) continue;
      const prev = change.oldValue as BoardObject | undefined;
      if (change.action === "add" || prev?.index !== o.index) reorder = true;
      this.put(o);
    }
    // A connector follows its objects, so redraw all of them after any change.
    for (const [id, n] of this.nodes) if (n.connector) { const o = this.board.get(id); if (o) this.put(o); }
    if (reorder) this.layer.removeChildren(), this.board.list().forEach((o) => { const n = this.nodes.get(o.id); if (n) this.layer.addChild(n.node); });
  }

  /** Shows only objects that touch the viewport, and hides text at low zoom. `view` is the visible world rectangle. */
  cull(view: { x: number; y: number; width: number; height: number }, zoom: number) {
    for (const n of this.nodes.values()) {
      const b = n.box;
      n.node.visible = n.connector || (b.x <= view.x + view.width && b.x + b.width >= view.x && b.y <= view.y + view.height && b.y + b.height >= view.y);
      if (n.text) n.text.visible = zoom >= TEXT_MIN_ZOOM;
    }
  }

  get size() { return this.nodes.size; }
}

export function drawSelection(o: BoardObject): Graphics {
  return new Graphics().rect(o.x - 3, o.y - 3, o.width + 6, o.height + 6).stroke({ width: 2, color: 0x1976d2 });
}

export function drawCursor(x: number, y: number, colour: string, name: string): Container {
  const c = new Container();
  c.position.set(x, y);
  c.addChild(new Graphics().poly([0, 0, 0, 16, 5, 12, 10, 18, 13, 16, 8, 10, 14, 9]).fill(hex(colour)));
  const t = new Text({ text: name, style: { fontSize: 12, fill: 0xffffff, fontWeight: "600" } });
  const tag = new Graphics().roundRect(14, 14, t.width + 8, t.height + 4, 4).fill(hex(colour));
  t.position.set(18, 16);
  c.addChild(tag, t);
  return c;
}
