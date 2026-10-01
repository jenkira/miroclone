import type { FastifyInstance, FastifyRequest } from "fastify";
import * as Y from "yjs";
import { atLeast, boardRoles, builtinTemplates, compareClassification, exportSvg, importJson, isDowngrade, OBJECTS_MAP, type BoardRole } from "@miroclone/shared";
import { appendUpdate, deleteVersion, loadDoc, loadRetention, saveRetention, listVersions, openTokens, sealTokens, searchBoards, snapshot, versionState } from "@miroclone/server-core";
import { createHash, randomUUID } from "node:crypto";
import type { GraphClient } from "./graph.js";
import { detectImageType, MAX_UPLOAD_BYTES, svgProblem } from "./files.js";
import type { ObjectStore } from "@miroclone/server-core";
import type { Scanner } from "./scanner.js";
import type { OidcClient } from "./oidc.js";
import { audit } from "./audit.js";
import * as spaces from "./spaces.js";
import { Conflict, importMigratedBoard } from "./migration.js";
import * as boards from "./boards.js";
import * as comments from "./comments.js";
import * as workshop from "./workshop.js";
import { loadClassifications, loadMarkers, saveClassifications, saveMarkers, usageStats, type ClassificationConfig } from "./settings.js";
import type { Db } from "@miroclone/server-core";
import { SESSION_COOKIE, type Session, type SessionManager } from "@miroclone/server-core";

declare module "fastify" {
  interface FastifyRequest { session?: Session }
}

function status(err: unknown): number {
  if (err instanceof boards.NotFound) return 404;
  if (err instanceof boards.Forbidden) return 403;
  if (err instanceof boards.Invalid) return 400;
  // Fastify's own client errors, such as an oversize body (413) or a bad content type (415).
  const code = (err as { statusCode?: number }).statusCode;
  return code && code >= 400 && code < 500 ? code : 500;
}

/** Who can export boards of a classification (EXP-5). Missing classifications allow everyone who can view. */
export type ExportPolicy = Record<string, "everyone" | "owners" | "none">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const exportFormats = ["png", "svg", "pdf", "json"] as const;

