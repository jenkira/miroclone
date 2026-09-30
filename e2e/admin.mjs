// Administration (ADM-3, PMK-1, PMK-7) and the paste warning (PMK-5) against the full stack.
import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const APP = "http://127.0.0.1:5199", IDP = "http://127.0.0.1:4010";
const res = [];
const check = (n, ok, x = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  " + x : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
async function login(user) {
  await fetch(`${IDP}/switch?user=${user}`);
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 800 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  pageerror:", e.message.slice(0, 120)));
  await page.goto(APP + "/auth/login");
  await page.waitForSelector("text=Signed in as");
  return { ctx, page };
}
const RUN = Date.now();
/** Puts the markings back to the built-in list and removes boards that use an added one. This is a test database. */
const resetMarkings = () => execSync(
  `psql -h ${process.env.POSTGRES_HOST} -p ${process.env.POSTGRES_PORT ?? 5432} -U ${process.env.POSTGRES_USER} -d ${process.env.POSTGRES_DB} -qc "DELETE FROM settings WHERE key = 'classifications'; DELETE FROM boards WHERE classification NOT IN ('OFFICIAL','OFFICIAL_SENSITIVE','SENSITIVE','PROTECTED')"`,
  { env: { ...process.env, PGPASSWORD: process.env.POSTGRES_PASSWORD } });
resetMarkings();
const apiLog = () => readFileSync(process.env.API_LOG ?? "api.log", "utf8").split("\n").filter((l) => l.includes('"type":"audit"')).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const bannerPx = (page) => page.screenshot({ clip: { x: 650, y: 4, width: 2, height: 2 } }).then((b) => page.evaluate(async (b64) => { const i = new Image(); i.src = "data:image/png;base64," + b64; await i.decode(); const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const g = c.getContext("2d"); g.drawImage(i, 0, 0); return [...g.getImageData(0, 0, 1, 1).data]; }, b.toString("base64")));

// 1. A person without the administrator role
const ann = await login("ann");
await ann.page.goto(`${APP}/#/admin`);
await ann.page.getByText(/Only a service administrator/).waitFor({ timeout: 8000 });
check("a person who isn't an administrator can't open the admin page", true);
const direct = await ann.page.evaluate(async () => [(await fetch("/api/admin/stats")).status, (await fetch("/api/admin/classifications", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ list: [], default: "x" }) })).status]);
check("and the API refuses both admin calls", direct[0] === 403 && direct[1] === 403, JSON.stringify(direct));
await ann.page.goto(APP + "/");
check("the dashboard shows no Administration link to them", (await ann.page.getByRole("link", { name: "Administration" }).count()) === 0);
await ann.page.getByLabel("Title").fill(`Protected ${RUN}`);
await ann.page.getByLabel("Classification").selectOption("PROTECTED");
await ann.page.getByRole("button", { name: "Create board" }).click();
await ann.page.waitForFunction(() => window.__board && window.__provider?.synced);
const protectedId = ann.page.url().split("/board/")[1];

// 2. The administrator's statistics
const ada = await login("ada");
await ada.page.goto(APP + "/");
await ada.page.getByRole("link", { name: "Administration" }).click();
await ada.page.getByRole("heading", { name: "Usage" }).waitFor();
await ada.page.getByRole("table", { name: /Usage/ }).waitFor();
const usage = await ada.page.getByRole("table", { name: /Usage/ }).textContent();
check("the statistics show users, boards by classification, and storage", /Users/.test(usage) && /Boards marked PROTECTED/.test(usage) && /Board content stored/.test(usage) && /Uploaded files/.test(usage));
check("they show counts only, never a board title", !usage.includes(`Protected ${RUN}`));

// 3. Change the markings
const before = await ada.page.evaluate(async () => (await fetch("/api/classifications")).json());
await ada.page.getByRole("button", { name: "Add a marking" }).click();
const rows = ada.page.getByRole("table", { name: /Markings/ }).locator("tbody tr");
const last = rows.last();
await last.getByLabel(/Key of marking/).fill("CONFIDENTIAL");
await last.getByLabel(/Label of/).fill("CONFIDENTIAL");
await last.getByLabel(/Level of/).fill("3");
await last.getByLabel(/Colour of/).fill("#6a1b9a");
await ada.page.getByLabel("Use OFFICIAL_SENSITIVE for new boards").check();
await ada.page.getByRole("button", { name: "Save markings" }).click();
await ada.page.getByText("Saved.").waitFor();
check("the administrator saves a new marking and a new default", true);
check("the change is in the audit log", apiLog().some((e) => e.action === "settings_change" && JSON.stringify(e).includes("CONFIDENTIAL:3")));

