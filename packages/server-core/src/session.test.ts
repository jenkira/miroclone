import { describe, expect, it } from "vitest";
import { MemorySessionStore, SessionManager } from "./session.js";

const user = { userId: "u", name: "U", isAdmin: false, groups: ["g"] };

function manager() {
  const clock = { t: 0 };
  const m = new SessionManager(new MemorySessionStore(), { idleSeconds: 60, maxLifetimeSeconds: 600 }, () => clock.t);
  return { m, clock };
}

describe("SessionManager", () => {
  it("issues unguessable ids", async () => {
    const { m } = manager();
    const [a, b] = [await m.create(user), await m.create(user)];
    expect(a.id).not.toBe(b.id);
    expect(a.id.length).toBeGreaterThanOrEqual(43);
  });

  it("ends an idle session and refreshes an active one", async () => {
    const { m, clock } = manager();
    const s = await m.create(user);
    clock.t = 59; expect(await m.touch(s.id)).toBeDefined();
    clock.t = 118; expect(await m.touch(s.id)).toBeDefined();
    clock.t = 200; expect(await m.touch(s.id)).toBeUndefined();
  });

  it("ends a session at the maximum lifetime even when active", async () => {
    const { m, clock } = manager();
    const s = await m.create(user);
    for (clock.t = 50; clock.t < 600; clock.t += 50) expect(await m.touch(s.id)).toBeDefined();
    clock.t = 601; expect(await m.touch(s.id)).toBeUndefined();
  });

  it("uses each auth transaction once", async () => {
    const { m } = manager();
    await m.putTx("s", { codeVerifier: "v", nonce: "n", expiresAt: 1 });
    expect(await m.takeTx("s")).toBeDefined();
    expect(await m.takeTx("s")).toBeUndefined();
  });
});
