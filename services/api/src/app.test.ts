import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("api", () => {
  const app = buildApp({ tenantId: "t1" });
  it("serves health", async () => {
    expect((await app.inject("/healthz")).statusCode).toBe(200);
  });
  it("blocks a user without MFA", async () => {
    const res = await app.inject({ method: "POST", url: "/internal/claims/check", payload: { oid: "u", tid: "t1", roles: ["Whiteboard.User"], amr: ["pwd"] } });
    expect(res.statusCode).toBe(403);
  });
  it("allows a cleared user", async () => {
    const res = await app.inject({ method: "POST", url: "/internal/claims/check", payload: { oid: "u", tid: "t1", roles: ["Whiteboard.User"], amr: ["mfa"] } });
    expect(res.statusCode).toBe(200);
  });
});
