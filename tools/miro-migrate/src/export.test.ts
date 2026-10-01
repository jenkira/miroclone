import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importJson } from "@miroclone/shared";
import { describe, expect, it } from "vitest";
import { MiroClient } from "./client.js";
import { exportBoards } from "./export.js";
import { parseArgs } from "./cli.js";
import { detectImage } from "./images.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const json = (b: unknown) => new Response(JSON.stringify(b));

/** A small fake Miro with one good board and one that fails. */
const fake = (async (url: string) => {
  const u = new URL(url);
  const p = u.pathname;
  if (p === "/v2/boards/good") return json({ id: "good", name: "Q3 Plan / Draft", owner: { id: "u1", name: "Ann Author" } });
  if (p === "/v2/boards/good/items") return json({ data: [
    { id: "s1", type: "sticky_note", data: { content: "<p>Ship it</p>" }, position: { x: 0, y: 0 }, geometry: { width: 200 } },
    { id: "im1", type: "image", position: { x: 400, y: 0 }, geometry: { width: 200, height: 100 } },
    { id: "im2", type: "image", position: { x: 400, y: 300 }, geometry: { width: 200, height: 100 } },
    { id: "app", type: "app_card", data: { title: "Jira" }, position: { x: 0, y: 400 } },
  ] });
  if (p === "/v2/boards/good/connectors") return json({ data: [{ id: "c1", startItem: { id: "s1" }, endItem: { id: "im1" } }] });
  if (p === "/v2/boards/good/members") return json({ data: [{ id: "u1", name: "Ann Author", email: "ann@example.test" }] });
  if (p === "/v2/boards/good/images/im1") return json({ data: { imageUrl: "https://files.test/im1" } });
  if (p === "/v2/boards/good/images/im2") return json({ data: { imageUrl: "https://files.test/im2" } });
  if (url === "https://files.test/im1") return new Response(PNG);
  if (url === "https://files.test/im2") return new Response(new TextEncoder().encode("<html>not an image</html>"));
  return new Response("", { status: 404 });
}) as unknown as typeof fetch;

describe("exportBoards (MIG-1, MIG-4)", () => {
  it("writes a board file the product can import, a report, the image, and a manifest", async () => {
    const out = await mkdtemp(join(tmpdir(), "miro-"));
    const manifest = await exportBoards(new MiroClient("super-secret-token", fake, "https://miro.test"), ["good", "missing"], out, () => {}, new Date("2026-09-30T00:00:00Z"));

    expect(manifest.boards).toHaveLength(2);
    const [good, missing] = manifest.boards as [typeof manifest.boards[0], typeof manifest.boards[0]];
    expect(good).toMatchObject({ title: "Q3 Plan / Draft", ownerName: "Ann Author", ownerEmail: "ann@example.test", objects: 5 });
    expect(good.totals).toMatchObject({ items: 5, converted: 3, placeholder: 2, error: 0 });
    expect(missing.error).toContain("404");

    const dir = join(out, good.folder);
    const file = importJson(await readFile(join(dir, "board.json"), "utf8"));
    expect(file.title).toBe("Q3 Plan / Draft");
    expect(file.objects.map((o) => o.type).sort()).toEqual(["connector", "image", "sticky", "sticky", "sticky"]);
    expect((await readdir(join(dir, "files")))).toEqual(["im1.png"]);
    expect(new Uint8Array(await readFile(join(dir, "files/im1.png")))).toEqual(PNG);

    const md = await readFile(join(dir, "report.md"), "utf8");
    expect(md).toContain("# Migration report: Q3 Plan / Draft");
    expect(md).toContain("Miroclone has no equivalent for \"app_card\"");
    expect(md).toContain("isn't a PNG, JPEG, GIF, WebP, or SVG image");
    expect(md).toContain("30 September 2026");
  });

  it("never writes the access token to disk", async () => {
    const out = await mkdtemp(join(tmpdir(), "miro-"));
    await exportBoards(new MiroClient("super-secret-token", fake, "https://miro.test"), ["good", "missing"], out, () => {});
    const all: string[] = [];
    const walk = async (d: string) => { for (const e of await readdir(d, { withFileTypes: true })) e.isDirectory() ? await walk(join(d, e.name)) : all.push(await readFile(join(d, e.name), "latin1")); };
    await walk(out);
    expect(all.length).toBeGreaterThan(3);
    expect(all.some((c) => c.includes("super-secret-token"))).toBe(false);
  });
});

describe("detectImage", () => {
  it("identifies images by content", () => {
    expect(detectImage(PNG)).toBe("image/png");
    expect(detectImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectImage(new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="x"/>'))).toBe("image/svg+xml");
    expect(detectImage(new TextEncoder().encode("<html><svg/></html>"))).toBeUndefined();
  });
});

describe("parseArgs", () => {
  it("reads a board list", () => {
    expect(parseArgs(["export", "--out", "o", "--board", "a", "--board", "b"])).toMatchObject({ out: "o", boards: ["a", "b"], all: false, tokenEnv: "MIRO_TOKEN" });
  });
  it("refuses a token on the command line", () => {
    expect(parseArgs(["export", "--out", "o", "--all", "--token", "x"])).toHaveProperty("error");
  });
  it("needs an output folder and a choice of boards", () => {
    expect(parseArgs(["export", "--all"])).toHaveProperty("error");
    expect(parseArgs(["export", "--out", "o"])).toHaveProperty("error");
    expect(parseArgs(["export", "--out", "o", "--all", "--board", "a"])).toHaveProperty("error");
  });
});
