import { describe, expect, it } from "vitest";
import {
  boardObjectSchema,
  canEditContent,
  isDowngrade,
  strongestRole,
  validateClaims,
  validateClassificationChange,
} from "./index.js";

const claims = { oid: "u1", tid: "t1", roles: ["Whiteboard.User"], amr: ["pwd", "mfa"] };

describe("claims", () => {
  it("accepts a valid user", () => {
    expect(validateClaims(claims, { tenantId: "t1" }).ok).toBe(true);
  });
  it("rejects another tenant", () => {
    expect(validateClaims(claims, { tenantId: "t2" })).toEqual({ ok: false, reason: "tenant" });
  });
  it("rejects a user without a role", () => {
    expect(validateClaims({ ...claims, roles: [] }, { tenantId: "t1" })).toEqual({ ok: false, reason: "role" });
  });
  it("rejects a session without MFA", () => {
    expect(validateClaims({ ...claims, amr: ["pwd"] }, { tenantId: "t1" })).toEqual({ ok: false, reason: "mfa" });
  });
  it("rejects an expired token", () => {
    expect(validateClaims({ ...claims, exp: 10 }, { tenantId: "t1", now: 20 })).toEqual({ ok: false, reason: "expired" });
  });
});

describe("access", () => {
  it("lets only editors and owners change content", () => {
    expect(canEditContent("viewer")).toBe(false);
    expect(canEditContent("commenter")).toBe(false);
    expect(canEditContent("editor")).toBe(true);
  });
  it("picks the strongest role", () => {
    expect(strongestRole(["viewer", "editor"])).toBe("editor");
    expect(strongestRole([])).toBeUndefined();
  });
});

describe("classification", () => {
  it("treats equivalent markings as equal", () => {
    expect(isDowngrade("OFFICIAL_SENSITIVE", "SENSITIVE")).toBe(false);
  });
  it("flags a paste into a lower classification", () => {
    expect(isDowngrade("PROTECTED", "OFFICIAL")).toBe(true);
  });
  it("requires a reason to lower a classification", () => {
    expect(validateClassificationChange("PROTECTED", "OFFICIAL", { confirmed: true }).ok).toBe(false);
    expect(validateClassificationChange("PROTECTED", "OFFICIAL", { confirmed: true, reason: "Declassified" }).ok).toBe(true);
    expect(validateClassificationChange("OFFICIAL", "PROTECTED", {}).ok).toBe(true);
  });
});

describe("objects", () => {
  it("parses a sticky with defaults", () => {
    const o = boardObjectSchema.parse({ id: "a", type: "sticky", x: 0, y: 0, width: 100, height: 100, index: "a0" });
    expect(o.type === "sticky" && o.color).toBe("#fff475");
  });
});
