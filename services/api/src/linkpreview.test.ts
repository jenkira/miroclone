import { describe, expect, it } from "vitest";
import { blockedAddress, fetchPreview, hostAllowed, parseMeta } from "./linkpreview.js";

const html = (body: string, headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" }, status = 200) => new Response(body, { status, headers });
const resolveTo = (...addrs: string[]) => async () => addrs;

describe("hostAllowed", () => {
  it("matches exact hosts and wildcard domains, ignoring case", () => {
    expect(hostAllowed("Wiki.Corp.Internal", ["wiki.corp.internal"])).toBe(true);
    expect(hostAllowed("a.b.corp.internal", ["*.corp.internal"])).toBe(true);
    expect(hostAllowed("corp.internal", ["*.corp.internal"])).toBe(false);
    expect(hostAllowed("evilcorp.internal", ["*.corp.internal"])).toBe(false);
    expect(hostAllowed("example.com", [])).toBe(false);
  });
});

describe("blockedAddress", () => {
  it.each(["127.0.0.1", "127.1.2.3", "0.0.0.0", "169.254.169.254", "::1", "::", "fe80::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254"])("blocks %s", (a) => expect(blockedAddress(a)).toBe(true));
  it.each(["10.1.2.3", "192.168.0.5", "172.16.0.9", "8.8.8.8", "2001:db8::1"])("allows %s", (a) => expect(blockedAddress(a)).toBe(false));
});

describe("parseMeta", () => {
  it("prefers Open Graph tags, then the title and description tags, and decodes entities", () => {
    expect(parseMeta('<head><title>Plain</title><meta property="og:title" content="Team &amp; Tools"><meta name="description" content="A &lt;b&gt;guide&lt;/b&gt;"></head>'))
      .toEqual({ title: "Team & Tools", description: "A <b>guide</b>" });
    expect(parseMeta("<title>\n  Only a title \n</title>")).toEqual({ title: "Only a title", description: "" });
    expect(parseMeta("<p>nothing</p>")).toEqual({ title: "", description: "" });
  });
  it("strips tags from the text and caps the length", () => {
    expect(parseMeta(`<title>${"x".repeat(500)}</title>`).title).toHaveLength(300);
    expect(parseMeta("<title>a<script>bad()</script>b</title>").title).toBe("abad()b");
  });
});

describe("fetchPreview (CNV-17)", () => {
  const allow = ["wiki.corp.internal"];

  it("fetches an allowed internal page without credentials and reads its title", async () => {
    const seen: RequestInit[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => { seen.push(init); return html('<head><title>Handbook</title><meta name="description" content="How we work"></head>'); }) as unknown as typeof fetch;
    const p = await fetchPreview("https://wiki.corp.internal/handbook", allow, { fetchImpl, resolve: resolveTo("10.0.0.5") });
    expect(p).toEqual({ url: "https://wiki.corp.internal/handbook", title: "Handbook", description: "How we work", fetched: true });
    expect(seen[0]).toMatchObject({ redirect: "manual", credentials: "omit" });
    expect(JSON.stringify(seen[0]!.headers)).not.toMatch(/cookie|authorization/i);
  });

  it("never calls a host that isn't on the allow-list, and returns the host as the title", async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; return html("<title>x</title>"); }) as unknown as typeof fetch;
    const p = await fetchPreview("https://example.com/page", allow, { fetchImpl, resolve: resolveTo("93.184.216.34") });
    expect(p).toEqual({ url: "https://example.com/page", title: "example.com", description: "", fetched: false });
    expect(calls).toBe(0);
    expect((await fetchPreview("https://wiki.corp.internal/x", [], { fetchImpl, resolve: resolveTo("10.0.0.5") })).fetched).toBe(false);
    expect(calls).toBe(0);
  });

  it("refuses an allowed host that points at a blocked address", async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; return html("<title>secret</title>"); }) as unknown as typeof fetch;
    for (const addr of ["127.0.0.1", "169.254.169.254", "::1"]) {
      expect((await fetchPreview("https://wiki.corp.internal/", allow, { fetchImpl, resolve: resolveTo(addr) })).fetched).toBe(false);
    }
    expect((await fetchPreview("https://wiki.corp.internal/", allow, { fetchImpl, resolve: resolveTo("10.0.0.5", "127.0.0.1") })).fetched).toBe(false);
    expect(calls).toBe(0);
  });

  it("refuses non-web addresses, and addresses with embedded credentials", async () => {
    const deps = { fetchImpl: (async () => html("")) as unknown as typeof fetch, resolve: resolveTo("10.0.0.5") };
    await expect(fetchPreview("javascript:alert(1)", allow, deps)).rejects.toThrow();
    await expect(fetchPreview("file:///etc/passwd", allow, deps)).rejects.toThrow();
    await expect(fetchPreview("not a url", allow, deps)).rejects.toThrow();
    expect((await fetchPreview("https://user:pw@wiki.corp.internal/", allow, deps)).fetched).toBe(false);
  });

  it("follows a redirect within the same host, and refuses one to another host or a blocked address", async () => {
    const pages: Record<string, Response | (() => Response)> = {
      "https://wiki.corp.internal/old": () => new Response("", { status: 301, headers: { location: "/new" } }),
      "https://wiki.corp.internal/new": () => html("<title>Moved</title>"),
      "https://wiki.corp.internal/away": () => new Response("", { status: 302, headers: { location: "https://example.com/" } }),
      "https://wiki.corp.internal/loop": () => new Response("", { status: 302, headers: { location: "/loop" } }),
    };
    const fetchImpl = (async (u: string) => { const p = pages[u]; return p ? (typeof p === "function" ? p() : p) : new Response("", { status: 404 }); }) as unknown as typeof fetch;
    const deps = { fetchImpl, resolve: resolveTo("10.0.0.5") };
    expect((await fetchPreview("https://wiki.corp.internal/old", allow, deps)).title).toBe("Moved");
    expect((await fetchPreview("https://wiki.corp.internal/away", allow, deps)).fetched).toBe(false);
    expect((await fetchPreview("https://wiki.corp.internal/loop", allow, deps)).fetched).toBe(false);
  });

  it("returns the host when the page isn't HTML, errors, or the fetch fails", async () => {
    const deps = (res: () => Response | Promise<Response>) => ({ fetchImpl: (async () => res()) as unknown as typeof fetch, resolve: resolveTo("10.0.0.5") });
    expect((await fetchPreview("https://wiki.corp.internal/a.pdf", allow, deps(() => new Response("%PDF", { headers: { "content-type": "application/pdf" } })))).title).toBe("wiki.corp.internal");
    expect((await fetchPreview("https://wiki.corp.internal/gone", allow, deps(() => new Response("", { status: 500 })))).title).toBe("wiki.corp.internal");
    expect((await fetchPreview("https://wiki.corp.internal/x", allow, deps(() => { throw new Error("down"); }))).fetched).toBe(false);
  });

  it("stops reading a very large page", async () => {
    let read = 0;
    const body = new ReadableStream({ pull(c) { read += 64 * 1024; c.enqueue(new Uint8Array(64 * 1024).fill(0x61)); if (read > 10 * 1024 * 1024) c.close(); } });
    const fetchImpl = (async () => new Response(body, { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const p = await fetchPreview("https://wiki.corp.internal/big", allow, { fetchImpl, resolve: resolveTo("10.0.0.5") });
    expect(p.fetched).toBe(true);
    expect(read).toBeLessThan(2 * 1024 * 1024);
  });
});
