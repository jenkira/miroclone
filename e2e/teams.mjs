// Teams activity notifications (COL-9) against the full stack. The worker sends through a fake Entra ID and Graph, and the
// script reads back what Graph received. Free port 8095 first. Needs `ada` (administrator), `ann`, and `bob`.
import { spawn } from "node:child_process";

const API = "http://127.0.0.1:5199", IDP = "http://127.0.0.1:4010";
const res = [];
const check = (n, ok, x = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  " + x : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = Date.now();

/** Signs in through the fake identity provider, and returns a fetch that carries the session cookie. */
async function login(user) {
  await fetch(`${IDP}/switch?user=${user}`);
  let url = `${API}/auth/login`, cookie = "";
  for (let i = 0; i < 6; i++) {
    const r = await fetch(url, { redirect: "manual", headers: cookie ? { cookie } : {} });
    for (const c of r.headers.getSetCookie()) cookie = [cookie, c.split(";")[0]].filter(Boolean).join("; ");
    const next = r.headers.get("location");
    if (!next) break;
    url = new URL(next, url).href;
  }
  const call = (path, init = {}) => fetch(API + path, { ...init, headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) } });
  return { call, me: await (await call("/api/me")).json() };
}
const teamsLog = async () => (await fetch(`${IDP}/__teams`)).json();

const ann = await login("ann"), bob = await login("bob"), ada = await login("ada");

const created = await (await ann.call("/api/boards", { method: "POST", body: JSON.stringify({ title: `Secret codename ${RUN}`, classification: "PROTECTED" }) })).json();
const boardId = created.id;
await ann.call(`/api/boards/${boardId}/members`, { method: "PUT", body: JSON.stringify({ type: "user", principalId: bob.me.id, role: "editor", name: "Bob" }) });
await bob.call(`/api/boards/${boardId}`);   // Opening the board makes Bob mentionable.
const mention = (text) => ann.call(`/api/boards/${boardId}/comments`, { method: "POST", body: JSON.stringify({ body: `${text} @[Bob Builder](${bob.me.id})` }) });

// The notifications that follow need the worker, which starts with Teams credentials against the fake services.
const env = { ...process.env, PORT: "8095", METRICS_PORT: "9466", APP_URL: "https://board.example.internal", ENTRA_TENANT_ID: "00000000-0000-0000-0000-000000000000", ENTRA_CLIENT_ID: "client-1", ENTRA_CLIENT_SECRET: "x", ENTRA_AUTHORITY: IDP, GRAPH_BASE_URL: `${IDP}/v1.0` };
const worker = spawn("pnpm", ["start"], { cwd: "services/worker", env, stdio: "ignore", detached: true });
const stop = () => { try { process.kill(-worker.pid); } catch { /* already gone */ } };
process.on("exit", stop);

check("a person who isn't an administrator can't change the setting", (await bob.call("/api/admin/teams-notifications", { method: "PUT", body: JSON.stringify({ enabled: true }) })).status === 403);
check("Teams notifications start off", (await (await ada.call("/api/admin/teams-notifications")).json()).enabled === false);

const before = (await teamsLog()).length;
await mention("First note");
await wait(35_000);   // The worker looks every 30 seconds.
check("with the setting off, nothing goes to Teams", (await teamsLog()).length === before);

check("an administrator turns it on", (await (await ada.call("/api/admin/teams-notifications", { method: "PUT", body: JSON.stringify({ enabled: true }) })).json()).enabled === true);
await mention("Second note");
let sent = [];
for (let i = 0; i < 40 && !(sent = (await teamsLog()).slice(before)).length; i++) await wait(2000);
check("with it on, the worker sends a Teams notification to the mentioned person", sent.some((s) => s.user === bob.me.id), JSON.stringify(sent.map((s) => s.user)));
const body = JSON.stringify(sent.find((s) => s.user === bob.me.id)?.body ?? {});
check("it carries the classification and a link, as an activity notification", /PROTECTED/.test(body) && body.includes(`https://board.example.internal/#/board/${boardId}`) && body.includes("boardActivity"), body);
check("and no board title, comment, or name", !/Secret codename|Second note|First note|Ann Author|Bob Builder/.test(body));

// The unit tests cover a person with no Teams app, who gets a 404 and is skipped without retries.
stop();
const done = (await teamsLog()).length;
await wait(1000);
check("the worker doesn't send the same notification twice", (await teamsLog()).length === done);

const failed = res.filter((r) => !r).length;
console.log(`\n${res.length - failed}/${res.length} passed`);
process.exit(failed ? 1 : 0);
