import { Redis } from "ioredis";
import pg from "pg";
import { createRegistry, defaultSessionPolicy, initTracing, RedisSessionStore, serveMetrics, SessionManager } from "@miroclone/server-core";
import { createCollabServer } from "./server.js";
import { sessionResolver } from "./resolver.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

const db = new pg.Pool({
  host: required("POSTGRES_HOST"),
  port: process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : undefined,
  database: required("POSTGRES_DB"),
  user: required("POSTGRES_USER"),
  password: required("POSTGRES_PASSWORD"),
  ssl: process.env.POSTGRES_SSL === "0" ? false : { rejectUnauthorized: true },
});
const redis = new Redis({ host: required("REDIS_HOST"), port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379, password: process.env.REDIS_PASSWORD });
const sessions = new SessionManager(new RedisSessionStore(redis, defaultSessionPolicy.maxLifetimeSeconds));

const port = Number(process.env.PORT ?? 1234);
const registry = createRegistry("collab");
const tracing = initTracing("miroclone-collab");
const server = createCollabServer({ port, db, resolver: sessionResolver(sessions, db), registry, tracing });
// Metrics use their own port. The Service and the ingress never route to it.
const metricsServer = serveMetrics(registry, Number(process.env.METRICS_PORT ?? 9464));
await server.listen();
console.log(JSON.stringify({ level: "info", msg: "collab listening", port }));

// Rolling updates send SIGTERM. Closing the server flushes open documents and closes sockets,
// and clients reconnect to another pod without losing changes (section 7.2).
process.once("SIGTERM", async () => {
  console.log(JSON.stringify({ level: "info", msg: "draining" }));
  metricsServer.close();
  await tracing.shutdown();
  await server.destroy();
  await db.end();
  redis.disconnect();
  process.exit(0);
});
