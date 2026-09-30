import { createServer, type Server } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClamdScanner } from "./scanner.js";

/** A stand-in for clamd that speaks the INSTREAM protocol and flags the EICAR test string. */
function fakeClamd(): Promise<{ server: Server; port: number; received: Buffer[] }> {
  const received: Buffer[] = [];
  const server = createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (!buf.subarray(0, 10).equals(Buffer.from("zINSTREAM\0"))) return;
      let i = 10; const parts: Buffer[] = [];
      while (i + 4 <= buf.length) {
        const n = buf.readUInt32BE(i); i += 4;
        if (n === 0) {
          const all = Buffer.concat(parts); received.push(all);
          sock.end(all.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE") ? "stream: Eicar-Signature FOUND\0" : "stream: OK\0");
          return;
        }
        if (i + n > buf.length) return;
        parts.push(buf.subarray(i, i + n)); i += n;
      }
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, port: (server.address() as { port: number }).port, received })));
}

let f: Awaited<ReturnType<typeof fakeClamd>>;
beforeAll(async () => { f = await fakeClamd(); });
afterAll(() => { f.server.close(); });

describe("ClamdScanner", () => {
  it("passes a clean file, including one larger than a chunk", async () => {
    const big = Buffer.alloc(200_000, 7);
    expect(await new ClamdScanner("127.0.0.1", f.port).scan(big)).toEqual({ clean: true });
    expect(f.received.at(-1)!.length).toBe(200_000);
  });
  it("reports the signature for an infected file", async () => {
    const eicar = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    expect(await new ClamdScanner("127.0.0.1", f.port).scan(eicar)).toEqual({ clean: false, signature: "Eicar-Signature" });
  });
  it("fails, and doesn't pass the file, when clamd isn't reachable", async () => {
    await expect(new ClamdScanner("127.0.0.1", 1).scan(Buffer.from("x"))).rejects.toThrow();
  });
});
