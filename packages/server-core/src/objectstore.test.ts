import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { S3ObjectStore } from "./objectstore.js";

/** A minimal path-style S3 server: PUT, GET, and DELETE on /bucket/key. It ignores signatures. */
let server: Server; let endpoint = "";
const data = new Map<string, { body: Buffer; type: string }>();
const seen: { method: string; url: string; auth?: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization });
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const key = decodeURIComponent(req.url!.split("?")[0]!);
      if (req.method === "PUT") { data.set(key, { body: Buffer.concat(chunks), type: String(req.headers["content-type"]) }); res.writeHead(200, { etag: '"x"' }).end(); }
      else if (req.method === "GET") {
        const v = data.get(key);
        if (!v) return void res.writeHead(404, { "content-type": "application/xml" }).end("<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>");
        res.writeHead(200, { "content-type": v.type, "content-length": v.body.length }).end(v.body);
      } else if (req.method === "DELETE") { data.delete(key); res.writeHead(204).end(); }
      else res.writeHead(405).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => { server.close(); });

describe("S3ObjectStore", () => {
  const make = () => new S3ObjectStore({ endpoint, region: "us-east-1", bucket: "boards", forcePathStyle: true, accessKeyId: "AK", secretAccessKey: "SK" });

  it("puts, gets, and deletes through the S3 API with path-style addressing", async () => {
    const s = make();
    await s.put("boards/b1/f1", Buffer.from("hello"), "image/png");
    expect(data.get("/boards/boards/b1/f1")?.type).toBe("image/png");
    expect(Buffer.from((await s.get("boards/b1/f1"))!).toString()).toBe("hello");
    await s.delete("boards/b1/f1");
    expect(await s.get("boards/b1/f1")).toBeUndefined();
  });
  it("signs every request", async () => {
    await make().put("k", Buffer.from("x"), "image/png");
    expect(seen.at(-1)!.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\//);
  });
  it("returns undefined for a missing object", async () => {
    expect(await make().get("nope")).toBeUndefined();
  });
});
