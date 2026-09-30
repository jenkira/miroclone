/**
 * Local stand-ins for an S3-compatible store and ClamAV, for development and end-to-end tests only.
 *
 * - S3 on 127.0.0.1:9100, path-style, no signature checks. GET /__stats returns the object count.
 * - clamd on 127.0.0.1:3311. It flags any file that contains the EICAR test string.
 *
 * Start the API with S3_ENDPOINT=http://127.0.0.1:9100 S3_BUCKET=boards S3_FORCE_PATH_STYLE=1
 * S3_ACCESS_KEY_ID=dev S3_SECRET_ACCESS_KEY=dev CLAMD_HOST=127.0.0.1 CLAMD_PORT=3311.
 */
import { createServer as tcp } from "node:net";
import { createServer as http } from "node:http";

const objects = new Map<string, { body: Buffer; type: string }>();

http((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const key = decodeURIComponent(req.url!.split("?")[0]!);
    if (key === "/__stats") return void res.writeHead(200).end(JSON.stringify({ objects: objects.size }));
    if (req.method === "PUT") { objects.set(key, { body: Buffer.concat(chunks), type: String(req.headers["content-type"]) }); return void res.writeHead(200, { etag: '"x"' }).end(); }
    if (req.method === "DELETE") { objects.delete(key); return void res.writeHead(204).end(); }
    const o = objects.get(key);
    if (req.method === "GET" && o) return void res.writeHead(200, { "content-type": o.type, "content-length": o.body.length }).end(o.body);
    res.writeHead(404, { "content-type": "application/xml" }).end("<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>");
  });
}).listen(9100, "127.0.0.1");

tcp((sock) => {
  let buf = Buffer.alloc(0);
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    if (!buf.subarray(0, 10).equals(Buffer.from("zINSTREAM\0"))) return;
    let i = 10; const parts: Buffer[] = [];
    while (i + 4 <= buf.length) {
      const n = buf.readUInt32BE(i); i += 4;
      if (n === 0) return void sock.end(Buffer.concat(parts).includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE") ? "stream: Eicar-Signature FOUND\0" : "stream: OK\0");
      if (i + n > buf.length) return;
      parts.push(buf.subarray(i, i + n)); i += n;
    }
  });
}).listen(3311, "127.0.0.1");

console.log(JSON.stringify({ msg: "fake storage listening", s3: 9100, clamd: 3311 }));
