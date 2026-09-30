import type { FastifyInstance, FastifyRequest } from "fastify";
import * as Y from "yjs";
import { atLeast, boardRoles, defaultClassifications, importJson, OBJECTS_MAP, type BoardRole } from "@miroclone/shared";
import { appendUpdate, openTokens, sealTokens } from "@miroclone/server-core";
import type { GraphClient } from "./graph.js";
import type { OidcClient } from "./oidc.js";
import { audit } from "./audit.js";
import * as boards from "./boards.js";
import type { Db } from "@miroclone/server-core";
import { SESSION_COOKIE, type Session, type SessionManager } from "@miroclone/server-core";

declare module "fastify" {
  interface FastifyRequest { session?: Session }
}

function status(err: unknown): number {
  if (err instanceof boards.NotFound) return 404;
  if (err instanceof boards.Forbidden) return 403;
  if (err instanceof boards.Invalid) return 400;
  return 500;
}

/** Who can export boards of a classification (EXP-5). Missing classifications allow everyone who can view. */
export type ExportPolicy = Record<string, "everyone" | "owners" | "none">;

export const exportFormats = ["png", "svg", "pdf", "json"] as const;

export function boardRoutes(app: FastifyInstance, opts: { db: Db; sessions: SessionManager; exportPolicy?: ExportPolicy; graph: GraphClient; oidc: OidcClient; tokenKey: Buffer }) {
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
      reply.code(code).send({ error: code === 500 ? "internal" : err.message || err.constructor.name });
    });

    const isClassification = (k: unknown): k is string =>
      typeof k === "string" && defaultClassifications.some((c) => c.key === k);

    api.get<{ Querystring: { filter?: boards.BoardFilter } }>("/api/boards", async (req) =>
      boards.listBoards(db, actorOf(req), req.query.filter));

    api.post<{ Body: { title: string; classification: string } }>("/api/boards", async (req, reply) => {
      if (!isClassification(req.body.classification)) throw new boards.Invalid("unknown classification");
      const id = await boards.createBoard(db, actorOf(req), req.body.title, req.body.classification);
      audit({ action: "board_create", actor: req.session!.userId, boardId: id, detail: { classification: req.body.classification } });
      return reply.code(201).send({ id });
    });

    api.get<{ Params: { id: string } }>("/api/boards/:id", async (req) => {
      const role = await boards.roleOnBoard(db, actorOf(req), req.params.id);
      if (!role) throw new boards.NotFound();
      const { rows } = await db.query("SELECT id, title, classification, updated_at FROM boards WHERE id = $1", [req.params.id]);
      audit({ action: "board_access", actor: req.session!.userId, boardId: req.params.id });
      return { ...rows[0], role };
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
        if (!isClassification(req.body.classification)) throw new boards.Invalid("unknown classification");
        const change = await boards.setClassification(db, actorOf(req), req.params.id, req.body.classification, req.body);
        audit({ action: "classification_change", actor: req.session!.userId, boardId: req.params.id, detail: { ...change, reason: req.body.reason } });
        return change;
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
      try { file = importJson(req.body.file); } catch (e) { throw new boards.Invalid((e as Error).message); }
      const classification = req.body.classification ?? file.classification;
      if (!isClassification(classification)) throw new boards.Invalid("unknown classification");
      const id = await boards.createBoard(db, actorOf(req), file.title, classification);
      const doc = new Y.Doc();
      doc.transact(() => { for (const o of file.objects) doc.getMap(OBJECTS_MAP).set(o.id, o); });
      await appendUpdate(db, id, Y.encodeStateAsUpdate(doc));
      audit({ action: "import", actor: req.session!.userId, boardId: id, detail: { objects: file.objects.length, classification } });
      return reply.code(201).send({ id });
    });

    api.put<{ Params: { id: string }; Body: { starred: boolean } }>("/api/boards/:id/star", async (req) => {
      await boards.setStar(db, actorOf(req), req.params.id, !!req.body.starred);
      return { ok: true };
    });
  });
}
