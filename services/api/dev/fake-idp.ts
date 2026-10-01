/**
 * A local stand-in for Entra ID and Microsoft Graph, for development and end-to-end tests only.
 * It signs real RS256 ID tokens, enforces PKCE, and serves minimal Graph search. It is not part of any image.
 *
 * Run it with `pnpm --filter @miroclone/api idp`, then start the API with
 * ENTRA_AUTHORITY=http://127.0.0.1:4010 and GRAPH_BASE_URL=http://127.0.0.1:4010/v1.0.
 * Switch the signed-in user with GET /switch?user=ann.
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const PORT = Number(process.env.IDP_PORT ?? 4010);
const TENANT = process.env.ENTRA_TENANT_ID ?? "00000000-0000-0000-0000-000000000000";
const BASE = `http://127.0.0.1:${PORT}`;

interface User { oid: string; name: string; email: string; roles: string[]; amr: string[]; groups: string[]; overage?: boolean }
const users: Record<string, User> = {
  ann: { oid: "oid-ann", name: "Ann Author", email: "ann@example.test", roles: ["Whiteboard.User"], amr: ["pwd", "mfa"], groups: ["g-eng"] },
  bob: { oid: "oid-bob", name: "Bob Builder", email: "bob@example.test", roles: ["Whiteboard.User"], amr: ["pwd", "mfa"], groups: ["g-eng"] },
  cy: { oid: "oid-cy", name: "Cy Nomfa", email: "cy@example.test", roles: ["Whiteboard.User"], amr: ["pwd"], groups: [] },
  dee: { oid: "oid-dee", name: "Dee Norole", email: "dee@example.test", roles: [], amr: ["pwd", "mfa"], groups: [] },
  ada: { oid: "oid-ada", name: "Ada Admin", email: "ada@example.test", roles: ["Whiteboard.Admin"], amr: ["pwd", "mfa"], groups: ["g-eng"] },
  eve: { oid: "oid-eve", name: "Eve Overage", email: "eve@example.test", roles: ["Whiteboard.User"], amr: ["pwd", "mfa"], groups: [], overage: true },
};
const groups = [{ id: "g-eng", displayName: "Engineering" }, { id: "g-ops", displayName: "Operations" }];
let current = "ann";

const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "dev", alg: "RS256", use: "sig" };
const codes = new Map<string, { user: User; nonce: string; challenge: string; redirect: string }>();
const json = (res: import("node:http").ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url!, BASE);
  const path = url.pathname;
  if (path === "/switch") { current = url.searchParams.get("user") ?? "ann"; return json(res, { current }); }
  if (path.endsWith("/discovery/v2.0/keys")) return json(res, { keys: [jwk] });

  if (path.endsWith("/oauth2/v2.0/authorize")) {
    const q = url.searchParams;
    const code = randomUUID();
    codes.set(code, { user: users[current]!, nonce: q.get("nonce")!, challenge: q.get("code_challenge")!, redirect: q.get("redirect_uri")! });
    res.writeHead(302, { location: `${q.get("redirect_uri")}?code=${code}&state=${q.get("state")}` });
    return void res.end();
  }

  if (path.endsWith("/oauth2/v2.0/token") && req.method === "POST") {
    let raw = ""; for await (const c of req) raw += c;
    const f = new URLSearchParams(raw);
    const grant = f.get("grant_type");
    if (grant === "refresh_token") return json(res, { access_token: `at-${randomUUID()}`, refresh_token: f.get("refresh_token"), expires_in: 3600 });
    const entry = codes.get(f.get("code") ?? "");
    codes.delete(f.get("code") ?? "");
    if (!entry) return json(res, { error: "invalid_grant" }, 400);
    // PKCE: the verifier must hash to the challenge sent at authorisation.
    if (createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url") !== entry.challenge) return json(res, { error: "invalid_grant", reason: "pkce" }, 400);
    const u = entry.user;
    const claims: Record<string, unknown> = { oid: u.oid, tid: TENANT, name: u.name, email: u.email, roles: u.roles, amr: u.amr, nonce: entry.nonce };
    if (u.overage) claims._claim_names = { groups: "src1" }; else claims.groups = u.groups;
    const idToken = await new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "dev" })
      .setIssuer(`${BASE}/${TENANT}/v2.0`).setAudience(f.get("client_id")!).setIssuedAt().setExpirationTime("1h").sign(privateKey);
    return json(res, { id_token: idToken, access_token: `at-${randomUUID()}`, refresh_token: `rt-${randomUUID()}`, expires_in: 3600 });
  }

  // Graph. The token is opaque here, but a missing one is rejected like the real service does.
  if (path.startsWith("/v1.0/")) {
    if (!req.headers.authorization?.startsWith("Bearer at-")) return json(res, { error: "unauthorised" }, 401);
    const term = (url.searchParams.get("$search") ?? "").match(/:([^"]+)"/)?.[1]?.toLowerCase() ?? "";
    if (path === "/v1.0/users") return json(res, { value: Object.values(users).filter((u) => u.name.toLowerCase().includes(term) || u.email.includes(term)).map((u) => ({ id: u.oid, displayName: u.name, mail: u.email })) });
    if (path === "/v1.0/groups") return json(res, { value: groups.filter((g) => g.displayName.toLowerCase().includes(term)) });
    if (path.startsWith("/v1.0/me/transitiveMemberOf")) return json(res, { value: [{ id: "g-eng" }, { id: "g-ops" }] });
  }
  json(res, { error: "not_found", path }, 404);
}).listen(PORT, "127.0.0.1", () => console.log(JSON.stringify({ msg: "fake idp listening", base: BASE })));
