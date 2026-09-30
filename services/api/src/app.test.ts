import { describe, expect, it } from "vitest";
import type { EntraClaims } from "@miroclone/shared";
import { buildApp, SESSION_COOKIE } from "./app.js";
import { pkceChallenge, type OidcClient } from "./oidc.js";
import { MemorySessionStore, SessionManager } from "./session.js";

const good: EntraClaims = { oid: "u1", tid: "t1", name: "Una", roles: ["Whiteboard.User"], amr: ["pwd", "mfa"] };

function setup(claims: EntraClaims | Error, now = { t: 1000 }) {
  let challenge = "";
  const oidc: OidcClient = {
    authorizationUrl: (p) => { challenge = p.codeChallenge; return `https://idp.test/auth?state=${p.state}`; },
    exchange: async () => { if (claims instanceof Error) throw claims; return claims; },
  };
  const sessions = new SessionManager(new MemorySessionStore(), { idleSeconds: 60, maxLifetimeSeconds: 600 }, () => now.t);
  const app = buildApp({ tenantId: "t1", oidc, sessions, secureCookies: true });
  return { app, now, getChallenge: () => challenge };
}

async function signIn(app: ReturnType<typeof buildApp>) {
  const login = await app.inject("/auth/login");
  const state = new URL(login.headers.location as string).searchParams.get("state")!;
  return app.inject(`/auth/callback?code=c&state=${state}`);
}

describe("sign-in", () => {
  it("redirects to Entra with an S256 PKCE challenge", async () => {
    const { app, getChallenge } = setup(good);
    const res = await app.inject("/auth/login");
    expect(res.statusCode).toBe(302);
    expect(getChallenge()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkceChallenge("abc")).toBe("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
  });

  it("creates a session with a secure HttpOnly cookie", async () => {
    const { app } = setup(good);
    const res = await signIn(app);
    expect(res.statusCode).toBe(302);
    const c = res.cookies.find((x) => x.name === SESSION_COOKIE)!;
    expect(c.httpOnly).toBe(true);
    expect(c.secure).toBe(true);
    expect(c.sameSite).toBe("Lax");
    const me = await app.inject({ url: "/api/me", cookies: { [SESSION_COOKIE]: c.value } });
    expect(me.json().id).toBe("u1");
  });

  it("rejects an unknown state and replays", async () => {
    const { app } = setup(good);
    expect((await app.inject("/auth/callback?code=c&state=nope")).statusCode).toBe(400);
    const login = await app.inject("/auth/login");
    const state = new URL(login.headers.location as string).searchParams.get("state")!;
    await app.inject(`/auth/callback?code=c&state=${state}`);
    expect((await app.inject(`/auth/callback?code=c&state=${state}`)).statusCode).toBe(400);
  });

  it.each([
    [{ ...good, tid: "other" }, "tenant"],
    [{ ...good, roles: [] }, "role"],
    [{ ...good, amr: ["pwd"] }, "mfa"],
  ])("blocks %#", async (claims, reason) => {
    const { app } = setup(claims as EntraClaims);
    const res = await signIn(app);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe(reason);
    expect(res.cookies).toHaveLength(0);
  });

  it("returns 401 when token validation fails", async () => {
    const { app } = setup(new Error("bad signature"));
    expect((await signIn(app)).statusCode).toBe(401);
  });
});

describe("session lifetime", () => {
  it("ends after the idle period and after the maximum lifetime", async () => {
    const { app, now } = setup(good);
    const c = (await signIn(app)).cookies[0]!;
    const hit = () => app.inject({ url: "/api/me", cookies: { [SESSION_COOKIE]: c.value } });
    now.t += 50; expect((await hit()).statusCode).toBe(200);
    now.t += 50; expect((await hit()).statusCode).toBe(200); // idle timer refreshed
    now.t += 500; expect((await hit()).statusCode).toBe(401); // past max lifetime
  });

  it("ends the session on logout", async () => {
    const { app } = setup(good);
    const c = (await signIn(app)).cookies[0]!;
    await app.inject({ method: "POST", url: "/auth/logout", cookies: { [SESSION_COOKIE]: c.value } });
    expect((await app.inject({ url: "/api/me", cookies: { [SESSION_COOKIE]: c.value } })).statusCode).toBe(401);
  });
});

describe("health", () => {
  it("serves health", async () => {
    expect((await setup(good).app.inject("/healthz")).statusCode).toBe(200);
  });
});
