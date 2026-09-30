// Image upload (CNV-8) against the full stack, with fake S3 and clamd from services/api/dev/fake-storage.ts.
import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const APP = "http://127.0.0.1:5199", IDP = "http://127.0.0.1:4010", S3 = "http://127.0.0.1:9100";
const res = [];
const check = (n, ok, x = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  " + x : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
const total = () => fetch(`${S3}/__stats`).then((r) => r.json()).then((j) => j.objects);
let baseline = 0;
/** Objects this run has stored, so earlier runs against the same fake store don't matter. */
const stored = async () => (await total()) - baseline;

async function login(user) {
  await fetch(`${IDP}/switch?user=${user}`);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  pageerror:", e.message.slice(0, 120)));
  await page.goto(APP + "/auth/login");
  await page.waitForSelector("text=Signed in as");
  return { ctx, page };
}
/** A solid-colour PNG made in the browser. */
const makePng = (page, w, h, colour) => page.evaluate(([w, h, c]) => { const k = document.createElement("canvas"); k.width = w; k.height = h; const x = k.getContext("2d"); x.fillStyle = c; x.fillRect(0, 0, w, h); return k.toDataURL("image/png").split(",")[1]; }, [w, h, colour]).then((b) => Buffer.from(b, "base64"));
/** Reads one pixel of a PNG buffer, in the page. */
const pixelOf = (page, buf, x, y) => page.evaluate(async ([b64, x, y]) => { const i = new Image(); i.src = "data:image/png;base64," + b64; await i.decode(); const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const g = c.getContext("2d"); g.drawImage(i, 0, 0); return [...g.getImageData(x, y, 1, 1).data]; }, [buf.toString("base64"), x, y]);
const centreShot = async (page) => {
  const r = await page.evaluate(() => { const b = document.querySelector("[role=application]").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  return page.screenshot({ clip: { x: r.x - 3, y: r.y - 3, width: 6, height: 6 } });
};
const isRed = (p) => p[0] > 200 && p[1] < 60 && p[2] < 60;
const notice = (page) => page.getByRole("alert").filter({ hasText: /./ }).first().textContent();

baseline = await total();
const ann = await login("ann");
await ann.page.getByLabel("Title").fill("Images");
await ann.page.getByRole("button", { name: "Create board" }).click();
await ann.page.waitForFunction(() => window.__board);
await ann.page.getByText("Saved automatically").waitFor();
const boardId = ann.page.url().split("/board/")[1];
const count = () => ann.page.evaluate(() => window.__board.list().filter((o) => o.type === "image").length);

// 1. Upload a PNG through the file picker
const red = await makePng(ann.page, 80, 60, "#ff0000");
await ann.page.getByLabel("Choose images").setInputFiles({ name: "red.png", mimeType: "image/png", buffer: red });
await ann.page.waitForFunction(() => window.__board.list().some((o) => o.type === "image"), null, { timeout: 8000 });
const img = await ann.page.evaluate(() => window.__board.list().find((o) => o.type === "image"));
check("the image is added at its natural size", img.width === 80 && img.height === 60 && img.mimeType === "image/png", `${img.width}x${img.height}`);
check("the bytes are in object storage", (await stored()) === 1);
await wait(1200);
check("the uploaded pixels are drawn on the canvas", isRed(await pixelOf(ann.page, await centreShot(ann.page), 3, 3)));

// 2. A viewer sees the image too (download is authorised by board role)
await ann.page.getByRole("button", { name: "Share" }).click();
await ann.page.getByPlaceholder("Search by name or email").fill("bob");
const bobRow = ann.page.getByRole("listitem").filter({ hasText: "Bob Builder" });
await bobRow.getByRole("button").first().waitFor();
await ann.page.getByRole("dialog").locator("select").first().selectOption("viewer");
await bobRow.getByRole("button").first().click();
await ann.page.getByLabel("Members").getByText("Bob Builder").waitFor();
await ann.page.getByRole("button", { name: "Done" }).click();
const bob = await login("bob");
await bob.page.goto(`${APP}/#/board/${boardId}`);
await bob.page.waitForFunction(() => window.__board && window.__board.list().length > 0, null, { timeout: 10000 });
await wait(1500);
const bobPx = await pixelOf(bob.page, await centreShot(bob.page), 3, 3);
check("a viewer sees the image", isRed(bobPx), JSON.stringify(bobPx));
check("a viewer has no Add image button", (await bob.page.getByRole("button", { name: "Add image" }).count()) === 0);
const direct = await bob.page.evaluate(async (id) => { const r = await fetch(`/api/boards/${id}`); const meta = await r.json(); const o = window.__board.list().find((x) => x.type === "image"); const up = await fetch(`/api/boards/${id}/files`, { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array([1, 2, 3]) }); const dl = await fetch(`/api/boards/${id}/files/${o.objectKey}`); return { role: meta.role, upload: up.status, dl: dl.status, nosniff: dl.headers.get("x-content-type-options"), csp: dl.headers.get("content-security-policy") }; }, boardId);
check("a viewer who calls the API directly can't upload, but can download", direct.upload === 403 && direct.dl === 200, JSON.stringify(direct));
check("downloads carry nosniff and a sandbox CSP", direct.nosniff === "nosniff" && /sandbox/.test(direct.csp));

// 3. Malware is blocked, and nothing is stored
const eicar = Buffer.concat([red, Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")]);
await ann.page.getByLabel("Choose images").setInputFiles({ name: "bad.png", mimeType: "image/png", buffer: eicar });
await ann.page.getByRole("alert").filter({ hasText: "blocked" }).waitFor({ timeout: 8000 });
check("an infected file is refused with a clear message", true, await notice(ann.page));
check("  and is not stored or added to the board", (await stored()) === 1 && (await count()) === 1);

// 4. Wrong types
await ann.page.getByLabel("Choose images").setInputFiles({ name: "notes.png", mimeType: "image/png", buffer: Buffer.from("<html><script>alert(1)</script>") });
await ann.page.getByRole("alert").filter({ hasText: "Only PNG" }).waitFor({ timeout: 8000 });
check("a file that only claims to be an image is refused by content", (await stored()) === 1 && (await count()) === 1);
await ann.page.getByLabel("Choose images").setInputFiles({ name: "x.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
await ann.page.getByRole("alert").filter({ hasText: "blocked" }).waitFor({ timeout: 8000 });
check("an SVG with a script is refused", (await stored()) === 1 && (await count()) === 1);

// 5. Drag and drop, and paste
const green = await makePng(ann.page, 50, 50, "#00aa00");
await ann.page.evaluate(async (b64) => {
  const f = new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], "green.png", { type: "image/png" });
  const dt = new DataTransfer(); dt.items.add(f);
  const el = document.querySelector("[role=application]");
  el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 700, clientY: 400 }));
}, green.toString("base64"));
await ann.page.waitForFunction(() => window.__board.list().filter((o) => o.type === "image").length === 2, null, { timeout: 8000 });
check("dropping an image file on the canvas adds it", (await stored()) === 2);
await ann.page.evaluate(async (b64) => {
  const f = new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], "p.png", { type: "image/png" });
  const dt = new DataTransfer(); dt.items.add(f);
  window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, green.toString("base64"));
await ann.page.waitForFunction(() => window.__board.list().filter((o) => o.type === "image").length === 3, null, { timeout: 8000 });
check("pasting an image adds it", (await stored()) === 3);

// 6. Exports include the image
await ann.page.evaluate(() => window.__board.remove(window.__board.list().filter((o) => o.type === "image").slice(1).map((o) => o.id)));
await ann.page.getByRole("button", { name: "Escape" }).count();
await ann.page.keyboard.press("Escape");
const [dl] = await Promise.all([ann.page.waitForEvent("download"), ann.page.getByRole("button", { name: "SVG", exact: true }).click()]);
await dl.saveAs("images-export.svg");
const svg = readFileSync("images-export.svg", "utf8");
check("the SVG export embeds the image bytes", /<image href="data:image\/png;base64,/.test(svg) && svg.includes(">OFFICIAL<"));
const [dlp] = await Promise.all([ann.page.waitForEvent("download"), ann.page.getByRole("button", { name: "PNG", exact: true }).click()]);
await dlp.saveAs("images-export.png");
const png = readFileSync("images-export.png");
const info = await ann.page.evaluate(async (b64) => { const i = new Image(); i.src = "data:image/png;base64," + b64; await i.decode(); const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const g = c.getContext("2d"); g.drawImage(i, 0, 0); const d = g.getImageData(0, 0, i.width, i.height).data; let red = 0; for (let k = 0; k < d.length; k += 4) if (d[k] > 200 && d[k + 1] < 60 && d[k + 2] < 60) red++; return { w: i.width, h: i.height, red }; }, png.toString("base64"));
check("the PNG export contains the image's pixels", info.red > 2000, JSON.stringify(info));

// 7. The scanner goes away: uploads fail closed, and nothing is added
console.log("  (stopping the fake scanner and store to simulate an outage)");
execSync("fuser -k 3311/tcp 9100/tcp || true", { shell: "/bin/bash", stdio: "ignore" });
await wait(500);
const before = await count();
await ann.page.getByLabel("Choose images").setInputFiles({ name: "late.png", mimeType: "image/png", buffer: red });
await ann.page.getByRole("alert").filter({ hasText: "isn't available" }).waitFor({ timeout: 8000 });
check("with the scanner down, uploads are refused", (await count()) === before, await notice(ann.page));
await browser.close();
console.log(`\n${res.filter(Boolean).length}/${res.length} checks passed`);
process.exit(res.every(Boolean) ? 0 : 1);
