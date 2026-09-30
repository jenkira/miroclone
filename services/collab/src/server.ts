import { Server } from "@hocuspocus/server";
import type { Db } from "@miroclone/server-core";
import { authenticate, type AccessResolver } from "./auth.js";
import { appendUpdate, compact, loadDoc } from "./persistence.js";

export function createCollabServer(opts: { port: number; resolver: AccessResolver; db: Db }) {
  return Server.configure({
    port: opts.port,
    quiet: true,
    async onAuthenticate({ documentName, requestHeaders, connection }) {
      const result = await authenticate(opts.resolver, documentName, requestHeaders.cookie);
      connection.readOnly = result.readOnly;
      return { user: result.user, role: result.role };
    },
    onLoadDocument: ({ documentName }) => loadDoc(opts.db, documentName),
    async onChange({ documentName, update }) {
      await appendUpdate(opts.db, documentName, update);
      await compact(opts.db, documentName);
    },
  });
}
