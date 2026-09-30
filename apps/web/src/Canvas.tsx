import { useEffect, useRef, useState } from "react";
import { Application, Container, Graphics } from "pixi.js";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { Board, type BoardObject } from "@miroclone/shared";
import { hitTest, intersects, normaliseRect, strokesHit, type Point } from "./geometry.js";
import { drawCursor, drawObject, drawSelection, Scene, withDefaults } from "./render.js";
import { objectForGesture, type Tool } from "./tools.js";
import { screenToWorld, zoomAt, type Viewport } from "./viewport.js";

export interface CanvasProps {
  board: Board;
  tool: Tool;
  readOnly: boolean;
  awareness?: Awareness;
  onToolDone?: () => void;
  /** Receives a function that returns the selected object ids. */
  selectionRef?: { current: () => string[] };
}

/** Clipboard shared by every board in this tab, so paste works between boards (CNV-11). It clears on reload and sign-out (COL-10). */
let clipboard: BoardObject[] = [];
export const clearClipboard = () => { clipboard = []; };

const CURSOR_COLOURS = ["#e53935", "#8e24aa", "#3949ab", "#00897b", "#f4511e", "#6d4c41"];
export const colourFor = (id: number) => CURSOR_COLOURS[id % CURSOR_COLOURS.length]!;

