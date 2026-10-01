// Spaces, organisation-wide visibility, ownership transfer, and thumbnails (BRD-2, BRD-3, BRD-5, IAM-8) against the full stack.
import { chromium } from "playwright-core";

const APP = "http://127.0.0.1:5199", IDP = "http://127.0.0.1:4010";
const res = [];
const check = (n, ok, x = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  " + x : ""}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
async function login(user) {
  await fetch(`${IDP}/switch?user=${user}`);
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  pageerror:", e.message.slice(0, 120)));
  page.on("dialog", (d) => d.accept(d.type() === "prompt" ? d.defaultValue() || globalThis.__promptAnswer : undefined));
  await page.goto(APP + "/auth/login");
  await page.waitForSelector("text=Signed in as");
  const me = await page.evaluate(async () => (await fetch("/api/me")).json());
  return { ctx, page, me };
}
const status = (page, url, method = "GET", body) => page.evaluate(async ([u, m, b]) => (await fetch(u, { method: m, headers: b ? { "content-type": "application/json" } : undefined, body: b ? JSON.stringify(b) : undefined })).status, [url, method, body]);
const RUN = Date.now();

const ann = await login("ann"), bob = await login("bob");
const TITLE = `Spaces ${RUN}`;
await ann.page.getByLabel("Title").fill(TITLE);
await ann.page.getByRole("button", { name: "Create board" }).click();
await ann.page.waitForURL(/#\/board\//);
const id = ann.page.url().split("/board/")[1];

// Organisation-wide visibility from the share dialog
check("bob can't open the board at first", (await status(bob.page, `/api/boards/${id}`)) === 404);
await ann.page.getByRole("button", { name: "Share" }).click();
await ann.page.getByLabel("Organisation-wide role").selectOption("viewer");
await ann.page.waitForFunction(async (i) => (await (await fetch(`/api/boards/${i}/visibility`)).json()).role === "viewer", id);
check("an owner makes the board visible to the organisation", (await status(bob.page, `/api/boards/${id}`)) === 200);
await ann.page.getByRole("button", { name: "Done" }).click();

// Ownership transfer (bob is a member first)
await status(ann.page, `/api/boards/${id}/members`, "PUT", { type: "user", principalId: bob.me.id, role: "editor", name: "bob" });
await ann.page.getByRole("button", { name: "Share" }).click();
await ann.page.getByRole("button", { name: "Make owner" }).click();
await ann.page.waitForFunction(async ([i, b]) => (await (await fetch(`/api/boards/${i}/members`)).json()).find((m) => m.id === b)?.role === "owner", [id, bob.me.id]);
check("an owner hands the board to another person", true);
check("and loses the right to delete it", (await status(ann.page, `/api/boards/${id}`, "DELETE")) === 403);
await ann.page.getByRole("button", { name: "Done" }).click();

// PROTECTED boards can't be organisation-wide
await ann.page.goto(APP + "/");
await ann.page.getByLabel("Title").fill(`Prot ${RUN}`);
await ann.page.getByLabel("Classification").selectOption("PROTECTED");
await ann.page.getByRole("button", { name: "Create board" }).click();
await ann.page.waitForURL(/#\/board\//);
await ann.page.getByRole("button", { name: "Share" }).click();
check("the organisation-wide option is off on a PROTECTED board", await ann.page.getByLabel("Organisation-wide role").isDisabled());
await ann.page.getByRole("button", { name: "Done" }).click();

// Spaces on the dashboard
await bob.page.goto(APP + "/");
await bob.page.reload();
await bob.page.getByRole("link", { name: TITLE }).waitFor({ timeout: 10000 });
globalThis.__promptAnswer = `Team ${RUN}`;
await bob.page.getByRole("button", { name: "New space" }).click();
// Creating a space opens it, so wait for that before going back to every board.
await bob.page.getByRole("region", { name: "Spaces" }).locator("select").first().evaluate((el) => new Promise((r) => { const t = setInterval(() => { if (el.value) { clearInterval(t); r(); } }, 50); }));
await bob.page.getByRole("region", { name: "Spaces" }).locator("select").first().selectOption({ label: "All boards" });
await bob.page.getByLabel(`Space for ${TITLE}`).selectOption({ label: `Team ${RUN}` });
await bob.page.waitForFunction(() => document.querySelector('select[aria-label^="Space for"]')?.value !== "");
await bob.page.getByRole("region", { name: "Spaces" }).locator("select").first().selectOption({ label: `Team ${RUN} (1)` });
check("an owner moves a board into a space, and the space filter lists it", (await bob.page.getByRole("link", { name: TITLE }).count()) === 1 && (await bob.page.getByRole("region", { name: "Spaces" }).locator("select").first().locator("option", { hasText: `Team ${RUN} (1)` }).count()) === 1);
check("the board shows a thumbnail that loads", await bob.page.evaluate(async () => { const i = document.querySelector('img[src$="/thumbnail"]'); if (!i) return false; await i.decode().catch(() => {}); return i.naturalWidth > 0; }));

// Space members get access to every board in it
const spaces = await bob.page.evaluate(async () => (await fetch("/api/spaces")).json());
const space = spaces.find((s) => s.name === `Team ${RUN}`);
const eve = await login("eve");
const board2 = await bob.page.evaluate(async (t) => (await (await fetch("/api/boards")).json()).find((b) => b.title === t)?.id, TITLE);
check("eve can open it while it's visible to the organisation", (await status(eve.page, `/api/boards/${board2}`)) === 200);
await status(bob.page, `/api/boards/${board2}/visibility`, "PUT", { role: null });
check("once organisation-wide visibility ends, eve can't", (await status(eve.page, `/api/boards/${board2}`)) === 404);
await status(bob.page, `/api/spaces/${space.id}/members`, "PUT", { type: "user", principalId: eve.me.id, role: "viewer", name: "eve" });
check("a space member can open its boards", (await status(eve.page, `/api/boards/${board2}`)) === 200);
check("and sees the space", (await eve.page.evaluate(async () => (await (await fetch("/api/spaces")).json()).length)) >= 1);

await browser.close();
const failed = res.filter((r) => !r).length;
console.log(`\n${res.length - failed}/${res.length} passed`);
process.exit(failed ? 1 : 0);
