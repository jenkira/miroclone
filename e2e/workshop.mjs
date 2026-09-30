// Workshop tools (WSH-1 to WSH-5) and follow mode (COL-6) against the full stack.
import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

const APP = "http://127.0.0.1:5199", IDP = "http://127.0.0.1:4010";
const res = [];
const check = (n, ok, x = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  " + x : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (q) => execSync(`psql -h ${process.env.POSTGRES_HOST} -p ${process.env.POSTGRES_PORT ?? 5432} -U ${process.env.POSTGRES_USER} -d ${process.env.POSTGRES_DB} -qAt -c "${q}"`, { env: { ...process.env, PGPASSWORD: process.env.POSTGRES_PASSWORD } }).toString().trim();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });

async function login(user, skewMs = 0) {
  await fetch(`${IDP}/switch?user=${user}`);
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 800 } });
  // A browser whose clock is wrong, to test that the timer uses the server's clock.
  if (skewMs) await ctx.addInitScript((skew) => { const real = Date.now.bind(Date); Date.now = () => real() + skew; }, skewMs);
  const page = await ctx.newPage();
  page.on("dialog", (d) => (d.type() === "prompt" ? d.accept(process.env.TEMPLATE_NAME ?? "Team SWOT") : d.accept()));
  page.on("pageerror", (e) => console.log("  pageerror:", e.message.slice(0, 120)));
  await page.goto(APP + "/auth/login");
  await page.waitForSelector("text=Signed in as");
  return { ctx, page };
}
const ready = async (page) => { await page.waitForFunction(() => window.__board && window.__apiRef?.current); await page.getByText("Saved automatically").waitFor(); await page.waitForFunction(() => window.__provider.synced === true); };
const objs = (page) => page.evaluate(() => window.__board.list().map((o) => ({ id: o.id, type: o.type, text: o.text ?? o.title ?? "", x: o.x, y: o.y, w: o.width, h: o.height })));
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await wait(200); } return false; };
/** How far the centre of a world rectangle is from the middle of the canvas, in pixels. */
const offCentre = (page, r) => page.evaluate((r) => { const a = window.__apiRef.current; const s = a.toScreen({ x: r.x + r.w / 2, y: r.y + r.h / 2 }); const b = document.querySelector("[role=application]").getBoundingClientRect(); return Math.hypot(s.x - (b.left + b.width / 2), s.y - (b.top + b.height / 2)); }, r);
const view = (page) => page.evaluate(() => window.__apiRef.current.viewport());
const secs = async (page) => { const t = await page.getByRole("timer").textContent(); const [m, s] = t.split(":").map(Number); return m * 60 + s; };
const newBoard = async (page, title, cls, tpl) => {
  await page.goto(APP + "/");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Classification").selectOption(cls);
  if (tpl) await page.getByLabel("Start from").selectOption({ label: tpl });
  await page.getByRole("button", { name: "Create board" }).click();
};
const share = async (ann, name, role) => {
  await ann.getByRole("button", { name: "Share" }).click();
  await ann.getByPlaceholder("Search by name or email").fill(name.split(" ")[0].toLowerCase());
  const row = ann.getByRole("listitem").filter({ hasText: name });
  await row.getByRole("button").first().waitFor();
  await ann.getByRole("dialog").locator("select").first().selectOption(role);
  await row.getByRole("button").first().click();
  await ann.getByLabel("Members").getByText(name).waitFor();
  await ann.getByRole("button", { name: "Done" }).click();
};
// Organisation templates outlive a run, so each run names its own.
const RUN = Date.now();
const T1 = `Team SWOT ${RUN}`, T2 = `Secret SWOT ${RUN}`;
process.env.TEMPLATE_NAME = T1;

// 1. Templates: start a board from a built-in template
const ann = await login("ann");
await newBoard(ann.page, `SWOT ${RUN}`, "OFFICIAL", "SWOT analysis");
await ready(ann.page);
const o = await objs(ann.page);
check("a board starts from the SWOT template, with its four frames", o.filter((x) => x.type === "frame").map((f) => f.text).sort().join() === "Opportunities,Strengths,Threats,Weaknesses", JSON.stringify(o.filter((x) => x.type === "frame").map((f) => f.text)));
check("  and its starter notes", o.filter((x) => x.type === "sticky").length === 4);
await wait(800);
const boardId = ann.page.url().split("/board/")[1];

