import { useEffect, useMemo, useRef, useState } from "react";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { clockOffset, frameOrder, timerRemaining, visibleInPrivateMode, Workshop, type Board } from "@miroclone/shared";
import { api } from "./api.js";
import type { CanvasApi } from "./Canvas.js";
import type { Viewport } from "./viewport.js";

/**
 * Timer, presentation, follow mode, and summon (WSH-3, WSH-5, COL-6). The state lives in the board's shared document,
 * so only editors can change it and everyone sees the same thing.
 */
export function useWorkshop(o: { doc: Y.Doc; board: Board; awareness?: Awareness; me: { id: string; name: string }; canFacilitate: boolean; apiRef: { current: CanvasApi | null } }) {
  const { doc, board, awareness, me, canFacilitate, apiRef } = o;
  const workshop = useMemo(() => new Workshop(doc), [doc]);
  const [, bump] = useState(0);
  const [offset, setOffset] = useState(0);
  const [followId, setFollowId] = useState<number | null>(null);
  const [followPresenter, setFollowPresenter] = useState(true);
  const [notice, setNotice] = useState("");
  const offsetRef = useRef(0);
  offsetRef.current = offset;
  const lastSummon = useRef<number | undefined>(workshop.summon?.at);

  // Redraw when shared state changes, and every quarter second while a timer runs.
  useEffect(() => workshop.observe(() => bump((n) => n + 1)), [workshop]);
  useEffect(() => { const t = window.setInterval(() => { if (workshop.timer) bump((n) => n + 1); }, 250); return () => window.clearInterval(t); }, [workshop]);

  // Line this browser's clock up with the server's. Keep the estimate from the quickest round trip.
  useEffect(() => {
    let best = Infinity, stopped = false;
    const measure = async () => {
      const sent = Date.now();
      try {
        const { now } = await api.time();
        const received = Date.now();
        if (!stopped && received - sent < best) { best = received - sent; setOffset(clockOffset(sent, now, received)); }
      } catch { /* The timer falls back to this browser's clock. */ }
    };
    void measure(); void measure(); void measure();
    const t = window.setInterval(() => void measure(), 60_000);
    return () => { stopped = true; window.clearInterval(t); };
  }, []);
  const serverNow = () => Date.now() + offsetRef.current;

  // Lock and private mode (WSH-7). The collaboration service enforces the lock. Private mode hides content in this view only.
  const lock = workshop.lock;
  const lockedByOther = !!lock && lock.by !== me.id;
  const priv = workshop.privateMode;
  useEffect(() => {
    board.setViewFilter(priv ? (o) => visibleInPrivateMode(o, me.id, priv.by) : null);
    apiRef.current?.refresh();
    return () => board.setViewFilter(null);
  }, [priv?.by, board, me.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const frames = frameOrder(board.list());
  const present = workshop.present;
  const presenting = !!present;
  const iAmPresenter = presenting && present!.by === me.name;
  const slide = present ? Math.min(present.index, Math.max(0, frames.length - 1)) : 0;

  // Show the current frame to the presenter, and to everyone who follows the presentation.
  useEffect(() => {
    if (!present || !frames.length) return;
    if (!iAmPresenter && !followPresenter) return;
    const f = frames[slide]!;
    apiRef.current?.showRect({ x: f.x, y: f.y, width: f.width, height: f.height });
  }, [present?.index, present?.by, frames.length, followPresenter]);   // eslint-disable-line react-hooks/exhaustive-deps

  // A new presentation starts with everyone following it.
  useEffect(() => { if (presenting) setFollowPresenter(true); }, [present?.by]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Browsers keep the Escape key for leaving fullscreen and never pass it to the page. So when the presenter's
  // fullscreen ends, the presentation ends too, which is what pressing Escape means here.
  const enteredFullscreen = useRef(false);
  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement) { enteredFullscreen.current = true; return; }
      if (enteredFullscreen.current && workshop.present?.by === me.name) { enteredFullscreen.current = false; workshop.stopPresenting(); }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [workshop, me.name]);

  const go = (d: number) => {
    const list = frameOrder(board.list());
    const cur = workshop.present;
    if (!cur || !list.length) return;
    const i = Math.min(list.length - 1, Math.max(0, cur.index + d));
    workshop.setSlide(i, list[i]!.id);
  };
  const start = () => {
    const list = frameOrder(board.list());
    if (!list.length) { setNotice("Add a frame to the board first. Each frame is one slide."); return; }
    workshop.startPresenting(me.name, list[0]!.id);
    void document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const stop = () => {
    enteredFullscreen.current = false;
    workshop.stopPresenting();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  };

  // The presenter moves through frames with the arrow keys, and leaves with Escape. One listener stays in place, and
  // reads the current values from a ref. A listener that is replaced on every render can be removed in the middle of a
  // key event, for example when another handler clears the selection, and then the key is lost.
  const live = useRef({ go, stop, active: iAmPresenter });
  live.current = { go, stop, active: iAmPresenter };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!live.current.active) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); live.current.go(1); }
      else if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); live.current.go(-1); }
      else if (e.key === "Escape") live.current.stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Summon: everyone moves to the facilitator's view, once.
  useEffect(() => {
    const s = workshop.summon;
    if (!s || s.at === lastSummon.current) return;
    lastSummon.current = s.at;
    if (s.by === me.name) return;
    apiRef.current?.setViewport({ x: s.x, y: s.y, zoom: s.zoom });
    setNotice(`${s.by} moved everyone to their view. Move the canvas to go your own way.`);
  });   // eslint-disable-line react-hooks/exhaustive-deps
  const summon = () => {
    const v = apiRef.current?.viewport();
    if (v) workshop.summonTo(v.x, v.y, v.zoom, me.name, serverNow());
  };

  // Follow one person's view (COL-6). Moving the canvas yourself ends it.
  useEffect(() => {
    if (followId === null || !awareness) return;
    const apply = () => {
      const v = awareness.getStates().get(followId)?.viewport as Viewport | undefined;
      if (v) apiRef.current?.setViewport(v);
      else if (!awareness.getStates().has(followId)) setFollowId(null);
    };
    apply();
    awareness.on("change", apply);
    return () => awareness.off("change", apply);
  }, [followId, awareness]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Publish this browser's view so others can follow it. Only the user's own moves are sent.
  const lastSent = useRef(0);
  const onViewChange = (v: Viewport, source: "user" | "api") => {
    if (source !== "user") return;
    if (followId !== null) setFollowId(null);
    if (presenting && !iAmPresenter) setFollowPresenter(false);
    const now = Date.now();
    if (awareness && now - lastSent.current > 100) { lastSent.current = now; awareness.setLocalStateField("viewport", v); }
  };

  const timer = workshop.timer;
  return {
    timer, remainingMs: timerRemaining(timer, serverNow()),
    startTimer: (minutes: number) => { try { workshop.startTimer(minutes * 60_000, serverNow(), me.name); } catch (e) { setNotice((e as Error).message); } },
    stopTimer: () => workshop.stopTimer(),
    present, presenting, iAmPresenter, slide, slideCount: frames.length, slideTitle: frames[slide]?.title ?? "",
    startPresenting: start, stopPresenting: stop, next: () => go(1), prev: () => go(-1),
    followPresenter, setFollowPresenter, followId, setFollowId, summon, onViewChange, notice, clearNotice: () => setNotice(""),
    canFacilitate,
    lock, lockedByOther, iLocked: !!lock && lock.by === me.id, privateMode: priv, iStartedPrivate: !!priv && priv.by === me.id,
    lockBoard: () => workshop.lockBoard(me.id, me.name), unlockBoard: () => workshop.unlockBoard(),
    startPrivate: () => workshop.startPrivate(me.id, me.name), reveal: () => workshop.reveal(),
  };
}
