// Version history and search (BRD-6, BRD-4) against the full stack. Run it from the repository root: it starts workers.
import { chromium } from "playwright-core";
import { execSync, spawn } from "node:child_process";
import { openSync } from "node:fs";

const APP = "http://127.0.0.1:5199", IDP = "http://127.0.0.1:4010";
const res = [];
const check = (n, ok, x = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  " + x : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (q) => execSync(`psql -h ${process.env.POSTGRES_HOST} -p ${process.env.POSTGRES_PORT ?? 5432} -U ${process.env.POSTGRES_USER} -d ${process.env.POSTGRES_DB} -qAt -c "${q}"`, { env: { ...process.env, PGPASSWORD: process.env.POSTGRES_PASSWORD } }).toString().trim();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
// Set WORKER_LOG_DIR to keep each worker's output, which helps when a job doesn't run.
const startWorker = (port) => {
  const out = process.env.WORKER_LOG_DIR ? openSync(`${process.env.WORKER_LOG_DIR}/worker-${port}.log`, "w") : "ignore";
  return spawn("pnpm", ["start"], { cwd: "services/worker", env: { ...process.env, PORT: String(port) }, stdio: ["ignore", out, out], detached: true });
};
const stop = (w) => { try { process.kill(-w.pid); } catch { /* gone */ } };

async function login(user) {
  await fetch(`${IDP}/switch?user=${user}`);
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 800 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  page.on("pageerror", (e) => console.log("  pageerror:", e.message.slice(0, 120)));
  await page.goto(APP + "/auth/login");
  await page.waitForSelector("text=Signed in as");
  return { ctx, page };
}
const texts = (page) => page.evaluate(() => window.__board.list().map((o) => o.text).sort());
/** Waits until the server has acknowledged every change, so leaving the page can't drop an edit. Returns the wait in ms. */
const flushed = async (page) => {
  const t = Date.now();
  await page.waitForFunction(() => window.__provider && window.__provider.unsyncedChanges === 0, null, { timeout: 15000 });
  return Date.now() - t;
};
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await wait(300); } return false; };

// A unique title per run, so boards left by earlier runs can't be mistaken for this one.
const TITLE = `Quarterly budget planning ${Date.now()}`;
const indexer = startWorker(8093);
const ann = await login("ann");
await ann.page.getByLabel("Title").fill(TITLE);
await ann.page.getByRole("button", { name: "Create board" }).click();
await ann.page.waitForFunction(() => window.__board);
await ann.page.getByText("Saved automatically").waitFor();
const boardId = ann.page.url().split("/board/")[1];
await ann.page.evaluate(() => window.__board.add({ type: "sticky", x: 0, y: 0, text: "Kestrel launch" }));
await wait(800);

// 1. Save a named version
await ann.page.getByRole("button", { name: "History" }).click();
await ann.page.getByLabel("Name this version").fill("Baseline");
await ann.page.getByRole("button", { name: "Save version" }).click();
await ann.page.getByRole("complementary", { name: "Version history" }).getByText("Baseline").waitFor();
check("a named version is saved and listed, with its object count", /1 objects/.test(await ann.page.getByRole("complementary", { name: "Version history" }).textContent()));

// Bob joins as an editor and watches the board
await ann.page.getByRole("button", { name: "Share" }).click();
await ann.page.getByPlaceholder("Search by name or email").fill("bob");
const row = ann.page.getByRole("listitem").filter({ hasText: "Bob Builder" });
await row.getByRole("button").first().waitFor();
await ann.page.getByRole("dialog").locator("select").first().selectOption("editor");
await row.getByRole("button").first().click();
await ann.page.getByLabel("Members").getByText("Bob Builder").waitFor();
await ann.page.getByRole("button", { name: "Done" }).click();
const bob = await login("bob");
await bob.page.goto(`${APP}/#/board/${boardId}`);
await bob.page.waitForFunction(() => window.__board && window.__board.list().length === 1, null, { timeout: 10000 });

