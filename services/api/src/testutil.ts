import { PGlite } from "@electric-sql/pglite";
import type { EntraClaims } from "@miroclone/shared";
import { buildApp, type AppOptions } from "./app.js";
import { migrate, type Db } from "@miroclone/server-core";
import type { OidcClient } from "./oidc.js";
import { MemorySessionStore, SessionManager } from "@miroclone/server-core";

export const db = new PGlite() as unknown as Db;
await migrate(db);

export function setup(claims: EntraClaims | Error, now = { t: 1000 }, extra: Partial<AppOptions> = {}) {
  let challenge = "";
  const oidc: OidcClient = {
    authorizationUrl: (p) => { challenge = p.codeChallenge; return `https://idp.test/auth?state=${p.state}`; },
    exchange: async () => { if (claims instanceof Error) throw claims; return claims; },
  };
  const sessions = new SessionManager(new MemorySessionStore(), { idleSeconds: 60, maxLifetimeSeconds: 600 }, () => now.t);
  const app = buildApp({ tenantId: "t1", oidc, sessions, db, secureCookies: true, ...extra });
  return { app, now, getChallenge: () => challenge };
}

export async function signIn(app: ReturnType<typeof buildApp>) {
  const login = await app.inject("/auth/login");
  const state = new URL(login.headers.location as string).searchParams.get("state")!;
  return app.inject(`/auth/callback?code=c&state=${state}`);
}

