/**
 * A local SMTP server that accepts every message and keeps it in memory, for development and end-to-end tests only.
 * It listens on 127.0.0.1:2525 (SMTP_SINK_PORT). GET http://127.0.0.1:2526/mails returns what arrived.
 */
import { createServer as http } from "node:http";
import { createServer as tcp } from "node:net";

const mails: { from: string; to: string[]; data: string }[] = [];

tcp((sock) => {
  let from = "", to: string[] = [], data = "", inData = false, buf = "";
  const say = (s: string) => sock.write(s + "\r\n");
  say("220 sink ESMTP");
  sock.on("data", (d) => {
    buf += d.toString("utf8");
    let i: number;
    while ((i = buf.indexOf("\r\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (inData) {
        if (line === ".") { inData = false; mails.push({ from, to, data }); data = ""; say("250 queued"); }
        else data += (line.startsWith("..") ? line.slice(1) : line) + "\n";
        continue;
      }
      const cmd = line.toUpperCase();
      if (cmd.startsWith("EHLO")) say("250-sink\r\n250 8BITMIME");
      else if (cmd.startsWith("HELO")) say("250 sink");
      else if (cmd.startsWith("MAIL FROM")) { from = /<([^>]*)>/.exec(line)?.[1] ?? ""; to = []; say("250 ok"); }
      else if (cmd.startsWith("RCPT TO")) { to.push(/<([^>]*)>/.exec(line)?.[1] ?? ""); say("250 ok"); }
      else if (cmd === "DATA") { inData = true; say("354 go ahead"); }
      else if (cmd === "QUIT") { say("221 bye"); sock.end(); }
      else say("250 ok");
    }
  });
  sock.on("error", () => {});
}).listen(Number(process.env.SMTP_SINK_PORT ?? 2525), "127.0.0.1");

http((req, res) => {
  if (req.url === "/clear") { mails.length = 0; return void res.writeHead(200).end("cleared"); }
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(mails));
}).listen(2526, "127.0.0.1");

console.log(JSON.stringify({ msg: "smtp sink listening", smtp: 2525, http: 2526 }));
