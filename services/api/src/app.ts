import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { validateClaims, type EntraClaims } from "@miroclone/shared";
import { sealTokens } from "@miroclone/server-core";
import type { GraphClient } from "./graph.js";
import type { ObjectStore } from "@miroclone/server-core";
import type { Scanner } from "./scanner.js";
import { audit } from "./audit.js";
import { pkceChallenge, pkceVerifier, type OidcClient } from "./oidc.js";
import { newId, SESSION_COOKIE, SessionManager } from "@miroclone/server-core";
export { SESSION_COOKIE };
import { upsertUser } from "./boards.js";
import type { Db } from "@miroclone/server-core";
import { boardRoutes, type ExportPolicy } from "./routes.js";

export interface AppOptions {
  tenantId: string;
  oidc: OidcClient;
  sessions: SessionManager;
  db: Db;
  /** Set false only for local development over HTTP. */
  secureCookies?: boolean;
  exportPolicy?: ExportPolicy;
  graph: GraphClient;
  /** Object storage and scanner for file uploads. Uploads are refused unless both exist. */
  store?: ObjectStore;
  scanner?: Scanner;
  /** Key for encrypting Graph tokens in the session store (32 bytes). */
  tokenKey: Buffer;
  txTtlSeconds?: number;
}

export function buildApp(opts: AppOptions) {
  const app = Fastify({ logger: true });
  app.register(cookie);
  const secure = opts.secureCookies ?? true;
  const cookieOpts = { httpOnly: true, secure, sameSite: "lax" as const, path: "/" };

  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/readyz", async () => ({ status: "ready" }));

  app.get("/auth/login", async (_req, reply) => {
    const state = newId();
    const nonce = newId();
    const codeVerifier = pkceVerifier();
    await opts.sessions.putTx(state, {
      codeVerifier,
      nonce,
      expiresAt: Math.floor(Date.now() / 1000) + (opts.txTtlSeconds ?? 600),
    });
    return reply.redirect(
      opts.oidc.authorizationUrl({ state, nonce, codeChallenge: pkceChallenge(codeVerifier) }),
    );
  });

  app.get<{ Querystring: { code?: string; state?: string } }>("/auth/callback", async (req, reply) => {
    const { code, state } = req.query;
    if (!code || !state) return reply.code(400).send({ error: "bad_request" });
    const tx = await opts.sessions.takeTx(state);
    if (!tx || tx.expiresAt < Math.floor(Date.now() / 1000))
      return reply.code(400).send({ error: "invalid_state" });

    let claims: EntraClaims;
    let tokens: Awaited<ReturnType<OidcClient["exchange"]>>["tokens"];
    try {
      ({ claims, tokens } = await opts.oidc.exchange({ code, codeVerifier: tx.codeVerifier, nonce: tx.nonce }));
    } catch (err) {
      req.log.warn({ err }, "token exchange failed");
      audit({ action: "sign_in", actor: "unknown", detail: { allowed: false, reason: "token" } });
      return reply.code(401).send({ error: "token_invalid" });
    }

    const result = validateClaims(claims, { tenantId: opts.tenantId });
    if (!result.ok) {
      audit({ action: "sign_in", actor: claims.oid ?? "unknown", detail: { allowed: false, reason: result.reason } });
      return reply.code(403).send({ error: result.reason });
    }
    // A user in more than 200 groups gets no group list in the token. Resolve it through Graph (IAM-9).
    let groups = claims.groups ?? [];
    if (claims._claim_names?.groups) {
      try { groups = await opts.graph.memberGroups(tokens.accessToken); }
      catch (err) {
        req.log.error({ err }, "group overage lookup failed");
        return reply.code(503).send({ error: "groups_unavailable" });
      }
    }
    await upsertUser(opts.db, {
      id: claims.oid,
      tenantId: claims.tid,
      name: claims.name ?? claims.preferred_username ?? claims.oid,
      email: claims.email ?? claims.preferred_username,
    });
    const session = await opts.sessions.create({
      userId: claims.oid,
      name: claims.name ?? claims.preferred_username ?? claims.oid,
      email: claims.email ?? claims.preferred_username,
      isAdmin: result.isAdmin,
      groups,
      graph: sealTokens(tokens, opts.tokenKey),
    });
    audit({ action: "sign_in", actor: claims.oid, detail: { allowed: true } });
    reply.setCookie(SESSION_COOKIE, session.id, cookieOpts);
    return reply.redirect("/");
  });

  app.post("/auth/logout", async (req, reply) => {
    const id = req.cookies[SESSION_COOKIE];
    if (id) await opts.sessions.destroy(id);
    reply.clearCookie(SESSION_COOKIE, cookieOpts);
    return { ok: true };
  });

  app.get("/api/me", async (req, reply) => {
    const s = await opts.sessions.touch(req.cookies[SESSION_COOKIE]);
    if (!s) return reply.code(401).send({ error: "unauthenticated" });
    return { id: s.userId, name: s.name, email: s.email, isAdmin: s.isAdmin };
  });

  boardRoutes(app, opts);
  return app;
}
