import { createServer } from "node:http";
import pg from "pg";
import { migrate, purgeExpiredBoards, S3ObjectStore } from "@miroclone/server-core";
import { sendPendingEmails, type Mailer } from "./email.js";
import { SmtpMailer } from "./smtp.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}
const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ level: "info", msg, ...extra }));

const db = new pg.Pool({
  host: required("POSTGRES_HOST"),
  port: process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : undefined,
  database: required("POSTGRES_DB"),
  user: required("POSTGRES_USER"),
  password: required("POSTGRES_PASSWORD"),
  ssl: process.env.POSTGRES_SSL === "0" ? false : { rejectUnauthorized: true },
});
await migrate(db);

const store = process.env.S3_BUCKET
  ? new S3ObjectStore({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? "us-east-1",
      bucket: process.env.S3_BUCKET,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "0",
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    })
  : undefined;

// Without a relay, notifications stay in the app only.
const mailer: Mailer | undefined = process.env.SMTP_HOST
  ? new SmtpMailer({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      from: required("SMTP_FROM"),
      user: process.env.SMTP_USER,
      password: process.env.SMTP_PASSWORD,
      requireTls: process.env.SMTP_TLS !== "0",
    })
  : undefined;
const appUrl = process.env.APP_URL;

let running = true;
const every = (name: string, ms: number, job: () => Promise<unknown>) => {
  const tick = async () => {
    try { const r = await job(); if (r && JSON.stringify(r) !== JSON.stringify({ sent: 0, failed: 0, skipped: 0 })) log(name, r as Record<string, unknown>); }
    catch (err) { console.error(JSON.stringify({ level: "error", msg: `${name} failed`, err: String(err) })); }
  };
  void tick();
  return setInterval(() => { if (running) void tick(); }, ms);
};

const timers = [
  ...(mailer && appUrl ? [every("emails", 30_000, () => sendPendingEmails(db, mailer, appUrl))] : []),
  every("purge", 60 * 60 * 1000, () => purgeExpiredBoards(db, store)),
];

// A small HTTP endpoint for the Kubernetes probes.
const health = createServer((_req, res) => res.writeHead(running ? 200 : 503).end(running ? "ok" : "stopping"));
health.listen(Number(process.env.PORT ?? 8081), "0.0.0.0");
log("worker started", { emails: !!(mailer && appUrl), files: !!store });

process.once("SIGTERM", async () => {
  running = false;
  timers.forEach(clearInterval);
  health.close();
  await db.end();
  process.exit(0);
});
