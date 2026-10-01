import { canEditContent, type BoardRole } from "@miroclone/shared";

export interface CollabUser { id: string; name: string; groups: string[] }

/** Resolves a session cookie to a user, and a user's role on a board. */
export interface AccessResolver {
  userFromCookie(cookie: string | undefined): Promise<CollabUser | undefined>;
  roleOnBoard(user: CollabUser, boardId: string): Promise<BoardRole | undefined>;
}

export interface AuthResult {
  user: CollabUser;
  role: BoardRole;
  readOnly: boolean;
}

/**
 * Authenticates a WebSocket connection when it opens and checks the board role
 * before any board data syncs (section 7.4). Viewers and commenters connect
 * read-only, so the server drops their document updates.
 */
export async function authenticate(
  resolver: AccessResolver,
  boardId: string,
  cookie: string | undefined,
): Promise<AuthResult> {
  const user = await resolver.userFromCookie(cookie);
  if (!user) throw new Error("unauthenticated");
  const role = await resolver.roleOnBoard(user, boardId);
  if (!role) throw new Error("forbidden");
  return { user, role, readOnly: !canEditContent(role) };
}
