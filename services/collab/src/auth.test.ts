import { describe, expect, it } from "vitest";
import { authenticate, type AccessResolver } from "./auth.js";

const resolver = (role?: "viewer" | "editor"): AccessResolver => ({
  userFromCookie: async (c) => (c ? { id: "u", name: "U" } : undefined),
  roleOnBoard: async () => role,
});

describe("authenticate", () => {
  it("rejects a connection without a session", async () => {
    await expect(authenticate(resolver("editor"), "b", undefined)).rejects.toThrow("unauthenticated");
  });
  it("rejects a user with no board role", async () => {
    await expect(authenticate(resolver(), "b", "s")).rejects.toThrow("forbidden");
  });
  it("makes viewers read-only", async () => {
    expect((await authenticate(resolver("viewer"), "b", "s")).readOnly).toBe(true);
  });
  it("lets editors write", async () => {
    expect((await authenticate(resolver("editor"), "b", "s")).readOnly).toBe(false);
  });
});
