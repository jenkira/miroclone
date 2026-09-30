import { createRegistry, initTracing, serveMetrics } from "@miroclone/server-core";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";
import type { EntraClaims } from "@miroclone/shared";
import { SESSION_COOKIE } from "./app.js";
import { setup, signIn } from "./testutil.js";

const good: EntraClaims = { oid: "obs-u", tid: "t1", name: "Una", roles: ["Whiteboard.User"], amr: ["mfa"], groups: [] };

const series = async (registry: ReturnType<typeof createRegistry>) => registry.metrics();
/** The value of the first series whose name starts with `name` and that has every label, in any order. */
function value(text: string, name: string, labels: Record<string, string>): number | undefined {
  for (const l of text.split("\n")) {
    if (!l.startsWith(name + "{")) continue;
    if (Object.entries(labels).every(([k, v]) => l.includes(`${k}="${v}"`))) return Number(l.slice(l.lastIndexOf(" ") + 1));
  }
  return undefined;
}

describe("metrics", () => {
  it("records request duration by method, route pattern, and status, never by URL", async () => {
    const registry = createRegistry("api-test");
    const { app } = setup(good, { t: 1000 }, { registry });
    const s = (await signIn(app)).cookies[0]!.value;
    const id = (await app.inject({ method: "POST", url: "/api/boards", cookies: { [SESSION_COOKIE]: s }, payload: { title: "T", classification: "OFFICIAL" } })).json().id;
    await app.inject({ url: `/api/boards/${id}`, cookies: { [SESSION_COOKIE]: s } });
    await app.inject({ url: `/api/boards/${id}/comments`, cookies: { [SESSION_COOKIE]: s } });
    await app.inject({ url: "/no/such/path" });
    const text = await series(registry);
    expect(value(text, "http_request_duration_seconds_count", { method: "GET", route: "/api/boards/:id", status: "200", service: "api-test" })).toBe(1);
    expect(text).toContain('route="/api/boards/:id/comments"');
    expect(text).toContain('route="unmatched"');
    expect(text).not.toContain(id);                       // IDs never become labels
    expect(text).toContain("process_cpu_user_seconds_total");
  });

  it("leaves health checks out, and counts requests in flight back to zero", async () => {
    const registry = createRegistry("api-test");
    const { app } = setup(good, { t: 1000 }, { registry });
    await app.inject("/healthz"); await app.inject("/readyz");
    expect(await series(registry)).not.toContain('route="/healthz"');
    await app.inject("/api/time");
    const text = await series(registry);
    expect(text).toMatch(/http_requests_in_flight\{[^}]*\} 0/);
  });

  it("counts sign-ins by outcome", async () => {
    const registry = createRegistry("api-test");
    for (const claims of [good, { ...good, amr: ["pwd"] }, { ...good, roles: [] }, { ...good, tid: "other" }, good]) {
      const { app } = setup(claims as EntraClaims, { t: 1000 }, { registry });
      await signIn(app);
    }
    const text = await series(registry);
    expect(value(text, "miroclone_sign_in_total", { result: "allowed" })).toBe(2);
    for (const r of ["mfa", "role", "tenant"]) expect(value(text, "miroclone_sign_in_total", { result: r })).toBe(1);
  });

  it("serves /metrics on its own port and nothing else", async () => {
    const registry = createRegistry("api-test");
    const server = serveMetrics(registry, 0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;
    const ok = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/plain");
    expect(await ok.text()).toContain("process_cpu_user_seconds_total");
    expect((await fetch(`http://127.0.0.1:${port}/api/boards`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/metrics`, { method: "POST" })).status).toBe(404);
    server.close();
  });
});

describe("tracing", () => {
  it("makes one span per request, named by route, with status and no user data", async () => {
    const exporter = new InMemorySpanExporter();
    const tracing = initTracing("api-test", { exporter });
    const { app } = setup(good, { t: 1000 }, { tracing });
    const s = (await signIn(app)).cookies[0]!.value;
    await app.inject({ url: "/api/boards", cookies: { [SESSION_COOKIE]: s } });
    await app.inject("/healthz");
    const spans = exporter.getFinishedSpans();
    const list = spans.find((x) => x.name === "GET /api/boards")!;
    expect(list).toBeDefined();
    expect(list.attributes).toMatchObject({ "http.request.method": "GET", "http.route": "/api/boards", "http.response.status_code": 200 });
    expect(JSON.stringify(list.attributes)).not.toContain("obs-u");
    expect(spans.some((x) => String(x.attributes["http.route"]) === "/healthz")).toBe(false);
    await tracing.shutdown();
  });

  it("joins the caller's trace from a traceparent header", async () => {
    const exporter = new InMemorySpanExporter();
    const tracing = initTracing("api-test", { exporter });
    const { app } = setup(good, { t: 1000 }, { tracing });
    const traceId = "0af7651916cd43dd8448eb211c80319c", parentId = "b7ad6b7169203331";
    await app.inject({ url: "/api/time", headers: { traceparent: `00-${traceId}-${parentId}-01` } });
    const span = exporter.getFinishedSpans().find((x) => x.name === "GET /api/time")!;
    expect(span.spanContext().traceId).toBe(traceId);
    expect(span.parentSpanContext?.spanId).toBe(parentId);
    await tracing.shutdown();
  });

  it("does nothing, and sends nothing, when no collector is configured", () => {
    const t = initTracing("x", {});
    expect(t.enabled).toBe(false);
  });
});
