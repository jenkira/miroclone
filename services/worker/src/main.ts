import { createServer } from "node:http";
import pg from "pg";
import { compactBusyBoards, Counter, createRegistry, Histogram, LATENCY_BUCKETS, serveMetrics, indexStaleBoards, migrate, pruneAutoVersions, purgeExpiredBoards, S3ObjectStore, snapshotChangedBoards } from "@miroclone/server-core";
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

const registry = createRegistry("worker");
const jobRuns = new Counter({ name: "worker_job_runs_total", help: "Job runs by job and result", labelNames: ["job", "result"], registers: [registry] });
const jobSeconds = new Histogram({ name: "worker_job_duration_seconds", help: "Job duration", labelNames: ["job"], buckets: LATENCY_BUCKETS, registers: [registry] });
const emails = new Counter({ name: "worker_emails_total", help: "Notification emails by result", labelNames: ["result"], registers: [registry] });
// Metrics use their own port, apart from the health endpoint.
const metricsServer = serveMetrics(registry, Number(process.env.METRICS_PORT ?? 9464));

let running = true;
const every = (name: string, ms: number, job: () => Promise<unknown>) => {
  const tick = async () => {
    const end = jobSeconds.startTimer({ job: name });
    try {
      const r = (await job()) as Record<string, number> | undefined;
      jobRuns.inc({ job: name, result: "ok" });
      if (name === "emails" && r) for (const k of ["sent", "failed", "skipped"]) if (r[k]) emails.inc({ result: k }, r[k]);
      if (r && Object.values(r).some((n) => n > 0)) log(name, r);
    } catch (err) {
      jobRuns.inc({ job: name, result: "error" });
      console.error(JSON.stringify({ level: "error", msg: `${name} failed`, err: String(err) }));
    } finally { end(); }
  };
  void tick();
  return setInterval(() => { if (running) void tick(); }, ms);
};

const timers = [
  ...(mailer && appUrl ? [every("emails", 30_000, () => sendPendingEmails(db, mailer, appUrl))] : []),
  every("purge", 60 * 60 * 1000, () => purgeExpiredBoards(db, store)),
  // Stored updates merge here, so the collaboration service never spends its single thread on it.
  every("compact", 15_000, async () => ({ compacted: await compactBusyBoards(db) })),
  // New and changed boards reach search within seconds (BRD-4).
  every("search-index", 10_000, async () => ({ indexed: await indexStaleBoards(db) })),
  // Automatic versions (BRD-6): changed boards get one at most every 10 minutes, and old ones are pruned.
  every("versions", 2 * 60 * 1000, async () => ({ snapshots: await snapshotChangedBoards(db), pruned: await pruneAutoVersions(db) })),
];

// A small HTTP endpoint for the Kubernetes probes.
const health = createServer((_req, res) => res.writeHead(running ? 200 : 503).end(running ? "ok" : "stopping"));
health.listen(Number(process.env.PORT ?? 8081), "0.0.0.0");
log("worker started", { emails: !!(mailer && appUrl), files: !!store });

process.once("SIGTERM", async () => {
  running = false;
  timers.forEach(clearInterval);
  health.close();
  metricsServer.close();
  await db.end();
  process.exit(0);
});
