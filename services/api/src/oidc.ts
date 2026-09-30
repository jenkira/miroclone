import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { EntraClaims } from "@miroclone/shared";
import type { GraphTokens } from "@miroclone/server-core";

export interface OidcConfig {
  tenantId: string;
  clientId: string;
  redirectUri: string;
  /** Read from a Kubernetes Secret, never from source control. */
  clientSecret: string;
  authority?: string;
}

/** Abstraction over Entra ID so routes can be tested without the network. */
export interface OidcClient {
  authorizationUrl(p: { state: string; nonce: string; codeChallenge: string }): string;
  exchange(p: { code: string; codeVerifier: string; nonce: string }): Promise<{ claims: EntraClaims; tokens: GraphTokens }>;
  refresh(refreshToken: string): Promise<GraphTokens>;
}

export const SCOPES = "openid profile email offline_access User.ReadBasic.All GroupMember.Read.All";

export const pkceVerifier = () => randomBytes(32).toString("base64url");
export const pkceChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

interface TokenResponse { id_token?: string; access_token: string; refresh_token?: string; expires_in: number }

const toTokens = (r: TokenResponse): GraphTokens => ({
  accessToken: r.access_token,
  refreshToken: r.refresh_token,
  expiresAt: Math.floor(Date.now() / 1000) + r.expires_in,
});

export class EntraOidcClient implements OidcClient {
  private authority: string;
  private jwks;
  constructor(private cfg: OidcConfig) {
    this.authority = cfg.authority ?? "https://login.microsoftonline.com";
    this.jwks = createRemoteJWKSet(new URL(`${this.authority}/${cfg.tenantId}/discovery/v2.0/keys`));
  }

  authorizationUrl({ state, nonce, codeChallenge }: { state: string; nonce: string; codeChallenge: string }) {
    const u = new URL(`${this.authority}/${this.cfg.tenantId}/oauth2/v2.0/authorize`);
    u.search = new URLSearchParams({
      client_id: this.cfg.clientId,
      response_type: "code",
      redirect_uri: this.cfg.redirectUri,
      response_mode: "query",
      scope: SCOPES,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    return u.toString();
  }

  async exchange({ code, codeVerifier, nonce }: { code: string; codeVerifier: string; nonce: string }) {
    const res = await fetch(`${this.authority}/${this.cfg.tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: this.cfg.redirectUri,
        code_verifier: codeVerifier,
      }),
    });
    if (!res.ok) throw new Error(`token endpoint returned ${res.status}`);
    const body = (await res.json()) as TokenResponse;
    const { id_token } = body;
    if (!id_token) throw new Error("no id_token in response");
    const { payload } = await jwtVerify(id_token, this.jwks, {
      issuer: `${this.authority}/${this.cfg.tenantId}/v2.0`,
      audience: this.cfg.clientId,
    });
    if (payload.nonce !== nonce) throw new Error("nonce mismatch");
    // The browser never holds Entra tokens. The API keeps the Graph tokens in the encrypted session.
    return { claims: payload as unknown as EntraClaims, tokens: toTokens(body) };
  }

  async refresh(refreshToken: string): Promise<GraphTokens> {
    const res = await fetch(`${this.authority}/${this.cfg.tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: SCOPES,
      }),
    });
    if (!res.ok) throw new Error(`token endpoint returned ${res.status}`);
    return toTokens((await res.json()) as TokenResponse);
  }
}
