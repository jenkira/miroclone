import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/status of (404|500)/.test(m.text())) errors.push(m.text()); });
const res = [];
const check = (n, ok, x = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  " + x : ""}`); };
const obj = (i = 0) => page.evaluate((i) => { const o = window.__board.list()[i]; return o && { x: Math.round(o.x), y: Math.round(o.y), w: Math.round(o.width), h: Math.round(o.height), r: Math.round(o.rotation), text: o.text, type: o.type, bold: o.bold, align: o.align, list: o.list, link: o.link, underline: o.underline, size: o.size }; }, i);
await page.goto("http://127.0.0.1:5199/#/local"); await page.waitForSelector("canvas"); await page.waitForTimeout(500);

// A rectangle to work on: drag 400,300 -> 600,400 (200x100)
await page.getByRole("button", { name: "Rectangle" }).click();
await page.mouse.move(400, 300); await page.mouse.down(); await page.mouse.move(600, 400, { steps: 4 }); await page.mouse.up();
let o = await obj();
check("rectangle drawn", o.type === "shape" && o.w === 200 && o.h === 100, JSON.stringify(o));
await page.getByRole("button", { name: "Select", exact: true }).click();
// canvas top-left offset: find by the world->screen: the viewport starts at 0,0 at canvas origin; measure canvas origin
const origin = await page.evaluate(() => { const r = document.querySelector("[role=application]").getBoundingClientRect(); return { x: r.left, y: r.top }; });
const X = (x) => origin.x + x, Y = (y) => origin.y + y;
// The object was drawn at screen (400,300) => world = screen - origin
const wx = 400 - origin.x, wy = 300 - origin.y;
await page.mouse.click(X(wx + 100), Y(wy + 50));   // select
// resize: drag SE corner (wx+200, wy+100) to (wx+300, wy+180)
await page.mouse.move(X(wx + 200), Y(wy + 100)); await page.mouse.down(); await page.mouse.move(X(wx + 300), Y(wy + 180), { steps: 5 }); await page.mouse.up();
o = await obj();
check("dragging the SE handle resizes, keeping the NW corner fixed", o.x === wx && o.y === wy && o.w === 300 && o.h === 180, JSON.stringify(o));
await page.keyboard.press("Control+z");
o = await obj();
check("one undo reverts the whole resize", o.w === 200 && o.h === 100, JSON.stringify(o));
// resize again then rotate with handle: rotate handle is 28px above top middle
await page.mouse.move(X(wx + 200), Y(wy + 100)); await page.mouse.down(); await page.mouse.move(X(wx + 300), Y(wy + 180), { steps: 5 }); await page.mouse.up();
await page.mouse.move(X(wx + 150), Y(wy - 28)); await page.mouse.down(); await page.mouse.move(X(wx + 150 + 200), Y(wy + 90), { steps: 6 }); await page.mouse.up();
o = await obj();
check("dragging the rotate handle to the right turns the object 90 degrees", o.r === 90, JSON.stringify(o));
// hit test on rotated: object centre (wx+150, wy+90), now tall 180 x 300 after 90deg; point above centre by 140 along world y is inside
await page.keyboard.press("Escape");
const before = await page.evaluate(() => window.__board.list().length);
// After 90 degrees the object spans y from wy-60 to wy+240, so (wx+150, wy-40) is inside it but outside its unrotated box.
await page.mouse.click(X(wx + 150), Y(wy - 40));
await page.keyboard.press("Delete");
const after = await page.evaluate(() => window.__board.list().length);
check("a rotated object is selected by clicking where it now is", before === 1 && after === 0, `${before} -> ${after}`);
await page.keyboard.press("Control+z");
check("undo brings it back", (await page.evaluate(() => window.__board.list().length)) === 1);

// Sticky auto-size: long text shrinks the font so it fits
await page.getByRole("button", { name: "Sticky note" }).click();
await page.mouse.click(X(900), Y(250));
await page.keyboard.type("A very long note that has to shrink so that all of the words still fit inside the square");
await page.mouse.click(X(1100), Y(700));
const fit = await page.evaluate(() => { const o = window.__board.list().find((x) => x.type === "sticky"); return { text: o.text.length, w: o.width }; });
check("long sticky text is stored in full", fit.text > 60, JSON.stringify(fit));
await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/canvas-a.png` : "canvas-a.png" });

// Text object + formatting
await page.getByRole("button", { name: "Text", exact: true }).click();
await page.mouse.click(X(200), Y(550));
await page.keyboard.type("first\nsecond");
await page.mouse.click(X(1100), Y(700));
await page.mouse.click(X(210), Y(560));
await page.getByRole("button", { name: "Bold" }).click();
await page.getByRole("button", { name: "Underline" }).click();
await page.getByLabel("Align").selectOption("center");
await page.getByLabel("List").selectOption("bullet");
await page.getByLabel("Link").fill("https://example.test/doc");
const t = await page.evaluate(() => window.__board.list().find((x) => x.type === "text"));
check("text formatting is applied to the object", t.bold && t.underline && t.align === "center" && t.list === "bullet" && t.link === "https://example.test/doc", JSON.stringify({ b: t.bold, u: t.underline, a: t.align, l: t.list, k: t.link }));
await page.getByLabel("Link").fill("javascript:alert(1)");
const t2 = await page.evaluate(() => window.__board.list().find((x) => x.type === "text"));
check("an unsafe link is refused and cleared", t2.link === undefined, String(t2.link));

// Zoom to fit
await page.mouse.click(X(1250), Y(780));
await page.getByRole("button", { name: "Zoom to fit" }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/canvas-b.png` : "canvas-b.png" });
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(`${res.filter(Boolean).length}/${res.length} passed`);
