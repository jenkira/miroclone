import type { FastifyInstance, FastifyRequest } from "fastify";
import { boardRoles, defaultClassifications, type BoardRole } from "@miroclone/shared";
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

export function boardRoutes(app: FastifyInstance, opts: { db: Db; sessions: SessionManager }) {
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

    api.put<{ Params: { id: string }; Body: { type: "user" | "group"; principalId: string; role: BoardRole } }>(
      "/api/boards/:id/members", async (req) => {
        const { type, principalId, role } = req.body;
        if (!["user", "group"].includes(type) || !principalId || !boardRoles.includes(role)) throw new boards.Invalid("bad member");
        await boards.share(db, actorOf(req), req.params.id, { type, id: principalId, role });
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

    api.put<{ Params: { id: string }; Body: { starred: boolean } }>("/api/boards/:id/star", async (req) => {
      await boards.setStar(db, actorOf(req), req.params.id, !!req.body.starred);
      return { ok: true };
    });
  });
}
