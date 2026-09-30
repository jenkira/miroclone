import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import type { AuthTransaction, Session, SessionStore } from "./session.js";

/** Redis keys use a hash of the session ID, so a read of Redis doesn't reveal a value that works as a cookie. */
const digest = (id: string) => createHash("sha256").update(id).digest("base64url");

/**
 * Stores sessions in Redis, shared by the API and collaboration services.
 * Keys expire after the maximum lifetime, so abandoned sessions clear themselves.
 */
export class RedisSessionStore implements SessionStore {
  constructor(private redis: Redis, private maxLifetimeSeconds: number, private txTtlSeconds = 600) {}

  async get(id: string) {
    const v = await this.redis.get(`sess:${digest(id)}`);
    // The ID isn't stored in the value, so it's added back from the lookup key.
    return v ? ({ ...JSON.parse(v), id } as Session) : undefined;
  }
  async put(s: Session) {
    const { id, ...rest } = s;
    // The remaining lifetime shrinks as the session ages, so the key never outlives the maximum.
    const left = Math.max(1, this.maxLifetimeSeconds - (Math.floor(Date.now() / 1000) - s.createdAt));
    await this.redis.set(`sess:${digest(id)}`, JSON.stringify(rest), "EX", left);
  }
  async delete(id: string) { await this.redis.del(`sess:${digest(id)}`); }
  async putTx(state: string, tx: AuthTransaction) {
    await this.redis.set(`tx:${digest(state)}`, JSON.stringify(tx), "EX", this.txTtlSeconds);
  }
  async takeTx(state: string) {
    const v = await this.redis.getdel(`tx:${digest(state)}`);
    return v ? (JSON.parse(v) as AuthTransaction) : undefined;
  }
}
