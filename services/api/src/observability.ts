import type { FastifyInstance } from "fastify";
import { context, Counter, createRegistry, Gauge, Histogram, LATENCY_BUCKETS, propagation, SpanKind, SpanStatusCode, trace, type Registry, type Span, type Tracing } from "@miroclone/server-core";

declare module "fastify" {
  interface FastifyRequest { otel?: { span: Span; start: bigint } }
}

export interface ApiMetrics {
  registry: Registry;
  /** Sign-in outcomes, by result: allowed, tenant, role, mfa, token, or groups. Spikes show attacks or a bad rollout. */
  signIns: Counter<"result">;
}

const QUIET = new Set(["/healthz", "/readyz", "/metrics"]);

/**
 * Adds request metrics and trace spans (section 8.6). Labels use the route pattern, never the URL, so board and file
 * IDs don't create a new series each. Health checks are left out. Spans carry no user data.
 */
export function observe(app: FastifyInstance, opts: { registry?: Registry; tracing?: Tracing }): ApiMetrics {
  const registry = opts.registry ?? createRegistry("api");
  // Reuse a series that already exists, so two apps can share one registry.
  const reuse = <T,>(name: string, make: () => T) => (registry.getSingleMetric(name) as T | undefined) ?? make();
  const duration = reuse("http_request_duration_seconds", () => new Histogram({ name: "http_request_duration_seconds", help: "Request duration", labelNames: ["method", "route", "status"], buckets: LATENCY_BUCKETS, registers: [registry] }));
  const inFlight = reuse("http_requests_in_flight", () => new Gauge({ name: "http_requests_in_flight", help: "Requests being handled", registers: [registry] }));
  const signIns = reuse("miroclone_sign_in_total", () => new Counter({ name: "miroclone_sign_in_total", help: "Sign-in attempts by result", labelNames: ["result"], registers: [registry] }));
  const tracer = opts.tracing?.tracer;

  app.addHook("onRequest", async (req) => {
    if (QUIET.has(req.url.split("?")[0]!)) return;
    inFlight.inc();
    // Join the caller's trace when the request carries a W3C traceparent header.
    const parent = propagation.extract(context.active(), req.headers);
    const span = tracer?.startSpan(`${req.method} request`, { kind: SpanKind.SERVER, attributes: { "http.request.method": req.method } }, parent);
    req.otel = { span: span as Span, start: process.hrtime.bigint() };
  });

  app.addHook("onResponse", async (req, reply) => {
    if (!req.otel) return;
    inFlight.dec();
    const route = req.routeOptions?.url ?? "unmatched";
    const seconds = Number(process.hrtime.bigint() - req.otel.start) / 1e9;
    duration.observe({ method: req.method, route, status: String(reply.statusCode) }, seconds);
    const span = req.otel.span;
    if (span) {
      span.updateName(`${req.method} ${route}`);
      span.setAttributes({ "http.route": route, "http.response.status_code": reply.statusCode });
      if (reply.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    }
  });

  return { registry, signIns };
}

export { trace };
