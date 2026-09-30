import { useState } from "react";
import { formatDuration } from "@miroclone/shared";
import type { useWorkshop } from "./useWorkshop.js";

type W = ReturnType<typeof useWorkshop>;

/** The timer, presentation controls, and summon button (WSH-3, WSH-5, COL-6). Everyone sees state. Editors change it. */
export function WorkshopBar({ w }: { w: W }) {
  const [minutes, setMinutes] = useState(5);
  const left = w.remainingMs;
  const running = !!w.timer;
  const done = running && left === 0;

  return (
    <div role="region" aria-label="Workshop tools" style={{ display: "flex", gap: 8, alignItems: "center", padding: "2px 8px", background: done ? "#ffebee" : "#f1f8e9", borderBottom: "1px solid #ddd", minHeight: 28, flexWrap: "wrap" }}>
      {running && (
        <span role="timer" aria-live="off" style={{ fontWeight: 700, fontSize: 18, fontVariantNumeric: "tabular-nums", color: done ? "#c62828" : "inherit" }}>
          {done ? "Time's up" : formatDuration(left)}
        </span>
      )}
      {w.canFacilitate && (
        <>
          {running
            ? <button onClick={w.stopTimer}>Stop timer</button>
            : <>
                <label>Timer (minutes) <input type="number" min={1} max={1440} value={minutes} style={{ width: 56 }} onChange={(e) => setMinutes(Math.max(1, Number(e.target.value) || 1))} /></label>
                <button onClick={() => w.startTimer(minutes)}>Start timer</button>
              </>}
          <span aria-hidden>|</span>
          {w.iAmPresenter
            ? <><button onClick={w.prev} disabled={w.slide === 0}>Previous</button><button onClick={w.next} disabled={w.slide >= w.slideCount - 1}>Next</button><button onClick={w.stopPresenting}>Stop presenting</button></>
            : <button onClick={w.startPresenting} disabled={w.presenting}>Present frames</button>}
          <button onClick={w.summon}>Bring everyone to my view</button>
        </>
      )}
      {w.presenting && (
        <span role="status">
          {w.iAmPresenter ? "You are presenting" : `${w.present!.by} is presenting`}: slide {w.slide + 1} of {w.slideCount}{w.slideTitle ? `, ${w.slideTitle}` : ""}.{" "}
          {!w.iAmPresenter && (w.followPresenter
            ? <button onClick={() => w.setFollowPresenter(false)}>Leave presentation</button>
            : <button onClick={() => w.setFollowPresenter(true)}>Follow presentation</button>)}
        </span>
      )}
      {w.followId !== null && <button onClick={() => w.setFollowId(null)}>Stop following</button>}
      {w.notice && <span role="alert">{w.notice} <button aria-label="Dismiss" onClick={w.clearNotice}>Dismiss</button></span>}
    </div>
  );
}
