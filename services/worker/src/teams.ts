import type { Db } from "@miroclone/server-core";

/** Attempts before the job gives up on a Teams notification. */
export const TEAMS_MAX_ATTEMPTS = 5;
/** Wait between attempts, in seconds. */
export const TEAMS_RETRY_AFTER_SECONDS = 60;

export interface TeamsConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** Entra ID address. Change it only for a test. */
  authority?: string;
  /** Microsoft Graph address. Change it only for a test. */
  graphBase?: string;
}

/** Why a notification wasn't delivered. `permanent` means retrying can't help. */
export class TeamsError extends Error {
  constructor(message: string, readonly status: number, readonly permanent: boolean) { super(message); }
}

export interface TeamsNotifier {
  notify(userId: string, n: { link: string; classification: string }): Promise<void>;
}

/**
 * Sends activity feed notifications through Microsoft Graph with the app's own credentials (COL-9). The only calls are
 * to Entra ID for a token and to Graph to send, so the fixed rule on outbound calls holds. The notification names the
 * classification and links to the board, and holds no board content, title, comment, or commenter (COL-8).
 */
export class GraphTeamsNotifier implements TeamsNotifier {
  private token?: { value: string; expiresAt: number };
  constructor(private cfg: TeamsConfig, private fetchImpl: typeof fetch = fetch, private now: () => number = Date.now) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    const authority = (this.cfg.authority ?? "https://login.microsoftonline.com").replace(/\/$/, "");
    const res = await this.fetchImpl(`${authority}/${encodeURIComponent(this.cfg.tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, scope: "https://graph.microsoft.com/.default" }),
    });
    if (!res.ok) throw new TeamsError(`Entra ID refused the app's credentials (${res.status}).`, res.status, false);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new TeamsError("Entra ID returned no token.", 502, false);
    this.token = { value: body.access_token, expiresAt: this.now() + (body.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  async notify(userId: string, n: { link: string; classification: string }): Promise<void> {
    const base = (this.cfg.graphBase ?? "https://graph.microsoft.com/v1.0").replace(/\/$/, "");
    const send = async () => this.fetchImpl(`${base}/users/${encodeURIComponent(userId)}/teamwork/sendActivityNotification`, {
      method: "POST",
      headers: { authorization: `Bearer ${await this.accessToken()}`, "content-type": "application/json" },
      body: JSON.stringify({
        topic: { source: "text", value: "Miroclone", webUrl: n.link },
        activityType: "boardActivity",
        previewText: { content: `New activity on a ${n.classification} board` },
        templateParameters: [{ name: "classification", value: n.classification }],
      }),
    });
    let res = await send();
    // A token that Graph no longer accepts is replaced once.
    if (res.status === 401) { this.token = undefined; res = await send(); }
    if (res.ok) return;
    // 404 means the person isn't in the tenant or hasn't installed the Teams app, which no retry fixes.
    // 403 means the app lacks the TeamsActivity.Send permission, which an administrator must grant, so the job keeps trying.
    throw new TeamsError(`Graph returned ${res.status}.`, res.status, res.status === 404);
  }
}

interface Row { id: string; user_id: string; board_id: string; classification: string }

/**
 * Sends pending Teams notifications. Rows are claimed in one statement, so several workers can run together without
 * sending twice. A notification that fails is retried after a delay, up to TEAMS_MAX_ATTEMPTS. A person who hasn't
 * installed the app is skipped without retries.
 */
export async function sendPendingTeams(db: Db, notifier: TeamsNotifier, baseUrl: string, batch = 50): Promise<{ sent: number; failed: number; skipped: number }> {
  const claimed = await db.query<Row>(
    `UPDATE notifications n SET teams_attempts = n.teams_attempts + 1, teams_attempt_at = now()
     FROM (SELECT id FROM notifications
           WHERE teams_sent_at IS NULL AND teams_attempts < $1
             AND (teams_attempt_at IS NULL OR teams_attempt_at < now() - ($2 || ' seconds')::interval)
           ORDER BY created_at LIMIT $3 FOR UPDATE SKIP LOCKED) pick
     WHERE n.id = pick.id
     RETURNING n.id, n.user_id, n.board_id, (SELECT classification FROM boards WHERE id = n.board_id) AS classification`,
    [TEAMS_MAX_ATTEMPTS, String(TEAMS_RETRY_AFTER_SECONDS), batch]);
  const out = { sent: 0, failed: 0, skipped: 0 };
  const link = (id: string) => `${baseUrl.replace(/\/$/, "")}/#/board/${id}`;
  for (const r of claimed.rows) {
    try {
      await notifier.notify(r.user_id, { link: link(r.board_id), classification: r.classification });
      await db.query("UPDATE notifications SET teams_sent_at = now() WHERE id = $1", [r.id]);
      out.sent++;
    } catch (e) {
      if (e instanceof TeamsError && e.permanent) {
        await db.query("UPDATE notifications SET teams_sent_at = now() WHERE id = $1", [r.id]);
        out.skipped++;
      } else out.failed++;
    }
  }
  return out;
}

/** Whether an administrator turned Teams notifications on. The default is off (COL-9: only if the agency approves). */
export async function teamsEnabled(db: Db): Promise<boolean> {
  const { rows } = await db.query<{ value: boolean }>("SELECT value FROM settings WHERE key = 'teams_notifications'");
  return rows[0]?.value === true;
}
