import { parseCookie } from "cookie";
import { roleOnBoard, SESSION_COOKIE, type Db, type SessionManager } from "@miroclone/server-core";
import type { AccessResolver } from "./auth.js";

/** Resolves the API's session cookie and the user's board role (section 8.3, step 6). */
export function sessionResolver(sessions: SessionManager, db: Db): AccessResolver {
  return {
    async userFromCookie(cookie) {
      const id = cookie ? parseCookie(cookie)[SESSION_COOKIE] : undefined;
      const s = await sessions.touch(id);
      return s && { id: s.userId, name: s.name, groups: s.groups };
    },
    roleOnBoard: (user, boardId) => roleOnBoard(db, user, boardId),
  };
}
