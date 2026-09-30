import { useEffect, useRef } from "react";
import { Application, Container, Graphics } from "pixi.js";
import * as Y from "yjs";
import { OBJECTS_MAP, type BoardObject } from "@miroclone/shared";
import { screenToWorld, zoomAt, type Viewport } from "./viewport.js";

export function addSticky(doc: Y.Doc, x: number, y: number) {
  const id = crypto.randomUUID();
  const sticky: BoardObject = {
    id, type: "sticky", x, y, width: 160, height: 160, rotation: 0,
    index: String(Date.now()), locked: false, text: "", color: "#fff475",
  };
  doc.getMap(OBJECTS_MAP).set(id, sticky);
}

/** Renders the board's Yjs object map with PixiJS. Wheel zooms; drag on empty space pans; double click adds a sticky note. */
export function Canvas({ doc, readOnly }: { doc: Y.Doc; readOnly: boolean }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const app = new Application();
    const world = new Container();
    const view: Viewport = { x: 0, y: 0, zoom: 1 };
    let disposed = false;
    const objects = doc.getMap<BoardObject>(OBJECTS_MAP);

    const apply = () => { world.position.set(view.x, view.y); world.scale.set(view.zoom); };
    const redraw = () => {
      world.removeChildren().forEach((c) => c.destroy());
      const sorted = [...objects.values()].sort((a, b) => a.index.localeCompare(b.index));
      for (const o of sorted) {
        const g = new Graphics().rect(o.x, o.y, o.width, o.height)
          .fill(o.type === "sticky" ? o.color : 0xffffff).stroke({ width: 1, color: 0x1a1a1a });
        world.addChild(g);
      }
    };

    (async () => {
      await app.init({ resizeTo: host.current!, background: "#f5f5f5", antialias: true });
      if (disposed) { app.destroy(); return; }
      host.current!.appendChild(app.canvas);
      app.stage.addChild(world);
      objects.observe(redraw);
      redraw();
    })();

    const el = host.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      Object.assign(view, zoomAt(view, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.001)));
      apply();
    };
    let drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY }; };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      view.x += e.clientX - drag.x; view.y += e.clientY - drag.y;
      drag = { x: e.clientX, y: e.clientY }; apply();
    };
    const up = () => { drag = null; };
    const dbl = (e: MouseEvent) => {
      if (readOnly) return;
      const r = el.getBoundingClientRect();
      const p = screenToWorld(view, e.clientX - r.left, e.clientY - r.top);
      addSticky(doc, p.x - 80, p.y - 80);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    el.addEventListener("dblclick", dbl);

    return () => {
      disposed = true;
      objects.unobserve(redraw);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      el.removeEventListener("dblclick", dbl);
      try { app.destroy(true); } catch { /* not yet initialised */ }
    };
  }, [doc, readOnly]);

  return <div ref={host} style={{ flex: 1, minHeight: 0 }} role="application" aria-label="Board canvas" />;
}
