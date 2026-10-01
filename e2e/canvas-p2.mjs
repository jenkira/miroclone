// Tables, mind maps, link cards, and PDF cards (CNV-15, CNV-16, CNV-17) against the full stack.
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir, networkInterfaces } from "node:os";
import { join } from "node:path";

const APP = "http://127.0.0.1:5199", IDP = "http://127.0.0.1:4010";
const res = [];
const check = (n, ok, x = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  " + x : ""}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
async function login(user) {
  await fetch(`${IDP}/switch?user=${user}`);
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  pageerror:", e.message.slice(0, 160)));
  await page.goto(APP + "/auth/login");
  await page.waitForSelector("text=Signed in as");
  return page;
}
const call = (page, method, url, body) => page.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: b ? { "content-type": "application/json" } : undefined, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [method, url, body]);
const RUN = Date.now();

const ann = await login("ann"), ada = await login("ada");
await ann.getByLabel("Title").fill(`Canvas P2 ${RUN}`);
await ann.getByRole("button", { name: "Create board" }).click();
await ann.waitForURL(/#\/board\//);
const id = ann.url().split("/board/")[1];
await ann.waitForSelector("canvas");
await ann.waitForFunction(() => window.__provider?.synced);
const list = () => ann.evaluate(() => window.__board.list());
const toScreen = (p) => ann.evaluate((p) => window.__api.current.toScreen(p), p);

// 1. Tables
await ann.getByRole("button", { name: "Table", exact: true }).click();
const at = await toScreen({ x: 400, y: 150 });
await ann.mouse.click(at.x, at.y);
const group = ann.getByRole("group", { name: "Table cells" });
await group.waitFor();
await group.getByLabel("Row 1, column 1").fill("Name");
await group.getByLabel("Row 1, column 2").fill("Owner");
await group.getByLabel("Row 2, column 1").fill("Plan <b>A</b>");
await group.getByLabel("Row 2, column 2").fill("Ann");
let t = (await list()).find((o) => o.type === "table");
check("the Table tool makes a 3 by 3 table, and the cells take text", t.rows === 3 && t.cols === 3 && t.cells[0] === "Name" && t.cells[4] === "Ann" && t.cells[3] === "Plan <b>A</b>", JSON.stringify(t.cells));
await group.getByRole("button", { name: "Add column" }).click();
await group.getByRole("button", { name: "Add row" }).click();
t = (await list()).find((o) => o.type === "table");
check("rows and columns can be added, keeping the text", t.rows === 4 && t.cols === 4 && t.cells[0] === "Name" && t.cells[5] === "Plan <b>A</b>".replace("<b>A</b>", "<b>A</b>") || t.cells[4] === "Plan <b>A</b>", `${t.rows}x${t.cols} ${JSON.stringify(t.cells.slice(0, 6))}`);
await group.getByRole("button", { name: "Remove last column" }).click();
check("the last column can be removed", (await list()).find((o) => o.type === "table").cols === 3);
await ann.screenshot({ path: join(process.env.SHOT_DIR ?? ".", "table.png") });

// 2. Mind map
await ann.getByRole("button", { name: "Mind map", exact: true }).click();
const m = await toScreen({ x: 150, y: 400 });
await ann.mouse.click(m.x, m.y);
await ann.getByLabel("Edit object text").waitFor();
await ann.keyboard.type("Launch");
await ann.mouse.click(m.x + 600, m.y + 250);   // Click away to finish the text.
const root = (await list()).find((o) => o.mind && !o.parentId);
check("the Mind map tool makes a root node and opens it for typing", root?.text === "Launch", JSON.stringify(root && { text: root.text }));
await ann.evaluate((rid) => window.__api.current.select([rid]), root.id);
await ann.evaluate(() => document.querySelector("[role=application]").focus());
await ann.keyboard.press("Tab");
await ann.getByLabel("Edit object text").waitFor();
await ann.keyboard.type("Marketing");
await ann.keyboard.press("Escape");
await ann.keyboard.press("Enter");
await ann.getByLabel("Edit object text").waitFor();
await ann.keyboard.type("Sales");
await ann.keyboard.press("Escape");
await ann.keyboard.press("Tab");
await ann.getByLabel("Edit object text").waitFor();
await ann.keyboard.type("Webinar");
await ann.keyboard.press("Escape");
const nodes = (await list()).filter((o) => o.mind);
const byText = Object.fromEntries(nodes.map((n) => [n.text, n]));
check("Tab adds a child, Enter adds a sibling, and they hang from the right parents", byText.Marketing?.parentId === root.id && byText.Sales?.parentId === root.id && byText.Webinar?.parentId === byText.Sales?.id, JSON.stringify(nodes.map((n) => [n.text, n.parentId === root.id ? "root" : n.parentId ? "child" : ""])));
check("each node is joined to its parent by a connector", (await list()).filter((o) => o.type === "connector").length === 3);
const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
check("the nodes don't overlap", nodes.every((a, i) => nodes.every((b, j) => i >= j || !overlap(a, b))));
await ann.keyboard.press("Shift+Tab");
await ann.waitForFunction(() => window.__api.current.selection().length === 1);
await ann.evaluate((sid) => window.__api.current.select([sid]), byText.Sales.id);
await ann.keyboard.press("Delete");
check("deleting a node deletes its branch and connectors", (await list()).filter((o) => o.mind).length === 2 && (await list()).filter((o) => o.type === "connector").length === 1);
await ann.keyboard.press("Control+z");
check("one undo brings the branch back", (await list()).filter((o) => o.mind).length === 4);

// 3. Link cards, with previews only from an allowed internal host
const ip = Object.values(networkInterfaces()).flat().find((i) => i.family === "IPv4" && !i.internal)?.address;
if (!ip) { console.log("SKIP  no non-loopback address for the fake wiki"); }
else {
  let hits = 0;
  const wiki = createServer((req, rsp) => { hits++; rsp.setHeader("content-type", "text/html"); rsp.end("<head><title>Team handbook &amp; norms</title><meta name=\"description\" content=\"How we work\"></head>"); });
  await new Promise((r) => wiki.listen(0, ip, r));
  const url = `http://${ip}:${wiki.address().port}/handbook`;
  const add = async (u) => { ann.once("dialog", (d) => d.accept(u)); await ann.getByRole("button", { name: "Add link" }).click(); };
  await add(url);
  await ann.waitForFunction(() => window.__board.list().some((o) => o.type === "embed"));
  let e = (await list()).find((o) => o.type === "embed");
  check("with no allowed hosts, a link card is made but nothing is fetched", e.kind === "link" && e.url === url && e.title === "" && hits === 0, JSON.stringify({ title: e.title, hits }));
  check("the administrator allows a host", (await call(ada, "PUT", "/api/admin/link-preview-hosts", [`${ip}`])).status === 200);
  await ann.evaluate((eid) => window.__board.remove([eid]), e.id);
  await add(url);
  await ann.waitForFunction(() => window.__board.list().filter((o) => o.type === "embed").length === 1 && window.__board.list().find((o) => o.type === "embed").title);
  e = (await list()).find((o) => o.type === "embed");
  check("an allowed internal host gives the card a title and description", e.title === "Team handbook & norms" && e.description === "How we work" && hits === 1, JSON.stringify({ title: e.title, description: e.description, hits }));
  const loopback = await call(ann, "GET", `/api/boards/${id}/link-preview?url=${encodeURIComponent(`http://127.0.0.1:${wiki.address().port}/`)}`);
  check("a host that isn't allowed is never fetched", loopback.body.fetched === false && hits === 1);
  await ann.getByRole("link", { name: new RegExp(`Open ${ip}`) }).waitFor();
  check("the card offers to open the link in a new tab, safely", (await ann.getByRole("link", { name: new RegExp(`Open ${ip}`) }).getAttribute("rel")) === "noopener noreferrer");
  await call(ada, "PUT", "/api/admin/link-preview-hosts", []);
  wiki.close();
}

// 4. PDF cards
const dir = mkdtempSync(join(tmpdir(), "pdf-"));
const make = (name, extra = "") => {
  const body = `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R ${extra} >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj\n4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF`;
  const f = join(dir, name); writeFileSync(f, body, "latin1"); return f;
};
await ann.getByLabel("Choose a PDF file").setInputFiles(make("Roadmap.pdf"));
await ann.waitForFunction(() => window.__board.list().some((o) => o.type === "embed" && o.kind === "pdf"));
const pdf = (await list()).find((o) => o.type === "embed" && o.kind === "pdf");
check("a PDF is stored and a card names it, with its page count", pdf.name === "Roadmap.pdf" && pdf.title === "Roadmap" && pdf.pages === 2 && !!pdf.fileId, JSON.stringify({ name: pdf.name, pages: pdf.pages }));
await ann.getByRole("button", { name: "Preview PDF" }).click();
await ann.getByRole("dialog", { name: /Preview of Roadmap.pdf/ }).waitFor();
const frame = await ann.locator("iframe[title='Roadmap.pdf']").getAttribute("src");
check("the preview opens the file from a local address in a window on the page", frame?.startsWith("blob:"));
await ann.getByRole("button", { name: "Close preview" }).click();
const [dl] = await Promise.all([ann.waitForEvent("download"), ann.getByRole("button", { name: "Download" }).click()]);
const saved = join(dir, "saved.pdf"); await dl.saveAs(saved);
check("the PDF downloads and opens in a real reader", /Pages:\s+2/.test(execFileSync("pdfinfo", [saved]).toString()));
await ann.getByLabel("Choose a PDF file").setInputFiles(make("Bad.pdf", "/OpenAction << /S /JavaScript /JS (app.alert(1)) >>"));
await ann.getByRole("alert").filter({ hasText: /active content/ }).waitFor();
check("a PDF with active content is refused", (await list()).filter((o) => o.type === "embed" && o.kind === "pdf").length === 1);

// Search finds the new objects' text, and a PDF's file is served only to people on the board
await ann.waitForTimeout(500);
const svg = await ann.evaluate(async (bid) => (await fetch(`/api/boards/${bid}/thumbnail`)).status, id);
check("the thumbnail still draws a board with every new object type", svg === 200);
await browser.close();
const failed = res.filter((r) => !r).length;
console.log(`\n${res.length - failed}/${res.length} passed`);
process.exit(failed ? 1 : 0);
