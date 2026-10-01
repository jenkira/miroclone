import type { Db } from "@miroclone/server-core";

export interface Mail { to: string; subject: string; text: string }
export interface Mailer { send(mail: Mail): Promise<void> }

/** Attempts before the job gives up on a notification email. */
export const MAX_ATTEMPTS = 5;
/** Wait between attempts, in seconds. */
export const RETRY_AFTER_SECONDS = 60;

interface Row { id: string; kind: "mention" | "reply"; board_id: string; classification: string; email: string | null }

/**
 * Builds an email that carries a link and the board's classification, and no board content (COL-8).
 * The title, comment text, and the commenter's name stay out, because a mailbox isn't authorised for PROTECTED.
 */
export function renderEmail(n: { kind: "mention" | "reply"; boardId: string; classification: string }, baseUrl: string): { subject: string; text: string } {
  const link = `${baseUrl.replace(/\/$/, "")}/#/board/${n.boardId}`;
  const what = n.kind === "mention" ? "You were mentioned in a comment" : "There is a reply to a comment you took part in";
  return {
    subject: `Miroclone: new activity on a ${n.classification} board`,
    text: [
      `${what} on a board classified ${n.classification}.`,
      "",
      "Open the board to read it:",
      link,
      "",
      "This message contains no board content. Sign in to see the comment.",
    ].join("\n"),
  };
}

/**
 * Sends pending notification emails. Each row is claimed in one statement, so several workers can run together
 * without sending a message twice. A failed send is retried after a delay, up to MAX_ATTEMPTS.
 */
export async function sendPendingEmails(db: Db, mailer: Mailer, baseUrl: string, batch = 50): Promise<{ sent: number; failed: number; skipped: number }> {
  const claimed = await db.query<Row>(
    `UPDATE notifications n SET email_attempts = n.email_attempts + 1, last_attempt_at = now()
     FROM (SELECT id FROM notifications
           WHERE emailed_at IS NULL AND email_attempts < $1
             AND (last_attempt_at IS NULL OR last_attempt_at < now() - ($2 || ' seconds')::interval)
           ORDER BY created_at LIMIT $3 FOR UPDATE SKIP LOCKED) pick
     WHERE n.id = pick.id
     RETURNING n.id, n.kind, n.board_id,
       (SELECT classification FROM boards WHERE id = n.board_id) AS classification,
       (SELECT email FROM users WHERE id = n.user_id) AS email`,
    [MAX_ATTEMPTS, String(RETRY_AFTER_SECONDS), batch]);
  const out = { sent: 0, failed: 0, skipped: 0 };
  for (const r of claimed.rows) {
    if (!r.email) {
      // Nobody to write to. Mark it done so it doesn't come round again.
      await db.query("UPDATE notifications SET emailed_at = now() WHERE id = $1", [r.id]);
      out.skipped++;
      continue;
    }
    try {
      await mailer.send({ to: r.email, ...renderEmail({ kind: r.kind, boardId: r.board_id, classification: r.classification }, baseUrl) });
      await db.query("UPDATE notifications SET emailed_at = now() WHERE id = $1", [r.id]);
      out.sent++;
    } catch {
      out.failed++;
    }
  }
  return out;
}
