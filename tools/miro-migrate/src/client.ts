import type { MiroBoard, MiroBoardInfo, MiroConnector, MiroItem, MiroMember } from "./miro-types.js";

type Fetch = typeof fetch;

export class MiroError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

/**
 * Reads boards through the Miro REST API v2 (MIG-1). The token needs read access only (boards:read).
 * The client follows pagination, waits when Miro says to slow down, and never writes the token anywhere.
 */
export class MiroClient {
  constructor(
    private token: string,
    private fetchImpl: Fetch = fetch,
    private base = "https://api.miro.com",
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    if (!token) throw new MiroError("A Miro access token is required.");
  }

  private async send(url: string, tries = 5): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try { res = await this.fetchImpl(url, { headers: { authorization: `Bearer ${this.token}`, accept: "application/json" } }); }
      catch (err) { throw new MiroError(`The request to Miro failed: ${(err as Error).message}`); }
      if (res.status === 429 && attempt < tries) {
        // Miro sends how long to wait in seconds. Without a header, back off each time.
        const wait = Number(res.headers.get("retry-after"));
        await this.sleep(Number.isFinite(wait) && wait > 0 ? wait * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new MiroError("Miro refused the access token. Check that it's valid and has read access.", res.status);
      if (!res.ok) throw new MiroError(`Miro returned ${res.status} for ${new URL(url).pathname}.`, res.status);
      return res;
    }
  }

  private async json<T>(path: string): Promise<T> {
    return (await this.send(`${this.base}${path}`)).json() as Promise<T>;
  }

  /** Follows `cursor` pagination until Miro returns no more pages. */
  private async pages<T>(path: string, limit = 50): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    do {
      const sep = path.includes("?") ? "&" : "?";
      const page = await this.json<{ data?: T[]; cursor?: string }>(`${path}${sep}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      out.push(...(page.data ?? []));
      cursor = page.data?.length ? page.cursor : undefined;
    } while (cursor);
    return out;
  }

  /** Lists the boards the token can read. `team` narrows the list to one team. */
  async listBoards(team?: string): Promise<MiroBoardInfo[]> {
    return this.pages<MiroBoardInfo>(`/v2/boards${team ? `?team_id=${encodeURIComponent(team)}` : ""}`);
  }

  async board(id: string): Promise<MiroBoard> {
    const e = encodeURIComponent(id);
    const [info, items, connectors, members] = await Promise.all([
      this.json<MiroBoardInfo>(`/v2/boards/${e}`),
      this.pages<MiroItem>(`/v2/boards/${e}/items`),
      this.pages<MiroConnector>(`/v2/boards/${e}/connectors`),
      // Members are optional. They give assignee names and owner emails when the plan allows it.
      this.pages<MiroMember>(`/v2/boards/${e}/members`).catch(() => [] as MiroMember[]),
    ]);
    return { info, items, connectors, members };
  }

  /** Downloads an image item's original file. */
  async image(boardId: string, itemId: string): Promise<Uint8Array> {
    const meta = await this.json<{ data?: { imageUrl?: string } }>(`/v2/boards/${encodeURIComponent(boardId)}/images/${encodeURIComponent(itemId)}?format=original`);
    const url = meta.data?.imageUrl;
    if (!url) throw new MiroError("Miro gave no download link for the image.");
    // The link is pre-signed and already carries its own access, so the token isn't sent with it.
    let res: Response;
    try { res = await this.fetchImpl(url); } catch (err) { throw new MiroError(`The image download failed: ${(err as Error).message}`); }
    if (!res.ok) throw new MiroError(`The image download returned ${res.status}.`, res.status);
    return new Uint8Array(await res.arrayBuffer());
  }
}
