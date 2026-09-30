import pg from "pg";
import { migrate } from "@miroclone/server-core";
import { buildApp } from "./app.js";
import { GraphClient } from "./graph.js";
import { EntraOidcClient } from "./oidc.js";
import { Redis } from "ioredis";
import { defaultSessionPolicy, parseKey, RedisSessionStore, SessionManager } from "@miroclone/server-core";

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
  // Optional. Sovereign clouds use another authority, and local development uses a fake identity provider.
  authority: process.env.ENTRA_AUTHORITY,
});

const db = new pg.Pool({
  host: required("POSTGRES_HOST"),
  port: process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : undefined,
  database: required("POSTGRES_DB"),
  user: required("POSTGRES_USER"),
  password: required("POSTGRES_PASSWORD"),
  ssl: process.env.POSTGRES_SSL === "0" ? false : { rejectUnauthorized: true },
});
await migrate(db);

const redis = new Redis({ host: required("REDIS_HOST"), port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379, password: process.env.REDIS_PASSWORD });
const app = buildApp({
  tenantId,
  oidc,
  db,
  graph: new GraphClient(fetch, process.env.GRAPH_BASE_URL),
  tokenKey: parseKey(required("SESSION_ENCRYPTION_KEY")),
  sessions: new SessionManager(new RedisSessionStore(redis, defaultSessionPolicy.maxLifetimeSeconds)),
  secureCookies: process.env.INSECURE_COOKIES !== "1",
});
await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });

process.once("SIGTERM", async () => { await app.close(); await db.end(); redis.disconnect(); process.exit(0); });
