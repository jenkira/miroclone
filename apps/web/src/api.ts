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
export interface MigrationResult { id: string; ownerId: string; ownerResolved: boolean; objects: number; images: number; imageProblems: { name: string; reason: string }[] }
export interface MarkerDef { key: string; label: string }
export interface Marking { key: string; label: string; level: number; colour: string }
export interface ClassificationConfig { list: Marking[]; default: string }
export interface UsageStats {
  users: { total: number; activeLast7Days: number; activeLast30Days: number };
  boards: { total: number; inRecycleBin: number; byClassification: { classification: string; count: number }[] };
  storage: { documentBytes: number; versionBytes: number; fileBytes: number; fileCount: number };
  activity: { comments: number; templates: number };
}
export interface BoardSummary { id: string; title: string; classification: string; markers?: string[]; archived_at?: string | null; canRestore?: boolean; role: string; starred: boolean; updated_at: string; space_id?: string | null }
export interface Space { id: string; name: string; role: string; boards: number }

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
  visibility: (id: string) => call<{ role: string | null }>("GET", `/api/boards/${id}/visibility`),
  setVisibility: (id: string, role: string | null) => call<unknown>("PUT", `/api/boards/${id}/visibility`, { role }),
  transfer: (id: string, userId: string) => call<unknown>("POST", `/api/boards/${id}/transfer`, { userId }),
  spaces: () => call<Space[]>("GET", "/api/spaces"),
  createSpace: (name: string) => call<{ id: string }>("POST", "/api/spaces", { name }),
  deleteSpace: (id: string) => call<unknown>("DELETE", `/api/spaces/${id}`),
  spaceMembers: (id: string) => call<Member[]>("GET", `/api/spaces/${id}/members`),
  shareSpace: (id: string, p: Person, role: string) => call<unknown>("PUT", `/api/spaces/${id}/members`, { type: p.type, principalId: p.id, role, name: p.name }),
  unshareSpace: (id: string, m: { type: string; id: string }) => call<unknown>("DELETE", `/api/spaces/${id}/members/${m.type}/${encodeURIComponent(m.id)}`),
  moveToSpace: (id: string, spaceId: string | null) => call<unknown>("PUT", `/api/boards/${id}/space`, { spaceId }),
  importMigrated: (body: { board: string; classification: string; ownerEmail?: string; sourceId?: string; files?: { name: string; data: string }[] }) =>
    call<MigrationResult>("POST", "/api/admin/migration/import", body),
  uploadFile: async (boardId: string, file: Blob) => {
    const res = await fetch(`/api/boards/${boardId}/files`, { method: "POST", credentials: "same-origin", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
    if (!res.ok) throw Object.assign(new Error(`${res.status}`), { status: res.status });
    return res.json() as Promise<{ id: string; mimeType: string; pages?: number }>;
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
  teamsNotifications: () => call<{ enabled: boolean }>("GET", "/api/admin/teams-notifications"),
  setTeamsNotifications: (enabled: boolean) => call<{ enabled: boolean }>("PUT", "/api/admin/teams-notifications", { enabled }),
  retention: () => call<{ archiveAfterMonths: number | null }>("GET", "/api/admin/retention"),
  saveRetention: (archiveAfterMonths: number | null) => call<{ archiveAfterMonths: number | null }>("PUT", "/api/admin/retention", { archiveAfterMonths }),
  archiveBoard: (id: string) => call<unknown>("POST", `/api/boards/${id}/archive`),
  unarchiveBoard: (id: string) => call<unknown>("POST", `/api/boards/${id}/unarchive`),
  linkPreview: (id: string, url: string) => call<{ url: string; title: string; description: string; fetched: boolean }>("GET", `/api/boards/${id}/link-preview?url=${encodeURIComponent(url)}`),
  previewHosts: () => call<string[]>("GET", "/api/admin/link-preview-hosts"),
  savePreviewHosts: (hosts: string[]) => call<string[]>("PUT", "/api/admin/link-preview-hosts", hosts),
  markers: () => call<MarkerDef[]>("GET", "/api/markers"),
  saveMarkerList: (list: MarkerDef[]) => call<MarkerDef[]>("PUT", "/api/admin/markers", list),
  setBoardMarkers: (id: string, markers: string[]) => call<{ markers: string[] }>("PUT", `/api/boards/${id}/markers`, { markers }),
  classifications: () => call<ClassificationConfig>("GET", "/api/classifications"),
  saveClassifications: (cfg: ClassificationConfig) => call<ClassificationConfig>("PUT", "/api/admin/classifications", cfg),
  stats: () => call<UsageStats>("GET", "/api/admin/stats"),
  auditPaste: (toBoardId: string, fromBoardId: string, count: number) => call<unknown>("POST", `/api/boards/${toBoardId}/paste-audit`, { fromBoardId, count }),
  recordExport: (id: string, format: string, scope = "board") => call<unknown>("POST", `/api/boards/${id}/exports`, { format, scope }),
  importBoard: (file: string, classification?: string) => call<{ id: string }>("POST", "/api/boards/import", { file, classification }),
  logout: () => call<unknown>("POST", "/auth/logout"),
};
