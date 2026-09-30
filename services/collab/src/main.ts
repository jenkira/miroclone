import { Redis } from "ioredis";
import pg from "pg";
import { defaultSessionPolicy, RedisSessionStore, SessionManager } from "@miroclone/server-core";
import { createCollabServer } from "./server.js";
import { sessionResolver } from "./resolver.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

const db = new pg.Pool({
  host: required("POSTGRES_HOST"),
  database: required("POSTGRES_DB"),
  user: required("POSTGRES_USER"),
  password: required("POSTGRES_PASSWORD"),
  ssl: process.env.POSTGRES_SSL === "0" ? false : { rejectUnauthorized: true },
});
const redis = new Redis({ host: required("REDIS_HOST"), password: process.env.REDIS_PASSWORD });
const sessions = new SessionManager(new RedisSessionStore(redis, defaultSessionPolicy.maxLifetimeSeconds));

const port = Number(process.env.PORT ?? 1234);
await createCollabServer({ port, db, resolver: sessionResolver(sessions, db) }).listen();
console.log(JSON.stringify({ level: "info", msg: "collab listening", port }));
