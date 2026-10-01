import { PGlite } from "@electric-sql/pglite";
import { migrate, type Db } from "@miroclone/server-core";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GraphTeamsNotifier, sendPendingTeams, teamsEnabled, TEAMS_MAX_ATTEMPTS, TeamsError, type TeamsNotifier } from "./teams.js";

const cfg = { tenantId: "tenant-1", clientId: "client-1", clientSecret: "s3cret-value", authority: "https://login.test", graphBase: "https://graph.test/v1.0" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

describe("GraphTeamsNotifier (COL-9)", () => {
  function fake(handler: (url: string, init: RequestInit) => Response | Promise<Response> = () => new Response(null, { status: 204 })) {
    const calls: { url: string; init: RequestInit }[] = [];
    let tokens = 0;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.startsWith("https://login.test/")) return json({ access_token: `tok-${++tokens}`, expires_in: 3600 });
      return handler(url, init);
    }) as unknown as typeof fetch;
    return { calls, fetchImpl, graph: () => calls.filter((c) => c.url.startsWith("https://graph.test/")) };
  }

  it("gets an app token from Entra ID and posts a content-free activity notification to Graph", async () => {
    const f = fake();
    await new GraphTeamsNotifier(cfg, f.fetchImpl).notify("user-1", { link: "https://app.test/#/board/b1", classification: "PROTECTED" });
    const [tokenCall, send] = f.calls;
    expect(tokenCall!.url).toBe("https://login.test/tenant-1/oauth2/v2.0/token");
    const form = new URLSearchParams(String(tokenCall!.init.body));
    expect(Object.fromEntries(form)).toMatchObject({ grant_type: "client_credentials", client_id: "client-1", scope: "https://graph.microsoft.com/.default" });
    expect(send!.url).toBe("https://graph.test/v1.0/users/user-1/teamwork/sendActivityNotification");
    expect((send!.init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
    expect(JSON.parse(String(send!.init.body))).toEqual({
      topic: { source: "text", value: "Miroclone", webUrl: "https://app.test/#/board/b1" },
      activityType: "boardActivity",
      previewText: { content: "New activity on a PROTECTED board" },
      templateParameters: [{ name: "classification", value: "PROTECTED" }],
    });
  });

  it("only calls Entra ID and Graph, and never sends the secret to Graph", async () => {
    const f = fake();
    await new GraphTeamsNotifier(cfg, f.fetchImpl).notify("u", { link: "l", classification: "OFFICIAL" });
    expect(f.calls.every((c) => c.url.startsWith("https://login.test/") || c.url.startsWith("https://graph.test/"))).toBe(true);
    expect(JSON.stringify(f.graph())).not.toContain("s3cret-value");
  });

  it("reuses a token until shortly before it expires", async () => {
    let t = 0;
    const f = fake();
    const n = new GraphTeamsNotifier(cfg, f.fetchImpl, () => t);
    await n.notify("a", { link: "l", classification: "OFFICIAL" });
    await n.notify("b", { link: "l", classification: "OFFICIAL" });
    expect(f.calls.filter((c) => c.url.startsWith("https://login.test/"))).toHaveLength(1);
    t = 3600_000 - 30_000;
    await n.notify("c", { link: "l", classification: "OFFICIAL" });
    expect(f.calls.filter((c) => c.url.startsWith("https://login.test/"))).toHaveLength(2);
  });

  it("gets a new token once when Graph refuses the old one", async () => {
    let first = true;
    const f = fake(() => { if (first) { first = false; return new Response(null, { status: 401 }); } return new Response(null, { status: 204 }); });
    await new GraphTeamsNotifier(cfg, f.fetchImpl).notify("u", { link: "l", classification: "OFFICIAL" });
    expect(f.graph().map((c) => (c.init.headers as Record<string, string>).authorization)).toEqual(["Bearer tok-1", "Bearer tok-2"]);
  });

  it("treats 404 as permanent (the person hasn't installed the app), and other errors as worth retrying", async () => {
    const notify = (status: number) => new GraphTeamsNotifier(cfg, fake(() => new Response(null, { status })).fetchImpl).notify("u", { link: "l", classification: "OFFICIAL" });
    await expect(notify(404)).rejects.toMatchObject({ permanent: true, status: 404 });
    for (const s of [403, 429, 500]) await expect(notify(s)).rejects.toMatchObject({ permanent: false, status: s });
  });

  it("fails without leaking the secret when Entra ID refuses the credentials", async () => {
    const fetchImpl = (async () => json({ error: "invalid_client" }, 401)) as unknown as typeof fetch;
    const err = (await new GraphTeamsNotifier(cfg, fetchImpl).notify("u", { link: "l", classification: "OFFICIAL" }).then(() => undefined, (e: unknown) => e)) as TeamsError;
    expect(err).toBeInstanceOf(TeamsError);
    expect(err.message).not.toContain("s3cret-value");
    expect(err.permanent).toBe(false);
  });
});