// 2. Save a frame as an organisation template
const strengths = o.find((x) => x.text === "Strengths");
await ann.page.evaluate((id) => window.__apiRef.current.select([id]), strengths.id);
await ann.page.getByRole("button", { name: "Save as template" }).click();
await ann.page.getByText(/Saved the template/).waitFor({ timeout: 8000 });
check("saving a selected frame as a template works", true);
const bob0 = await login("bob");
await bob0.page.goto(APP + "/");
await bob0.page.getByLabel("Start from").locator("option", { hasText: T1 }).waitFor({ state: "attached" });
check("another person sees the organisation template", true);
await newBoard(bob0.page, `From template ${RUN}`, "OFFICIAL", `${T1} (OFFICIAL)`);
await ready(bob0.page);
const bo = await objs(bob0.page);
check("a board made from it has the frame and the note inside it, and nothing else", bo.length === 2 && bo.some((x) => x.type === "frame" && x.text === "Strengths") && bo.some((x) => x.type === "sticky"), JSON.stringify(bo.map((x) => x.type)));
const saveAsViewer = await bob0.page.evaluate(async (id) => (await fetch("/api/templates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ boardId: id, name: "sneaky" }) })).status, boardId);
check("someone with no access to a board can't save it as a template", saveAsViewer === 404, String(saveAsViewer));
await bob0.ctx.close();

// 3. The classification of a template is a floor
await newBoard(ann.page, `Secret ${RUN}`, "PROTECTED", "SWOT analysis");
await ready(ann.page);
process.env.TEMPLATE_NAME = T2;
await ann.page.getByRole("button", { name: "Save as template" }).click();
await ann.page.getByText(`Saved the template "${T2}".`).waitFor({ timeout: 8000 });
const bob1 = await login("bob");
await newBoard(bob1.page, `Low ${RUN}`, "OFFICIAL", `${T2} (PROTECTED)`);
await bob1.page.getByRole("alert").filter({ hasText: "higher" }).waitFor({ timeout: 8000 });
check("a board can't start below the classification of its template", true);
await newBoard(bob1.page, `High ${RUN}`, "PROTECTED", `${T2} (PROTECTED)`);
await ready(bob1.page);
check("at the same classification it works", (await objs(bob1.page)).length >= 8);
await bob1.ctx.close();

// 4. Workshop board: Ann facilitates, Bob watches with a clock that is 9 s fast, Eve can comment
await newBoard(ann.page, `Workshop ${RUN}`, "OFFICIAL", "SWOT analysis");
await ready(ann.page);
const wid = ann.page.url().split("/board/")[1];
await share(ann.page, "Bob Builder", "viewer");
await share(ann.page, "Eve Overage", "commenter");
const bob = await login("bob", 9000);
await bob.page.goto(`${APP}/#/board/${wid}`); await ready(bob.page);
const eve = await login("eve");
await eve.page.goto(`${APP}/#/board/${wid}`); await ready(eve.page);
const frames = (await objs(ann.page)).filter((x) => x.type === "frame");
const byTitle = Object.fromEntries(frames.map((f) => [f.text, f]));

// 5. Timer
check("a viewer has no timer controls", (await bob.page.getByRole("button", { name: "Start timer" }).count()) === 0);
await ann.page.getByLabel("Timer (minutes)").fill("1");
await ann.page.getByRole("button", { name: "Start timer" }).click();
await bob.page.getByRole("timer").waitFor({ timeout: 8000 });
await wait(2500);
const [a, b, e] = [await secs(ann.page), await secs(bob.page), await secs(eve.page)];
check("the timer runs for everyone", a > 50 && a <= 59 && b > 50 && e > 50, `Ann ${a}s, Bob ${b}s, Eve ${e}s`);
check("a browser with a clock 9 seconds fast still shows the same time left", Math.abs(a - b) <= 2 && Math.abs(a - e) <= 2, `difference ${Math.abs(a - b)}s`);
await ann.page.getByRole("button", { name: "Stop timer" }).click();
await bob.page.getByRole("timer").waitFor({ state: "detached", timeout: 8000 });
check("stopping the timer stops it for everyone", true);

// 6. Presentation
await ann.page.getByRole("button", { name: "Present frames" }).click();
await bob.page.getByText(/Ann Author is presenting: slide 1 of 4, Strengths/).waitFor({ timeout: 8000 });
check("everyone sees who is presenting and the slide", true);
await until(async () => (await offCentre(bob.page, byTitle.Strengths)) < 6);
check("the presenter and followers both show the first frame, in the middle", (await offCentre(ann.page, byTitle.Strengths)) < 6 && (await offCentre(bob.page, byTitle.Strengths)) < 6, `${Math.round(await offCentre(ann.page, byTitle.Strengths))} px, ${Math.round(await offCentre(bob.page, byTitle.Strengths))} px`);
await ann.page.keyboard.press("ArrowRight");
await bob.page.getByText(/slide 2 of 4, Weaknesses/).waitFor({ timeout: 8000 });
await until(async () => (await offCentre(bob.page, byTitle.Weaknesses)) < 6);
check("frames go in reading order, and followers move with the presenter", (await offCentre(bob.page, byTitle.Weaknesses)) < 6);
await bob.page.mouse.move(600, 400); await bob.page.mouse.wheel(0, -300);
await bob.page.getByRole("button", { name: "Follow presentation" }).waitFor({ timeout: 5000 });
const bobBefore = await view(bob.page);
await ann.page.keyboard.press("ArrowRight");
await eve.page.getByText(/slide 3 of 4, Opportunities/).waitFor({ timeout: 8000 });
await wait(600);
const bobAfter = await view(bob.page);
check("a follower who moves the canvas leaves the presentation", JSON.stringify(bobBefore) === JSON.stringify(bobAfter));
await bob.page.getByRole("button", { name: "Follow presentation" }).click();
await until(async () => (await offCentre(bob.page, byTitle.Opportunities)) < 6);
check("and can rejoin it", (await offCentre(bob.page, byTitle.Opportunities)) < 6);
await ann.page.keyboard.press("Escape");
await bob.page.getByText(/is presenting/).waitFor({ state: "detached", timeout: 8000 });
check("the presenter ends the presentation with Escape", true);

// 7. Follow a person (COL-6)
await bob.page.getByRole("button", { name: /^Follow Ann/ }).click();
await ann.page.mouse.move(600, 400); await ann.page.mouse.wheel(0, 500);
await until(async () => { const [x, y] = [await view(ann.page), await view(bob.page)]; return Math.abs(x.zoom - y.zoom) < 0.01 && Math.abs(x.x - y.x) < 2; });
const [av, bv] = [await view(ann.page), await view(bob.page)];
check("following someone makes your view match theirs", Math.abs(av.zoom - bv.zoom) < 0.01 && Math.abs(av.x - bv.x) < 2 && Math.abs(av.y - bv.y) < 2, `Ann zoom ${av.zoom.toFixed(2)}, Bob ${bv.zoom.toFixed(2)}`);
await bob.page.mouse.move(600, 400); await bob.page.mouse.wheel(0, 300);
await bob.page.getByRole("button", { name: "Stop following" }).waitFor({ state: "detached", timeout: 5000 });
check("moving the canvas yourself stops following", true);

// 8. A facilitator brings everyone to their view
await ann.page.mouse.wheel(0, -700);
await wait(300);
await ann.page.getByRole("button", { name: "Bring everyone to my view" }).click();
await bob.page.getByText(/moved everyone to their view/).waitFor({ timeout: 8000 });
await eve.page.getByText(/moved everyone to their view/).waitFor({ timeout: 8000 });
await wait(400);
const [a2, b2, e2] = [await view(ann.page), await view(bob.page), await view(eve.page)];
check("everyone lands on the facilitator's view", [b2, e2].every((v) => Math.abs(v.zoom - a2.zoom) < 0.01 && Math.abs(v.x - a2.x) < 2 && Math.abs(v.y - a2.y) < 2));
check("a viewer has no summon button", (await bob.page.getByRole("button", { name: "Bring everyone to my view" }).count()) === 0);

// 9. Voting (anonymous)
await ann.page.evaluate(() => window.__apiRef.current.fit());
for (const p of [bob.page, eve.page]) await p.evaluate(() => window.__apiRef.current.fit());
await ann.page.getByRole("button", { name: /^Voting/ }).click();
await ann.page.getByLabel("Votes each").fill("2");
await ann.page.getByRole("button", { name: "Start voting" }).click();
await ann.page.getByText("Voting is open.").waitFor();
await eve.page.getByRole("button", { name: /^Voting/ }).click();
await eve.page.getByText("Voting is open.").waitFor({ timeout: 10000 });
check("the commenter sees that voting is open and how many votes they have", (await eve.page.getByLabel("Voting").textContent()).includes("2 of 2") || /You have\s*2\s*of 2/.test(await eve.page.getByRole("complementary", { name: "Voting" }).textContent()));
check("a viewer can't choose the Vote tool", await bob.page.getByRole("button", { name: "Vote", exact: true }).isDisabled());
await eve.page.getByRole("button", { name: "Vote", exact: true }).click();
const stick = (await objs(ann.page)).filter((x) => x.type === "sticky");
const clickOn = async (page, s) => { const p = await page.evaluate((s) => window.__apiRef.current.toScreen({ x: s.x + s.w / 2, y: s.y + s.h / 2 }), s); await page.mouse.click(p.x, p.y); };
const sA = stick.find((s) => s.x < 100 && s.y < 100), sB = stick.find((s) => s.x > 500 && s.y < 100);
await clickOn(eve.page, sA); await eve.page.getByText(/You have\s*1\s*of 2/).waitFor({ timeout: 5000 });
await clickOn(eve.page, sA); await eve.page.getByText(/You have\s*0\s*of 2/).waitFor({ timeout: 5000 });
await clickOn(eve.page, sB);
await eve.page.getByRole("alert").filter({ hasText: /used all your votes/ }).waitFor({ timeout: 5000 });
check("a third vote is refused once the limit is reached", true);
await wait(500);
const badgePx = await eve.page.evaluate(async ([x, y]) => new Promise((r) => r(null)), [0, 0]).then(() => null);
const pt = await eve.page.evaluate((s) => window.__apiRef.current.toScreen({ x: s.x, y: s.y }), sA);
const png = await eve.page.screenshot({ clip: { x: pt.x - 2, y: pt.y - 2, width: 4, height: 4 } });
const px = await eve.page.evaluate(async (b64) => { const i = new Image(); i.src = "data:image/png;base64," + b64; await i.decode(); const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const g = c.getContext("2d"); g.drawImage(i, 0, 0); return [...g.getImageData(1, 1, 1, 1).data]; }, png.toString("base64"));
check("the voter's own dots show on the object", px[2] > 150 && px[0] < 80, JSON.stringify(px));
await ann.page.keyboard.press("Escape");
await ann.page.getByRole("button", { name: "Vote", exact: true }).click();
await clickOn(ann.page, sB);
await ann.page.getByText(/You have\s*1\s*of 2/).waitFor({ timeout: 5000 });
check("the facilitator hides nothing from themselves but sees no one else's votes before closing", (await ann.page.getByRole("list", { name: "Results" }).count()) === 0);
await ann.page.getByRole("button", { name: "Close voting and show results" }).click();
await ann.page.getByRole("list", { name: "Results" }).waitFor({ timeout: 8000 });
const items = await ann.page.getByRole("list", { name: "Results" }).getByRole("listitem").allTextContents();
check("closing shows totals, most votes first", /^2 votes/.test(items[0]) && /^1 vote/.test(items[1]), JSON.stringify(items));
const panelText = await ann.page.getByRole("complementary", { name: "Voting" }).textContent();
check("an anonymous round shows no names", !/Eve|Ann Author|Bob/.test(items.join(" ")) && /anonymous/.test(panelText));
const apiBody = await eve.page.evaluate(async (id) => JSON.stringify(await (await fetch(`/api/boards/${id}/votes`)).json()), wid);
check("and the API never sends voter names or IDs for it", !/voters|oid-eve|oid-ann|Eve Overage/.test(apiBody) && /"count":2/.test(apiBody), apiBody.slice(0, 120));
await eve.page.getByRole("list", { name: "Results" }).waitFor({ timeout: 8000 });
check("everyone sees the results after it closes", true);

// 10. Named round
await ann.page.getByLabel("Votes each").fill("1");
await ann.page.getByLabel("Anonymous votes").uncheck();
await ann.page.getByRole("button", { name: "Start voting" }).click();
await ann.page.getByText("Votes show names.").waitFor();
await eve.page.getByText("Votes show names.").waitFor({ timeout: 10000 });
await clickOn(eve.page, sB);
await eve.page.getByText(/You have\s*0\s*of 1/).waitFor({ timeout: 5000 });
await ann.page.getByRole("button", { name: "Close voting and show results" }).click();
await ann.page.getByRole("list", { name: "Results" }).waitFor({ timeout: 8000 });
check("a named round shows who voted", /Eve Overage/.test(await ann.page.getByRole("list", { name: "Results" }).textContent()));
check("votes are stored in PostgreSQL", Number(sql(`SELECT count(*) FROM votes v JOIN vote_sessions s ON s.id = v.session_id WHERE s.board_id = '${wid}'`)) === 4);

await browser.close();
console.log(`\n${res.filter(Boolean).length}/${res.length} checks passed`);
process.exit(res.every(Boolean) ? 0 : 1);
