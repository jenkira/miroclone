import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { EntraClaims } from "@miroclone/shared";

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
  exchange(p: { code: string; codeVerifier: string; nonce: string }): Promise<EntraClaims>;
}

export const pkceVerifier = () => randomBytes(32).toString("base64url");
export const pkceChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

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
      scope: "openid profile email",
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
    const { id_token } = (await res.json()) as { id_token?: string };
    if (!id_token) throw new Error("no id_token in response");
    const { payload } = await jwtVerify(id_token, this.jwks, {
      issuer: `${this.authority}/${this.cfg.tenantId}/v2.0`,
      audience: this.cfg.clientId,
    });
    if (payload.nonce !== nonce) throw new Error("nonce mismatch");
    // The browser never holds Entra tokens, and the API discards the access token.
    return payload as unknown as EntraClaims;
  }
}