export function boardRoutes(app: FastifyInstance, opts: { db: Db; sessions: SessionManager; exportPolicy?: ExportPolicy; graph: GraphClient; oidc: OidcClient; tokenKey: Buffer; store?: ObjectStore; scanner?: Scanner }) {
  const { db } = opts;
  const actorOf = (r: FastifyRequest): boards.Actor => ({ id: r.session!.userId, groups: r.session!.groups });

  app.register(async (api) => {
    api.addHook("preHandler", async (req, reply) => {
      req.session = await opts.sessions.touch(req.cookies[SESSION_COOKIE]);
      if (!req.session) return reply.code(401).send({ error: "unauthenticated" });
    });
    api.setErrorHandler((err: Error, req, reply) => {
      const code = status(err);
      if (code === 500) req.log.error({ err });
      reply.code(code).send({ error: code === 500 ? "internal" : code === 413 ? "file_too_large" : err.message || err.constructor.name });
    });

    // The markings an administrator configured (PMK-1). The list is cached for a few seconds, and a save clears it.
    let cached: { at: number; cfg: ClassificationConfig } | undefined;
    const config = async (): Promise<ClassificationConfig> => {
      if (!cached || Date.now() - cached.at > 5000) cached = { at: Date.now(), cfg: await loadClassifications(db) };
      return cached.cfg;
    };
    const isClassification = async (k: unknown): Promise<boolean> => typeof k === "string" && (await config()).list.some((c) => c.key === k);
    const adminOnly = (req: FastifyRequest) => { if (!req.session!.isAdmin) throw new boards.Forbidden("Only a service administrator can do this."); };

    api.get("/api/classifications", async () => config());

    // Information management markers and caveats (PMK-6). The list is empty until an administrator adds some.
    api.get("/api/markers", async () => loadMarkers(db));
    api.put<{ Body: unknown }>("/api/admin/markers", async (req) => {
      adminOnly(req);
      const saved = await saveMarkers(db, req.session!.userId, req.body);
      audit({ action: "settings_change", actor: req.session!.userId, detail: { setting: "markers", markers: saved.map((m) => m.key) } });
      return saved;
    });
    api.put<{ Params: { id: string }; Body: { markers: string[] } }>("/api/boards/:id/markers", async (req) => {
      const keys = (await loadMarkers(db)).map((m) => m.key);
      const markers = await boards.setMarkers(db, actorOf(req), req.params.id, req.body?.markers, keys);
      audit({ action: "classification_change", actor: req.session!.userId, boardId: req.params.id, detail: { markers } });
      return { markers };
    });

    api.put<{ Body: unknown }>("/api/admin/classifications", async (req) => {
      adminOnly(req);
      const saved = await saveClassifications(db, req.session!.userId, req.body);
      cached = undefined;
      audit({ action: "settings_change", actor: req.session!.userId, detail: { setting: "classifications", markings: saved.list.map((c) => `${c.key}:${c.level}`), default: saved.default } });
      return saved;
    });

    api.get("/api/admin/stats", async (req) => { adminOnly(req); return usageStats(db); });

    // Pasting content into a board with a lower classification needs a warning, and leaves an audit event (PMK-5).
    api.post<{ Params: { id: string }; Body: { fromBoardId: string; count?: number } }>("/api/boards/:id/paste-audit", async (req, reply) => {
      const from = req.body?.fromBoardId;
      if (typeof from !== "string" || !UUID.test(from)) throw new boards.Invalid("A source board is needed.");
      const [toRole, fromRole] = [await boards.roleOnBoard(db, actorOf(req), req.params.id), await boards.roleOnBoard(db, actorOf(req), from)];
      if (!toRole || !fromRole) throw new boards.NotFound();
      if (!atLeast(toRole, "editor")) throw new boards.Forbidden();
      const cls = async (id: string) => (await db.query<{ classification: string }>("SELECT classification FROM boards WHERE id = $1", [id])).rows[0]!.classification;
      const [target, source, list] = [await cls(req.params.id), await cls(from), (await config()).list];
      if (!isDowngrade(source, target, list)) throw new boards.Invalid("That paste doesn't lower the classification.");
      audit({ action: "paste_downgrade", actor: req.session!.userId, boardId: req.params.id, detail: { fromBoardId: from, from: source, to: target, objects: Number(req.body.count) || 0 } });
      return reply.code(204).send();
    });


    // --- Files (CNV-8) ---
    // Uploads arrive as raw bytes. Every type is parsed as a buffer, and the route decides what it accepts.
    api.addContentTypeParser(
      ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "application/octet-stream"],
      { parseAs: "buffer", bodyLimit: MAX_UPLOAD_BYTES },
      (_req, body, done) => done(null, body),
    );

    api.post<{ Params: { id: string }; Body: Buffer }>("/api/boards/:id/files", { bodyLimit: MAX_UPLOAD_BYTES }, async (req, reply) => {
      const role = await boards.roleOnBoard(db, actorOf(req), req.params.id);
      if (!role) throw new boards.NotFound();
      if (!atLeast(role, "editor")) throw new boards.Forbidden();
      // Without storage and a scanner, refuse, so nothing reaches users unscanned.
      if (!opts.store || !opts.scanner) return reply.code(503).send({ error: "uploads_unavailable" });
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) return reply.code(400).send({ error: "empty_file" });

      const type = detectImageType(body);
      const declared = (req.headers["content-type"] ?? "").split(";")[0]!.trim();
      if (!type || (declared !== "application/octet-stream" && declared !== type))
        return reply.code(415).send({ error: "unsupported_type" });
      if (type === "image/svg+xml") {
        const why = svgProblem(body);
        if (why) return reply.code(422).send({ error: "svg_not_allowed", reason: why });
      }

      let scan;
      try { scan = await opts.scanner.scan(body); }
      catch (err) { req.log.error({ err }, "malware scan failed"); return reply.code(503).send({ error: "scan_unavailable" }); }
      if (!scan.clean) {
        audit({ action: "upload", actor: req.session!.userId, boardId: req.params.id, detail: { allowed: false, reason: "malware", signature: scan.signature } });
        return reply.code(422).send({ error: "malware_found" });
      }

      const id = randomUUID();
      const key = `boards/${req.params.id}/${id}`;
      await opts.store.put(key, body, type);
      await db.query(
        "INSERT INTO board_files (id, board_id, object_key, mime_type, size_bytes, sha256, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [id, req.params.id, key, type, body.length, createHash("sha256").update(body).digest("hex"), req.session!.userId]);
      audit({ action: "upload", actor: req.session!.userId, boardId: req.params.id, detail: { allowed: true, mimeType: type, bytes: body.length } });
      return reply.code(201).send({ id, mimeType: type });
    });

    api.get<{ Params: { id: string; fileId: string } }>("/api/boards/:id/files/:fileId", async (req, reply) => {
      const role = await boards.roleOnBoard(db, actorOf(req), req.params.id);
      if (!role) throw new boards.NotFound();
      if (!opts.store) return reply.code(503).send({ error: "uploads_unavailable" });
      // The file must belong to the board in the URL, so a file ID from another board gives nothing.
      if (!UUID.test(req.params.fileId)) throw new boards.NotFound();
      const { rows } = await db.query<{ object_key: string; mime_type: string }>(
        "SELECT object_key, mime_type FROM board_files WHERE id = $1 AND board_id = $2",
        [req.params.fileId, req.params.id]);
      if (!rows[0]) throw new boards.NotFound();
      const bytes = await opts.store.get(rows[0].object_key);
      if (!bytes) throw new boards.NotFound();
      return reply
        .header("content-type", rows[0].mime_type)
        .header("x-content-type-options", "nosniff")
        // Even if a browser opened the file as a page, it couldn't run anything or load anything.
        .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
        .header("cache-control", "private, max-age=3600")
        .send(Buffer.from(bytes));
    });

    api.get<{ Querystring: { filter?: boards.BoardFilter } }>("/api/boards", async (req) =>
      boards.listBoards(db, actorOf(req), req.query.filter));

    api.post<{ Body: { title: string; classification?: string; template?: string } }>("/api/boards", async (req, reply) => {
      const cfg = await config();
      const requested = req.body.classification ?? cfg.default;
      if (!(await isClassification(requested))) throw new boards.Invalid("unknown classification");
      // Check the template first, so a board isn't created and then left empty.
      const start = req.body.template ? await workshop.templateObjects(db, req.body.template, requested, cfg.list) : undefined;
      const id = await boards.createBoard(db, actorOf(req), req.body.title, requested);
      if (start) await workshop.seedBoard(db, id, start);
      audit({ action: "board_create", actor: req.session!.userId, boardId: id, detail: { classification: requested, template: req.body.template } });
      return reply.code(201).send({ id });
    });

    api.get<{ Params: { id: string } }>("/api/boards/:id", async (req) => {
      const role = await boards.roleOnBoard(db, actorOf(req), req.params.id);
      if (!role) throw new boards.NotFound();
      const { rows } = await db.query("SELECT id, title, classification, markers, updated_at, archived_at FROM boards WHERE id = $1", [req.params.id]);
      audit({ action: "board_access", actor: req.session!.userId, boardId: req.params.id });
      // Opening a board restarts its retention clock. Updating at most once an hour keeps this cheap.
      await db.query("UPDATE boards SET last_opened_at = now() WHERE id = $1 AND last_opened_at < now() - interval '1 hour'", [req.params.id]);
      await comments.recordParticipant(db, req.params.id, req.session!.userId);
      // An archived board is read-only, but its owner can still restore it, and the page needs to know that.
      const canRestore = !!rows[0]?.archived_at && (await boards.roleOnBoard(db, actorOf(req), req.params.id, { ignoreArchive: true })) === "owner";
      return { ...rows[0], role, canRestore };
    });

    api.patch<{ Params: { id: string }; Body: { title: string } }>("/api/boards/:id", async (req) => {
      await boards.renameBoard(db, actorOf(req), req.params.id, req.body.title);
      return { ok: true };
    });

    api.delete<{ Params: { id: string } }>("/api/boards/:id", async (req) => {
      await boards.deleteBoard(db, actorOf(req), req.params.id);
      audit({ action: "delete", actor: req.session!.userId, boardId: req.params.id });
      return { ok: true };
    });

    api.post<{ Params: { id: string } }>("/api/boards/:id/restore", async (req) => {
      await boards.restoreBoard(db, actorOf(req), req.params.id);
      return { ok: true };
    });

    /** Returns a live Graph access token for the session, refreshing it when it's about to expire. */
    const graphToken = async (s: Session): Promise<string> => {
      let t = s.graph ? openTokens(s.graph, opts.tokenKey) : undefined;
      if (!t) throw new boards.Forbidden("Sign in again to search the directory.");
      if (t.expiresAt - Math.floor(Date.now() / 1000) < 60) {
        if (!t.refreshToken) throw new boards.Forbidden("Sign in again to search the directory.");
        t = { ...(await opts.oidc.refresh(t.refreshToken)), refreshToken: t.refreshToken };
        await opts.sessions.setGraph(s.id, sealTokens(t, opts.tokenKey));
      }
      return t.accessToken;
    };

    // People picker (IAM-5). The search runs as the signed-in user, so Graph applies their directory rights.
    api.get<{ Querystring: { q?: string } }>("/api/people", async (req) =>
      opts.graph.search(await graphToken(req.session!), req.query.q ?? ""));

    api.get<{ Params: { id: string } }>("/api/boards/:id/members", async (req) =>
      boards.listMembers(db, actorOf(req), req.params.id));

    api.put<{ Params: { id: string }; Body: { type: "user" | "group"; principalId: string; role: BoardRole; name?: string } }>(
      "/api/boards/:id/members", async (req) => {
        const { type, principalId, role, name } = req.body;
        if (!["user", "group"].includes(type) || !principalId || !boardRoles.includes(role)) throw new boards.Invalid("bad member");
        await boards.share(db, actorOf(req), req.params.id, { type, id: principalId, role, name });
        audit({ action: "share_change", actor: req.session!.userId, boardId: req.params.id, detail: { type, principalId, role } });
        return { ok: true };
      });

    api.delete<{ Params: { id: string; type: "user" | "group"; principalId: string } }>(
      "/api/boards/:id/members/:type/:principalId", async (req) => {
        const { id, type, principalId } = req.params;
        await boards.unshare(db, actorOf(req), id, { type, id: principalId });
        audit({ action: "share_change", actor: req.session!.userId, boardId: id, detail: { type, principalId, role: null } });
        return { ok: true };
      });

    api.put<{ Params: { id: string }; Body: { classification: string; confirmed?: boolean; reason?: string } }>(
      "/api/boards/:id/classification", async (req) => {
        if (!(await isClassification(req.body.classification))) throw new boards.Invalid("unknown classification");
        const change = await boards.setClassification(db, actorOf(req), req.params.id, req.body.classification, req.body, (await config()).list);
        audit({ action: "classification_change", actor: req.session!.userId, boardId: req.params.id, detail: { ...change, reason: req.body.reason } });
        return change;
      });

    // A small preview of the board for the dashboard (BRD-2). It skips images, so the call stays cheap.
    // The response holds the board's content, so it follows the same access rules as the board.
    api.get<{ Params: { id: string } }>("/api/boards/:id/thumbnail", async (req, reply) => {
      const role = await boards.roleOnBoard(db, actorOf(req), req.params.id);
      if (!role) throw new boards.NotFound();
      const { rows } = await db.query<{ classification: string }>("SELECT classification FROM boards WHERE id = $1", [req.params.id]);
      const doc = await loadDoc(db, req.params.id);
      const objs = [...doc.getMap(OBJECTS_MAP).values()] as never[];
      const svg = objs.length
        ? exportSvg(objs, { classification: rows[0]!.classification, classifications: (await config()).list })
        : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="#f5f5f5"/></svg>`;
      return reply
        .header("content-type", "image/svg+xml")
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
        .header("cache-control", "private, max-age=60")
        .send(svg);
    });

    // Retention (ADM-4). The worker archives boards that nobody has opened for the configured time.
    api.get("/api/admin/retention", async (req) => { adminOnly(req); return loadRetention(db); });
    api.put<{ Body: unknown }>("/api/admin/retention", async (req) => {
      adminOnly(req);
      let saved;
      try { saved = await saveRetention(db, req.session!.userId, req.body); } catch (e) { throw new boards.Invalid((e as Error).message); }
      audit({ action: "settings_change", actor: req.session!.userId, detail: { setting: "retention", ...saved } });
      return saved;
    });
    api.post<{ Params: { id: string } }>("/api/boards/:id/archive", async (req) => {
      await boards.setArchived(db, actorOf(req), req.params.id, true);
      audit({ action: "archive", actor: req.session!.userId, boardId: req.params.id });
      return { ok: true };
    });
    api.post<{ Params: { id: string } }>("/api/boards/:id/unarchive", async (req) => {
      await boards.setArchived(db, actorOf(req), req.params.id, false);
      audit({ action: "unarchive", actor: req.session!.userId, boardId: req.params.id });
      return { ok: true };
    });

    // Organisation-wide visibility (IAM-8).
    api.get<{ Params: { id: string } }>("/api/boards/:id/visibility", async (req) =>
      ({ role: await boards.getOrgVisibility(db, actorOf(req), req.params.id) }));

    api.put<{ Params: { id: string }; Body: { role: "viewer" | "commenter" | "editor" | null } }>(
      "/api/boards/:id/visibility", async (req) => {
        await boards.setOrgVisibility(db, actorOf(req), req.params.id, req.body.role ?? null, (await config()).list);
        audit({ action: "share_change", actor: req.session!.userId, boardId: req.params.id, detail: { type: "organisation", role: req.body.role ?? null } });
        return { ok: true };
      });

    // Ownership transfer and administrator reassignment (BRD-5).
    api.post<{ Params: { id: string }; Body: { userId: string } }>("/api/boards/:id/transfer", async (req) => {
      if (!req.body?.userId) throw new boards.Invalid("userId is required");
      const r = await boards.transferOwnership(db, { ...actorOf(req), isAdmin: req.session!.isAdmin }, req.params.id, { id: req.body.userId });
      audit({ action: "share_change", actor: req.session!.userId, boardId: req.params.id, detail: { type: "ownership", newOwner: req.body.userId, previousOwners: r.from, byAdmin: req.session!.isAdmin } });
      return { ok: true };
    });

    // Spaces (BRD-3).
    api.get("/api/spaces", async (req) => spaces.listSpaces(db, actorOf(req)));
    api.post<{ Body: { name: string } }>("/api/spaces", async (req, reply) => {
      const id = await spaces.createSpace(db, actorOf(req), req.body?.name ?? "");
      audit({ action: "share_change", actor: req.session!.userId, detail: { type: "space_create", spaceId: id } });
      return reply.code(201).send({ id });
    });
    api.patch<{ Params: { id: string }; Body: { name: string } }>("/api/spaces/:id", async (req) => {
      await spaces.renameSpace(db, actorOf(req), req.params.id, req.body?.name ?? ""); return { ok: true };
    });
    api.delete<{ Params: { id: string } }>("/api/spaces/:id", async (req) => {
      await spaces.deleteSpace(db, actorOf(req), req.params.id);
      audit({ action: "share_change", actor: req.session!.userId, detail: { type: "space_delete", spaceId: req.params.id } });
      return { ok: true };
    });
    api.get<{ Params: { id: string } }>("/api/spaces/:id/members", async (req) => spaces.listSpaceMembers(db, actorOf(req), req.params.id));
    api.put<{ Params: { id: string }; Body: { type: "user" | "group"; principalId: string; role: BoardRole; name?: string } }>(
      "/api/spaces/:id/members", async (req) => {
        const { type, principalId, role, name } = req.body;
        await spaces.shareSpace(db, actorOf(req), req.params.id, { type, id: principalId, role, name });
        audit({ action: "share_change", actor: req.session!.userId, detail: { type: "space_member", spaceId: req.params.id, principalType: type, principalId, role } });
        return { ok: true };
      });
    api.delete<{ Params: { id: string; type: "user" | "group"; principalId: string } }>(
      "/api/spaces/:id/members/:type/:principalId", async (req) => {
        await spaces.unshareSpace(db, actorOf(req), req.params.id, { type: req.params.type, id: req.params.principalId });
        audit({ action: "share_change", actor: req.session!.userId, detail: { type: "space_member", spaceId: req.params.id, principalType: req.params.type, principalId: req.params.principalId, role: null } });
        return { ok: true };
      });
    api.put<{ Params: { id: string }; Body: { spaceId: string | null } }>("/api/boards/:id/space", async (req) => {
      await spaces.moveBoard(db, actorOf(req), req.params.id, req.body?.spaceId ?? null);
      audit({ action: "share_change", actor: req.session!.userId, boardId: req.params.id, detail: { type: "space_move", spaceId: req.body?.spaceId ?? null } });
      return { ok: true };
    });

    // --- Templates (WSH-1, WSH-2) ---
    api.get("/api/templates", async (req) => ({ builtin: builtinTemplates, organisation: await workshop.listOrgTemplates(db, actorOf(req)) }));

    api.post<{ Body: { boardId: string; name: string; objectIds?: string[] } }>("/api/templates", async (req, reply) => {
      const ids = Array.isArray(req.body?.objectIds) ? req.body.objectIds.filter((i) => typeof i === "string" && i.length <= 64).slice(0, 5000) : undefined;
      const id = await workshop.saveOrgTemplate(db, actorOf(req), req.body?.boardId, req.body?.name ?? "", ids);
      audit({ action: "template_create", actor: req.session!.userId, boardId: req.body.boardId, detail: { templateId: id } });
      return reply.code(201).send({ id });
    });

    api.delete<{ Params: { id: string } }>("/api/templates/:id", async (req) => {
      if (!UUID.test(req.params.id)) throw new boards.NotFound();
      await workshop.deleteOrgTemplate(db, { ...actorOf(req), isAdmin: req.session!.isAdmin }, req.params.id);
      return { ok: true };
    });

    // --- Voting (WSH-4) ---
    api.get<{ Params: { id: string } }>("/api/boards/:id/votes", async (req) => workshop.voteState(db, actorOf(req), req.params.id));
    api.post<{ Params: { id: string }; Body: { limit: number; anonymous?: boolean } }>("/api/boards/:id/votes/session", async (req, reply) => {
      await workshop.startVoting(db, actorOf(req), req.params.id, Number(req.body?.limit), !!req.body?.anonymous);
      audit({ action: "vote_start", actor: req.session!.userId, boardId: req.params.id, detail: { limit: req.body.limit, anonymous: !!req.body.anonymous } });
      return reply.code(201).send(await workshop.voteState(db, actorOf(req), req.params.id));
    });
    api.post<{ Params: { id: string } }>("/api/boards/:id/votes/close", async (req) => {
      await workshop.closeVoting(db, actorOf(req), req.params.id);
      audit({ action: "vote_close", actor: req.session!.userId, boardId: req.params.id });
      return workshop.voteState(db, actorOf(req), req.params.id);
    });
    api.post<{ Params: { id: string }; Body: { objectId: string } }>("/api/boards/:id/votes", async (req) => {
      await workshop.castVote(db, actorOf(req), req.params.id, req.body?.objectId);
      return workshop.voteState(db, actorOf(req), req.params.id);
    });
    api.delete<{ Params: { id: string }; Body: { objectId: string } }>("/api/boards/:id/votes", async (req) => {
      await workshop.removeVote(db, actorOf(req), req.params.id, req.body?.objectId);
      return workshop.voteState(db, actorOf(req), req.params.id);
    });

    // --- Version history (BRD-6) ---
    const editorOn = async (req: FastifyRequest, id: string, min: BoardRole = "editor") => {
      const role = await boards.roleOnBoard(db, actorOf(req), id);
      if (!role) throw new boards.NotFound();
      if (!atLeast(role, min)) throw new boards.Forbidden();
    };

    api.get<{ Params: { id: string } }>("/api/boards/:id/versions", async (req) => {
      await editorOn(req, req.params.id);
      return listVersions(db, req.params.id);
    });

    api.post<{ Params: { id: string }; Body: { name?: string } }>("/api/boards/:id/versions", async (req, reply) => {
      await editorOn(req, req.params.id);
      const name = (req.body?.name ?? "").trim();
      if (!name || name.length > 100) throw new boards.Invalid("A version needs a name of 1 to 100 characters.");
      const id = await snapshot(db, req.params.id, { kind: "named", name, userId: req.session!.userId });
      audit({ action: "version_create", actor: req.session!.userId, boardId: req.params.id, detail: { versionId: id } });
      return reply.code(201).send({ id });
    });

    // The editor's own client applies the state as a normal, undoable edit, so the collaboration service still
    // enforces roles and connected users see the change. This call gives the saved state and records the audit event.
    api.post<{ Params: { id: string; versionId: string } }>("/api/boards/:id/versions/:versionId/restore", async (req) => {
      await editorOn(req, req.params.id);
      if (!UUID.test(req.params.versionId)) throw new boards.NotFound();
      const state = await versionState(db, req.params.id, req.params.versionId);
      if (!state) throw new boards.NotFound();
      audit({ action: "version_restore", actor: req.session!.userId, boardId: req.params.id, detail: { versionId: req.params.versionId } });
      return { state: Buffer.from(state).toString("base64") };
    });

    api.delete<{ Params: { id: string; versionId: string } }>("/api/boards/:id/versions/:versionId", async (req) => {
      await editorOn(req, req.params.id, "owner");
      if (!UUID.test(req.params.versionId) || !(await deleteVersion(db, req.params.id, req.params.versionId))) throw new boards.NotFound();
      return { ok: true };
    });

    // --- Search (BRD-4). Results cover only boards the user can open. ---
    api.get<{ Querystring: { q?: string } }>("/api/search", async (req) =>
      searchBoards(db, actorOf(req), (req.query.q ?? "").slice(0, 200)));

    // --- Comments and notifications (COL-7, COL-8) ---
    api.get<{ Params: { id: string } }>("/api/boards/:id/comments", async (req) => comments.listThreads(db, actorOf(req), req.params.id));
    api.get<{ Params: { id: string } }>("/api/boards/:id/mentionable", async (req) => comments.mentionCandidates(db, actorOf(req), req.params.id));

    api.post<{ Params: { id: string }; Body: { body: string; threadId?: string; anchor?: unknown } }>("/api/boards/:id/comments", async (req, reply) =>
      reply.code(201).send(await comments.addComment(db, actorOf(req), req.params.id, req.body ?? {} as never)));

    api.put<{ Params: { id: string; threadId: string }; Body: { resolved: boolean } }>("/api/boards/:id/threads/:threadId/resolved", async (req) => {
      if (!UUID.test(req.params.threadId)) throw new boards.NotFound();
      await comments.setResolved(db, actorOf(req), req.params.id, req.params.threadId, !!req.body?.resolved);
      return { ok: true };
    });

    api.patch<{ Params: { id: string; commentId: string }; Body: { body: string } }>("/api/boards/:id/comments/:commentId", async (req) => {
      if (!UUID.test(req.params.commentId)) throw new boards.NotFound();
      await comments.editComment(db, actorOf(req), req.params.id, req.params.commentId, req.body?.body ?? "");
      return { ok: true };
    });

    api.delete<{ Params: { id: string; commentId: string } }>("/api/boards/:id/comments/:commentId", async (req) => {
      if (!UUID.test(req.params.commentId)) throw new boards.NotFound();
      await comments.deleteComment(db, actorOf(req), req.params.id, req.params.commentId);
      return { ok: true };
    });

    api.get("/api/notifications", async (req) => comments.listNotifications(db, actorOf(req)));
    api.post<{ Body: { ids?: string[] } }>("/api/notifications/read", async (req) => {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((i) => UUID.test(i)) : undefined;
      await comments.markRead(db, actorOf(req), ids);
      return { ok: true };
    });

    // Files are built in the browser, so board content never passes through this endpoint.
    // The call checks the export policy and writes the audit event (ADM-1, EXP-5).
    api.post<{ Params: { id: string }; Body: { format: string; scope?: string } }>("/api/boards/:id/exports", async (req, reply) => {
      const role = await boards.roleOnBoard(db, actorOf(req), req.params.id);
      if (!role) throw new boards.NotFound();
      if (!(exportFormats as readonly string[]).includes(req.body.format)) throw new boards.Invalid("unknown format");
      const { rows } = await db.query<{ classification: string }>("SELECT classification FROM boards WHERE id = $1", [req.params.id]);
      const classification = rows[0]!.classification;
      const rule = opts.exportPolicy?.[classification] ?? "everyone";
      if (rule === "none" || (rule === "owners" && !atLeast(role, "owner"))) {
        audit({ action: "export", actor: req.session!.userId, boardId: req.params.id, detail: { allowed: false, format: req.body.format } });
        throw new boards.Forbidden("Export isn't allowed for this classification.");
      }
      audit({ action: "export", actor: req.session!.userId, boardId: req.params.id, detail: { allowed: true, format: req.body.format, scope: req.body.scope ?? "board", classification } });
      return reply.code(204).send();
    });

    // Creates a new board from a board file (EXP-3). The importer becomes the owner.
    api.post<{ Body: { file: string; classification?: string } }>("/api/boards/import", { bodyLimit: 64 * 1024 * 1024 }, async (req, reply) => {
      let file;
      try { file = importJson(req.body.file, (await config()).list); } catch (e) { throw new boards.Invalid((e as Error).message); }
      const classification = req.body.classification ?? file.classification;
      if (!(await isClassification(classification))) throw new boards.Invalid("unknown classification");
      const id = await boards.createBoard(db, actorOf(req), file.title, classification);
      const doc = new Y.Doc();
      doc.transact(() => { for (const o of file.objects) doc.getMap(OBJECTS_MAP).set(o.id, o); });
      await appendUpdate(db, id, Y.encodeStateAsUpdate(doc));
      audit({ action: "import", actor: req.session!.userId, boardId: id, detail: { objects: file.objects.length, classification } });
      return reply.code(201).send({ id });
    });

    // Bulk import of boards converted by the Miro migration tool (MIG-5). One board for each call, so a large
    // migration shows progress and one failure doesn't stop the rest.
    api.post<{ Body: { board: string; classification: string; ownerEmail?: string; sourceId?: string; files?: { name: string; data: string }[] } }>(
      "/api/admin/migration/import", { bodyLimit: 128 * 1024 * 1024 }, async (req, reply) => {
        adminOnly(req);
        if (typeof req.body?.board !== "string" || typeof req.body?.classification !== "string") throw new boards.Invalid("board and classification are required");
        if (!(await isClassification(req.body.classification))) throw new boards.Invalid("unknown classification");
        const token = await graphToken(req.session!).catch(() => undefined);
        // Everyone here signed in to the one tenant, so the administrator's tenant is the tenant of the people they match.
        const tenantId = (await db.query<{ tenant_id: string }>("SELECT tenant_id FROM users WHERE id = $1", [req.session!.userId])).rows[0]!.tenant_id;
        try {
          const r = await importMigratedBoard({
            db, tenantId, classifications: (await config()).list, store: opts.store, scanner: opts.scanner,
            findByEmail: async (email) => (token ? opts.graph.findUserByEmail(token, email) : undefined),
          }, req.session!.userId, req.body);
          audit({ action: "import", actor: req.session!.userId, boardId: r.id, detail: { source: "miro", sourceId: req.body.sourceId, classification: req.body.classification, owner: r.ownerId, ownerResolved: r.ownerResolved, objects: r.objects, images: r.images, imageProblems: r.imageProblems.length } });
          return reply.code(201).send(r);
        } catch (e) {
          if (e instanceof Conflict) return reply.code(409).send({ error: "already_imported", message: e.message });
          throw e;
        }
      });

    api.put<{ Params: { id: string }; Body: { starred: boolean } }>("/api/boards/:id/star", async (req) => {
      await boards.setStar(db, actorOf(req), req.params.id, !!req.body.starred);
      return { ok: true };
    });
  });
}
