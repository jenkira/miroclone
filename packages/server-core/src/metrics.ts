import { createServer, type Server } from "node:http";
import { collectDefaultMetrics, Registry } from "prom-client";

export { Counter, Gauge, Histogram, Registry } from "prom-client";

/** A registry with process metrics and a `service` label on every series (section 8.6). */
export function createRegistry(service: string): Registry {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry });
  return registry;
}

/**
 * Serves `/metrics` on its own port, apart from the application port. The ingress and the Service never route to it,
 * and a NetworkPolicy lets only the monitoring namespace reach it.
 */
export function serveMetrics(registry: Registry, port: number, host = "0.0.0.0"): Server {
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url?.split("?")[0] === "/metrics") {
      res.writeHead(200, { "content-type": registry.contentType }).end(await registry.metrics());
    } else {
      res.writeHead(404).end();
    }
  });
  server.listen(port, host);
  return server;
}

/** Bucket boundaries, in seconds, for request and job timings. The 0.2 s bucket matches the sync target (PRF-3). */
export const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.35, 0.5, 1, 2, 5, 10];
