import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import {
  atLeast, boardObjectSchema, buildTemplate, cloneWithNewIds, compareClassification, isBuiltinTemplate, MAX_OBJECTS_PER_BOARD, OBJECTS_MAP,
  type BoardObject, type BoardRole, type Classification,
} from "@miroclone/shared";
import { appendUpdate, loadDoc, roleOnBoard, type Actor, type Db } from "@miroclone/server-core";
import { Forbidden, Invalid, NotFound } from "./boards.js";

async function need(db: Db, actor: Actor, boardId: string, min: BoardRole): Promise<BoardRole> {
  const role = await roleOnBoard(db, actor, boardId);
  if (!role) throw new NotFound();
  if (!atLeast(role, min)) throw new Forbidden();
  return role;
}

/** Writes objects into a new board's stored document, as if a user had added them. */
export async function seedBoard(db: Db, boardId: string, objects: readonly BoardObject[]) {
  const doc = new Y.Doc();
  doc.transact(() => { for (const o of objects) doc.getMap(OBJECTS_MAP).set(o.id, o); });
  await appendUpdate(db, boardId, Y.encodeStateAsUpdate(doc));
}

// ---------------------------------------------------------------- templates (WSH-1, WSH-2)

export interface OrgTemplate { id: string; name: string; classification: string; objectCount: number; createdByName: string; createdAt: string; mine: boolean }

export async function listOrgTemplates(db: Db, actor: Actor): Promise<OrgTemplate[]> {
  const { rows } = await db.query<{ id: string; name: string; classification: string; object_count: number; display_name: string; created_at: string; created_by: string }>(
    `SELECT t.id, t.name, t.classification, t.object_count, u.display_name, t.created_at, t.created_by
     FROM org_templates t JOIN users u ON u.id = t.created_by ORDER BY t.created_at DESC`);
  return rows.map((r) => ({ id: r.id, name: r.name, classification: r.classification, objectCount: r.object_count, createdByName: r.display_name, createdAt: r.created_at, mine: r.created_by === actor.id }));
}

/**
 * Saves a board, or part of it, as an organisation template. The server takes the content from the board's own
 * stored document, so nobody can put other content in a template. Everyone in the organisation can then use it,
 * so it needs editor rights on the board, and it keeps the board's classification.
 */
