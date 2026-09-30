import { useEffect, useRef, useState } from "react";
import { Application, Container, Graphics } from "pixi.js";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { isSafeLink, Board, type BoardObject } from "@miroclone/shared";
import { boundsOf } from "@miroclone/shared";
import { hitHandle, hitTest, intersects, normaliseRect, resizeFromHandle, rotationFor, strokesHit, type Handle, type Point } from "./geometry.js";
import { drawCursor, drawObject, drawSelection, Scene, textHeight, withDefaults } from "./render.js";
import { objectForGesture, type Tool } from "./tools.js";
import { fitRect, screenToWorld, zoomAt, type Viewport } from "./viewport.js";

/** What the parent can ask of the canvas. */
export interface CanvasApi {
  selection(): string[];
  select(ids: string[]): void;
  /** Zooms to show every object (CNV-1). */
  fit(): void;
  /** Zooms to show the selected objects (CNV-1). */
  fitSelection(): void;
  /** Moves the viewport to a world point, for jumping to another user (COL-3). */
  centreOn(p: Point): void;
  /** The world point at the middle of the screen. */
  viewCentre(): Point;
}

export interface CanvasProps {
  board: Board;
  tool: Tool;
  readOnly: boolean;
  awareness?: Awareness;
  onToolDone?: () => void;
  apiRef?: { current: CanvasApi | null };
  onSelect?: (ids: string[]) => void;
  /** Called with image files dropped on the canvas or pasted into it, and the world point to place them. */
  onFiles?: (files: File[], at: Point) => void;
}

/** Clipboard shared by every board in this tab, so paste works between boards (CNV-11). It clears on reload and sign-out (COL-10). */
let clipboard: BoardObject[] = [];
/** Grows or shrinks a text object to fit its content. */
export function fitTextHeight(board: Board, id: string) {
  const o = board.get(id);
  if (o?.type === "text") {
    const h = textHeight(o);
    if (h !== o.height) board.update(id, { height: h });
  }
}

export const clearClipboard = () => { clipboard = []; };

const CURSOR_COLOURS = ["#e53935", "#8e24aa", "#3949ab", "#00897b", "#f4511e", "#6d4c41"];
export const colourFor = (id: number) => CURSOR_COLOURS[id % CURSOR_COLOURS.length]!;

type Gesture =
  | { kind: "pan"; last: { x: number; y: number } }
  | { kind: "move"; last: Point }
  | { kind: "draw"; path: Point[] }
  | { kind: "marquee"; path: Point[] }
  | { kind: "erase" }
  | { kind: "resize"; id: string; handle: Exclude<Handle, "rotate"> }
  | { kind: "rotate"; id: string };

const resizable = (o: BoardObject) => o.type !== "connector" && o.type !== "stroke";

