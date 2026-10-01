import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openTokens, parseKey, sealTokens } from "./tokens.js";

const key = randomBytes(32);
const tokens = { accessToken: "at", refreshToken: "rt", expiresAt: 100 };

describe("tokens", () => {
  it("round-trips", () => {
    expect(openTokens(sealTokens(tokens, key), key)).toEqual(tokens);
  });
  it("doesn't expose the token in the sealed value", () => {
    expect(Buffer.from(sealTokens(tokens, key), "base64").toString("utf8")).not.toContain("at");
  });
  it("uses a fresh nonce each time", () => {
    expect(sealTokens(tokens, key)).not.toBe(sealTokens(tokens, key));
  });
  it("rejects another key and tampered data", () => {
    const sealed = sealTokens(tokens, key);
    expect(openTokens(sealed, randomBytes(32))).toBeUndefined();
    const raw = Buffer.from(sealed, "base64"); raw[raw.length - 1]! ^= 1;
    expect(openTokens(raw.toString("base64"), key)).toBeUndefined();
  });
  it("requires a 32-byte key", () => {
    expect(() => parseKey(Buffer.alloc(16).toString("base64"))).toThrow("32 bytes");
    expect(parseKey(key.toString("base64"))).toHaveLength(32);
  });
});