describe("sendPendingTeams (COL-9)", () => {
  let db: Db;
  let board: string, comment: string;
  beforeAll(async () => {
    db = new PGlite() as unknown as Db;
    await migrate(db);
    await db.query("INSERT INTO users (id, tenant_id, display_name, email) VALUES ('ann','t','Ann Secretname','ann@x.test'), ('bob','t','Bob','bob@x.test'), ('carl','t','Carl','c@x.test')");
    board = (await db.query<{ id: string }>("INSERT INTO boards (title, classification, created_by) VALUES ('Secret project codename', 'PROTECTED', 'ann') RETURNING id")).rows[0]!.id;
    comment = (await db.query<{ id: string }>("INSERT INTO comments (board_id, thread_id, author_id, body) VALUES ($1, gen_random_uuid(), 'ann', 'The launch date is 12 March') RETURNING id", [board])).rows[0]!.id;
  });
  beforeEach(async () => { await db.query("DELETE FROM notifications"); });
  const notify = (user: string, kind = "mention") => db.query("INSERT INTO notifications (user_id, board_id, comment_id, kind, actor_id) VALUES ($1, $2, $3, $4, 'ann')", [user, board, comment, kind]);
  const state = async () => (await db.query<{ user_id: string; teams_sent_at: string | null; teams_attempts: number }>("SELECT user_id, teams_sent_at, teams_attempts FROM notifications ORDER BY created_at, user_id")).rows;
  const recorder = (fail?: (user: string) => Error | undefined) => {
    const sent: { user: string; link: string; classification: string }[] = [];
    const notifier: TeamsNotifier = { notify: async (user, n) => { const e = fail?.(user); if (e) throw e; sent.push({ user, ...n }); } };
    return { sent, notifier };
  };

  it("sends one notification each with the link and classification, and no board content", async () => {
    await notify("bob"); await notify("carl", "reply");
    const { sent, notifier } = recorder();
    expect(await sendPendingTeams(db, notifier, "https://app.test/")).toEqual({ sent: 2, failed: 0, skipped: 0 });
    expect(sent.map((s) => s.user).sort()).toEqual(["bob", "carl"]);
    expect(sent[0]).toMatchObject({ link: `https://app.test/#/board/${board}`, classification: "PROTECTED" });
    const text = JSON.stringify(sent);
    for (const secret of ["Secret project codename", "Ann Secretname", "launch date"]) expect(text).not.toContain(secret);
    expect(await sendPendingTeams(db, notifier, "https://app.test")).toEqual({ sent: 0, failed: 0, skipped: 0 });
  });

  it("skips a person who hasn't installed the app, and doesn't retry them", async () => {
    await notify("bob");
    const { notifier } = recorder(() => new TeamsError("no", 404, true));
    expect(await sendPendingTeams(db, notifier, "https://app.test")).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect((await state())[0]!.teams_sent_at).not.toBeNull();
  });

  it("keeps a failed notification for a retry, backs off, and gives up after the attempt limit", async () => {
    await notify("bob");
    const { notifier } = recorder(() => new TeamsError("later", 429, false));
    expect(await sendPendingTeams(db, notifier, "https://app.test")).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect((await state())[0]).toMatchObject({ teams_sent_at: null, teams_attempts: 1 });
    // Too soon for another go.
    expect(await sendPendingTeams(db, notifier, "https://app.test")).toEqual({ sent: 0, failed: 0, skipped: 0 });
    for (let i = 1; i < TEAMS_MAX_ATTEMPTS; i++) {
      await db.query("UPDATE notifications SET teams_attempt_at = now() - interval '5 minutes'");
      await sendPendingTeams(db, notifier, "https://app.test");
    }
    expect((await state())[0]!.teams_attempts).toBe(TEAMS_MAX_ATTEMPTS);
    await db.query("UPDATE notifications SET teams_attempt_at = now() - interval '5 minutes'");
    expect(await sendPendingTeams(db, notifier, "https://app.test")).toEqual({ sent: 0, failed: 0, skipped: 0 });
  });

  it("doesn't touch the email job's state, and the reverse", async () => {
    await notify("bob");
    await sendPendingTeams(db, recorder().notifier, "https://app.test");
    const { rows } = await db.query<{ emailed_at: string | null; email_attempts: number }>("SELECT emailed_at, email_attempts FROM notifications");
    expect(rows[0]).toMatchObject({ emailed_at: null, email_attempts: 0 });
  });

  it("is off unless an administrator turns it on", async () => {
    expect(await teamsEnabled(db)).toBe(false);
    await db.query("INSERT INTO settings (key, value) VALUES ('teams_notifications', 'true')");
    expect(await teamsEnabled(db)).toBe(true);
    await db.query("UPDATE settings SET value = 'false' WHERE key = 'teams_notifications'");
    expect(await teamsEnabled(db)).toBe(false);
  });
});
