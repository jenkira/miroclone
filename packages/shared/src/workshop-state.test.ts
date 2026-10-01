import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { clockOffset, formatDuration, freshReactions, isReaction, timerRemaining, Workshop } from "./workshop-state.js";

describe("timer", () => {
  it("counts down to zero and stays there", () => {
    const w = new Workshop(new Y.Doc());
    w.startTimer(60_000, 1_000_000, "Ann");
    expect(timerRemaining(w.timer, 1_000_000)).toBe(60_000);
    expect(timerRemaining(w.timer, 1_030_000)).toBe(30_000);
    expect(timerRemaining(w.timer, 1_100_000)).toBe(0);
    w.stopTimer();
    expect(timerRemaining(w.timer, 1_000_000)).toBe(0);
  });
  it("rejects a duration outside one second to 24 hours", () => {
    const w = new Workshop(new Y.Doc());
    for (const d of [0, 999, -5, NaN, 25 * 3600_000]) expect(() => w.startTimer(d, 0, "Ann")).toThrow();
  });
  it("reaches other users' documents, so everyone sees the same end time", () => {
    const a = new Y.Doc(), b = new Y.Doc();
    a.on("update", (u: Uint8Array) => Y.applyUpdate(b, u));
    new Workshop(a).startTimer(90_000, 5_000, "Ann");
    expect(new Workshop(b).timer).toEqual({ endsAt: 95_000, durationMs: 90_000, startedBy: "Ann" });
  });
});

describe("clock agreement", () => {
  /** One round trip to the server, for a browser whose clock is `skew` ms ahead of the true time. */
  function measure(skew: number, trueSend: number, tripMs: number) {
    const sentAt = trueSend + skew;                         // the browser's clock when it asks
    const serverNow = trueSend + tripMs / 2;                // the server reads its clock halfway through
    const receivedAt = trueSend + tripMs + skew;            // the browser's clock when the answer arrives
    return { offset: clockOffset(sentAt, serverNow, receivedAt), receivedAt };
  }

  it("lets browsers with different clocks recover the same true time", () => {
    const trueAfter = (trueSend: number, tripMs: number) => trueSend + tripMs;
    for (const skew of [3_000, -7_000, 0, 120_000]) {
      const m = measure(skew, 1_000_000, 200);
      // At the moment the answer arrives, offset plus the browser's clock gives the server's time then.
      expect(m.receivedAt + m.offset).toBe(trueAfter(1_000_000, 200));
    }
  });

  it("makes two browsers show the same time left on a timer", () => {
    const w = new Workshop(new Y.Doc());
    w.startTimer(60_000, 5_000_000, "Ann");                 // started at true time 5,000,000
    const ann = measure(3_000, 5_010_000, 100), bob = measure(-7_000, 5_010_000, 300);
    const left = (m: { offset: number; receivedAt: number }, browserNow: number) => timerRemaining(w.timer, browserNow + m.offset);
    // Ten seconds later by each browser's own clock, both report about 40 s left, despite 10 s of skew between them.
    const a = left(ann, ann.receivedAt + 10_000), b = left(bob, bob.receivedAt + 10_000);
    expect(Math.abs(a - b)).toBeLessThan(300);
    expect(a).toBeGreaterThan(39_000); expect(b).toBeGreaterThan(38_500);
  });

  it("finds the offset from the middle of the round trip", () => {
    expect(clockOffset(1000, 5000, 1200)).toBe(3900);
    expect(clockOffset(1000, 1100, 1200)).toBe(0);
  });
});

describe("presentation and summon", () => {
  it("tracks the presenter and current slide, and ends", () => {
    const w = new Workshop(new Y.Doc());
    w.startPresenting("Ann");
    expect(w.present).toEqual({ by: "Ann", frameId: null, index: 0 });
    w.setSlide(2, "f3");
    expect(w.present).toEqual({ by: "Ann", frameId: "f3", index: 2 });
    w.stopPresenting();
    expect(w.present).toBeUndefined();
    w.setSlide(1, "x");                         // no effect when nobody is presenting
    expect(w.present).toBeUndefined();
  });
  it("records a summon with its time", () => {
    const w = new Workshop(new Y.Doc());
    w.summonTo(10, 20, 1.5, "Ann", 999);
    expect(w.summon).toEqual({ x: 10, y: 20, zoom: 1.5, by: "Ann", at: 999 });
  });
  it("tells observers when state changes", () => {
    const w = new Workshop(new Y.Doc()); let n = 0;
    const off = w.observe(() => n++);
    w.startPresenting("Ann"); w.stopPresenting();
    off(); w.startPresenting("Ann");
    expect(n).toBe(2);
  });
});

describe("formatDuration", () => {
  it("shows minutes and seconds, and hours from an hour", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(59_100)).toBe("1:00");
    expect(formatDuration(61_000)).toBe("1:01");
    expect(formatDuration(3_600_000)).toBe("1:00:00");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
  });
});

describe("reactions (WSH-6)", () => {
  const states = (o: Record<number, unknown>) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v])) as never;
  it("accepts only the listed emoji", () => {
    expect(isReaction("👍")).toBe(true);
    expect(isReaction("<script>")).toBe(false);
    expect(isReaction("👍👍")).toBe(false);
  });
  it("returns each reaction once, with the sender's name", () => {
    const seen = new Map<number, number>();
    const s = states({ 2: { user: { name: "Ann" }, reaction: { emoji: "🎉", at: 1000 } } });
    expect(freshReactions(s, seen, 1500)).toEqual([{ clientId: 2, name: "Ann", emoji: "🎉", at: 1000 }]);
    expect(freshReactions(s, seen, 1600)).toEqual([]);
    const again = states({ 2: { user: { name: "Ann" }, reaction: { emoji: "👏", at: 2000 } } });
    expect(freshReactions(again, seen, 2100)).toHaveLength(1);
  });
  it("skips the viewer's own client, junk, and stale reactions", () => {
    const s = states({
      1: { reaction: { emoji: "👍", at: 1000 } },
      2: { reaction: { emoji: "💣", at: 1000 } },
      3: { reaction: { emoji: "👍", at: "now" } },
      4: { reaction: { emoji: "👍", at: 1 } },
      5: { user: { name: "x".repeat(200) }, reaction: { emoji: "👀", at: 100_000 } },
    });
    const r = freshReactions(s, new Map(), 100_500, 1);
    expect(r.map((x) => x.clientId)).toEqual([5]);
    expect(r[0]!.name).toHaveLength(60);
  });
});
