export interface Me { id: string; name: string; email?: string; isAdmin: boolean }
export interface Person { type: "user" | "group"; id: string; name: string; email?: string }
export interface Member { type: "user" | "group"; id: string; name: string; role: string }
export interface Anchor { objectId?: string; x?: number; y?: number }
export interface CommentRow { id: string; threadId: string; authorId: string; authorName: string; body: string; createdAt: string; editedAt: string | null }
export interface Thread { id: string; anchor: Anchor | null; resolved: boolean; resolvedBy: string | null; comments: CommentRow[] }
export interface Notification { id: string; kind: "mention" | "reply"; boardId: string; boardTitle: string; classification: string; actorName: string; createdAt: string; read: boolean }
export interface VersionInfo { id: string; kind: "auto" | "named"; name: string | null; objectCount: number; createdByName: string | null; createdAt: string; bytes: number }
export interface SearchHit { id: string; title: string; classification: string; role: string; snippet: string }
export interface TemplateInfo { id: string; name: string; description?: string }
export interface OrgTemplate { id: string; name: string; classification: string; objectCount: number; createdByName: string; mine: boolean }
export interface VoteState {
  session: { id: string; limit: number; anonymous: boolean; state: "open" | "closed" } | null;
  mine: string[]; remaining: number;
  results: { objectId: string; count: number; voters?: string[] }[] | null;
}
export interface BoardSummary { id: string; title: string; classification: string; role: string; starred: boolean; updated_at: string }

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw Object.assign(new Error(`${res.status}`), { status: res.status });
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  me: () => call<Me>("GET", "/api/me"),
  boards: (filter = "recent") => call<BoardSummary[]>("GET", `/api/boards?filter=${filter}`),
  createBoard: (title: string, classification: string, template?: string) => call<{ id: string }>("POST", "/api/boards", { title, classification, template: template || undefined }),
  board: (id: string) => call<BoardSummary>("GET", `/api/boards/${id}`),
  deleteBoard: (id: string) => call<unknown>("DELETE", `/api/boards/${id}`),
  restoreBoard: (id: string) => call<unknown>("POST", `/api/boards/${id}/restore`),
  star: (id: string, starred: boolean) => call<unknown>("PUT", `/api/boards/${id}/star`, { starred }),
  people: (q: string) => call<Person[]>("GET", `/api/people?q=${encodeURIComponent(q)}`),
  members: (id: string) => call<Member[]>("GET", `/api/boards/${id}/members`),
  share: (id: string, p: Person, role: string) => call<unknown>("PUT", `/api/boards/${id}/members`, { type: p.type, principalId: p.id, role, name: p.name }),
  unshare: (id: string, m: { type: string; id: string }) => call<unknown>("DELETE", `/api/boards/${id}/members/${m.type}/${encodeURIComponent(m.id)}`),
  uploadFile: async (boardId: string, file: Blob) => {
    const res = await fetch(`/api/boards/${boardId}/files`, { method: "POST", credentials: "same-origin", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
    if (!res.ok) throw Object.assign(new Error(`${res.status}`), { status: res.status });
    return res.json() as Promise<{ id: string; mimeType: string }>;
  },
  fetchFile: async (boardId: string, fileId: string) => {
    const res = await fetch(`/api/boards/${boardId}/files/${fileId}`, { credentials: "same-origin" });
    if (!res.ok) throw Object.assign(new Error(`${res.status}`), { status: res.status });
    return res.blob();
  },
  threads: (id: string) => call<Thread[]>("GET", `/api/boards/${id}/comments`),
  mentionable: (id: string) => call<{ id: string; name: string }[]>("GET", `/api/boards/${id}/mentionable`),
  addComment: (id: string, body: { body: string; threadId?: string; anchor?: Anchor }) => call<{ id: string; threadId: string }>("POST", `/api/boards/${id}/comments`, body),
  resolveThread: (id: string, threadId: string, resolved: boolean) => call<unknown>("PUT", `/api/boards/${id}/threads/${threadId}/resolved`, { resolved }),
  editComment: (id: string, commentId: string, body: string) => call<unknown>("PATCH", `/api/boards/${id}/comments/${commentId}`, { body }),
  deleteComment: (id: string, commentId: string) => call<unknown>("DELETE", `/api/boards/${id}/comments/${commentId}`),
  notifications: () => call<Notification[]>("GET", "/api/notifications"),
  markRead: (ids?: string[]) => call<unknown>("POST", "/api/notifications/read", ids ? { ids } : {}),
  versions: (id: string) => call<VersionInfo[]>("GET", `/api/boards/${id}/versions`),
  saveVersion: (id: string, name: string) => call<{ id: string }>("POST", `/api/boards/${id}/versions`, { name }),
  restoreVersion: (id: string, versionId: string) => call<{ state: string }>("POST", `/api/boards/${id}/versions/${versionId}/restore`),
  deleteVersion: (id: string, versionId: string) => call<unknown>("DELETE", `/api/boards/${id}/versions/${versionId}`),
  search: (q: string) => call<SearchHit[]>("GET", `/api/search?q=${encodeURIComponent(q)}`),
  time: () => call<{ now: number }>("GET", "/api/time"),
  templates: () => call<{ builtin: TemplateInfo[]; organisation: OrgTemplate[] }>("GET", "/api/templates"),
  saveTemplate: (boardId: string, name: string, objectIds?: string[]) => call<{ id: string }>("POST", "/api/templates", { boardId, name, objectIds }),
  deleteTemplate: (id: string) => call<unknown>("DELETE", `/api/templates/${id}`),
  votes: (id: string) => call<VoteState>("GET", `/api/boards/${id}/votes`),
  startVoting: (id: string, limit: number, anonymous: boolean) => call<VoteState>("POST", `/api/boards/${id}/votes/session`, { limit, anonymous }),
  closeVoting: (id: string) => call<VoteState>("POST", `/api/boards/${id}/votes/close`),
  castVote: (id: string, objectId: string) => call<VoteState>("POST", `/api/boards/${id}/votes`, { objectId }),
  removeVote: (id: string, objectId: string) => call<VoteState>("DELETE", `/api/boards/${id}/votes`, { objectId }),
  recordExport: (id: string, format: string, scope = "board") => call<unknown>("POST", `/api/boards/${id}/exports`, { format, scope }),
  importBoard: (file: string, classification?: string) => call<{ id: string }>("POST", "/api/boards/import", { file, classification }),
  logout: () => call<unknown>("POST", "/auth/logout"),
};
