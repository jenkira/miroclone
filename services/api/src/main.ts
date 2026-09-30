import { buildApp } from "./app.js";
import { EntraOidcClient } from "./oidc.js";
import { MemorySessionStore, SessionManager } from "./session.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

const tenantId = required("ENTRA_TENANT_ID");
const oidc = new EntraOidcClient({
  tenantId,
  clientId: required("ENTRA_CLIENT_ID"),
  clientSecret: required("ENTRA_CLIENT_SECRET"),
  redirectUri: required("ENTRA_REDIRECT_URI"),
});

// R0 uses the memory store. The Redis store replaces it when persistence lands.
const app = buildApp({
  tenantId,
  oidc,
  sessions: new SessionManager(new MemorySessionStore()),
  secureCookies: process.env.INSECURE_COOKIES !== "1",
});
await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
