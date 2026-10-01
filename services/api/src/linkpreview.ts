import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface Preview { url: string; title: string; description: string; /** False when the host isn't on the allow-list, so nothing was fetched. */ fetched: boolean }

/** The largest page the preview reads, in bytes. Titles and descriptions sit near the top. */
const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;

/** Matches a host against the allow-list. An entry is a host name, or `*.domain` for any host under a domain. */
export function hostAllowed(host: string, allow: readonly string[]): boolean {
  const h = host.toLowerCase();
  return allow.some((a) => {
    const e = a.trim().toLowerCase();
    return e.startsWith("*.") ? h.endsWith(e.slice(1)) && h.length > e.length - 1 : h === e;
  });
}

/** True for addresses a preview never fetches: loopback, link-local (which holds cloud metadata services), and unspecified. */
export function blockedAddress(addr: string): boolean {
  if (isIP(addr) === 4) {
    const [a, b] = addr.split(".").map(Number) as [number, number];
    return a === 127 || a === 0 || (a === 169 && b === 254);
  }
  const x = addr.toLowerCase();
  if (x.startsWith("::ffff:")) return blockedAddress(x.slice(7));
  return x === "::1" || x === "::" || x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === "#") { const c = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(c) && c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : m; }
  return ENTITIES[e.toLowerCase()] ?? m;
});
const clean = (s: string | undefined, max: number) => decode((s ?? "").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim().slice(0, max);

/** Reads a title and description from the start of an HTML page: Open Graph tags first, then the title and description tags. */
export function parseMeta(html: string): { title: string; description: string } {
  const meta = (key: string) => {
    for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
      const tag = m[0];
      const name = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
      if (name === key) return /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)?.slice(1).find((x) => x !== undefined);
    }
    return undefined;
  };
  const title = clean(meta("og:title") ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1], 300);
  const description = clean(meta("og:description") ?? meta("description"), 1000);
  return { title, description };
}

export interface PreviewDeps {
  fetchImpl?: typeof fetch;
  resolve?: (host: string) => Promise<string[]>;
}

/**
 * Fetches a page's title and description for a link card (CNV-17). The server fetches, never the browser, and only from
 * hosts an administrator put on the allow-list, so a PROTECTED board never causes a call to an outside site. The fetch
 * sends no cookies or credentials, follows redirects only within the same host, and stops at a size and time limit.
 */
export async function fetchPreview(rawUrl: string, allow: readonly string[], deps: PreviewDeps = {}): Promise<Preview> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const resolve = deps.resolve ?? (async (h: string) => (await lookup(h, { all: true })).map((a) => a.address));
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error("That isn't a web address."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("That isn't a web address.");
  const fallback: Preview = { url: url.href, title: url.host, description: "", fetched: false };
  if (url.username || url.password || !hostAllowed(url.hostname, allow)) return fallback;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Check where the host points every time, so a name that changes its address between checks can't reach a blocked place.
    const addrs = isIP(url.hostname) ? [url.hostname.replace(/^\[|\]$/g, "")] : await resolve(url.hostname).catch(() => []);
    if (!addrs.length || addrs.some(blockedAddress)) return fallback;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(url.href, { redirect: "manual", signal: ctl.signal, credentials: "omit", headers: { accept: "text/html", "user-agent": "Miroclone-link-preview" } });
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get("location");
        if (!next) return fallback;
        const target = new URL(next, url);
        if (target.hostname.toLowerCase() !== url.hostname.toLowerCase() || (target.protocol !== "http:" && target.protocol !== "https:")) return fallback;
        url = target;
        continue;
      }
      if (!res.ok || !/text\/html/i.test(res.headers.get("content-type") ?? "")) return { ...fallback, fetched: true };
      const reader = res.body?.getReader();
      let html = "", got = 0;
      const dec = new TextDecoder();
      while (reader && got < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        html += dec.decode(value, { stream: true });
        if (/<\/head>/i.test(html)) break;
      }
      await reader?.cancel().catch(() => {});
      const meta = parseMeta(html);
      return { url: url.href, title: meta.title || url.host, description: meta.description, fetched: true };
    } catch {
      return fallback;
    } finally { clearTimeout(timer); }
  }
  return fallback;
}
