export interface EntraClaims {
  oid: string;
  tid: string;
  name?: string;
  email?: string;
  preferred_username?: string;
  roles?: string[];
  amr?: string[];
  exp?: number;
}

export type ServiceRole = "Whiteboard.User" | "Whiteboard.Admin";

export type ClaimsResult =
  | { ok: true; role: ServiceRole; isAdmin: boolean }
  | { ok: false; reason: "tenant" | "role" | "mfa" | "expired" };

/**
 * Checks tenant (IAM-3), app role (IAM-4), and MFA (IAM-7). Clearance follows
 * from the app role (IAM-11), so no separate clearance check exists.
 */
export function validateClaims(
  claims: EntraClaims,
  opts: { tenantId: string; now?: number },
): ClaimsResult {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (claims.exp !== undefined && claims.exp <= now)
    return { ok: false, reason: "expired" };
  if (claims.tid !== opts.tenantId) return { ok: false, reason: "tenant" };
  const roles = claims.roles ?? [];
  const isAdmin = roles.includes("Whiteboard.Admin");
  if (!isAdmin && !roles.includes("Whiteboard.User"))
    return { ok: false, reason: "role" };
  if (!(claims.amr ?? []).includes("mfa")) return { ok: false, reason: "mfa" };
  return {
    ok: true,
    role: isAdmin ? "Whiteboard.Admin" : "Whiteboard.User",
    isAdmin,
  };
}
