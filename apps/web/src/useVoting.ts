import { useEffect, useMemo, useState } from "react";
import { api, type VoteState } from "./api.js";
import type { Badge } from "./Canvas.js";

/** Dot voting for one board (WSH-4). State comes from the server, and refreshes every few seconds. */
export function useVoting(boardId: string) {
  const [state, setState] = useState<VoteState | null>(null);
  const [message, setMessage] = useState("");
  const load = () => api.votes(boardId).then(setState).catch(() => {});
  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (!document.hidden) void load(); }, 3000);
    return () => window.clearInterval(t);
  }, [boardId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<VoteState>) => {
    setMessage("");
    try { setState(await fn()); }
    catch (e) { setMessage((e as { status?: number }).status === 400 ? "That didn't work. You may have used all your votes, or voting is closed." : "The vote couldn't be recorded."); }
  };

  // While voting is open, each person sees only their own dots. After it closes, everyone sees the totals.
  const badges: Badge[] = useMemo(() => {
    if (!state?.session) return [];
    if (state.session.state === "closed") return (state.results ?? []).map((r) => ({ objectId: r.objectId, text: String(r.count), colour: 0x2e7d32 }));
    const mine = new Map<string, number>();
    for (const id of state.mine) mine.set(id, (mine.get(id) ?? 0) + 1);
    return [...mine].map(([objectId, n]) => ({ objectId, text: `● ${n}` }));
  }, [state]);

  return {
    state, badges, message, open: state?.session?.state === "open",
    start: (limit: number, anonymous: boolean) => run(() => api.startVoting(boardId, limit, anonymous)),
    close: () => run(() => api.closeVoting(boardId)),
    cast: (objectId: string, remove: boolean) => run(() => (remove ? api.removeVote(boardId, objectId) : api.castVote(boardId, objectId))),
  };
}
