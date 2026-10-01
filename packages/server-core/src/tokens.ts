import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface GraphTokens {
  accessToken: string;
  refreshToken?: string;
  /** Seconds since the epoch. */
  expiresAt: number;
}

/** Parses a base64 key and checks that it is 32 bytes, as AES-256 needs. */
export function parseKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("The token encryption key must be 32 bytes, encoded as base64.");
  return key;
}

/**
 * Encrypts Graph tokens before they go into the session store, so a Redis read doesn't expose them.
 * The output is base64 of: 12-byte nonce, 16-byte tag, then the ciphertext.
 */
export function sealTokens(tokens: GraphTokens, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

/** Returns undefined for a value that fails authentication, for example one sealed with another key. */
export function openTokens(sealed: string, key: Buffer): GraphTokens | undefined {
  try {
    const raw = Buffer.from(sealed, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as GraphTokens;
  } catch {
    return undefined;
  }
}
