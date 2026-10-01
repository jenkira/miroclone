// Measures PRF-3 (propagation), PRF-4 (open time), and PRF-5 (50 editors and 200 viewers on one board) against the local stack.
// It talks to the real API and collaboration service, with real Postgres and Redis. Set LOAD_EDITORS, LOAD_VIEWERS, LOAD_SECONDS, and LOAD_INTERVAL_MS (the time between one editor's edits) to change the shape.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
// The scripts in this folder have no dependencies of their own, so load them from the packages that do.
const requireFrom = (dir) => createRequire(`${process.cwd()}/${dir}/`);
const load = (dir, name) => import(pathToFileURL(requireFrom(dir).resolve(name)).href);
const { default: WebSocket } = await load("services/collab", "ws");
const { HocuspocusProvider, HocuspocusProviderWebsocket } = await load("apps/web", "@hocuspocus/provider");
const Y = await load("apps/web", "yjs");

const APP = "http://127.0.0.1:5199", IDP = "http://127.0.0.1:4010", COLLAB = "ws://127.0.0.1:1234";
const EDITORS = Number(process.env.LOAD_EDITORS ?? 50), VIEWERS = Number(process.env.LOAD_VIEWERS ?? 200), SECONDS = Number(process.env.LOAD_SECONDS ?? 15);
const INTERVAL = Number(process.env.LOAD_INTERVAL_MS ?? 1000);
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? NaN; };
const stats = (xs) => ({ n: xs.length, p50: +pct(xs, 50).toFixed(1), p95: +pct(xs, 95).toFixed(1), p99: +pct(xs, 99).toFixed(1), max: +xs.reduce((m, x) => Math.max(m, x), 0).toFixed(1) });
const results = [];
const report = (name, ok, detail) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(detail)}`); };

// Sign in as Ann through the fake identity provider, following the redirects by hand to keep the cookie.
async function login() {
  await fetch(`${IDP}/switch?user=ann`);
  let url = `${APP}/auth/login`, cookie = "";
  for (let i = 0; i < 6; i++) {
    const r = await fetch(url, { redirect: "manual", headers: cookie ? { cookie } : {} });
    for (const c of r.headers.getSetCookie()) cookie = [cookie, c.split(";")[0]].filter(Boolean).join("; ");
    const next = r.headers.get("location");
    if (!next) break;
    url = new URL(next, url).href;
  }
  return cookie;
}
const cookie = await login();
const api = (path, init = {}) => fetch(APP + path, { ...init, headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) } });
if (!(await api("/api/me")).ok) { console.error("Couldn't sign in. Is the stack running?"); process.exit(2); }

class Socket extends WebSocket { constructor(url, protocols) { super(url, protocols, { headers: { cookie, origin: APP } }); } }
const connect = (boardId, doc = new Y.Doc()) => new Promise((resolve, reject) => {
  const t0 = performance.now();
  // Each connection gets its own socket, as each browser tab does, and the socket carries the session cookie.
  const websocketProvider = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: Socket });
  const provider = new HocuspocusProvider({ websocketProvider, name: boardId, document: doc, token: "cookie", onSynced: () => resolve({ doc, provider, ms: performance.now() - t0 }), onAuthenticationFailed: () => reject(new Error("authentication failed")) });
  setTimeout(() => reject(new Error("connect timed out")), 30000);
});

// Viewers run in their own processes, so the load generator's single thread doesn't add to the latency it measures.
// Timestamps use the wall clock, because every process shares the machine's clock.
if (process.argv[2] === "viewers") {
  const [, , , boardId, count] = process.argv;
  const lat = [];
  const sent = new Set();
  const viewers = await Promise.all(Array.from({ length: Number(count) }, () => connect(boardId)));
  let counted = 0;
  for (const v of viewers) v.doc.getMap("objects").observe((e) => { for (const [k, ch] of e.changes.keys) if (ch.action === "add" && k.startsWith("p5-")) { lat.push(Date.now() - Number(v.doc.getMap("objects").get(k).text)); counted++; } });
  process.send({ ready: true, connectMs: viewers.map((v) => v.ms) });
  process.on("message", (m) => { if (m === "stop") { process.send({ lat, size: viewers[0].doc.getMap("objects").size, sizes: [...new Set(viewers.map((v) => v.doc.getMap("objects").size))] }, () => process.exit(0)); } });
  await new Promise(() => {});
}

if (process.argv[2] === "editors") {
  const [, , , boardId, count, interval, offset] = process.argv;
  const editors = await Promise.all(Array.from({ length: Number(count) }, () => connect(boardId)));
  let sent = 0;
  let timers = [];
  let stopped = false;
  process.send({ ready: true, connectMs: editors.map((e) => e.ms) });
  process.on("message", (m) => {
    // People don't edit in step, so each editor starts at a random point in its interval and waits a varied time between edits.
    if (m === "go") {
      stopped = false;
      editors.forEach((e, n) => {
        const tick = () => {
          if (stopped) return;
          const id = `p5-${Number(offset) + n}-${sent++}`;
          e.doc.getMap("objects").set(id, { ...sticky(id), text: String(Date.now()) });
          timers.push(setTimeout(tick, Number(interval) * (0.5 + Math.random())));
        };
        timers.push(setTimeout(tick, Math.random() * Number(interval)));
      });
    }
    if (m === "stop") { stopped = true; timers.forEach(clearTimeout); process.send({ sent }, () => process.exit(0)); }
  });
  await new Promise(() => {});
}

// A board with 1,000 objects, made through the real import route.
const objs = Array.from({ length: 1000 }, (_, i) => ({ id: `seed-${i}`, type: "sticky", x: (i % 40) * 180, y: Math.floor(i / 40) * 180, width: 160, height: 160, rotation: 0, index: `a${String(i).padStart(4, "0")}`, locked: false, text: `Note ${i}`, color: "#fff475" }));
const created = await api("/api/boards/import", { method: "POST", body: JSON.stringify({ file: JSON.stringify({ format: "miroclone-board", version: 1, title: `Load ${Date.now()}`, classification: "OFFICIAL", objects: objs }) }) });
const made = await created.json();
if (!made.id) { console.error("Board import failed:", created.status, JSON.stringify(made)); process.exit(2); }
const boardId = made.id;
function sticky(id) { return { id, type: "sticky", x: 0, y: 0, width: 160, height: 160, rotation: 0, index: "z" + id, locked: false, text: String(performance.now()), color: "#fff475" }; }

// PRF-4: time to open a board with 1,000 objects.
const opens = [];
for (let i = 0; i < 30; i++) { const c = await connect(boardId); opens.push(c.ms); c.provider.destroy(); }
const s4 = stats(opens);
report("PRF-4 open a board with 1,000 objects, p95 under 2,000 ms", s4.p95 < 2000, s4);

// PRF-3: change propagation between two users.
{
  const a = await connect(boardId), b = await connect(boardId);
  const lat = [];
  const seen = new Map();
  b.doc.getMap("objects").observe((e) => { for (const [k, ch] of e.changes.keys) if (ch.action === "add" && seen.has(k)) lat.push(performance.now() - seen.get(k)); });
  for (let i = 0; i < 200; i++) {
    const id = `p3-${i}`; seen.set(id, performance.now());
    a.doc.getMap("objects").set(id, sticky(id));
    await new Promise((r) => setTimeout(r, 25));
  }
  await new Promise((r) => setTimeout(r, 500));
  const s3 = stats(lat);
  report("PRF-3 change propagation, p95 under 200 ms", lat.length === 200 && s3.p95 < 200, s3);
  a.provider.destroy(); b.provider.destroy();
}

// PRF-5: many editors and viewers on one board. Editors and viewers each run in child processes, 50 connections to a process.
{
  const { fork } = await import("node:child_process");
  const PER = 50;
  const spawn = (kind, n, ...extra) => {
    const child = fork(new URL(import.meta.url).pathname, [kind, boardId, String(n), ...extra], { env: process.env, cwd: process.cwd() });
    const ready = new Promise((res, rej) => { child.once("message", res); child.once("exit", (c) => rej(new Error(`${kind} process exited with ${c}`))); });
    return { child, ready };
  };
  const t0 = performance.now();
  const viewerProcs = Array.from({ length: Math.ceil(VIEWERS / PER) }, (_, i) => spawn("viewers", Math.min(PER, VIEWERS - i * PER)));
  const editorProcs = Array.from({ length: Math.ceil(EDITORS / PER) }, (_, i) => spawn("editors", Math.min(PER, EDITORS - i * PER), String(INTERVAL), String(i * PER)));
  const ready = await Promise.all([...viewerProcs, ...editorProcs].map((k) => k.ready));
  const connectMs = performance.now() - t0;
  report(`PRF-5 ${EDITORS} editors and ${VIEWERS} viewers connect and sync`, true, { connections: EDITORS + VIEWERS, seconds: +(connectMs / 1000).toFixed(1), ...stats(ready.flatMap((r) => r.connectMs)) });

  editorProcs.forEach((k) => k.child.send("go"));
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  const sentCounts = await Promise.all(editorProcs.map((k) => new Promise((res) => { k.child.once("message", res); k.child.send("stop"); })));
  const sent = sentCounts.reduce((n, c) => n + c.sent, 0);
  // Give slow deliveries time to land before counting.
  await new Promise((r) => setTimeout(r, Number(process.env.LOAD_SETTLE_MS ?? 3000)));
  const answers = await Promise.all(viewerProcs.map((k) => new Promise((res) => { k.child.once("message", res); k.child.send("stop"); })));
  const lat = answers.flatMap((a) => a.lat);
  const sp = stats(lat);
  report(`PRF-5 every update reaches every viewer (${sent} updates, ${VIEWERS} viewers)`, lat.length === sent * VIEWERS, { expected: sent * VIEWERS, received: lat.length });
  report("PRF-5 propagation under load, p95 under 200 ms", sp.p95 < 200, { ...sp, updatesPerSecond: +(sent / SECONDS).toFixed(1), fanOutPerSecond: Math.round((sent / SECONDS) * VIEWERS) });
  const sizes = new Set(answers.flatMap((a) => a.sizes));
  report("PRF-5 every viewer converges on the same board", sizes.size === 1 && [...sizes][0] === 1000 + 200 + sent, { objects: [...sizes], expected: 1000 + 200 + sent });
}

await api(`/api/boards/${boardId}`, { method: "DELETE" });
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
