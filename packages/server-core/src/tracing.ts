import { context, propagation, SpanKind, SpanStatusCode, trace, type Span, type Tracer } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, SimpleSpanProcessor, type SpanExporter } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

export { context, propagation, SpanKind, SpanStatusCode, trace };
export type { Span, Tracer };

export interface Tracing { tracer: Tracer; enabled: boolean; shutdown(): Promise<void> }

/**
 * Sets up OpenTelemetry tracing (section 8.6). It sends spans to an in-cluster OTLP collector when
 * OTEL_EXPORTER_OTLP_ENDPOINT is set. Without it, spans are no-ops, so nothing leaves the pod.
 * Tests pass an exporter of their own.
 */
export function initTracing(serviceName: string, opts: { exporter?: SpanExporter; endpoint?: string } = {}): Tracing {
  const endpoint = opts.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const exporter = opts.exporter ?? (endpoint ? new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, "")}/v1/traces` }) : undefined);
  if (!exporter) return { tracer: trace.getTracer(serviceName), enabled: false, shutdown: async () => {} };
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ "service.name": serviceName }),
    spanProcessors: [opts.exporter ? new SimpleSpanProcessor(exporter) : new BatchSpanProcessor(exporter)],
  });
  provider.register();
  return { tracer: provider.getTracer(serviceName), enabled: true, shutdown: () => provider.shutdown() };
}

/** Runs `fn` inside a span, records an error if it throws, and ends the span. */
export async function withSpan<T>(tracer: Tracer, name: string, attrs: Record<string, string | number | boolean>, fn: (span: Span) => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes: attrs }, async (span) => {
    try { return await fn(span); }
    catch (err) { span.setStatus({ code: SpanStatusCode.ERROR, message: String((err as Error).message).slice(0, 200) }); throw err; }
    finally { span.end(); }
  });
}
