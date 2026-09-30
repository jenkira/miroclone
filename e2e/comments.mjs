// Comments, mentions, and notification email (COL-7, COL-8) against the full stack.
// Also needs the SMTP sink (`pnpm --filter @miroclone/worker smtp-sink`). The script starts two workers itself.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";

const APP = "http://127.0.0.1:5199", IDP = "http://127.0.0.1:4010", SINK = "http://127.0.0.1:2526";
const res = [];
const check = (n, ok, x = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  " + x : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
const mails = () => fetch(`${SINK}/mails`).then((r) => r.json());
await fetch(`${SINK}/clear`);

async function login(user) {
  await fetch(`${IDP}/switch?user=${user}`);
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 800 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  pageerror:", e.message.slice(0, 120)));
  await page.goto(APP + "/auth/login");
  await page.waitForSelector("text=Signed in as");
  return { ctx, page };
}
const pixel = (page, x, y) => page.screenshot({ clip: { x: x - 2, y: y - 2, width: 4, height: 4 } }).then((b) => page.evaluate(async (b64) => { const i = new Image(); i.src = "data:image/png;base64," + b64; await i.decode(); const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const g = c.getContext("2d"); g.drawImage(i, 0, 0); return [...g.getImageData(1, 1, 1, 1).data]; }, b.toString("base64")));
const orange = (p) => p[0] > 220 && p[1] > 110 && p[1] < 170 && p[2] < 40;
const grey = (p) => Math.abs(p[0] - 158) < 12 && Math.abs(p[1] - 158) < 12 && Math.abs(p[2] - 158) < 12;

const ann = await login("ann");
await ann.page.getByLabel("Title").fill("Launch plan for Project Kestrel");
await ann.page.getByLabel("Classification").selectOption("PROTECTED");
await ann.page.getByRole("button", { name: "Create board" }).click();
await ann.page.waitForFunction(() => window.__board);
await ann.page.getByText("Saved automatically").waitFor();
const boardId = ann.page.url().split("/board/")[1];
const share = async (name, role) => {
  await ann.page.getByRole("button", { name: "Share" }).click();
  await ann.page.getByPlaceholder("Search by name or email").fill(name.split(" ")[0].toLowerCase());
  const row = ann.page.getByRole("listitem").filter({ hasText: name });
  await row.getByRole("button").first().waitFor();
  await ann.page.getByRole("dialog").locator("select").first().selectOption(role);
  await row.getByRole("button").first().click();
  await ann.page.getByLabel("Members").getByText(name).waitFor();
  await ann.page.getByRole("button", { name: "Done" }).click();
};
await share("Bob Builder", "commenter");
await share("Eve Overage", "viewer");
const bob = await login("bob");
await bob.page.goto(`${APP}/#/board/${boardId}`);
await bob.page.waitForFunction(() => window.__board);          // Bob opening the board makes him mentionable
await bob.page.getByText("Saved automatically").waitFor();

// 1. Ann adds a comment with a mention at a spot on the canvas
const box = await ann.page.evaluate(() => { const b = document.querySelector("[role=application]").getBoundingClientRect(); return { x: b.left, y: b.top }; });
await ann.page.getByRole("button", { name: "Comment", exact: true }).click();
await ann.page.mouse.click(box.x + 300, box.y + 200);
await ann.page.getByText("New comment at this spot").waitFor();
const ta = ann.page.getByLabel("Comment", { exact: true });
await ta.fill("Can we confirm the date @Bo");
await ann.page.getByRole("listbox", { name: "People to mention" }).getByRole("button", { name: "Bob Builder" }).click();
check("typing @ suggests people who can open the board", true);
await ann.page.getByRole("button", { name: "Comment", exact: true }).last().click();
await ann.page.getByText("Can we confirm the date").first().waitFor();
await ann.page.getByRole("complementary", { name: "Comments" }).locator("strong", { hasText: "@Bob Builder" }).waitFor();
check("the comment appears in a thread, with the mention in bold", true);
await wait(300);
check("a pin is drawn at the clicked spot", orange(await pixel(ann.page, box.x + 300, box.y + 200)), JSON.stringify(await pixel(ann.page, box.x + 300, box.y + 200)));

// 2. Bob is notified in the app
await bob.page.reload();
await bob.page.getByRole("button", { name: /Notifications, 1 unread/ }).waitFor({ timeout: 15000 });
check("Bob sees one unread notification", true);
await bob.page.getByRole("button", { name: /Notifications/ }).click();
const item = bob.page.getByRole("list", { name: "Notifications" }).getByRole("listitem").first();
check("it says who mentioned him, on which board", /Ann Author mentioned you on Launch plan/.test(await item.textContent()) && /PROTECTED/.test(await item.textContent()), await item.textContent());
await bob.page.getByRole("button", { name: /Notifications, 0 unread/ }).waitFor({ timeout: 8000 });
check("opening the list marks them read", true);

// 3. Email goes out through the worker, with no board content
const env = { ...process.env, PORT: "8091", SMTP_HOST: "127.0.0.1", SMTP_PORT: "2525", SMTP_TLS: "0", SMTP_FROM: "miroclone@example.test", APP_URL: APP };
const workers = [spawn("pnpm", ["start"], { cwd: "services/worker", env, stdio: "ignore", detached: true }), spawn("pnpm", ["start"], { cwd: "services/worker", env: { ...env, PORT: "8092" }, stdio: "ignore", detached: true })];
for (let i = 0; i < 30 && (await mails()).length < 1; i++) await wait(1000);
const got = await mails();
check("one email reaches Bob", got.length === 1 && got[0].to.includes("bob@example.test"), `${got.length} mails`);
// Mail is quoted-printable encoded on the wire, so decode it as a mail client does.
const decoded = (got[0]?.data ?? "").replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const body = JSON.stringify({ ...got[0], data: decoded });
check("it links to the board and names the classification", body.includes(`/#/board/${boardId}`) && body.includes("PROTECTED"));
check("it carries no title, comment text, or names", !/Kestrel|confirm the date|Ann Author|Bob Builder/.test(body), "");

// 4. Bob replies; Ann is notified; Ann resolves; the pin turns grey
await bob.page.getByRole("button", { name: /^Comments/ }).click();
await bob.page.getByRole("complementary", { name: "Comments" }).getByLabel("Reply", { exact: true }).fill("Confirmed for 12 March");
await bob.page.getByRole("complementary", { name: "Comments" }).getByRole("button", { name: "Reply", exact: true }).click();
await ann.page.getByRole("button", { name: /Notifications, 1 unread/ }).waitFor({ timeout: 15000 });
check("a reply notifies the other person in the thread", true);
await ann.page.getByText("Confirmed for 12 March").waitFor({ timeout: 15000 });
check("Bob's reply appears for Ann without a reload", true);
await ann.page.getByRole("button", { name: "Resolve" }).click();
await wait(800);
check("resolving turns the pin grey", grey(await pixel(ann.page, box.x + 300, box.y + 200)), JSON.stringify(await pixel(ann.page, box.x + 300, box.y + 200)));
await ann.page.getByRole("button", { name: /Show 1 resolved/ }).click();
await ann.page.getByRole("button", { name: "Reopen" }).click();
await wait(800);
check("reopening turns it orange again", orange(await pixel(ann.page, box.x + 300, box.y + 200)));

// 5. A viewer reads comments but can't write
const eve = await login("eve");
await eve.page.goto(`${APP}/#/board/${boardId}`);
await eve.page.getByText("View only").waitFor();
await eve.page.getByRole("button", { name: /^Comments/ }).click();
await eve.page.getByText("Confirmed for 12 March").waitFor({ timeout: 10000 });
check("a viewer reads the thread", true);
check("a viewer has no reply box and the Comment tool is off", (await eve.page.getByLabel("Reply", { exact: true }).count()) === 0 && (await eve.page.getByRole("button", { name: "Comment", exact: true }).isDisabled()));
const direct = await eve.page.evaluate(async (id) => (await fetch(`/api/boards/${id}/comments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "sneaky" }) })).status, boardId);
check("the API refuses a viewer's comment", direct === 403, String(direct));

// 6. Two workers at once send each email exactly once (real PostgreSQL, SKIP LOCKED)
await fetch(`${SINK}/clear`);
for (let i = 0; i < 12; i++) {
  await ann.page.evaluate(async ([id, n]) => { const me = await (await fetch("/api/boards/" + id + "/mentionable")).json(); const bobId = me.find((p) => p.name === "Bob Builder").id; await fetch(`/api/boards/${id}/comments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: `Note ${n} @[Bob Builder](${bobId})` }) }); }, [boardId, i]);
}
for (let i = 0; i < 40 && (await mails()).length < 12; i++) await wait(1000);
await wait(3000);
const final = await mails();
check("12 mentions produce exactly 12 emails across two workers", final.length === 12, `${final.length} mails`);
for (const w of workers) { try { process.kill(-w.pid); } catch { /* already gone */ } }

await browser.close();
console.log(`\n${res.filter(Boolean).length}/${res.length} checks passed`);
process.exit(res.every(Boolean) ? 0 : 1);
