export interface Me { id: string; name: string; email?: string; isAdmin: boolean }
export interface BoardSummary { id: string; title: string; classification: string; role: string; starred: boolean; updated_at: string }

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw Object.assign(new Error(`${res.status}`), { status: res.status });
  return res.json() as Promise<T>;
}

export const api = {
  me: () => call<Me>("GET", "/api/me"),
  boards: (filter = "recent") => call<BoardSummary[]>("GET", `/api/boards?filter=${filter}`),
  createBoard: (title: string, classification: string) => call<{ id: string }>("POST", "/api/boards", { title, classification }),
  board: (id: string) => call<BoardSummary>("GET", `/api/boards/${id}`),
  deleteBoard: (id: string) => call<unknown>("DELETE", `/api/boards/${id}`),
  restoreBoard: (id: string) => call<unknown>("POST", `/api/boards/${id}/restore`),
  star: (id: string, starred: boolean) => call<unknown>("PUT", `/api/boards/${id}/star`, { starred }),
  logout: () => call<unknown>("POST", "/auth/logout"),
};
