import { useEffect, useRef, useState } from "react";
import type { Awareness } from "y-protocols/awareness";
import { freshReactions, REACTION_TTL_MS, REACTIONS, type ReactionEvent } from "@miroclone/shared";

/**
 * Short emoji reactions that everyone on the board sends and sees (WSH-6). Reactions travel through awareness, so people
 * with view-only access can send them too, and nothing is stored on the board.
 */
export function Reactions({ awareness, me }: { awareness?: Awareness; me: string }) {
  const [shown, setShown] = useState<(ReactionEvent & { key: number })[]>([]);
  const seen = useRef(new Map<number, number>());
  const lastSent = useRef(0);
  const key = useRef(0);

  const show = (events: ReactionEvent[]) => {
    if (!events.length) return;
    const added = events.map((e) => ({ ...e, key: key.current++ }));
    setShown((s) => [...s, ...added].slice(-12));
    window.setTimeout(() => setShown((s) => s.filter((x) => !added.includes(x))), REACTION_TTL_MS);
  };

  useEffect(() => {
    if (!awareness) return;
    const check = () => show(freshReactions(awareness.getStates() as never, seen.current, Date.now(), awareness.clientID));
    awareness.on("change", check);
    return () => awareness.off("change", check);
  }, [awareness]);

  const send = (emoji: string) => {
    // One reaction a second, so nobody can flood the room.
    const now = Date.now();
    if (!awareness || now - lastSent.current < 1000) return;
    lastSent.current = now;
    awareness.setLocalStateField("reaction", { emoji, at: now });
    show([{ clientId: awareness.clientID, name: me, emoji, at: now }]);
  };

  return (
    <>
      <span role="group" aria-label="Reactions" style={{ display: "inline-flex", gap: 2 }}>
        {REACTIONS.map((r) => <button key={r.emoji} aria-label={r.label} title={r.label} onClick={() => send(r.emoji)} style={{ padding: "0 4px" }}>{r.emoji}</button>)}
      </span>
      {/* Floating reactions sit over the board, and a screen reader hears each one. */}
      <div role="status" aria-live="polite" style={{ position: "fixed", left: 12, bottom: 44, display: "flex", flexDirection: "column", gap: 4, pointerEvents: "none", zIndex: 5 }}>
        {shown.map((r) => (
          <span key={r.key} style={{ background: "#fffd", border: "1px solid #ccc", borderRadius: 14, padding: "2px 10px", font: "14px system-ui" }}>
            <span aria-hidden>{r.emoji}</span> {r.name} reacted: {REACTIONS.find((x) => x.emoji === r.emoji)?.label}
          </span>
        ))}
      </div>
    </>
  );
}
