import { Server } from "@hocuspocus/server";
import { authenticate, type AccessResolver } from "./auth.js";

export function createCollabServer(opts: { port: number; resolver: AccessResolver }) {
  return Server.configure({
    port: opts.port,
    quiet: true,
    async onAuthenticate({ documentName, requestHeaders, connection }) {
      const result = await authenticate(
        opts.resolver,
        documentName,
        requestHeaders.cookie,
      );
      connection.readOnly = result.readOnly;
      return { user: result.user, role: result.role };
    },
  });
}
