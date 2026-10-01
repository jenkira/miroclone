/** Board member roles (IAM-6), from least to most privileged. */
export const boardRoles = ["viewer", "commenter", "editor", "owner"] as const;
export type BoardRole = (typeof boardRoles)[number];

const rank = (r: BoardRole) => boardRoles.indexOf(r);

export function atLeast(role: BoardRole, min: BoardRole): boolean {
  return rank(role) >= rank(min);
}

/** The server drops document updates from viewers and commenters (section 7.4). */
export function canEditContent(role: BoardRole): boolean {
  return atLeast(role, "editor");
}

export function canComment(role: BoardRole): boolean {
  return atLeast(role, "commenter");
}

export function canManageBoard(role: BoardRole): boolean {
  return role === "owner";
}

/** Returns the strongest role, or undefined when the user has none. */
export function strongestRole(
  roles: readonly BoardRole[],
): BoardRole | undefined {
  return roles.reduce<BoardRole | undefined>(
    (best, r) => (best === undefined || rank(r) > rank(best) ? r : best),
    undefined,
  );
}
