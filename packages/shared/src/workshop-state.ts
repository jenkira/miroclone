import * as Y from "yjs";

/** Name of the Yjs map that holds shared workshop state. It sits beside the objects, and isn't one of them. */
export const WORKSHOP_MAP = "workshop";

export interface TimerState { endsAt: number; durationMs: number; startedBy: string }
export interface PresentState { by: string; frameId: string | null; index: number }
export interface LockState { by: string; name: string }
export interface PrivateState { by: string; name: string }
export interface SummonState { x: number; y: number; zoom: number; by: string; at: number }

/**
 * Shared workshop state (WSH-3, WSH-5, COL-6). Only editors and owners can write to the board document, so only
 * they can start a timer, present, or bring everyone to a view. Everyone else only reads it.
 */
export class Workshop {
  readonly map: Y.Map<unknown>;
  constructor(readonly doc: Y.Doc) { this.map = doc.getMap(WORKSHOP_MAP); }

  get timer(): TimerState | undefined { return this.map.get("timer") as TimerState | undefined; }
  get present(): PresentState | undefined { return this.map.get("present") as PresentState | undefined; }
  /** Who locked the board, if anyone. The collaboration service enforces it, so only the person who locked it can edit (WSH-7). */
  get lock(): LockState | undefined { return this.map.get("lock") as LockState | undefined; }
  /** Who turned on private mode, if anyone. Other people see only their own content until it ends (WSH-7). */
  get privateMode(): PrivateState | undefined { return this.map.get("private") as PrivateState | undefined; }
  get summon(): SummonState | undefined { return this.map.get("summon") as SummonState | undefined; }

  /** Starts a countdown. `serverNow` is the server's clock, so every browser agrees on when it ends. */
  startTimer(durationMs: number, serverNow: number, by: string) {
    if (!Number.isFinite(durationMs) || durationMs < 1000 || durationMs > 24 * 3600_000) throw new Error("Choose a timer from 1 second to 24 hours.");
    this.map.set("timer", { endsAt: serverNow + durationMs, durationMs, startedBy: by } satisfies TimerState);
  }
  stopTimer() { this.map.delete("timer"); }

  startPresenting(by: string, frameId: string | null = null) { this.map.set("present", { by, frameId, index: 0 } satisfies PresentState); }
  setSlide(index: number, frameId: string | null) {
    const p = this.present;
    if (p) this.map.set("present", { ...p, index, frameId } satisfies PresentState);
  }
  stopPresenting() { this.map.delete("present"); }

  lockBoard(by: string, name: string) { this.map.set("lock", { by, name } satisfies LockState); }
  unlockBoard() { this.map.delete("lock"); }
  startPrivate(by: string, name: string) { this.map.set("private", { by, name } satisfies PrivateState); }
  /** Ends private mode, which reveals everyone's content. */
  reveal() { this.map.delete("private"); }

  /** Asks everyone to move to a view. Each client applies it once, and can then leave it by moving. */
  summonTo(x: number, y: number, zoom: number, by: string, now: number) { this.map.set("summon", { x, y, zoom, by, at: now } satisfies SummonState); }

  observe(fn: () => void) { this.map.observe(fn); return () => this.map.unobserve(fn); }
}

/** Milliseconds left on a timer, never below zero. `serverNow` is the server clock as this browser estimates it. */
export function timerRemaining(t: TimerState | undefined, serverNow: number): number {
  return t ? Math.max(0, t.endsAt - serverNow) : 0;
}

/** Shows a duration as m:ss, or h:mm:ss from an hour up. */
export function formatDuration(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/**
 * Estimates the gap between this browser's clock and the server's from one round trip. Add the result to
 * `Date.now()` to get server time. The server's reading is taken to be halfway through the trip.
 */
export function clockOffset(sentAt: number, serverNow: number, receivedAt: number): number {
  return serverNow - (sentAt + receivedAt) / 2;
}

/** The reactions a participant can send (WSH-6). A fixed list keeps arbitrary text out of other people's screens. */
export const REACTIONS = [
  { emoji: "👍", label: "Thumbs up" }, { emoji: "👏", label: "Applause" }, { emoji: "❤️", label: "Heart" },
  { emoji: "🎉", label: "Celebrate" }, { emoji: "🤔", label: "Thinking" }, { emoji: "👀", label: "Eyes" },
] as const;

export const isReaction = (v: unknown): v is (typeof REACTIONS)[number]["emoji"] => REACTIONS.some((r) => r.emoji === v);

/** How long a reaction stays on screen, in milliseconds. */
export const REACTION_TTL_MS = 4000;

export interface ReactionEvent { clientId: number; name: string; emoji: string; at: number }

/**
 * Finds the reactions in awareness states that the viewer hasn't shown yet. `seen` maps each client to the time of the
 * last reaction shown, so a reaction shows once. Reactions older than the time to live, from the future, or with an
 * emoji outside the list are dropped. `skip` is the viewer's own client, whose reactions show locally.
 */
export function freshReactions(
  states: ReadonlyMap<number, { user?: { name?: string }; reaction?: { emoji?: unknown; at?: unknown } }>,
  seen: Map<number, number>, now: number, skip?: number,
): ReactionEvent[] {
  const out: ReactionEvent[] = [];
  for (const [clientId, s] of states) {
    const r = s.reaction;
    if (clientId === skip || !r || typeof r.at !== "number" || !isReaction(r.emoji)) continue;
    // Other people's clocks can differ, so allow some drift before calling a time stale or in the future.
    if (r.at <= (seen.get(clientId) ?? 0)) continue;
    seen.set(clientId, r.at);
    if (Math.abs(now - r.at) > REACTION_TTL_MS * 4) continue;
    out.push({ clientId, name: String(s.user?.name ?? "Someone").slice(0, 60), emoji: r.emoji, at: r.at });
  }
  return out;
}

/**
 * Whether a person sees an object while private mode is on (WSH-7). The facilitator sees everything. Everyone else sees
 * their own content and what the facilitator added, which includes frames and prompts. Content with no author counts as the facilitator's.
 */
export function visibleInPrivateMode(o: { by?: string }, me: string, facilitator: string): boolean {
  return me === facilitator || !o.by || o.by === me || o.by === facilitator;
}