export function Canvas({ board, tool, readOnly, awareness, onToolDone, apiRef, onSelect, onFiles }: CanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const toolRef = useRef(tool);
  const roRef = useRef(readOnly);
  const onSelectRef = useRef(onSelect);
  const onFilesRef = useRef(onFiles);
  const selection = useRef<string[]>([]);
  const view = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });
  const redrawRef = useRef<() => void>(() => {});
  const [editing, setEditing] = useState<{ id: string; left: number; top: number; width: number; height: number; text: string } | null>(null);
  const editingRef = useRef(editing);
  toolRef.current = tool;
  roRef.current = readOnly;
  onSelectRef.current = onSelect;
  onFilesRef.current = onFiles;
  editingRef.current = editing;

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

    const drawSelections = () => {
      overlay.removeChildren().forEach((c) => c.destroy({ children: true }));
      const only = selection.current.length === 1 ? board.get(selection.current[0]!) : undefined;
      for (const id of selection.current) {
        const o = board.get(id);
        if (o) overlay.addChild(drawSelection(o, { zoom: view.current.zoom, handles: !roRef.current && !!only && only.id === o.id && !o.locked && o.type !== "connector" }));
      }
    };
    const redraw = () => { if (ready) drawSelections(); };
    redrawRef.current = redraw;

    const apply = () => {
      world.position.set(view.current.x, view.current.y);
      world.scale.set(view.current.zoom);
      cull();
      drawSelections();
    };
    const setSel = (ids: string[]) => {
      selection.current = ids;
      onSelectRef.current?.(ids);
      redraw();
    };
    const onObjects = (event: Y.YMapEvent<BoardObject>) => { if (!ready) return; scene.apply(event); cull(); drawSelections(); };

    const showRect = (r: { x: number; y: number; width: number; height: number }) => {
      view.current = fitRect(r, el.clientWidth, el.clientHeight);
      apply();
    };
    if (apiRef) {
      apiRef.current = {
        selection: () => selection.current,
        select: setSel,
        fit: () => showRect(boundsOf(board.list(), 0)),
        fitSelection: () => { const objs = selection.current.map((id) => board.get(id)).filter(Boolean) as BoardObject[]; if (objs.length) showRect(boundsOf(objs, 0)); },
        viewCentre: () => screenToWorld(view.current, el.clientWidth / 2, el.clientHeight / 2),
        centreOn: (p) => { view.current = { ...view.current, x: el.clientWidth / 2 - p.x * view.current.zoom, y: el.clientHeight / 2 - p.y * view.current.zoom }; apply(); },
      };
    }

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
    let gesture: Gesture | null = null;

    const down = (e: PointerEvent) => {
      if (editingRef.current) return;
      el.setPointerCapture(e.pointerId);
      const p = pos(e);
      const t = toolRef.current;
      const ro = roRef.current;
      if (e.button === 1 || e.button === 2) { gesture = { kind: "pan", last: { x: e.clientX, y: e.clientY } }; return; }
      if (t === "select") {
        // Handles first, because they sit on top of the object.
        const only = selection.current.length === 1 ? board.get(selection.current[0]!) : undefined;
        if (only && !ro && !only.locked && only.type !== "connector") {
          const h = hitHandle(only, p, view.current.zoom);
          if (h === "rotate") { gesture = { kind: "rotate", id: only.id }; board.undo.stopCapturing(); return; }
          if (h && resizable(only)) { gesture = { kind: "resize", id: only.id, handle: h }; board.undo.stopCapturing(); return; }
        }
        const hit = hitTest(board.list(), p);
        if (hit) {
          // Ctrl or Cmd plus click follows a link.
          if ((e.ctrlKey || e.metaKey) && hit.type === "text" && hit.link && isSafeLink(hit.link)) { window.open(hit.link, "_blank", "noopener,noreferrer"); return; }
          setSel(board.expandGroups(selection.current.includes(hit.id) ? selection.current : e.shiftKey ? [...selection.current, hit.id] : [hit.id]));
          gesture = ro ? { kind: "pan", last: { x: e.clientX, y: e.clientY } } : { kind: "move", last: p };
          if (!ro) board.undo.stopCapturing();
        } else {
          setSel([]);
          gesture = { kind: "marquee", path: [p] };
        }
        return;
      }
      if (ro) return;
      if (t === "eraser") { gesture = { kind: "erase" }; board.remove(strokesHit(board.list(), p)); return; }
      gesture = { kind: "draw", path: [p] };
    };

    const move = (e: PointerEvent) => {
      const p = pos(e);
      if (awareness) awareness.setLocalStateField("cursor", { x: p.x, y: p.y });
      const g = gesture;
      if (!g) return;
      if (g.kind === "pan") {
        view.current.x += e.clientX - g.last.x; view.current.y += e.clientY - g.last.y;
        g.last = { x: e.clientX, y: e.clientY }; apply();
      } else if (g.kind === "move") {
        board.move(selection.current, p.x - g.last.x, p.y - g.last.y);
        g.last = p;
      } else if (g.kind === "resize") {
        const o = board.get(g.id);
        if (o) board.update(g.id, resizeFromHandle(o, g.handle, p, e.shiftKey));
      } else if (g.kind === "rotate") {
        const o = board.get(g.id);
        if (o) board.update(g.id, { rotation: rotationFor(o, p, e.shiftKey) });
      } else if (g.kind === "erase") {
        board.remove(strokesHit(board.list(), p));
      } else {
        g.path.push(p);
        if (g.kind === "draw") drawPreview(g.path);
        if (g.kind === "marquee") drawMarquee(g.path);
      }
    };

    const clearPreview = () => preview.removeChildren().forEach((c) => c.destroy({ children: true }));
    const drawPreview = (path: Point[]) => {
      clearPreview();
      const o = objectForGesture(toolRef.current, path, board.list());
      const shown = o && o.type !== "connector" ? withDefaults(o) : undefined;
      if (shown) preview.addChild(drawObject(shown, board).node);
      else if (o) { const a = path[0]!, b = path.at(-1)!; preview.addChild(new Graphics().moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2, color: 0x1976d2 })); }
    };
    const drawMarquee = (path: Point[]) => {
      clearPreview();
      const r = normaliseRect(path[0]!, path.at(-1)!);
      preview.addChild(new Graphics().rect(r.x, r.y, r.width, r.height).fill({ color: 0x1976d2, alpha: 0.1 }).stroke({ width: 1, color: 0x1976d2 }));
    };

    const up = () => {
      const g = gesture; gesture = null;
      clearPreview();
      if (!g) return;
      if (g.kind === "marquee" && g.path.length > 1) {
        const r = normaliseRect(g.path[0]!, g.path.at(-1)!);
        setSel(board.expandGroups(board.list().filter((o) => o.type !== "connector" && intersects(r, o)).map((o) => o.id)));
      }
      if (g.kind === "draw") {
        const o = objectForGesture(toolRef.current, g.path, board.list());
        if (o) {
          const made = board.add(o as never);
          setSel([made.id]);
          if (made.type === "sticky" || made.type === "text") startEdit(made.id);
          onToolDone?.();
        }
      }
    };

    const startEdit = (id: string) => {
      const o = board.get(id);
      if (!o || roRef.current || !("text" in o)) return;
      const v = view.current;
      setEditing({ id, left: o.x * v.zoom + v.x, top: o.y * v.zoom + v.y, width: Math.max(o.width * v.zoom, 120), height: Math.max(o.height * v.zoom, 40), text: o.text });
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
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const ro = roRef.current;
      const sel = selection.current;
      if (e.shiftKey && e.key === "!") { e.preventDefault(); showRect(boundsOf(board.list(), 0)); }          // Shift+1
      else if (e.shiftKey && e.key === "@") { e.preventDefault(); apiRef?.current?.fitSelection(); }          // Shift+2
      else if (mod && k === "z" && !ro) { e.preventDefault(); e.shiftKey ? board.undo.redo() : board.undo.undo(); }
      else if (mod && k === "y" && !ro) { e.preventDefault(); board.undo.redo(); }
      else if (mod && k === "c") { clipboard = board.copy(sel); }
      else if (mod && k === "x" && !ro) { clipboard = board.copy(sel); board.remove(sel); setSel([]); }
      else if (mod && k === "v" && !ro) { setSel(board.paste(clipboard)); }
      else if (mod && k === "d" && !ro) { e.preventDefault(); setSel(board.paste(board.copy(sel))); }
      else if (mod && k === "g" && !ro) { e.preventDefault(); e.shiftKey ? sel.forEach((id) => { const g = board.get(id)?.groupId; if (g) board.ungroup(g); }) : board.group(sel); }
      else if (mod && k === "l" && !ro) { e.preventDefault(); const locked = !sel.every((id) => board.get(id)?.locked); board.setLocked(sel, locked); redraw(); }
      else if (e.key === "]" && !ro && sel.length === 1) board.bringToFront(sel[0]!);
      else if (e.key === "[" && !ro && sel.length === 1) board.sendToBack(sel[0]!);
      else if ((e.key === "Delete" || e.key === "Backspace") && !ro) { board.remove(sel); setSel([]); }
      else if (e.key === "Escape") setSel([]);
      else if (e.key.startsWith("Arrow") && !ro && sel.length) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        board.move(sel, e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0, e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0);
      }
    };

    // Images arrive by drag and drop or paste. Everything is checked again on the server.
    const imageFiles = (list: FileList | null | undefined) => [...(list ?? [])].filter((f) => f.type.startsWith("image/"));
    const dragOver = (e: DragEvent) => { if (onFilesRef.current && !roRef.current && e.dataTransfer?.types.includes("Files")) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      const files = imageFiles(e.dataTransfer?.files);
      if (!files.length || !onFilesRef.current || roRef.current) return;
      e.preventDefault();
      onFilesRef.current(files, pos(e));
    };
    const paste = (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      const files = imageFiles(e.clipboardData?.files);
      if (!files.length || !onFilesRef.current || roRef.current) return;
      e.preventDefault();
      onFilesRef.current(files, screenToWorld(view.current, el.clientWidth / 2, el.clientHeight / 2));
    };
    const noMenu = (e: Event) => e.preventDefault();
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("dblclick", dbl);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("contextmenu", noMenu);
    el.addEventListener("dragover", dragOver);
    el.addEventListener("drop", drop);
    window.addEventListener("paste", paste);
    window.addEventListener("keydown", key);

    return () => {
      disposed = true;
      if (apiRef) apiRef.current = null;
      board.objects.unobserve(onObjects);
      awareness?.off("change", drawCursors);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("dblclick", dbl);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("contextmenu", noMenu);
      el.removeEventListener("dragover", dragOver);
      el.removeEventListener("drop", drop);
      window.removeEventListener("paste", paste);
      window.removeEventListener("keydown", key);
      try { app.destroy(true, { children: true }); } catch { /* not initialised */ }
    };
  }, [board, awareness, apiRef]);

  const commit = (text: string) => {
    if (!editing) return;
    board.update(editing.id, { text } as never);
    fitTextHeight(board, editing.id);
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
