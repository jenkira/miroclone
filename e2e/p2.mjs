// The P2 features against the full stack: CSV import (EXP-4), reactions (WSH-6), and markers (PMK-6).
import { chromium } from "playwright-core";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP = "http://127.0.0.1:5199", IDP = "http://127.0.0.1:4010";
const res = [];
const check = (n, ok, x = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  " + x : ""}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
async function login(user) {
  await fetch(`${IDP}/switch?user=${user}`);
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  pageerror:", e.message.slice(0, 160)));
  await page.goto(APP + "/auth/login");
  await page.waitForSelector("text=Signed in as");
  const me = await page.evaluate(async () => (await fetch("/api/me")).json());
  return { page, me };
}
const call = (page, method, url, body) => page.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: b ? { "content-type": "application/json" } : undefined, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [method, url, body]);
const RUN = Date.now();

const ann = await login("ann"), bob = await login("bob"), ada = await login("ada");
// A board for Ann, shared with Bob as a viewer.
await ann.page.getByLabel("Title").fill(`P2 ${RUN}`);
await ann.page.getByRole("button", { name: "Create board" }).click();
await ann.page.waitForURL(/#\/board\//);
const id = ann.page.url().split("/board/")[1];
await ann.page.waitForSelector("canvas");
await call(ann.page, "PUT", `/api/boards/${id}/members`, { type: "user", principalId: bob.me.id, role: "viewer", name: "Bob" });

// 1. CSV import
const dir = mkdtempSync(join(tmpdir(), "csv-"));
const csv = join(dir, "notes.csv");
writeFileSync(csv, 'Text,Colour\n"Fix, then ship",blue\nWrite docs,#ff0000\n\n"Line one\nline two",green\n');
await ann.page.waitForFunction(() => window.__provider?.synced);
await ann.page.getByLabel("Choose a CSV file").setInputFiles(csv);
await ann.page.getByRole("alert").filter({ hasText: /Added 3 sticky notes/ }).waitFor();
const notes = await ann.page.evaluate(() => window.__board.list().filter((o) => o.type === "sticky").map((o) => ({ text: o.text, color: o.color, x: o.x, y: o.y })));
check("a CSV file adds a sticky note for each row, with quoted commas and line breaks", notes.length === 3 && notes.some((n) => n.text === "Fix, then ship") && notes.some((n) => n.text === "Line one\nline two"), JSON.stringify(notes.map((n) => n.text)));
check("colours come from the colour column", notes.find((n) => n.text === "Write docs").color === "#ff0000" && notes.find((n) => n.text === "Fix, then ship").color === "#81d4fa");
check("the notes sit in a grid, not on top of each other", new Set(notes.map((n) => `${n.x},${n.y}`)).size === 3);
await ann.page.keyboard.press("Control+z");
check("one undo removes the whole import", (await ann.page.evaluate(() => window.__board.list().length)) === 0);

// 2. Reactions reach a person with view-only access
await bob.page.goto(`${APP}/#/board/${id}`);
await bob.page.waitForSelector("canvas");
await bob.page.waitForFunction(() => window.__provider?.synced);
await ann.page.waitForTimeout(800);
await ann.page.getByRole("button", { name: "Celebrate" }).click();
await bob.page.getByRole("status").filter({ hasText: /Ann Author reacted: Celebrate/ }).first().waitFor({ timeout: 8000 });
check("a reaction from the owner shows for a viewer", true);
await bob.page.waitForTimeout(1200);
await bob.page.getByRole("button", { name: "Applause" }).click();
await ann.page.getByRole("status").filter({ hasText: /Bob Builder reacted: Applause/ }).first().waitFor({ timeout: 8000 });
check("and a viewer's reaction shows for the owner", true);
check("a reaction leaves nothing on the board", (await ann.page.evaluate(() => window.__board.list().length)) === 0);
await ann.page.waitForFunction(() => !document.body.innerText.includes("reacted: Applause"), null, { timeout: 8000 });
check("reactions fade after a few seconds", true);

// 3. Markers and caveats
check("a person who isn't an administrator can't change the marker list", (await call(ann.page, "PUT", "/api/admin/markers", [])).status === 403);
check("the administrator lists markers", (await call(ada.page, "PUT", "/api/admin/markers", [{ key: "CABINET", label: "Cabinet" }, { key: "SIC", label: "Staff-in-confidence" }])).status === 200);
await ann.page.reload();
await ann.page.waitForSelector("canvas");
await ann.page.getByRole("button", { name: "Share" }).click();
await ann.page.getByLabel("Cabinet").click();
await ann.page.getByLabel("Cabinet").waitFor();
await ann.page.waitForFunction(() => document.querySelector("[role=banner]")?.textContent?.includes("Cabinet"));
await ann.page.getByRole("button", { name: "Done" }).click();
const banner = await ann.page.getByRole("banner").first().innerText();
check("the owner picks a marker and the banner shows it after the classification", banner === "OFFICIAL // Cabinet", JSON.stringify(banner));
await bob.page.reload();
await bob.page.waitForSelector("canvas");
check("everyone on the board sees it", (await bob.page.getByRole("banner").first().innerText()) === "OFFICIAL // Cabinet");
const svg = await ann.page.evaluate(async (bid) => { const r = await fetch(`/api/boards/${bid}/thumbnail`); return r.status; }, id);
check("the thumbnail still loads", svg === 200);
await call(ann.page, "PUT", `/api/boards/${id}/markers`, { markers: [] });
await call(ada.page, "PUT", "/api/admin/markers", []);

// 4. Retention and archiving (ADM-4)
await ada.page.goto(`${APP}/#/admin`);
await ada.page.reload();
await ada.page.getByLabel("Archive unopened boards").check();
await ada.page.getByRole("spinbutton", { name: /after/ }).fill("6");
await ada.page.getByRole("button", { name: "Save retention rule" }).click();
await ada.page.getByRole("status").filter({ hasText: "Saved." }).first().waitFor();
check("the administrator sets the retention rule", (await call(ada.page, "GET", "/api/admin/retention")).body.archiveAfterMonths === 6);
await call(ada.page, "PUT", "/api/admin/retention", { archiveAfterMonths: null });
await ann.page.goto(APP + "/");
ann.page.once("dialog", (d) => d.accept());
await ann.page.getByRole("listitem").filter({ hasText: `P2 ${RUN}` }).getByRole("button", { name: "Archive" }).click();
await ann.page.getByRole("button", { name: "Archived" }).click();
const row = ann.page.getByRole("listitem").filter({ hasText: `P2 ${RUN}` });
await row.getByRole("button", { name: "Restore from archive" }).waitFor();
check("an owner archives a board, and finds it under Archived", true);
await ann.page.goto(`${APP}/#/board/${id}`);
await ann.page.getByText("This board is archived, so it's read-only.").waitFor();
check("an archived board says so, and its tools are off", await ann.page.getByRole("button", { name: "Sticky note" }).isDisabled());
await ann.page.getByRole("button", { name: "Restore from archive" }).click();
await ann.page.waitForSelector("canvas");
await ann.page.waitForFunction(() => !document.body.innerText.includes("This board is archived"));
check("the owner restores it from the board", !(await ann.page.getByRole("button", { name: "Sticky note" }).isDisabled()));

// 5. Lock and private mode (WSH-7)
const eve = await login("eve");
await call(ann.page, "PUT", `/api/boards/${id}/members`, { type: "user", principalId: bob.me.id, role: "editor", name: "Bob" });
await call(ann.page, "PUT", `/api/boards/${id}/members`, { type: "user", principalId: eve.me.id, role: "editor", name: "Eve" });
const open = async (who) => { await who.page.goto(`${APP}/#/board/${id}`); await who.page.reload(); await who.page.waitForSelector("canvas"); await who.page.waitForFunction(() => window.__provider?.synced); };
await Promise.all([open(ann), open(bob), open(eve)]);
const count = (who) => who.page.evaluate(() => window.__board.list().filter((o) => o.type === "sticky").length);
await ann.page.getByRole("button", { name: "Lock board" }).click();
await bob.page.getByText("Ann Author locked the board").waitFor({ timeout: 8000 });
check("when the owner locks the board, the others see who locked it", true);
check("and their tools turn off", await bob.page.getByRole("button", { name: "Sticky note" }).isDisabled());
await bob.page.evaluate(() => window.__board.add({ type: "sticky", text: "bob while locked" }));
await ann.page.waitForTimeout(800);
check("an edit forced in during the lock never reaches the owner", (await count(ann)) === 0);
await ann.page.evaluate(() => window.__board.add({ type: "sticky", text: "ann while locked" }));
await eve.page.waitForFunction(() => window.__board.list().some((o) => o.text === "ann while locked"), null, { timeout: 8000 });
check("the owner can still edit, and others see it", true);
await ann.page.getByRole("button", { name: "Unlock board" }).click();
await bob.page.getByRole("button", { name: "Sticky note" }).waitFor();
await bob.page.waitForFunction(() => !document.body.innerText.includes("locked the board"));
check("unlocking gives the tools back", !(await bob.page.getByRole("button", { name: "Sticky note" }).isDisabled()));
// Bob's forced edit stays in his own browser, and his offline cache sends it once the lock ends. It's his own note.
await open(bob);

await ann.page.getByRole("button", { name: "Start private mode" }).click();
await bob.page.getByText("Ann Author started private mode").waitFor({ timeout: 8000 });
await eve.page.getByText("Ann Author started private mode").waitFor({ timeout: 8000 });
await bob.page.evaluate(() => window.__board.add({ type: "sticky", text: "bob's idea" }));
await eve.page.evaluate(() => window.__board.add({ type: "sticky", text: "eve's idea" }));
await ann.page.waitForFunction(() => ["bob's idea", "eve's idea"].every((t) => window.__board.list().some((o) => o.text === t)), null, { timeout: 8000 });
check("the facilitator sees everyone's notes", true);
await bob.page.waitForTimeout(800);
const bobSees = await bob.page.evaluate(() => window.__board.list().map((o) => o.text).sort());
check("another editor sees their own and the facilitator's, not other people's", JSON.stringify(bobSees) === JSON.stringify(["ann while locked", "bob while locked", "bob's idea"]), JSON.stringify(bobSees));
const eveSees = await eve.page.evaluate(() => window.__board.list().map((o) => o.text).sort());
check("and the others do the same", JSON.stringify(eveSees) === JSON.stringify(["ann while locked", "eve's idea"]), JSON.stringify(eveSees));
check("the board list, which exports and the minimap read, leaves out hidden notes", (await bob.page.evaluate(() => window.__board.list().length)) === 3);
await ann.page.getByRole("button", { name: "Reveal everyone's notes" }).click();
await bob.page.waitForFunction(() => window.__board.list().some((o) => o.text === "eve's idea"), null, { timeout: 8000 });
check("revealing shows everyone's notes to everyone", (await bob.page.evaluate(() => window.__board.list().length)) === 4);

await browser.close();
const failed = res.filter((r) => !r).length;
console.log(`\n${res.length - failed}/${res.length} passed`);
process.exit(failed ? 1 : 0);
