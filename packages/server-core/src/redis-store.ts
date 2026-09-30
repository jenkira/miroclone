import type { Redis } from "ioredis";
import type { AuthTransaction, Session, SessionStore } from "./session.js";

/**
 * Stores sessions in Redis, shared by the API and collaboration services.
 * Keys expire after the maximum lifetime, so abandoned sessions clear themselves.
 */
export class RedisSessionStore implements SessionStore {
  constructor(private redis: Redis, private maxLifetimeSeconds: number, private txTtlSeconds = 600) {}

  async get(id: string) {
    const v = await this.redis.get(`sess:${id}`);
    return v ? (JSON.parse(v) as Session) : undefined;
  }
  async put(s: Session) {
    await this.redis.set(`sess:${s.id}`, JSON.stringify(s), "EX", this.maxLifetimeSeconds);
  }
  async delete(id: string) { await this.redis.del(`sess:${id}`); }
  async putTx(state: string, tx: AuthTransaction) {
    await this.redis.set(`tx:${state}`, JSON.stringify(tx), "EX", this.txTtlSeconds);
  }
  async takeTx(state: string) {
    const v = await this.redis.getdel(`tx:${state}`);
    return v ? (JSON.parse(v) as AuthTransaction) : undefined;
  }
}
