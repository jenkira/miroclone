import { describe, expect, it } from "vitest";
import { MiroClient, MiroError } from "./client.js";

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

describe("MiroClient (MIG-1)", () => {
  it("sends the token as a bearer header, follows pages, and stops when a page is empty", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
      const u = new URL(url);
      if (u.pathname === "/v2/boards") {
        return u.searchParams.get("cursor") === "p2" ? json({ data: [{ id: "b3", name: "C" }] }) : json({ data: [{ id: "b1", name: "A" }, { id: "b2", name: "B" }], cursor: "p2" });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    const boards = await new MiroClient("secret-token", fetchImpl).listBoards();
    expect(boards.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
    expect(seen.every((s) => s.auth === "Bearer secret-token")).toBe(true);
    expect(seen).toHaveLength(2);
  });

  it("waits and retries when Miro says to slow down", async () => {
    let calls = 0;
    const waits: number[] = [];
    const fetchImpl = (async () => (++calls < 3 ? new Response("", { status: 429, headers: { "retry-after": "2" } }) : json({ data: [] }))) as unknown as typeof fetch;
    await new MiroClient("t", fetchImpl, "https://miro.test", async (ms) => { waits.push(ms); }).listBoards();
    expect(calls).toBe(3);
    expect(waits).toEqual([2000, 2000]);
  });

  it("gives up after repeated rate limits", async () => {
    const fetchImpl = (async () => new Response("", { status: 429 })) as unknown as typeof fetch;
    await expect(new MiroClient("t", fetchImpl, "https://miro.test", async () => {}).listBoards()).rejects.toThrow(/429/);
  });

  it("explains a refused token without repeating it", async () => {
    const fetchImpl = (async () => new Response("", { status: 401 })) as unknown as typeof fetch;
    const err = (await new MiroClient("secret-token", fetchImpl).listBoards().then(() => undefined, (e: unknown) => e)) as MiroError;
    expect(err).toBeInstanceOf(MiroError);
    expect(err.message).toContain("refused the access token");
    expect(err.message).not.toContain("secret-token");
  });

  it("refuses to start without a token", () => {
    expect(() => new MiroClient("")).toThrow(/token/);
  });

  it("reads a board, and carries on when the member list isn't allowed", async () => {
    const fetchImpl = (async (url: string) => {
      const p = new URL(url).pathname;
      if (p === "/v2/boards/b1") return json({ id: "b1", name: "Plan" });
      if (p === "/v2/boards/b1/items") return json({ data: [{ id: "i", type: "sticky_note" }] });
      if (p === "/v2/boards/b1/connectors") return json({ data: [] });
      return new Response("", { status: 403 });
    }) as unknown as typeof fetch;
    const b = await new MiroClient("t", fetchImpl).board("b1");
    expect(b.items).toHaveLength(1);
    expect(b.members).toEqual([]);
  });

  it("downloads an image without sending the token to the file host", async () => {
    const auths: (string | null)[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      auths.push(new Headers(init?.headers).get("authorization"));
      if (url.startsWith("https://miro.test/")) return json({ data: { imageUrl: "https://files.test/x.png?sig=1" } });
      return new Response(new Uint8Array([1, 2, 3]));
    }) as unknown as typeof fetch;
    const bytes = await new MiroClient("tok", fetchImpl, "https://miro.test").image("b1", "i1");
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(auths).toEqual(["Bearer tok", null]);
  });
});
