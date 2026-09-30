import { createCollabServer } from "./server.js";
import type { AccessResolver } from "./auth.js";

// Development resolver. Production wires this to the API service's session
// store (Redis) and the board membership tables (PostgreSQL).
const devResolver: AccessResolver = {
  async userFromCookie(cookie) {
    return cookie?.includes("dev=1") ? { id: "dev", name: "Developer" } : undefined;
  },
  async roleOnBoard() {
    return "editor";
  },
};

const port = Number(process.env.PORT ?? 1234);
await createCollabServer({ port, resolver: devResolver }).listen();
console.log(JSON.stringify({ level: "info", msg: "collab listening", port }));
