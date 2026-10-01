import { CanvasTextMetrics, Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import type * as Y from "yjs";
import { boardObjectSchema, formatDue, isOverdue, isSafeLink, listLines, type Board, type BoardObject } from "@miroclone/shared";
import { handlePositions } from "./geometry.js";
import { imageLoader } from "./images.js";

const hex = (c: string) => Number.parseInt(c.replace("#", ""), 16);

/** Picks the largest font size, from 28 down to 10, at which the text fits the box (CNV-2). */
export function fitFontSize(text: string, width: number, height: number): number {
  for (let size = 28; size > 10; size -= 2) {
    const style = new TextStyle({ fontSize: size, wordWrap: true, wordWrapWidth: width });
    if (CanvasTextMetrics.measureText(text, style).height <= height) return size;
  }
  return 10;
}

/** Height a text object needs for its content, so it never overflows its box. */
export function textHeight(o: Extract<BoardObject, { type: "text" }>): number {
  const style = new TextStyle({ fontSize: o.size, fontWeight: o.bold ? "700" : "400", fontStyle: o.italic ? "italic" : "normal", wordWrap: true, wordWrapWidth: o.width - 16 });
  const content = listLines(o.text, o.list).join("\n") || " ";
  return Math.ceil(CanvasTextMetrics.measureText(content, style).height) + 16;
}

function drawFormattedText(c: Container, o: Extract<BoardObject, { type: "text" }>): Text | undefined {
  const linked = !!o.link && isSafeLink(o.link);
  const content = listLines(o.text, o.list).join("\n");
  if (!content) return undefined;
  const style = new TextStyle({
    fontSize: o.size, fontWeight: o.bold ? "700" : "400", fontStyle: o.italic ? "italic" : "normal",
    fill: linked ? 0x1565c0 : hex(o.color), align: o.align, wordWrap: true, wordWrapWidth: o.width - 16,
  });
  const t = new Text({ text: content, style });
  const x = o.align === "center" ? (o.width - t.width) / 2 : o.align === "right" ? o.width - t.width - 8 : 8;
  t.position.set(x, 8);
  c.addChild(t);
  if (o.underline || linked) {
    const m = CanvasTextMetrics.measureText(content, style);
    const g = new Graphics();
    m.lines.forEach((line, i) => {
      const w = m.lineWidths[i] ?? 0;
      const lx = o.align === "center" ? (o.width - w) / 2 : o.align === "right" ? o.width - w - 8 : 8;
      const y = 8 + (i + 1) * m.lineHeight - 2;
      if (line) g.moveTo(lx, y).lineTo(lx + w, y);
    });
    g.stroke({ width: 1, color: linked ? 0x1565c0 : hex(o.color) });
    c.addChild(g);
  }
  return t;
}

/** Today's date as 2026-09-30, in the viewer's time zone. */
const todayIso = () => new Date().toLocaleDateString("en-CA");

/** Draws a card: title, assignee and due date, tags, then description. Lines that don't fit are left out (CNV-14). */
function drawCard(c: Container, g: Graphics, o: Extract<BoardObject, { type: "card" }>) {
  g.roundRect(0, 0, o.width, o.height, 6).fill(hex(o.color)).stroke({ width: 1, color: 0x9e9e9e });
  let y = 8;
  const add = (text: string, size: number, fill: number, bold = false) => {
    if (!text || y >= o.height - 8) return;
    const t = new Text({ text, style: { fontSize: size, fontWeight: bold ? "700" : "400", fill, wordWrap: true, wordWrapWidth: o.width - 24 } });
    if (y + t.height > o.height - 4) { t.destroy(); y = o.height; return; }
    t.position.set(12, y);
    c.addChild(t);
    y += t.height + 4;
  };
  add(o.title || "Untitled card", 16, 0x1a1a1a, true);
  add(o.assignee ? `Assigned to ${o.assignee}` : "", 12, 0x455a64);
  if (o.due) add(`${isOverdue(o.due, todayIso()) ? "Overdue: " : "Due "}${formatDue(o.due)}`, 12, isOverdue(o.due, todayIso()) ? 0xc62828 : 0x455a64, isOverdue(o.due, todayIso()));
  add(o.tags.map((t) => `#${t}`).join(" "), 12, 0x1565c0);
  add(o.description, 13, 0x1a1a1a);
}

/** Draws a link or PDF card with its title, source, and description (CNV-17). */
function drawEmbed(c: Container, g: Graphics, o: Extract<BoardObject, { type: "embed" }>) {
  g.roundRect(0, 0, o.width, o.height, 6).fill(0xffffff).stroke({ width: 1, color: 0x9e9e9e });
  g.rect(0, 0, 6, o.height).fill(o.kind === "pdf" ? 0xc62828 : 0x1565c0);
  const host = (() => { try { return o.url ? new URL(o.url).host : ""; } catch { return ""; } })();
  let y = 8;
  const add = (text: string, size: number, fill: number, bold = false) => {
    if (!text || y >= o.height - 8) return;
    const t = new Text({ text, style: { fontSize: size, fontWeight: bold ? "700" : "400", fill, wordWrap: true, wordWrapWidth: o.width - 28, breakWords: true } });
    if (y + t.height > o.height - 4) { t.destroy(); y = o.height; return; }
    t.position.set(16, y);
    c.addChild(t);
    y += t.height + 4;
  };
  add(o.title || o.name || host || (o.kind === "pdf" ? "PDF file" : "Link"), 15, 0x1a1a1a, true);
  add(o.kind === "pdf" ? `PDF${o.pages ? `, ${o.pages} page${o.pages === 1 ? "" : "s"}` : ""}` : host, 12, 0x1565c0);
  add(o.description, 12, 0x455a64);
}

/** Draws a table: a grid, a shaded header row, and the text of each cell, cut to fit (CNV-16). */
function drawTable(c: Container, g: Graphics, o: Extract<BoardObject, { type: "table" }>) {
  const cw = o.width / o.cols, ch = o.height / o.rows;
  g.rect(0, 0, o.width, o.height).fill(0xffffff);
  if (o.header) g.rect(0, 0, o.width, ch).fill(0xeceff1);
  for (let i = 1; i < o.cols; i++) g.moveTo(i * cw, 0).lineTo(i * cw, o.height);
  for (let i = 1; i < o.rows; i++) g.moveTo(0, i * ch).lineTo(o.width, i * ch);
  g.rect(0, 0, o.width, o.height);
  g.stroke({ width: 1, color: 0x757575 });
  for (let r = 0; r < o.rows; r++) for (let col = 0; col < o.cols; col++) {
    const text = o.cells[r * o.cols + col];
    if (!text) continue;
    const t = new Text({ text, style: { fontSize: 13, fontWeight: o.header && r === 0 ? "700" : "400", fill: 0x1a1a1a, wordWrap: true, wordWrapWidth: cw - 12, breakWords: true } });
    // Cells keep to their own box, so a long entry can't spill into the next cell.
    const mask = new Graphics().rect(col * cw + 1, r * ch + 1, cw - 2, ch - 2).fill(0xffffff);
    t.position.set(col * cw + 6, r * ch + 6);
    t.mask = mask;
    c.addChild(mask, t);
  }
}

export interface Drawn { node: Container; text?: Text }

/** Draws one board object into a display container. */
export function drawObject(o: BoardObject, board: Board): Drawn {
  const c = new Container();
  let textNode: Text | undefined;
  // Rotate about the centre, so the object turns in place (CNV-9).
  c.pivot.set(o.width / 2, o.height / 2);
  c.position.set(o.x + o.width / 2, o.y + o.height / 2);
  c.rotation = (o.rotation * Math.PI) / 180;
  const g = new Graphics();
  c.addChild(g);

  const label = (text: string, w: number, h: number, autoSize = false) => {
    if (!text) return;
    let size = 16;
    if (autoSize) size = fitFontSize(text, w - 16, h - 16);
    const t = new Text({ text, style: { fontSize: size, wordWrap: true, wordWrapWidth: w - 16, fill: 0x1a1a1a } });
    t.position.set(8, 8);
    c.addChild(t);
    textNode = t;
  };

  switch (o.type) {
    case "sticky":
      g.rect(0, 0, o.width, o.height).fill(hex(o.color)).stroke({ width: 1, color: 0xbdbdbd });
      label(o.text, o.width, o.height, true);
      break;
    case "card":
      drawCard(c, g, o);
      break;
    case "table":
      drawTable(c, g, o);
      break;
    case "embed":
      drawEmbed(c, g, o);
      break;
    case "shape": {
      const { width: w, height: h } = o;
      if (o.kind === "rectangle") g.rect(0, 0, w, h);
      else if (o.kind === "rounded") g.roundRect(0, 0, w, h, 12);
      else if (o.kind === "ellipse") g.ellipse(w / 2, h / 2, w / 2, h / 2);
      else if (o.kind === "triangle") g.poly([w / 2, 0, w, h, 0, h]);
      else g.poly([w / 2, 0, w, h / 2, w / 2, h, 0, h / 2]);
      g.fill(hex(o.fill)).stroke({ width: 2, color: hex(o.stroke) });
      label(o.text, w, h);
      break;
    }
    case "text":
      textNode = drawFormattedText(c, o);
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
      // A placeholder holds the space until the image arrives, and stays if it can't load.
      g.rect(0, 0, o.width, o.height).fill(0xeeeeee).stroke({ width: 1, color: 0x9e9e9e });
      imageLoader()?.(o.objectKey).then((tex) => {
        if (c.destroyed) return;
        const sprite = new Sprite(tex);
        sprite.width = o.width;
        sprite.height = o.height;
        g.clear();
        c.addChild(sprite);
      }).catch(() => { /* The placeholder stays. */ });
      break;
    case "connector": {
      const ends = board.connectorEnds(o.id);
      c.pivot.set(0, 0);
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
    // A rotated object can reach past its unrotated box, so cull by the circle around it.
    const r = o.rotation ? Math.hypot(o.width, o.height) / 2 : 0;
    const box = r
      ? { x: o.x + o.width / 2 - r, y: o.y + o.height / 2 - r, width: r * 2, height: r * 2 }
      : { x: o.x, y: o.y, width: o.width, height: o.height };
    this.nodes.set(o.id, { ...d, box, connector: o.type === "connector" });
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
      // Private mode hides other people's objects from this view (WSH-7).
      if (!this.board.visible(o)) { this.nodes.get(id)?.node.destroy({ children: true }); this.nodes.delete(id); continue; }
      const prev = change.oldValue as BoardObject | undefined;
      if (change.action === "add" || prev?.index !== o.index) reorder = true;
      this.put(o);
    }
    // A connector follows its objects, so redraw all of them after any change.
    for (const [id, n] of this.nodes) if (n.connector) { const o = this.board.get(id); if (o && this.board.visible(o)) this.put(o); }
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

/** Draws the selection outline. A single resizable object also gets corner and rotation handles (CNV-9). */
export function drawSelection(o: BoardObject, opts: { handles?: boolean; zoom?: number } = {}): Graphics {
  const zoom = opts.zoom ?? 1;
  const g = new Graphics();
  const hp = handlePositions(o, zoom);
  g.poly([hp.nw.x, hp.nw.y, hp.ne.x, hp.ne.y, hp.se.x, hp.se.y, hp.sw.x, hp.sw.y]).stroke({ width: 2 / zoom, color: 0x1976d2 });
  if (opts.handles) {
    const k = 4 / zoom;
    const top = { x: (hp.nw.x + hp.ne.x) / 2, y: (hp.nw.y + hp.ne.y) / 2 };
    g.moveTo(top.x, top.y).lineTo(hp.rotate.x, hp.rotate.y).stroke({ width: 1 / zoom, color: 0x1976d2 });
    for (const h of ["nw", "ne", "se", "sw"] as const) g.rect(hp[h].x - k, hp[h].y - k, k * 2, k * 2).fill(0xffffff).stroke({ width: 1.5 / zoom, color: 0x1976d2 });
    g.circle(hp.rotate.x, hp.rotate.y, k * 1.2).fill(0xffffff).stroke({ width: 1.5 / zoom, color: 0x1976d2 });
  }
  return g;
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
