import { randomUUID } from "node:crypto";
import { atLeast, type BoardRole } from "@miroclone/shared";
import { roleOnBoard, type Actor, type Db } from "@miroclone/server-core";
import { Forbidden, Invalid, NotFound } from "./boards.js";

export const MAX_BODY = 4000;
/** A mention is stored in the text as `@[Display name](user ID)`. */
const MENTION = /@\[([^\]]{1,100})\]\(([^)]{1,100})\)/g;

export interface Anchor { objectId?: string; x?: number; y?: number }
export interface CommentRow { id: string; threadId: string; authorId: string; authorName: string; body: string; createdAt: string; editedAt: string | null }
export interface Thread { id: string; anchor: Anchor | null; resolved: boolean; resolvedBy: string | null; comments: CommentRow[] }

async function need(db: Db, actor: Actor, boardId: string, min: BoardRole): Promise<BoardRole> {
  const role = await roleOnBoard(db, actor, boardId);
  if (!role) throw new NotFound();
  if (!atLeast(role, min)) throw new Forbidden();
  return role;
}

export const mentionsIn = (body: string): string[] => [...new Set([...body.matchAll(MENTION)].map((m) => m[2]!))];

/** Notes that a user opened a board, so others can mention them even when access comes through a group. */
export async function recordParticipant(db: Db, boardId: string, userId: string) {
  await db.query(
    `INSERT INTO board_participants (board_id, user_id) VALUES ($1, $2)
     ON CONFLICT (board_id, user_id) DO UPDATE SET last_seen_at = now()`, [boardId, userId]);
}

/** People who can be mentioned: direct members and anyone who has opened the board. */
export async function mentionCandidates(db: Db, actor: Actor, boardId: string): Promise<{ id: string; name: string }[]> {
  await need(db, actor, boardId, "commenter");
  const { rows } = await db.query<{ id: string; name: string }>(
    `SELECT DISTINCT u.id, u.display_name AS name FROM users u
     WHERE u.id IN (SELECT principal_id FROM board_members WHERE board_id = $1 AND principal_type = 'user'
                    UNION SELECT user_id FROM board_participants WHERE board_id = $1)
     ORDER BY name`, [boardId]);
  return rows;
}

function validAnchor(a: unknown): Anchor | null {
  if (a == null) return null;
  const o = a as Anchor;
  const num = (v: unknown) => v === undefined || (typeof v === "number" && Number.isFinite(v));
  if (typeof a !== "object" || !num(o.x) || !num(o.y) || (o.objectId !== undefined && (typeof o.objectId !== "string" || o.objectId.length > 64)))
    throw new Invalid("bad anchor");
  return { objectId: o.objectId, x: o.x, y: o.y };
}

export async function listThreads(db: Db, actor: Actor, boardId: string): Promise<Thread[]> {
  await need(db, actor, boardId, "viewer");
  const { rows } = await db.query<{
    id: string; thread_id: string; author_id: string; author_name: string; body: string; created_at: string; edited_at: string | null;
    anchor: Anchor | null; resolved_at: string | null; resolved_by: string | null;
  }>(
    `SELECT c.id, c.thread_id, c.author_id, u.display_name AS author_name, c.body, c.created_at, c.edited_at, c.anchor, c.resolved_at, c.resolved_by
     FROM comments c JOIN users u ON u.id = c.author_id WHERE c.board_id = $1 ORDER BY c.created_at, c.id`, [boardId]);
  const threads = new Map<string, Thread>();
  for (const r of rows) {
    let t = threads.get(r.thread_id);
    if (!t) { t = { id: r.thread_id, anchor: null, resolved: false, resolvedBy: null, comments: [] }; threads.set(r.thread_id, t); }
    if (r.id === r.thread_id) { t.anchor = r.anchor; t.resolved = !!r.resolved_at; t.resolvedBy = r.resolved_by; }
    t.comments.push({ id: r.id, threadId: r.thread_id, authorId: r.author_id, authorName: r.author_name, body: r.body, createdAt: r.created_at, editedAt: r.edited_at });
  }
  return [...threads.values()];
}

/**
 * Adds a comment. With no threadId it starts a thread at `anchor`. Mentions and replies create notifications (COL-8).
 */
