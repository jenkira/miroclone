// Runs the Miro migration tool against a fake Miro, then imports its output as an administrator (MIG-1 to MIG-5).
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP = "http://127.0.0.1:5199", IDP = "http://127.0.0.1:4010";
const res = [];
const check = (n, ok, x = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  " + x : ""}`); };
const RUN = Date.now();
const TOKEN = "miro-secret-" + RUN;
// A new board ID for each run, because the product refuses to import the same Miro board twice.
const BID = `u${RUN}=`;

// A 1x1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const seen = [];
const miro = createServer((req, rsp) => {
  const u = new URL(req.url, "http://x");
  seen.push({ path: u.pathname, auth: req.headers.authorization });
  const json = (b) => { rsp.setHeader("content-type", "application/json"); rsp.end(JSON.stringify(b)); };
  // Miro board IDs end in "=", and the tool sends it encoded, so compare the decoded path.
  const p = decodeURIComponent(u.pathname);
  if (p === "/files/logo.png") { rsp.end(PNG); return; }
  if (req.headers.authorization !== `Bearer ${TOKEN}`) { rsp.statusCode = 401; rsp.end(); return; }
  if (p === "/v2/boards") return json({ data: [{ id: BID, name: `Roadmap ${RUN}` }] });
  if (p === `/v2/boards/${BID}`) return json({ id: BID, name: `Roadmap ${RUN}`, owner: { id: "m1", name: "Ann Author" } });
  if (p === `/v2/boards/${BID}/items`) return json({ data: [
    { id: "f1", type: "frame", data: { title: "Now" }, position: { x: 300, y: 200 }, geometry: { width: 600, height: 400 } },
    { id: "s1", type: "sticky_note", data: { content: "<p>Ship <b>v1</b> &amp; celebrate</p>" }, style: { fillColor: "light_green" }, parent: { id: "f1" }, position: { x: 150, y: 150, relativeTo: "parent_top_left" }, geometry: { width: 200 } },
    { id: "c1", type: "card", data: { title: "Write docs", description: "<p>Google style</p>", assignee: { userId: "m1" }, dueDate: "2026-10-31T00:00:00Z" }, style: { cardTheme: "#2d9bf0" }, position: { x: 600, y: 300 }, geometry: { width: 240, height: 140 } },
    { id: "im1", type: "image", position: { x: 1100, y: 200 }, geometry: { width: 200, height: 100 } },
    { id: "e1", type: "embed", data: { title: "Demo video" }, position: { x: 1100, y: 500 }, geometry: { width: 300, height: 200 } },
  ] });
  if (p === `/v2/boards/${BID}/connectors`) return json({ data: [{ id: "k1", startItem: { id: "s1" }, endItem: { id: "c1" }, shape: "curved" }] });
  if (p === `/v2/boards/${BID}/members`) return json({ data: [{ id: "m1", name: "Ann Author", email: "ann@example.test" }] });
  if (p === `/v2/boards/${BID}/images/im1`) return json({ data: { imageUrl: `http://127.0.0.1:${miro.address().port}/files/logo.png` } });
  rsp.statusCode = 404; rsp.end();
});
await new Promise((r) => miro.listen(0, "127.0.0.1", r));
const out = mkdtempSync(join(tmpdir(), "migration-"));

// 1. Run the tool
let output = "";
// The fake Miro runs in this process, so the tool must run without blocking it.
try {
  output = (await promisify(execFile)("node", ["--import", "tsx", "src/cli.ts", "export", "--all", "--out", out, "--api-base", `http://127.0.0.1:${miro.address().port}`], { cwd: "tools/miro-migrate", env: { ...process.env, MIRO_TOKEN: TOKEN } })).stdout;
} catch (e) { output = String(e.stdout) + String(e.stderr); }
check("the tool exports the board", /Exported 1 of 1 boards/.test(output), output.trim().split("\n").slice(-2).join(" | "));
check("the tool sent the token only to Miro, as a bearer header", seen.filter((s) => s.path.startsWith("/v2/")).every((s) => s.auth === `Bearer ${TOKEN}`) && seen.filter((s) => s.path.startsWith("/files/")).every((s) => !s.auth));
const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
const entry = manifest.boards[0];
check("the manifest has the owner's email", entry.ownerEmail === "ann@example.test", JSON.stringify(entry).slice(0, 160));
const report = readFileSync(join(out, entry.folder, "report.md"), "utf8");
check("the report lists the placeholder and the approximated colour", report.includes('no equivalent for "embed"') && report.includes("light_green"));
check("the report and files don't hold the token", ![report, JSON.stringify(manifest), ...readdirSync(join(out, entry.folder)).map((f) => f)].some((t) => t.includes(TOKEN)));

// 2. Import as an administrator
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
const login = async (user) => {
  await fetch(`${IDP}/switch?user=${user}`);
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(APP + "/auth/login");
  await page.waitForSelector("text=Signed in as");
  return page;
};
const ann = await login("ann");   // Signs in first, so the importer can match the email.
const ada = await login("ada");
await ada.goto(`${APP}/#/admin`);
await ada.getByLabel("Migration folder").setInputFiles(out);
const row = ada.getByRole("row", { name: new RegExp(`Roadmap ${RUN}`) });
await row.waitFor();
check("the page lists the exported board with its owner email", (await row.getByLabel(/Owner email/).inputValue()) === "ann@example.test");
await row.getByLabel(/Classification for/).selectOption("SENSITIVE");
await ada.getByRole("button", { name: /Import 1 board/ }).click();
await row.getByText(/^Imported/).waitFor({ timeout: 20000 });
check("the import finishes", true, await row.getByText(/^Imported/).innerText());
await ada.getByRole("button", { name: /Import 0 boards/ }).waitFor();

// 3. Ann owns it, with the classification, content, and image
const boards = await ann.evaluate(async () => (await fetch("/api/boards?filter=owned")).json());
const b = boards.find((x) => x.title === `Roadmap ${RUN}`);
check("Ann owns the board, at the classification the administrator chose", b?.role === "owner" && b.classification === "SENSITIVE", JSON.stringify(b));
await ann.goto(`${APP}/#/board/${b.id}`);
await ann.waitForSelector("canvas");
await ann.waitForFunction(() => window.__provider?.synced);
await ann.waitForFunction(() => window.__board.list().length >= 6);
const objs = await ann.evaluate(() => window.__board.list().map((o) => ({ type: o.type, text: o.text, title: o.title, assignee: o.assignee, due: o.due, x: o.x, y: o.y, key: o.objectKey })));
check("the board has a frame, the sticky text without markup, the card, and a placeholder", objs.some((o) => o.type === "frame" && o.title === "Now") && objs.some((o) => o.text === "Ship v1 & celebrate") && objs.some((o) => o.type === "card" && o.assignee === "Ann Author" && o.due === "2026-10-31") && objs.some((o) => o.text?.startsWith("Unsupported Miro item: embed")), JSON.stringify(objs).slice(0, 300));
// The frame's centre is (300, 200) and it is 600 by 400, so its corner is (0, 0). The sticky's centre is 150 right and 150 down from that corner.
const st = objs.find((o) => o.text === "Ship v1 & celebrate");
check("the sticky sits inside its frame, at the right place", st.x === 50 && st.y === 50, JSON.stringify([st.x, st.y]));
const image = objs.find((o) => o.type === "image");
const served = await ann.evaluate(async ([id, key]) => { const r = await fetch(`/api/boards/${id}/files/${key}`); return [r.status, r.headers.get("content-type"), (await r.arrayBuffer()).byteLength]; }, [b.id, image?.key]);
check("the image was stored and is served", served[0] === 200 && served[1] === "image/png", JSON.stringify(served));
const connectors = await ann.evaluate(() => window.__board.list().filter((o) => o.type === "connector").length);
check("the connector came across", connectors === 1);

// 4. A second import is refused
await ada.reload();
await ada.getByLabel("Migration folder").setInputFiles(out);
const row2 = ada.getByRole("row", { name: new RegExp(`Roadmap ${RUN}`) });
await row2.waitFor();
await ada.getByRole("button", { name: /Import 1 board/ }).click();
await row2.getByText(/Already imported/).waitFor({ timeout: 20000 });
check("importing the same Miro board again is refused", true);

// 5. A person without the role can't use the endpoint
const refused = await ann.evaluate(async () => (await fetch("/api/admin/migration/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ board: "{}", classification: "OFFICIAL" }) })).status);
check("a person who isn't an administrator is refused", refused === 403);

await browser.close(); miro.close();
const failed = res.filter((r) => !r).length;
console.log(`\n${res.length - failed}/${res.length} passed`);
process.exit(failed ? 1 : 0);