// 2. Change the board, then restore the baseline
await ann.page.evaluate(() => { const b = window.__board; b.remove([b.list()[0].id]); b.add({ type: "sticky", text: "Extra one" }); b.add({ type: "sticky", text: "Extra two" }); });
await bob.page.waitForFunction(() => window.__board.list().every((o) => o.text.startsWith("Extra")) && window.__board.list().length === 2, null, { timeout: 10000 });
check("the changes reach Bob", true);
await ann.page.getByRole("complementary", { name: "Version history" }).getByRole("listitem").filter({ hasText: "Baseline" }).getByRole("button", { name: "Restore" }).click();
await ann.page.getByText(/Restored\. 1 added, 2 removed, 0 changed/).waitFor({ timeout: 10000 });
check("restoring puts the baseline back and reports what changed", JSON.stringify(await texts(ann.page)) === '["Kestrel launch"]', JSON.stringify(await texts(ann.page)));
await bob.page.waitForFunction(() => window.__board.list().length === 1 && window.__board.list()[0].text === "Kestrel launch", null, { timeout: 10000 });
check("another editor sees the restore live", true);
check("restoring first saved the current state as a version", (await ann.page.getByRole("complementary", { name: "Version history" }).textContent()).includes("Before restoring Baseline"));
await ann.page.locator("[role=application]").click({ position: { x: 600, y: 500 } });
await ann.page.keyboard.press("Control+z");
await ann.page.waitForFunction(() => window.__board.list().length === 2, null, { timeout: 5000 });
check("Ctrl+Z undoes the restore", JSON.stringify(await texts(ann.page)) === '["Extra one","Extra two"]', JSON.stringify(await texts(ann.page)));
await ann.page.keyboard.press("Control+y");

