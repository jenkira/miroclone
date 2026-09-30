import { describe, expect, it } from "vitest";
import { GraphClient } from "./graph.js";

function fake(routes: Record<string, unknown>) {
  const calls: { url: string; auth: string | null }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, auth: (init.headers as Record<string, string>).authorization ?? null });
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    return hit ? new Response(JSON.stringify(hit[1])) : new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("GraphClient", () => {
  it("searches users and groups with the user's token", async () => {
    const { f, calls } = fake({
      "/users?": { value: [{ id: "u1", displayName: "Una", mail: "una@x.test" }] },
      "/groups?": { value: [{ id: "g1", displayName: "Engineering" }] },
    });
    const r = await new GraphClient(f).search("tok", "eng");
    expect(r).toEqual([{ type: "user", id: "u1", name: "Una", email: "una@x.test" }, { type: "group", id: "g1", name: "Engineering" }]);
    expect(calls.every((c) => c.auth === "Bearer tok")).toBe(true);
  });
  it("skips short queries and strips quotes from the search term", async () => {
    const { f, calls } = fake({ "/users?": { value: [] }, "/groups?": { value: [] } });
    const g = new GraphClient(f);
    expect(await g.search("t", "a")).toEqual([]);
    expect(calls).toHaveLength(0);
    await g.search("t", 'ab" OR "x');
    expect(decodeURIComponent(calls[0]!.url)).not.toContain('ab"');
  });
  it("follows paging links to resolve group overage", async () => {
    const base = "https://graph.microsoft.com/v1.0";
    let n = 0;
    const f = (async () => new Response(JSON.stringify(n++ === 0
      ? { value: [{ id: "g1" }], "@odata.nextLink": `${base}/me/transitiveMemberOf/microsoft.graph.group?$skiptoken=x` }
      : { value: [{ id: "g2" }] }))) as unknown as typeof fetch;
    expect(await new GraphClient(f).memberGroups("t")).toEqual(["g1", "g2"]);
  });
  it("throws on a Graph error", async () => {
    const { f } = fake({});
    await expect(new GraphClient(f).memberGroups("t")).rejects.toThrow("404");
  });
});