export function Canvas({ board, tool, readOnly, awareness, onToolDone, selectionRef }: CanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const toolRef = useRef(tool);
  const roRef = useRef(readOnly);
  const selection = useRef<string[]>([]);
  const view = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });
  const redrawRef = useRef<() => void>(() => {});
  const [editing, setEditing] = useState<{ id: string; left: number; top: number; width: number; height: number; text: string } | null>(null);
  if (selectionRef) selectionRef.current = () => selection.current;
  toolRef.current = tool;
  roRef.current = readOnly;

  useEffect(() => {
    const el = host.current!;
    const app = new Application();
    const world = new Container();
    const objectsLayer = new Container();
    const overlay = new Container();
    const cursors = new Container();
    const preview = new Container();
    const scene = new Scene(objectsLayer, board);
    let disposed = false;
    let ready = false;

    const cull = () => {
      const v = view.current;
      scene.cull({ x: -v.x / v.zoom, y: -v.y / v.zoom, width: el.clientWidth / v.zoom, height: el.clientHeight / v.zoom }, v.zoom);
    };
    const apply = () => { world.position.set(view.current.x, view.current.y); world.scale.set(view.current.zoom); cull(); };

    const drawSelections = () => {
      overlay.removeChildren().forEach((c) => c.destroy({ children: true }));
      for (const id of selection.current) { const o = board.get(id); if (o) overlay.addChild(drawSelection(o)); }
    };
    /** Redraws the selection outlines. Object changes arrive through the scene. */
    const redraw = () => { if (ready) drawSelections(); };
    redrawRef.current = redraw;
    const onObjects = (event: Y.YMapEvent<BoardObject>) => { if (!ready) return; scene.apply(event); cull(); drawSelections(); };

    const drawCursors = () => {
      if (!ready || !awareness) return;
      cursors.removeChildren().forEach((c) => c.destroy({ children: true }));
      awareness.getStates().forEach((s, clientId) => {
        if (clientId === awareness.clientID || !s.cursor || !s.user) return;
        cursors.addChild(drawCursor(s.cursor.x, s.cursor.y, s.user.colour, s.user.name));
      });
    };

    (async () => {
      await app.init({ resizeTo: el, background: "#f5f5f5", antialias: true });
      if (disposed) { app.destroy(); return; }
      el.appendChild(app.canvas);
      world.addChild(objectsLayer, overlay, cursors, preview);
      app.stage.addChild(world);
      ready = true;
      scene.rebuild();
      cull();
      drawSelections();
    })();

    board.objects.observe(onObjects);
    awareness?.on("change", drawCursors);

    // --- Pointer handling ---
    const pos = (e: { clientX: number; clientY: number }): Point => {
      const r = el.getBoundingClientRect();
      return screenToWorld(view.current, e.clientX - r.left, e.clientY - r.top);
    };
    let gesture: null | { kind: "pan" | "move" | "draw" | "marquee" | "erase"; path: Point[]; last: { x: number; y: number }; ids?: string[] } = null;

    const down = (e: PointerEvent) => {
      if (editing) return;
      el.setPointerCapture(e.pointerId);
      const p = pos(e);
      const t = toolRef.current;
      const ro = roRef.current;
      const screen = { x: e.clientX, y: e.clientY };
      if (e.button === 1 || e.button === 2) { gesture = { kind: "pan", path: [p], last: screen }; return; }
      if (t === "select") {
        const hit = hitTest(board.list(), p);
        if (hit) {
          if (!selection.current.includes(hit.id)) selection.current = e.shiftKey ? [...selection.current, hit.id] : [hit.id];
          selection.current = board.expandGroups(selection.current);
          redraw();
          gesture = ro ? { kind: "pan", path: [p], last: screen } : { kind: "move", path: [p], last: { x: p.x, y: p.y } };
        } else {
          selection.current = [];
          redraw();
          gesture = { kind: "marquee", path: [p], last: screen };
        }
        return;
      }
      if (ro) return;
      if (t === "eraser") { gesture = { kind: "erase", path: [p], last: screen }; board.remove(strokesHit(board.list(), p)); return; }
      gesture = { kind: "draw", path: [p], last: screen };
    };

    const move = (e: PointerEvent) => {
      const p = pos(e);
      if (awareness) awareness.setLocalStateField("cursor", { x: p.x, y: p.y });
      if (!gesture) return;
      if (gesture.kind === "pan") {
        view.current.x += e.clientX - gesture.last.x; view.current.y += e.clientY - gesture.last.y;
        gesture.last = { x: e.clientX, y: e.clientY }; apply();
      } else if (gesture.kind === "move") {
        board.move(selection.current, p.x - gesture.last.x, p.y - gesture.last.y);
        gesture.last = { x: p.x, y: p.y };
      } else if (gesture.kind === "erase") {
        board.remove(strokesHit(board.list(), p));
      } else {
        gesture.path.push(p);
        if (gesture.kind === "draw") drawPreview(gesture.path);
        if (gesture.kind === "marquee") drawMarquee(gesture.path);
      }
    };

    const drawPreview = (path: Point[]) => {
      preview.removeChildren().forEach((c) => c.destroy({ children: true }));
      const o = objectForGesture(toolRef.current, path, board.list());
      const shown = o && o.type !== "connector" ? withDefaults(o) : undefined;
      if (shown) {
        preview.addChild(drawObject(shown, board).node);
      } else if (o) {
        const a = path[0]!, b = path.at(-1)!;
        preview.addChild(new Graphics().moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2, color: 0x1976d2 }));
      }
    };
    const drawMarquee = (path: Point[]) => {
      preview.removeChildren().forEach((c) => c.destroy({ children: true }));
      const r = normaliseRect(path[0]!, path.at(-1)!);
      preview.addChild(new Graphics().rect(r.x, r.y, r.width, r.height).fill({ color: 0x1976d2, alpha: 0.1 }).stroke({ width: 1, color: 0x1976d2 }));
    };

    const up = () => {
      const g = gesture; gesture = null;
      preview.removeChildren().forEach((c) => c.destroy({ children: true }));
      if (!g) return;
      if (g.kind === "marquee" && g.path.length > 1) {
        const r = normaliseRect(g.path[0]!, g.path.at(-1)!);
        selection.current = board.expandGroups(board.list().filter((o) => o.type !== "connector" && intersects(r, o)).map((o) => o.id));
        redraw();
      }
      if (g.kind === "draw") {
        const o = objectForGesture(toolRef.current, g.path, board.list());
        if (o) {
          const made = board.add(o as never);
          selection.current = [made.id];
          redraw();
          if (made.type === "sticky" || made.type === "text") startEdit(made.id);
          onToolDone?.();
        }
      }
    };

    const startEdit = (id: string) => {
      const o = board.get(id);
      if (!o || roRef.current || !("text" in o || o.type === "text")) return;
      const v = view.current;
      setEditing({
        id, left: o.x * v.zoom + v.x, top: o.y * v.zoom + v.y, width: o.width * v.zoom, height: o.height * v.zoom,
        text: o.type === "text" ? o.html.replace(/<[^>]*>/g, "") : (o as { text: string }).text,
      });
    };
    const dbl = (e: MouseEvent) => {
      const hit = hitTest(board.list(), pos(e));
      if (hit) startEdit(hit.id);
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      view.current = zoomAt(view.current, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.001));
      apply();
    };

    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "TEXTAREA") return;
      const mod = e.ctrlKey || e.metaKey;
      const ro = roRef.current;
      if (mod && e.key.toLowerCase() === "z" && !ro) { e.preventDefault(); e.shiftKey ? board.undo.redo() : board.undo.undo(); }
      else if (mod && e.key.toLowerCase() === "y" && !ro) { e.preventDefault(); board.undo.redo(); }
      else if (mod && e.key.toLowerCase() === "c") { clipboard = board.copy(selection.current); }
      else if (mod && e.key.toLowerCase() === "x" && !ro) { clipboard = board.copy(selection.current); board.remove(selection.current); selection.current = []; }
      else if (mod && e.key.toLowerCase() === "v" && !ro) { selection.current = board.paste(clipboard); redraw(); }
      else if (mod && e.key.toLowerCase() === "d" && !ro) { e.preventDefault(); selection.current = board.paste(board.copy(selection.current)); redraw(); }
      else if (mod && e.key.toLowerCase() === "g" && !ro) { e.preventDefault(); e.shiftKey ? selection.current.forEach((id) => { const g = board.get(id)?.groupId; if (g) board.ungroup(g); }) : board.group(selection.current); }
      else if ((e.key === "Delete" || e.key === "Backspace") && !ro) { board.remove(selection.current); selection.current = []; }
      else if (e.key === "Escape") { selection.current = []; redraw(); }
      else if (e.key.startsWith("Arrow") && !ro && selection.current.length) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        board.move(selection.current, e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0, e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0);
      }
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("dblclick", dbl);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", key);

    return () => {
      disposed = true;
      board.objects.unobserve(onObjects);
      awareness?.off("change", drawCursors);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("dblclick", dbl);
      el.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", key);
      try { app.destroy(true, { children: true }); } catch { /* not initialised */ }
    };
    // editing is intentionally read through closure state only at pointer time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, awareness]);

  const commit = (text: string) => {
    if (!editing) return;
    const o = board.get(editing.id);
    if (o?.type === "text") board.update(editing.id, { html: text } as never);
    else if (o) board.update(editing.id, { text } as never);
    setEditing(null);
    redrawRef.current();
  };

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
      <div ref={host} style={{ position: "absolute", inset: 0 }} role="application" aria-label="Board canvas" tabIndex={0} />
      {editing && (
        <textarea
          autoFocus
          defaultValue={editing.text}
          aria-label="Edit object text"
          style={{ position: "absolute", left: editing.left, top: editing.top, width: editing.width, height: editing.height, font: "16px system-ui", resize: "none" }}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Escape") commit(e.currentTarget.value); }}
        />
      )}
    </div>
  );
}