// 3. A viewer has no history
const eve = await login("eve");
await ann.page.getByRole("button", { name: "Share" }).click();
await ann.page.getByPlaceholder("Search by name or email").fill("eve");
const erow = ann.page.getByRole("listitem").filter({ hasText: "Eve Overage" });
await erow.getByRole("button").first().waitFor();
await ann.page.getByRole("dialog").locator("select").first().selectOption("viewer");
await erow.getByRole("button").first().click();
await ann.page.getByLabel("Members").getByText("Eve Overage").waitFor();
await ann.page.getByRole("button", { name: "Done" }).click();
await eve.page.goto(`${APP}/#/board/${boardId}`);
await eve.page.getByText("View only").waitFor();
check("a viewer sees no History button", (await eve.page.getByRole("button", { name: "History" }).count()) === 0);
const api = await eve.page.evaluate(async (id) => [(await fetch(`/api/boards/${id}/versions`)).status, (await fetch(`/api/boards/${id}/versions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x" }) })).status], boardId);
check("and the API refuses a viewer", api[0] === 403 && api[1] === 403, JSON.stringify(api));

// 4. Search: by content, by title, with access control
await ann.page.evaluate(() => window.__board.restoreObjects([{ id: "k1", type: "sticky", x: 0, y: 0, width: 100, height: 100, rotation: 0, index: "a0", locked: false, text: "Kestrel launch checklist", color: "#fff475" }]));
console.log("  (Ann's edit acknowledged by the server after", await flushed(ann.page), "ms)");
await ann.page.goto(APP + "/");
const search = async (page, q) => { await page.getByLabel("Search boards").fill(q); await wait(700); return page.getByRole("region", { name: "Search results" }); };
let found = false;
for (let i = 0; i < 12 && !found; i++) { const r = await search(ann.page, "kestrel"); found = (await r.getByRole("link", { name: TITLE }).count()) > 0; if (!found) await wait(2000); }
if (!found) {
  await ann.page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/history-search-fail.png` : "history-search-fail.png" });
  console.log("  dashboard text:", (await ann.page.locator("body").textContent()).replace(/\s+/g, " ").slice(0, 300));
}
check("search finds a board by its text", found);
const hitText = await ann.page.getByRole("region", { name: "Search results" }).textContent();
check("the match is highlighted in the snippet", (await ann.page.locator("mark", { hasText: /kestrel/i }).count()) > 0, hitText.slice(0, 80));
const rt = await search(ann.page, TITLE.split(" ").slice(0, 2).join(" ").toLowerCase());
check("search finds a board by its title, with prefix matching", (await rt.getByRole("link", { name: TITLE }).count()) > 0);
const none = await search(ann.page, "nonexistentword");
check("no match says so", /No boards match/.test(await none.textContent()));
await eve.page.goto(APP + "/");
await eve.page.getByLabel("Search boards").fill("kestrel"); await wait(800);
check("a viewer with access finds it too", (await eve.page.getByRole("link", { name: TITLE }).count()) > 0);
const xss = await ann.page.evaluate(async () => (await fetch("/api/search?q=" + encodeURIComponent("'; DROP TABLE boards; --"))).status);
check("hostile search text is handled safely", xss === 200 && Number(sql("select count(*) from boards")) > 0);

// 5. Search follows edits
await ann.page.goto(`${APP}/#/board/${boardId}`);
await ann.page.waitForFunction(() => window.__board);
// Wait for the connection first. An edit made before it opens is kept in the browser and sent on the next visit.
await ann.page.getByText("Saved automatically").waitFor();
await ann.page.waitForFunction(() => window.__provider.synced === true, null, { timeout: 15000 });
const updatesBefore = Number(sql(`SELECT count(*) FROM board_updates WHERE board_id = '${boardId}'`));
await ann.page.evaluate(() => window.__board.add({ type: "sticky", text: "Zebra crossing review" }));
await flushed(ann.page);
await wait(500);
console.log("  stored updates before/after the zebra edit:", updatesBefore, Number(sql(`SELECT count(*) FROM board_updates WHERE board_id = '${boardId}'`)), "| board updated_at:", sql(`SELECT to_char(updated_at,'HH24:MI:SS') FROM boards WHERE id = '${boardId}'`), "| now:", sql("SELECT to_char(now(),'HH24:MI:SS')"));
await ann.page.goto(APP + "/");
let z = false; const t0 = Date.now();
while (!z && Date.now() - t0 < 60000) { const r = await search(ann.page, "zebra"); z = (await r.getByRole("link", { name: TITLE }).count()) > 0; if (!z) await wait(2000); }
const secs = Math.round((Date.now() - t0) / 1000);
if (!z) {
  await ann.page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/history-zebra-fail.png` : "history-zebra-fail.png" });
  console.log("  url:", ann.page.url(), "| box value:", await ann.page.getByLabel("Search boards").inputValue().catch((e) => "n/a " + e.message.slice(0, 50)));
}
check("a new edit becomes searchable within 30 seconds", z && secs <= 30, `${secs} s`);

// 6. A user who can't open the board finds nothing. Use a board only Ann owns, and search as Bob after removing him.
await ann.page.goto(`${APP}/#/board/${boardId}`);
await ann.page.getByRole("button", { name: "Share" }).click();
await ann.page.getByLabel("Members").getByRole("listitem").filter({ hasText: "Bob Builder" }).getByRole("button", { name: "Remove" }).click();
await wait(800);
await ann.page.getByRole("button", { name: "Done" }).click();
await bob.page.goto(APP + "/");
await bob.page.getByLabel("Search boards").fill("zebra"); await wait(800);
check("after access is removed the board no longer appears in search", (await bob.page.getByRole("link", { name: TITLE }).count()) === 0);

// 7. The worker takes an automatic version of a changed board after a quiet moment
sql(`UPDATE boards SET updated_at = now() - interval '5 minutes' WHERE id = '${boardId}'`);
// A version newer than the last change already holds the board, so clear them to make a change that needs saving.
sql(`DELETE FROM board_versions WHERE board_id = '${boardId}'`);
const autoWorker = startWorker(8094);   // its first tick runs at once
let auto = 0;
for (let i = 0; i < 30 && !auto; i++) { auto = Number(sql(`SELECT count(*) FROM board_versions WHERE board_id = '${boardId}' AND kind = 'auto'`)); if (!auto) await wait(1000); }
check("the worker takes an automatic version of a changed board", auto === 1, `${auto} automatic versions`);
await ann.page.goto(`${APP}/#/board/${boardId}`);
await ann.page.getByRole("button", { name: "History" }).click();
await ann.page.getByRole("complementary", { name: "Version history" }).getByText("Automatic version").first().waitFor({ timeout: 8000 });
check("it appears in the history panel", true);

stop(indexer); stop(autoWorker);
await browser.close();
console.log(`\n${res.filter(Boolean).length}/${res.length} checks passed`);
process.exit(res.every(Boolean) ? 0 : 1);