export async function addComment(
  db: Db, actor: Actor, boardId: string,
  input: { body: string; threadId?: string; anchor?: unknown },
): Promise<{ id: string; threadId: string }> {
  await need(db, actor, boardId, "commenter");
  const body = (input.body ?? "").trim();
  if (!body) throw new Invalid("A comment needs text.");
  if (body.length > MAX_BODY) throw new Invalid("That comment is too long.");

  if (input.threadId) {
    const t = await db.query("SELECT 1 FROM comments WHERE id = $1 AND board_id = $2 AND thread_id = id", [input.threadId, boardId]);
    if (!t.rows.length) throw new NotFound();
  }
  const anchor = input.threadId ? null : validAnchor(input.anchor);
  // A new thread's first comment points at itself, so the ID comes first.
  const commentId = randomUUID();
  const finalThread = input.threadId ?? commentId;
  await db.query(
    "INSERT INTO comments (id, board_id, thread_id, author_id, body, anchor) VALUES ($1, $2, $3, $4, $5, $6)",
    [commentId, boardId, finalThread, actor.id, body, anchor ? JSON.stringify(anchor) : null]);

  // Only people who can open the board are notified, so a mention can't reveal that a board exists.
  const allowed = new Set((await mentionCandidates(db, actor, boardId)).map((p) => p.id));
  const mentioned = mentionsIn(body).filter((u) => u !== actor.id && allowed.has(u));
  const replyTo = input.threadId
    ? (await db.query<{ author_id: string }>("SELECT DISTINCT author_id FROM comments WHERE thread_id = $1", [finalThread])).rows
        .map((r) => r.author_id).filter((u) => u !== actor.id && !mentioned.includes(u))
    : [];
  for (const [user, kind] of [...mentioned.map((u) => [u, "mention"] as const), ...replyTo.map((u) => [u, "reply"] as const)]) {
    await db.query("INSERT INTO notifications (user_id, board_id, comment_id, kind, actor_id) VALUES ($1, $2, $3, $4, $5)", [user, boardId, commentId, kind, actor.id]);
  }
  return { id: commentId, threadId: finalThread };
}

/** Resolves or reopens a thread. Anyone who can comment can do it. */
export async function setResolved(db: Db, actor: Actor, boardId: string, threadId: string, resolved: boolean) {
  await need(db, actor, boardId, "commenter");
  const r = await db.query(
    `UPDATE comments SET resolved_at = ${resolved ? "now()" : "NULL"}, resolved_by = ${resolved ? "$3" : "NULL"}
     WHERE id = $1 AND board_id = $2 AND thread_id = id RETURNING id`,
    resolved ? [threadId, boardId, actor.id] : [threadId, boardId]);
  if (!r.rows.length) throw new NotFound();
}

export async function editComment(db: Db, actor: Actor, boardId: string, commentId: string, body: string) {
  await need(db, actor, boardId, "commenter");
  const text = body.trim();
  if (!text || text.length > MAX_BODY) throw new Invalid("A comment needs 1 to 4000 characters.");
  const r = await db.query("UPDATE comments SET body = $3, edited_at = now() WHERE id = $1 AND board_id = $2 AND author_id = $4 RETURNING id", [commentId, boardId, text, actor.id]);
  if (!r.rows.length) throw new Forbidden("Only the author can edit a comment.");
}

/** Authors delete their own comments, and editors delete any. Deleting the first comment deletes the thread. */
export async function deleteComment(db: Db, actor: Actor, boardId: string, commentId: string) {
  const role = await need(db, actor, boardId, "commenter");
  const c = (await db.query<{ author_id: string; thread_id: string }>("SELECT author_id, thread_id FROM comments WHERE id = $1 AND board_id = $2", [commentId, boardId])).rows[0];
  if (!c) throw new NotFound();
  if (c.author_id !== actor.id && !atLeast(role, "editor")) throw new Forbidden();
  if (c.thread_id === commentId) await db.query("DELETE FROM comments WHERE thread_id = $1", [commentId]);
  else await db.query("DELETE FROM comments WHERE id = $1", [commentId]);
}

export interface NotificationRow { id: string; kind: "mention" | "reply"; boardId: string; boardTitle: string; classification: string; actorName: string; commentId: string; createdAt: string; read: boolean }

/** Lists a user's notifications, newest first. Only boards the user can still open are shown. */
export async function listNotifications(db: Db, actor: Actor, limit = 50): Promise<NotificationRow[]> {
  const { rows } = await db.query<{ id: string; kind: "mention" | "reply"; board_id: string; title: string; classification: string; actor_name: string; comment_id: string; created_at: string; read_at: string | null }>(
    `SELECT n.id, n.kind, n.board_id, b.title, b.classification, u.display_name AS actor_name, n.comment_id, n.created_at, n.read_at
     FROM notifications n JOIN boards b ON b.id = n.board_id AND b.deleted_at IS NULL JOIN users u ON u.id = n.actor_id
     WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT $2`, [actor.id, limit]);
  const out: NotificationRow[] = [];
  for (const r of rows) {
    if (!(await roleOnBoard(db, actor, r.board_id))) continue;
    out.push({ id: r.id, kind: r.kind, boardId: r.board_id, boardTitle: r.title, classification: r.classification, actorName: r.actor_name, commentId: r.comment_id, createdAt: r.created_at, read: !!r.read_at });
  }
  return out;
}

export async function markRead(db: Db, actor: Actor, ids?: string[]) {
  if (ids?.length) await db.query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2::uuid[])", [actor.id, ids]);
  else await db.query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [actor.id]);
}
