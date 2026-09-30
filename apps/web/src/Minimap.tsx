import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { boundsOf, type Board } from "@miroclone/shared";
import type { CanvasApi } from "./Canvas.js";
import { minimapLayout, minimapToWorld, type Viewport } from "./viewport.js";

const W = 180, H = 120;
/** Past this many objects the minimap draws a sample, so a large board stays cheap to redraw. */
const MAX_DRAWN = 1500;

/** Shows the whole board and the current view. Click or drag to move the view (CNV-13). */
export function Minimap({ board, api, subscribe }: {
  board: Board; api: { current: CanvasApi | null };
  /** Registers a callback for viewport changes. Returns a function that removes it. */
  subscribe: (fn: (v: Viewport) => void) => () => void;
}) {
  const [view, setView] = useState<Viewport | undefined>(api.current?.viewport());
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const dragging = useRef(false);

  useEffect(() => subscribe(setView), [subscribe]);
  // The canvas starts after this component mounts, so ask for the first view until it's there.
  useEffect(() => {
    if (view) return;
    const t = window.setInterval(() => { const v = api.current?.viewport(); if (v) setView(v); }, 200);
    return () => window.clearInterval(t);
  }, [view, api]);
  // Redraw the objects at most every 250 ms while people edit.
  useEffect(() => {
    let timer: number | undefined;
    const on = () => { if (timer === undefined) timer = window.setTimeout(() => { timer = undefined; bump(); }, 250); };
    board.objects.observe(on);
    return () => { board.objects.unobserve(on); window.clearTimeout(timer); };
  }, [board]);

  const objs = useMemo(() => board.list().filter((o) => o.type !== "connector"), [board, version]);
  const content = useMemo(() => (objs.length ? boundsOf(objs, 0) : undefined), [objs]);
  const drawn = useMemo(() => {
    const step = Math.max(1, Math.ceil(objs.length / MAX_DRAWN));
    return objs.filter((_, i) => i % step === 0);
  }, [objs]);

  const size = api.current?.size();
  if (!view || !size) return null;
  const visible = { x: -view.x / view.zoom, y: -view.y / view.zoom, width: size.width / view.zoom, height: size.height / view.zoom };
  const l = minimapLayout(content, visible, W, H);
  const px = (v: number, o: number) => (v - o) * l.scale;

  const go = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    api.current?.centreOn(minimapToWorld(l, e.clientX - r.left, e.clientY - r.top));
  };
  return (
    <svg role="img" aria-label="Board minimap. Click to move the view." width={W} height={H}
      style={{ position: "absolute", right: 12, bottom: 12, background: "#fffd", border: "1px solid #90a4ae", borderRadius: 4, touchAction: "none", cursor: "pointer" }}
      onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); go(e); }}
      onPointerMove={(e) => { if (dragging.current) go(e); }}
      onPointerUp={() => { dragging.current = false; }}>
      {drawn.map((o) => (
        <rect key={o.id} x={px(o.x, l.originX)} y={px(o.y, l.originY)} width={Math.max(o.width * l.scale, 1)} height={Math.max(o.height * l.scale, 1)}
          fill={o.type === "frame" ? "none" : "#90a4ae"} stroke={o.type === "frame" ? "#607d8b" : "none"} />
      ))}
      <rect x={px(visible.x, l.originX)} y={px(visible.y, l.originY)} width={visible.width * l.scale} height={visible.height * l.scale}
        fill="#1976d222" stroke="#1976d2" strokeWidth={1.5} />
    </svg>
  );
}
