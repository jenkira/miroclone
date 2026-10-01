// Cards, snapping, the minimap, and PDF export (CNV-12, CNV-13, CNV-14, EXP-2) against the full stack.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP = "http://127.0.0.1:5199", IDP = "http://127.0.0.1:4010";
const res = [];
const check = (n, ok, x = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  " + x : ""}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
await fetch(`${IDP}/switch?user=ann`);
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(APP + "/auth/login");
await page.waitForSelector("text=Signed in as");
const TITLE = `Cards ${Date.now()}`;
await page.getByLabel("Title").fill(TITLE);
await page.getByRole("button", { name: "Create board" }).click();
await page.waitForURL(/#\/board\//);
await page.waitForSelector("canvas");
await page.waitForFunction(() => window.__provider?.synced);
const list = () => page.evaluate(() => window.__board.list());
const toScreen = (p) => page.evaluate((p) => window.__api.current.toScreen(p), p);

// 1. Cards
await page.getByRole("button", { name: "Card", exact: true }).click();
const at = await toScreen({ x: 300, y: 200 });
await page.mouse.click(at.x, at.y);
const card = (await list()).find((o) => o.type === "card");
check("the Card tool makes a card with a title", card?.title === "New card", JSON.stringify(card));
const bar = page.getByRole("group", { name: "Card details" });
await bar.waitFor();
await bar.getByLabel("Title").fill("Fix the login page");
await bar.getByLabel("Assignee").fill("Ann Author");
await bar.getByLabel("Due").fill("2020-01-31");
await bar.getByLabel("Tags").fill("bug, #urgent");
await bar.getByLabel("Description").fill("Users can't sign in after a password reset.");
const c2 = (await list()).find((o) => o.type === "card");
check("the card bar sets title, assignee, due date, tags, and description", c2.title === "Fix the login page" && c2.assignee === "Ann Author" && c2.due === "2020-01-31" && c2.tags.join() === "bug,urgent" && c2.description.startsWith("Users can"), JSON.stringify(c2));
await bar.getByLabel("Due").fill("");
check("clearing the due date removes it", (await list()).find((o) => o.type === "card").due === undefined);
await bar.getByLabel("Due").fill("2020-01-31");
await page.waitForTimeout(400);
await page.screenshot({ path: join(process.env.SHOT_DIR ?? ".", "cards.png") });

// 2. Snapping
await page.evaluate(() => {
  const b = window.__board;
  b.add({ type: "shape", kind: "rectangle", x: 100, y: 500, width: 100, height: 100 });
  b.add({ type: "shape", kind: "rectangle", x: 400, y: 500, width: 100, height: 100 });
});
await page.getByRole("button", { name: "Select", exact: true }).click();
const drag = async (id, dx, dy, alt = false) => {
  const o = (await list()).find((x) => x.id === id);
  const a = await toScreen({ x: o.x + 50, y: o.y + 50 });
  await page.mouse.click(a.x, a.y);
  if (alt) await page.keyboard.down("Alt");
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + dx / 2, a.y + dy / 2, { steps: 4 }); await page.mouse.move(a.x + dx, a.y + dy, { steps: 4 });
  const during = await page.evaluate(() => window.__board.get && null);
  await page.mouse.up();
  if (alt) await page.keyboard.up("Alt");
  return (await list()).find((x) => x.id === id);
};
const ids = (await list()).filter((o) => o.type === "shape").map((o) => o.id);
const zoom = await page.evaluate(() => window.__api.current.viewport().zoom);
// Move the second rectangle so its left edge ends 3 world units from the first's.
const moved = await drag(ids[1], (103 - 400) * zoom, 0);
check("a dragged object snaps to another object's edge", moved.x === 100, `x=${moved.x}`);
await page.keyboard.press("Control+z");
const unsnapped = await drag(ids[1], (103 - 400) * zoom, 0, true);
check("holding Alt turns snapping off", Math.abs(unsnapped.x - 103) < 1, `x=${unsnapped.x}`);

// 3. Minimap
const map = page.getByRole("img", { name: /Board minimap/ });
check("the minimap is shown", await map.isVisible());
const v0 = await page.evaluate(() => window.__api.current.viewport());
const box = await map.boundingBox();
await page.mouse.click(box.x + box.width - 6, box.y + box.height - 6);
const v1 = await page.evaluate(() => window.__api.current.viewport());
check("clicking the minimap moves the view", Math.abs(v1.x - v0.x) > 5 || Math.abs(v1.y - v0.y) > 5, `${Math.round(v0.x)},${Math.round(v0.y)} -> ${Math.round(v1.x)},${Math.round(v1.y)}`);
check("the minimap draws the objects and the view", (await map.locator("rect").count()) >= 4);

// Keyboard navigation (section 7.3)
await page.evaluate(() => document.querySelector("[role=application]").focus());
await page.keyboard.press("Escape");
await page.keyboard.press("Tab");
const first = await page.evaluate(() => window.__api.current.selection());
const said = await page.getByRole("status").filter({ hasText: /of \d+\./ }).first().innerText();
check("Tab selects the first object and announces it", first.length === 1 && /^\w[\w ]*.* 1 of \d+\.$/.test(said), said);
await page.keyboard.press("Tab");
const second = await page.evaluate(() => window.__api.current.selection());
check("Tab again moves to the next object", second.length === 1 && second[0] !== first[0] && /2 of/.test(await page.getByRole("status").filter({ hasText: /of \d+\./ }).first().innerText()));
await page.keyboard.press("Shift+Tab");
check("Shift+Tab moves back", (await page.evaluate(() => window.__api.current.selection()))[0] === first[0]);
await page.keyboard.press("Escape");

// 4. PDF export: one page per frame, in order
await page.evaluate(() => {
  const b = window.__board;
  b.add({ type: "frame", title: "Second", x: 1000, y: 100, width: 600, height: 400 });
  b.add({ type: "frame", title: "First", x: 100, y: 100, width: 600, height: 400 });
  b.add({ type: "sticky", x: 150, y: 150, width: 160, height: 160, text: "In the first frame" });
});
await page.getByRole("button", { name: "Escape" }).first().click().catch(() => {});
await page.keyboard.press("Escape");
const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "PDF" }).click()]);
const dir = mkdtempSync(join(tmpdir(), "pdf-"));
const file = join(dir, "out.pdf");
await download.saveAs(file);
const info = execFileSync("pdfinfo", [file]).toString();
check("the PDF opens in a real reader", /Pages:\s+2/.test(info), info.split("\n").filter((l) => /Pages|Title|Subject|Page size/.test(l)).join(" | "));
check("the title and classification are in its properties", /Title:\s+Cards/.test(info) && /Subject:\s+OFFICIAL/.test(info));
execFileSync("pdftoppm", ["-png", "-r", "40", file, join(dir, "page")]);
const png = readFileSync(join(dir, "page-1.png"));
check("a page renders to an image", png.length > 1000, `${png.length} bytes`);
writeFileSync(join(process.env.SHOT_DIR ?? ".", "pdf-page-1.png"), png);
const audit = await page.evaluate(async () => 0);

check("no page errors", errors.length === 0, errors.join("; ").slice(0, 200));
await browser.close();
const failed = res.filter((r) => !r).length;
console.log(`\n${res.length - failed}/${res.length} passed`);
process.exit(failed ? 1 : 0);
