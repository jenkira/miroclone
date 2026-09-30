import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
const APP = "http://127.0.0.1:5199", IDP = "http://127.0.0.1:4010";
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
const switchUser = (u) => fetch(`${IDP}/switch?user=${u}`).then((r) => r.json());
async function newUser(name) {
  await switchUser(name);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  pageerror:", e.message.slice(0, 120)));
  return { ctx, page };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Sign in as Ann
const ann = await newUser("ann");
await ann.page.goto(APP + "/");
check("anonymous visitor sees the sign-in link", await ann.page.getByRole("link", { name: /Sign in/ }).isVisible());
await ann.page.getByRole("link", { name: /Sign in/ }).click();
await ann.page.waitForSelector("text=Signed in as Ann Author");
check("sign-in through the identity provider (PKCE, ID token, session) reaches the dashboard", true);
const cookies = await ann.ctx.cookies();
const sess = cookies.find((c) => c.name === "mc_session");
check("session cookie is HttpOnly and opaque", !!sess?.httpOnly && sess.value.length >= 43 && !/\./.test(sess.value));
check("browser holds no Entra token", !(await ann.page.evaluate(() => JSON.stringify([localStorage, sessionStorage, document.cookie]))).includes("at-"));

// 2. Rejections
for (const [user, why] of [["cy", "mfa"], ["dee", "role"]]) {
  const x = await newUser(user);
  await x.page.goto(APP + "/auth/login");
  const body = await x.page.textContent("body");
  check(`sign-in is refused for a user with no ${why}`, body.includes(`"${why}"`), body.trim());
  check(`  and no session cookie is set (${why})`, !(await x.ctx.cookies()).some((c) => c.name === "mc_session"));
  await x.ctx.close();
}

// 3. Create a PROTECTED board and draw on it
await ann.page.getByLabel("Title").fill("Retro");
await ann.page.getByLabel("Classification").selectOption("PROTECTED");
await ann.page.getByRole("button", { name: "Create board" }).click();
await ann.page.waitForSelector("canvas");
const boardUrl = ann.page.url();
const boardId = boardUrl.split("/board/")[1];
check("new board opens with PROTECTED banners", (await ann.page.getByText("PROTECTED", { exact: true }).count()) >= 2);
await ann.page.waitForFunction(() => window.__board);
await ann.page.getByText("Saved automatically").waitFor();
await ann.page.getByRole("button", { name: "Sticky note" }).click();
await ann.page.mouse.click(300, 300);
await ann.page.keyboard.type("Start, stop, continue");
await ann.page.mouse.click(900, 650);
await wait(800);
const text = () => ann.page.evaluate(() => window.__board.list().map((o) => o.text ?? o.type));
check("sticky note with text is on the board", (await text()).includes("Start, stop, continue"), JSON.stringify(await text()));

// 4. Persistence: reload reads the document back from PostgreSQL through the collaboration service
await ann.page.reload();
await ann.page.waitForFunction(() => window.__board?.list().length > 0, null, { timeout: 8000 }).catch(() => {});
check("board content survives a reload (stored in PostgreSQL)", (await text()).includes("Start, stop, continue"), JSON.stringify(await text()));

// 5. Bob can't open it yet
const bob = await newUser("bob");
await bob.page.goto(APP + "/auth/login");
await bob.page.waitForSelector("text=Signed in as Bob Builder");
await bob.page.goto(`${APP}/#/board/${boardId}`);
await bob.page.waitForSelector("text=You can't open this board");
check("a user with no grant can't open the board", true);

// 6. Ann shares with the Engineering group through the people picker
await ann.page.getByRole("button", { name: "Share" }).click();
await ann.page.getByPlaceholder("Search by name or email").fill("eng");
await ann.page.getByRole("listitem").filter({ hasText: "Engineering" }).getByRole("button").first().waitFor();
await ann.page.getByRole("dialog").locator("select").first().selectOption("viewer");
await ann.page.getByRole("listitem").filter({ hasText: "Engineering" }).getByRole("button").first().click();
await ann.page.getByLabel("Members").getByText("Engineering").waitFor();
check("people picker searches the directory and adds the Engineering group as viewer", true);
await ann.page.getByRole("button", { name: "Done" }).click();

// 7. Bob opens it as a viewer, sees the content, and receives live edits
await bob.page.reload();
await bob.page.waitForSelector("canvas");
await bob.page.waitForFunction(() => window.__board);
await bob.page.getByText("View only").waitFor();
const bobSees = () => bob.page.evaluate(() => window.__board.list().map((o) => o.type === "sticky" ? o.text : o.type));
await bob.page.waitForFunction(() => window.__board.list().length > 0, null, { timeout: 8000 }).catch(() => {});
check("Bob (via group) opens the board read-only and sees the existing content", (await bobSees()).includes("Start, stop, continue"), JSON.stringify(await bobSees()));
check("Bob's drawing tools are disabled", await bob.page.getByRole("button", { name: "Rectangle" }).isDisabled());
await ann.page.getByRole("button", { name: "Ellipse" }).click();
await ann.page.mouse.move(500, 400); await ann.page.mouse.down(); await ann.page.mouse.move(640, 480, { steps: 4 }); await ann.page.mouse.up();
await wait(700);
check("Ann's new shape reaches Bob live", (await bobSees()).includes("shape"), JSON.stringify(await bobSees()));
check("presence lists both people", (await ann.page.getByLabel("People on this board").textContent()).includes("Bob Builder"));

// 8. A viewer's write is dropped by the server
await bob.page.evaluate(() => window.__board.add({ type: "sticky", x: 0, y: 0, text: "FROM VIEWER" }));
await wait(800);
const annSees = await ann.page.evaluate(() => window.__board.list().map((o) => o.type === "sticky" ? o.text : o.type));
check("the viewer's forced edit exists in the viewer's own browser", (await bobSees()).includes("FROM VIEWER"));
check("an edit forced in by a viewer never reaches the owner", !annSees.includes("FROM VIEWER"), JSON.stringify(annSees));
await ann.page.reload();
await ann.page.waitForFunction(() => window.__board?.list().length > 0, null, { timeout: 8000 }).catch(() => {});
check("  and it isn't stored in PostgreSQL", !(await text()).includes("FROM VIEWER"));

// 9. Export is audited
const [dl] = await Promise.all([ann.page.waitForEvent("download"), ann.page.getByRole("button", { name: "PNG" }).click()]);
check("PNG export downloads", (dl.suggestedFilename() ?? "").endsWith(".png"));
await wait(300);
const log = readFileSync(process.env.API_LOG ?? "api.log", "utf8").split("\n").filter((l) => l.includes('"type":"audit"')).map((l) => JSON.parse(l));
check("audit log has sign-in, board create, share, and export events", ["sign_in", "board_create", "share_change", "export"].every((a) => log.some((e) => e.action === a)), [...new Set(log.map((e) => e.action))].join(","));
check("audit log records the refused sign-ins", [...new Set(log.filter((e) => e.action === "sign_in" && e.detail?.allowed === false).map((e) => e.detail.reason))].sort().join() === "mfa,role");
const pc = log.filter((e) => e.action === "export").at(-1);
check("export audit event carries the classification", pc?.detail?.classification === "PROTECTED" && pc?.detail?.format === "png");

// 10. Sign out ends the session
await ann.page.goto(APP + "/");
await ann.page.getByRole("button", { name: "Sign out" }).click();
await ann.page.waitForSelector("text=Sign in with Microsoft");
check("sign-out ends the session", (await ann.page.evaluate(() => fetch("/api/me").then((r) => r.status))) === 401);

await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
