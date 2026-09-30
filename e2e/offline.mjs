// Offline editing and cache clearing (COL-5, COL-10) against the full stack.
// Needs the same setup as full-stack.mjs, plus COLLAB_PID_FILE, which holds the PID of the collaboration service's
// `pnpm start` process. The script stops and restarts that service.
import { chromium } from "playwright-core";
import { execSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const APP = "http://127.0.0.1:5199", IDP = "http://127.0.0.1:4010";
const COLLAB_DIR = process.env.COLLAB_DIR ?? "services/collab";
const pidFile = process.env.COLLAB_PID_FILE;
const res = [];
const check = (n, ok, x = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  " + x : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });

function stopCollab() {
  const pid = readFileSync(pidFile, "utf8").trim();
  execSync(`pkill -P ${pid} || true; kill ${pid} || true`, { shell: "/bin/bash" });
}
async function startCollab() {
  const c = spawn("pnpm", ["start"], { cwd: COLLAB_DIR, env: process.env, detached: true, stdio: "ignore" });
  c.unref();
  await wait(5000);
}
async function login(user) {
  await fetch(`${IDP}/switch?user=${user}`);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(APP + "/auth/login");
  await page.waitForSelector("text=Signed in as");
  return { ctx, page };
}
const texts = (page) => page.evaluate(() => window.__board.list().map((o) => (o.type === "sticky" ? o.text : o.type)));
const dbs = (page) => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).filter((n) => n?.startsWith("miroclone:")));

const ann = await login("ann");
await ann.page.getByLabel("Title").fill("Offline board");
await ann.page.getByRole("button", { name: "Create board" }).click();
await ann.page.waitForFunction(() => window.__board && window.__provider);
await ann.page.getByText("Saved automatically").waitFor();
const boardUrl = ann.page.url();
await ann.page.evaluate(() => window.__board.add({ type: "sticky", x: 10, y: 10, text: "before" }));
await wait(800);
check("the board is cached in this browser", (await dbs(ann.page)).some((n) => n.endsWith("board:" + boardUrl.split("/board/")[1])), JSON.stringify(await dbs(ann.page)));

// The collaboration service goes away. The user reloads and still sees the board.
stopCollab();
await wait(1000);
await ann.page.reload();
await ann.page.waitForFunction(() => window.__board);
await ann.page.waitForFunction(() => window.__board.list().length > 0, null, { timeout: 8000 }).catch(() => {});
check("after a reload with no server connection, the cached board still opens", (await texts(ann.page)).includes("before"), JSON.stringify(await texts(ann.page)));
await ann.page.getByText(/Offline|Connecting/).first().waitFor();
check("the page says it's offline", true);

// Edit while offline, then bring the service back.
await ann.page.evaluate(() => window.__board.add({ type: "sticky", x: 300, y: 10, text: "made offline" }));
await wait(500);
await startCollab();
await ann.page.getByText("Saved automatically").waitFor({ timeout: 30000 });
check("the client reconnects by itself", true);

// A second user, opening fresh, sees both edits: the offline one merged.
await fetch(`${IDP}/switch?user=ann`);
const other = await browser.newContext({ viewport: { width: 1200, height: 800 } });
const op = await other.newPage();
await op.goto(APP + "/auth/login"); await op.waitForSelector("text=Signed in as");
await op.goto(boardUrl);
await op.waitForFunction(() => window.__board && window.__board.list().length >= 2, null, { timeout: 15000 }).catch(() => {});
const merged = await texts(op);
check("the offline edit merged into the shared board", merged.includes("before") && merged.includes("made offline"), JSON.stringify(merged));
await other.close();

// Sign-out removes the cache.
await ann.page.goto(APP + "/");
await ann.page.getByRole("button", { name: "Sign out" }).click();
await ann.page.waitForSelector("text=Sign in with Microsoft");
check("sign-out deletes every cached board", (await dbs(ann.page)).length === 0, JSON.stringify(await dbs(ann.page)));
check("  and the cache registry", (await ann.page.evaluate(() => localStorage.getItem("miroclone:registry"))) === null);

// Session ending on the server also clears the cache.
const bob = await login("bob");
await bob.page.getByLabel("Title").fill("B");
await bob.page.getByRole("button", { name: "Create board" }).click();
await bob.page.waitForFunction(() => window.__board);
await bob.page.evaluate(() => window.__board.add({ type: "sticky", text: "secret" }));
await wait(600);
check("a board is cached for the second user", (await dbs(bob.page)).length === 1);
await bob.ctx.clearCookies(); // The server no longer recognises this browser, as after an expiry.
await bob.page.goto(APP + "/");
await bob.page.waitForSelector("text=Sign in with Microsoft");
await wait(300);
check("a page that finds no valid session clears the cache", (await dbs(bob.page)).length === 0, JSON.stringify(await dbs(bob.page)));

await browser.close();
console.log(`\n${res.filter(Boolean).length}/${res.length} checks passed`);
process.exit(res.every(Boolean) ? 0 : 1);
