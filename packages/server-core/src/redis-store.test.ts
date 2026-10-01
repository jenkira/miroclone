import type { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import { RedisSessionStore } from "./redis-store.js";
import type { Session } from "./session.js";

/** The few Redis commands the store uses, backed by a map. */
function fakeRedis() {
  const data = new Map<string, { v: string; ex: number }>();
  const r = {
    get: async (k: string) => data.get(k)?.v ?? null,
    set: async (k: string, v: string, _ex: string, ttl: number) => { data.set(k, { v, ex: ttl }); return "OK"; },
    del: async (k: string) => data.delete(k),
    getdel: async (k: string) => { const v = data.get(k)?.v ?? null; data.delete(k); return v; },
  };
  return { redis: r as unknown as Redis, data };
}

const now = () => Math.floor(Date.now() / 1000);
const session = (over: Partial<Session> = {}): Session =>
  ({ id: "secret-session-id", userId: "u", name: "U", isAdmin: false, groups: [], createdAt: now(), lastSeenAt: now(), ...over });

describe("RedisSessionStore", () => {
  it("round-trips a session", async () => {
    const { redis } = fakeRedis();
    const store = new RedisSessionStore(redis, 600);
    await store.put(session());
    expect(await store.get("secret-session-id")).toMatchObject({ id: "secret-session-id", userId: "u" });
    expect(await store.get("other")).toBeUndefined();
  });

  it("never writes the session ID to Redis, in a key or a value", async () => {
    const { redis, data } = fakeRedis();
    await new RedisSessionStore(redis, 600).put(session());
    for (const [k, { v }] of data) {
      expect(k).not.toContain("secret-session-id");
      expect(v).not.toContain("secret-session-id");
    }
  });

  it("expires the key at the session's maximum lifetime, not later", async () => {
    const { redis, data } = fakeRedis();
    await new RedisSessionStore(redis, 600).put(session({ createdAt: now() - 500 }));
    expect([...data.values()][0]!.ex).toBeLessThanOrEqual(100);
  });

  it("deletes a session", async () => {
    const { redis } = fakeRedis();
    const store = new RedisSessionStore(redis, 600);
    await store.put(session());
    await store.delete("secret-session-id");
    expect(await store.get("secret-session-id")).toBeUndefined();
  });

  it("uses a sign-in transaction once", async () => {
    const { redis } = fakeRedis();
    const store = new RedisSessionStore(redis, 600);
    await store.putTx("state-1", { codeVerifier: "v", nonce: "n", expiresAt: 1 });
    expect(await store.takeTx("state-1")).toBeDefined();
    expect(await store.takeTx("state-1")).toBeUndefined();
  });
});
