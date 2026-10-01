import { connect } from "node:net";

export interface ScanResult { clean: boolean; signature?: string }

/** Checks a file for malware before anyone else can download it (section 7.4). */
export interface Scanner {
  scan(data: Uint8Array): Promise<ScanResult>;
}

/** Talks to ClamAV's clamd over TCP with the INSTREAM command. */
export class ClamdScanner implements Scanner {
  constructor(private host: string, private port = 3310, private timeoutMs = 30_000) {}

  scan(data: Uint8Array): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const sock = connect({ host: this.host, port: this.port });
      let reply = "";
      const fail = (e: Error) => { sock.destroy(); reject(e); };
      sock.setTimeout(this.timeoutMs, () => fail(new Error("clamd timed out")));
      sock.on("error", fail);
      sock.on("data", (d) => { reply += d.toString("utf8"); });
      sock.on("end", () => {
        const r = reply.replace(/\0/g, "").trim();
        if (r.endsWith("OK")) return resolve({ clean: true });
        const m = /stream:\s*(.+)\s+FOUND$/.exec(r);
        if (m) return resolve({ clean: false, signature: m[1] });
        reject(new Error(`unexpected clamd reply: ${r.slice(0, 80)}`));
      });
      sock.on("connect", () => {
        sock.write("zINSTREAM\0");
        // clamd reads chunks that each start with a 4-byte big-endian length. A zero length ends the stream.
        const CHUNK = 64 * 1024;
        for (let i = 0; i < data.length; i += CHUNK) {
          const part = data.subarray(i, i + CHUNK);
          const len = Buffer.alloc(4); len.writeUInt32BE(part.length);
          sock.write(len); sock.write(part);
        }
        sock.write(Buffer.alloc(4));
      });
    });
  }
}
