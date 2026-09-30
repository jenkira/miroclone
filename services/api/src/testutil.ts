import { PGlite } from "@electric-sql/pglite";
import type { EntraClaims } from "@miroclone/shared";
import { randomBytes } from "node:crypto";
import { buildApp, type AppOptions } from "./app.js";
import { GraphClient } from "./graph.js";
import { migrate, type Db } from "@miroclone/server-core";
import type { OidcClient } from "./oidc.js";
import { MemorySessionStore, SessionManager } from "@miroclone/server-core";

/** Fake Graph. Every request is recorded, so tests can check the token that was used. */
export const graphCalls: { url: string; auth: string }[] = [];
export const graphFetch = (async (url: string, init: RequestInit) => {
  graphCalls.push({ url, auth: (init.headers as Record<string, string>).authorization! });
  if (url.includes("/users?")) return new Response(JSON.stringify({ value: [{ id: "u-eng", displayName: "Eng Person", mail: "eng@x.test" }] }));
  if (url.includes("/groups?")) return new Response(JSON.stringify({ value: [{ id: "g-eng", displayName: "Engineering" }] }));
  if (url.includes("transitiveMemberOf")) return new Response(JSON.stringify({ value: [{ id: "g-big-1" }, { id: "g-big-2" }] }));
  return new Response("", { status: 404 });
}) as unknown as typeof fetch;

export const db = new PGlite() as unknown as Db;
await migrate(db);

export function setup(claims: EntraClaims | Error, now = { t: 1000 }, extra: Partial<AppOptions> = {}, tokenTtl = 3600) {
  let challenge = "";
  const oidc: OidcClient = {
    authorizationUrl: (p) => { challenge = p.codeChallenge; return `https://idp.test/auth?state=${p.state}`; },
    exchange: async () => { if (claims instanceof Error) throw claims; return { claims, tokens: { accessToken: "graph-at", refreshToken: "graph-rt", expiresAt: Math.floor(Date.now() / 1000) + tokenTtl } }; },
    refresh: async () => ({ accessToken: "graph-at-2", expiresAt: Math.floor(Date.now() / 1000) + 3600 }),
  };
  const sessions = new SessionManager(new MemorySessionStore(), { idleSeconds: 60, maxLifetimeSeconds: 600 }, () => now.t);
  const app = buildApp({ tenantId: "t1", oidc, sessions, db, secureCookies: true, graph: new GraphClient(graphFetch), tokenKey: randomBytes(32), ...extra });
  return { app, now, getChallenge: () => challenge };
}

export async function signIn(app: ReturnType<typeof buildApp>) {
  const login = await app.inject("/auth/login");
  const state = new URL(login.headers.location as string).searchParams.get("state")!;
  return app.inject(`/auth/callback?code=c&state=${state}`);
}

