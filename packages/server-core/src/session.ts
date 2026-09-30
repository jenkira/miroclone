import { randomBytes } from "node:crypto";

export const SESSION_COOKIE = "mc_session";

export interface Session {
  id: string;
  userId: string;
  name: string;
  email?: string;
  isAdmin: boolean;
  groups: string[];
  /** Graph tokens, encrypted. Never sent to the browser. */
  graph?: string;
  createdAt: number;
  lastSeenAt: number;
}

export interface AuthTransaction {
  codeVerifier: string;
  nonce: string;
  expiresAt: number;
}

/** Session storage. Production uses Redis (section 8.1); tests use memory. */
export interface SessionStore {
  get(id: string): Promise<Session | undefined>;
  put(session: Session): Promise<void>;
  delete(id: string): Promise<void>;
  putTx(state: string, tx: AuthTransaction): Promise<void>;
  takeTx(state: string): Promise<AuthTransaction | undefined>;
}

export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, Session>();
  private txs = new Map<string, AuthTransaction>();
  async get(id: string) { return this.sessions.get(id); }
  async put(s: Session) { this.sessions.set(s.id, s); }
  async delete(id: string) { this.sessions.delete(id); }
  async putTx(state: string, tx: AuthTransaction) { this.txs.set(state, tx); }
  async takeTx(state: string) {
    const tx = this.txs.get(state);
    this.txs.delete(state);
    return tx;
  }
}

export interface SessionPolicy {
  /** Seconds without activity before the session ends (IAM-10). */
  idleSeconds: number;
  /** Seconds from sign-in before the session always ends (IAM-10). */
  maxLifetimeSeconds: number;
}

export const defaultSessionPolicy: SessionPolicy = {
  idleSeconds: 30 * 60,
  maxLifetimeSeconds: 8 * 60 * 60,
};

export const newId = () => randomBytes(32).toString("base64url");

export class SessionManager {
  constructor(
    private store: SessionStore,
    private policy: SessionPolicy = defaultSessionPolicy,
    private now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  async create(user: Pick<Session, "userId" | "name" | "email" | "isAdmin" | "groups" | "graph">): Promise<Session> {
    const t = this.now();
    const s: Session = { ...user, id: newId(), createdAt: t, lastSeenAt: t };
    await this.store.put(s);
    return s;
  }

  /** Returns the session if it's live, and refreshes its idle timer. */
  async touch(id: string | undefined): Promise<Session | undefined> {
    if (!id) return undefined;
    const s = await this.store.get(id);
    if (!s) return undefined;
    const t = this.now();
    if (t - s.lastSeenAt > this.policy.idleSeconds || t - s.createdAt > this.policy.maxLifetimeSeconds) {
      await this.store.delete(id);
      return undefined;
    }
    s.lastSeenAt = t;
    await this.store.put(s);
    return s;
  }

  /** Replaces the sealed Graph tokens, for example after a refresh. */
  async setGraph(id: string, graph: string): Promise<void> {
    const s = await this.store.get(id);
    if (s) await this.store.put({ ...s, graph });
  }

  destroy(id: string) { return this.store.delete(id); }
  putTx(state: string, tx: AuthTransaction) { return this.store.putTx(state, tx); }
  takeTx(state: string) { return this.store.takeTx(state); }
}
