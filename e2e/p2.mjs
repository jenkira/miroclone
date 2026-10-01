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

await browser.close();
const failed = res.filter((r) => !r).length;
console.log(`\n${res.length - failed}/${res.length} passed`);
process.exit(failed ? 1 : 0);