// Everyone else gets it on their next page load
await ann.page.goto(APP + "/");
await ann.page.getByLabel("Classification").locator("option", { hasText: "CONFIDENTIAL" }).waitFor({ state: "attached" });
check("other people's pickers list the new marking", true);
check("and preselect the new default", (await ann.page.getByLabel("Classification").inputValue()) === "OFFICIAL_SENSITIVE");
await ann.page.getByLabel("Title").fill(`Purple ${RUN}`);
await ann.page.getByLabel("Classification").selectOption("CONFIDENTIAL");
await ann.page.getByRole("button", { name: "Create board" }).click();
await ann.page.waitForFunction(() => window.__board && window.__provider?.synced);
await wait(300);
const px = await bannerPx(ann.page);
check("a board with it shows the administrator's banner colour", px[0] === 106 && px[1] === 27 && px[2] === 154, JSON.stringify(px));

// 4. A marking that boards use can't be removed; markings at one level are equivalent
await ada.page.goto(`${APP}/#/admin`);
await ada.page.getByRole("button", { name: "Remove PROTECTED" }).waitFor();
await ada.page.getByRole("button", { name: "Remove PROTECTED" }).click();
await ada.page.getByRole("button", { name: "Save markings" }).click();
await ada.page.getByText(/weren't saved/).waitFor({ timeout: 8000 });
const listed = await ada.page.evaluate(async () => (await (await fetch("/api/classifications")).json()).list.map((m) => m.key));
check("a marking that boards use can't be removed", listed.includes("PROTECTED"), JSON.stringify(listed));
const eq = await ann.page.evaluate(async () => { const r = await (await fetch("/api/classifications")).json(); return r.list.filter((m) => m.level === 1).map((m) => m.key).sort(); });
check("OFFICIAL: Sensitive and SENSITIVE share a level, so they count as equivalent", eq.join() === "OFFICIAL_SENSITIVE,SENSITIVE", eq.join());

// 5. Pasting into a lower classification
await ann.page.goto(`${APP}/#/board/${protectedId}`);
await ann.page.waitForFunction(() => window.__board && window.__provider?.synced);
await ann.page.evaluate(() => window.__board.add({ type: "sticky", x: 10, y: 10, text: "Protected idea" }));
await ann.page.waitForFunction(() => window.__provider.unsyncedChanges === 0);
await ann.page.evaluate(() => window.__apiRef.current.select(window.__board.list().map((o) => o.id)));
await ann.page.keyboard.press("Control+c");
// Move to a lower board without reloading, so the copied content stays in memory.
await ann.page.evaluate(() => { location.hash = "#/"; });
await ann.page.getByLabel("Title").fill(`Official ${RUN}`);
await ann.page.getByLabel("Classification").selectOption("OFFICIAL");
await ann.page.getByRole("button", { name: "Create board" }).click();
await ann.page.waitForFunction(() => window.__board && window.__provider?.synced && location.hash.includes("/board/"));
await wait(300);
const officialId = ann.page.url().split("/board/")[1];
let message = "";
ann.page.once("dialog", (d) => { message = d.message(); void d.dismiss(); });
await ann.page.keyboard.press("Control+v");
await wait(800);
check("pasting into a lower board asks first, and names both classifications", /PROTECTED/.test(message) && /OFFICIAL/.test(message) && /audit log/.test(message), message.slice(0, 80));
check("declining pastes nothing and records nothing", (await ann.page.evaluate(() => window.__board.list().length)) === 0 && !apiLog().some((e) => e.action === "paste_downgrade" && e.boardId === officialId));
ann.page.once("dialog", (d) => void d.accept());
await ann.page.keyboard.press("Control+v");
await ann.page.waitForFunction(() => window.__board.list().length === 1, null, { timeout: 8000 });
check("agreeing pastes the content", (await ann.page.evaluate(() => window.__board.list()[0].text)) === "Protected idea");
await wait(300);
const ev = apiLog().find((e) => e.action === "paste_downgrade" && e.boardId === officialId);
check("and records who, from where, to where, and how many", ev && ev.detail.from === "PROTECTED" && ev.detail.to === "OFFICIAL" && ev.detail.objects === 1 && ev.detail.fromBoardId === protectedId, JSON.stringify(ev?.detail));
// Copying within one board, and pasting upward, need no warning
let asked = false;
ann.page.on("dialog", (d) => { asked = true; void d.dismiss(); });
await ann.page.evaluate(() => window.__apiRef.current.select(window.__board.list().map((o) => o.id)));
await ann.page.keyboard.press("Control+c"); await ann.page.keyboard.press("Control+v");
await wait(600);
check("pasting into the same board doesn't ask", !asked && (await ann.page.evaluate(() => window.__board.list().length)) === 2);
await ann.page.goto(`${APP}/#/board/${protectedId}`);
await ann.page.waitForFunction(() => window.__board && window.__provider?.synced);
await ann.page.keyboard.press("Control+v");
await wait(800);
check("pasting into a higher board doesn't ask", !asked);

// 6. Put the markings back to the built-in list, so other suites start from the same place
resetMarkings();

await browser.close();
console.log(`\n${res.filter(Boolean).length}/${res.length} checks passed`);
process.exit(res.every(Boolean) ? 0 : 1);