export async function saveOrgTemplate(db: Db, actor: Actor, boardId: string, name: string, objectIds?: string[]): Promise<string> {
  await need(db, actor, boardId, "editor");
  const n = name.trim();
  if (!n || n.length > 100) throw new Invalid("A template needs a name of 1 to 100 characters.");
  const doc = await loadDoc(db, boardId);
  let objs = [...doc.getMap<BoardObject>(OBJECTS_MAP).values()];
  if (objectIds?.length) {
    const want = new Set(objectIds);
    // Keep a connector when both its ends are kept, as copy and paste does.
    objs = objs.filter((o) => (o.type === "connector" ? want.has(o.from) && want.has(o.to) : want.has(o.id)));
  }
  if (!objs.length) throw new Invalid("There is nothing to save.");
  if (objs.length > MAX_OBJECTS_PER_BOARD) throw new Invalid("That is too large for a template.");
  const { rows } = await db.query<{ classification: string }>("SELECT classification FROM boards WHERE id = $1", [boardId]);
  const cloned = cloneWithNewIds(objs);
  const id = randomUUID();
  await db.query(
    "INSERT INTO org_templates (id, name, classification, objects, object_count, created_by) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, n, rows[0]!.classification, JSON.stringify(cloned), cloned.length, actor.id]);
  return id;
}

export async function deleteOrgTemplate(db: Db, actor: Actor & { isAdmin?: boolean }, id: string) {
  const r = (await db.query<{ created_by: string }>("SELECT created_by FROM org_templates WHERE id = $1", [id])).rows[0];
  if (!r) throw new NotFound();
  if (r.created_by !== actor.id && !actor.isAdmin) throw new Forbidden("Only the author or an administrator can delete a template.");
  await db.query("DELETE FROM org_templates WHERE id = $1", [id]);
}

/**
 * Finds the starting content for a new board. A template's classification is a floor: a board made from a
 * PROTECTED template can't start lower, so content can't drop a level by being copied (PMK-5).
 */
export async function templateObjects(db: Db, templateId: string, classification: string, list?: readonly Classification[]): Promise<BoardObject[]> {
  if (isBuiltinTemplate(templateId)) return buildTemplate(templateId);
  if (!/^[0-9a-f-]{36}$/i.test(templateId)) throw new NotFound();
  const r = (await db.query<{ objects: unknown; classification: string }>("SELECT objects, classification FROM org_templates WHERE id = $1", [templateId])).rows[0];
  if (!r) throw new NotFound();
  if (compareClassification(classification, r.classification, list) < 0)
    throw new Invalid(`This template holds ${r.classification} content, so the board must be ${r.classification} or higher.`);
  return cloneWithNewIds((r.objects as unknown[]).map((o) => boardObjectSchema.parse(o)));
}

// ---------------------------------------------------------------- voting (WSH-4)

export interface VoteState {
  session: { id: string; limit: number; anonymous: boolean; state: "open" | "closed"; createdAt: string } | null;
  /** The caller's own votes, as object IDs. A repeated ID is several votes on one object. */
  mine: string[];
  remaining: number;
  /** Shown only after the session closes. For an anonymous session, voters are never included. */
  results: { objectId: string; count: number; voters?: string[] }[] | null;
}

async function latestSession(db: Db, boardId: string) {
  return (await db.query<{ id: string; vote_limit: number; anonymous: boolean; state: "open" | "closed"; created_at: string }>(
    "SELECT id, vote_limit, anonymous, state, created_at FROM vote_sessions WHERE board_id = $1 ORDER BY created_at DESC, id LIMIT 1", [boardId])).rows[0];
}

export async function voteState(db: Db, actor: Actor, boardId: string): Promise<VoteState> {
  await need(db, actor, boardId, "viewer");
  const s = await latestSession(db, boardId);
  if (!s) return { session: null, mine: [], remaining: 0, results: null };
  const mine = (await db.query<{ object_id: string }>("SELECT object_id FROM votes WHERE session_id = $1 AND user_id = $2 ORDER BY created_at", [s.id, actor.id])).rows.map((r) => r.object_id);
  let results: VoteState["results"] = null;
  if (s.state === "closed") {
    if (s.anonymous) {
      results = (await db.query<{ object_id: string; n: string }>("SELECT object_id, count(*) AS n FROM votes WHERE session_id = $1 GROUP BY object_id ORDER BY n DESC, object_id", [s.id]))
        .rows.map((r) => ({ objectId: r.object_id, count: Number(r.n) }));
    } else {
      const rows = (await db.query<{ object_id: string; name: string }>(
        "SELECT v.object_id, u.display_name AS name FROM votes v JOIN users u ON u.id = v.user_id WHERE v.session_id = $1 ORDER BY v.created_at", [s.id])).rows;
      const by = new Map<string, string[]>();
      for (const r of rows) by.set(r.object_id, [...(by.get(r.object_id) ?? []), r.name]);
      results = [...by].map(([objectId, voters]) => ({ objectId, count: voters.length, voters })).sort((a, b) => b.count - a.count || a.objectId.localeCompare(b.objectId));
    }
  }
  return {
    session: { id: s.id, limit: s.vote_limit, anonymous: s.anonymous, state: s.state, createdAt: s.created_at },
    mine, remaining: s.state === "open" ? Math.max(0, s.vote_limit - mine.length) : 0, results,
  };
}

export async function startVoting(db: Db, actor: Actor, boardId: string, limit: number, anonymous: boolean): Promise<string> {
  await need(db, actor, boardId, "editor");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Invalid("The vote limit must be a whole number from 1 to 50.");
  const id = randomUUID();
  try {
    await db.query("INSERT INTO vote_sessions (id, board_id, vote_limit, anonymous, created_by) VALUES ($1, $2, $3, $4, $5)", [id, boardId, limit, !!anonymous, actor.id]);
  } catch (e) {
    if (/one_open_vote_session|duplicate key/.test(String((e as Error).message))) throw new Invalid("A voting session is already open. Close it first.");
    throw e;
  }
  return id;
}

export async function castVote(db: Db, actor: Actor, boardId: string, objectId: string) {
  await need(db, actor, boardId, "commenter");
  if (typeof objectId !== "string" || objectId.length < 1 || objectId.length > 64) throw new Invalid("Choose an object to vote for.");
  const s = await latestSession(db, boardId);
  if (!s || s.state !== "open") throw new Invalid("No voting session is open.");
  // One statement counts and inserts, so two quick clicks can't pass the limit.
  const r = await db.query(
    `INSERT INTO votes (session_id, user_id, object_id)
     SELECT $1, $2, $3 WHERE (SELECT count(*) FROM votes WHERE session_id = $1 AND user_id = $2) < $4 RETURNING id`,
    [s.id, actor.id, objectId, s.vote_limit]);
  if (!r.rows.length) throw new Invalid("You have used all your votes.");
}

export async function removeVote(db: Db, actor: Actor, boardId: string, objectId: string) {
  await need(db, actor, boardId, "commenter");
  const s = await latestSession(db, boardId);
  if (!s || s.state !== "open") throw new Invalid("No voting session is open.");
  await db.query(
    "DELETE FROM votes WHERE id = (SELECT id FROM votes WHERE session_id = $1 AND user_id = $2 AND object_id = $3 ORDER BY created_at DESC LIMIT 1)",
    [s.id, actor.id, objectId]);
}

export async function closeVoting(db: Db, actor: Actor, boardId: string) {
  await need(db, actor, boardId, "editor");
  const r = await db.query("UPDATE vote_sessions SET state = 'closed', closed_at = now() WHERE board_id = $1 AND state = 'open' RETURNING id", [boardId]);
  if (!r.rows.length) throw new Invalid("No voting session is open.");
}
