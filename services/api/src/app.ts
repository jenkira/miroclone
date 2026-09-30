import Fastify from "fastify";
import { validateClaims, type EntraClaims } from "@miroclone/shared";
import { audit } from "./audit.js";

export function buildApp(opts: { tenantId: string }) {
  const app = Fastify({ logger: true });

  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/readyz", async () => ({ status: "ready" }));

  // Stands in for the OIDC callback's claim checks (IAM-3, IAM-4, IAM-7).
  // The full authorisation code flow with PKCE replaces the body parameter.
  app.post<{ Body: EntraClaims }>("/internal/claims/check", async (req, reply) => {
    const result = validateClaims(req.body, { tenantId: opts.tenantId });
    if (!result.ok) {
      audit({ action: "sign_in", actor: req.body.oid ?? "unknown", detail: { allowed: false, reason: result.reason } });
      return reply.code(403).send(result);
    }
    audit({ action: "sign_in", actor: req.body.oid, detail: { allowed: true } });
    return result;
  });

  return app;
}
