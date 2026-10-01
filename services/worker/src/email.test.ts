import { PGlite } from "@electric-sql/pglite";
import { migrate, type Db } from "@miroclone/server-core";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, renderEmail, sendPendingEmails, type Mail, type Mailer } from "./email.js";

let db: Db;
let board: string, comment: string;

beforeAll(async () => {
  db = new PGlite() as unknown as Db;
  await migrate(db);
  await db.query("INSERT INTO users (id, tenant_id, display_name, email) VALUES ('ann','t','Ann Secretname','ann@x.test'), ('bob','t','Bob','bob@x.test'), ('noemail','t','No Email', NULL)");
  board = (await db.query<{ id: string }>("INSERT INTO boards (title, classification, created_by) VALUES ('Secret project codename', 'PROTECTED', 'ann') RETURNING id")).rows[0]!.id;
  comment = (await db.query<{ id: string }>("INSERT INTO comments (board_id, thread_id, author_id, body) VALUES ($1, gen_random_uuid(), 'ann', 'The launch date is 12 March') RETURNING id", [board])).rows[0]!.id;
});
beforeEach(async () => { await db.query("DELETE FROM notifications"); });

const notify = (user: string, kind = "mention") =>
  db.query("INSERT INTO notifications (user_id, board_id, comment_id, kind, actor_id) VALUES ($1, $2, $3, $4, 'ann')", [user, board, comment, kind]);
const sink = () => { const sent: Mail[] = []; return { sent, mailer: { send: async (m: Mail) => { sent.push(m); } } satisfies Mailer }; };
const state = async () => (await db.query<{ emailed_at: string | null; email_attempts: number }>("SELECT emailed_at, email_attempts FROM notifications")).rows;

describe("renderEmail", () => {
  it("carries a link and the classification", () => {
    const m = renderEmail({ kind: "mention", boardId: "b-1", classification: "PROTECTED" }, "https://board.example.internal/");
    expect(m.subject).toContain("PROTECTED");
    expect(m.text).toContain("https://board.example.internal/#/board/b-1");
  });
});

describe("sendPendingEmails", () => {
  it("sends one email per notification and marks it sent", async () => {
    await notify("bob"); await notify("bob", "reply");
    const { sent, mailer } = sink();
    expect(await sendPendingEmails(db, mailer, "https://app.test")).toEqual({ sent: 2, failed: 0, skipped: 0 });
    expect(sent.map((m) => m.to)).toEqual(["bob@x.test", "bob@x.test"]);
    expect((await state()).every((r) => r.emailed_at)).toBe(true);
    expect(await sendPendingEmails(db, mailer, "https://app.test")).toEqual({ sent: 0, failed: 0, skipped: 0 });
  });

  it("puts no board content in any email", async () => {
    await notify("bob");
    const { sent, mailer } = sink();
    await sendPendingEmails(db, mailer, "https://app.test");
    const all = JSON.stringify(sent);
    for (const secret of ["Secret project codename", "launch date", "12 March", "Ann Secretname"]) expect(all).not.toContain(secret);
    expect(all).toContain("PROTECTED");
  });

  it("skips a user with no address without retrying", async () => {
    await notify("noemail");
    const { sent, mailer } = sink();
    expect(await sendPendingEmails(db, mailer, "https://app.test")).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(sent).toHaveLength(0);
    expect((await state())[0]!.emailed_at).not.toBeNull();
  });

  it("keeps a failed email for another try, after a delay, and stops at the limit", async () => {
    await notify("bob");
    const broken: Mailer = { send: async () => { throw new Error("relay down"); } };
    expect(await sendPendingEmails(db, broken, "https://app.test")).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect((await state())[0]).toMatchObject({ emailed_at: null, email_attempts: 1 });
    // Too soon: the job leaves it alone.
    expect(await sendPendingEmails(db, broken, "https://app.test")).toEqual({ sent: 0, failed: 0, skipped: 0 });
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      await db.query("UPDATE notifications SET last_attempt_at = now() - interval '5 minutes'");
      await sendPendingEmails(db, broken, "https://app.test");
    }
    expect((await state())[0]!.email_attempts).toBe(MAX_ATTEMPTS);
    await db.query("UPDATE notifications SET last_attempt_at = now() - interval '5 minutes'");
    expect(await sendPendingEmails(db, broken, "https://app.test")).toEqual({ sent: 0, failed: 0, skipped: 0 });
  });

  it("recovers once the relay is back", async () => {
    await notify("bob");
    await sendPendingEmails(db, { send: async () => { throw new Error("down"); } }, "https://app.test");
    await db.query("UPDATE notifications SET last_attempt_at = now() - interval '5 minutes'");
    const { sent, mailer } = sink();
    expect(await sendPendingEmails(db, mailer, "https://app.test")).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(sent).toHaveLength(1);
  });

  it("doesn't send the same email twice when two workers run together", async () => {
    for (let i = 0; i < 6; i++) await notify("bob");
    const { sent, mailer } = sink();
    await Promise.all([sendPendingEmails(db, mailer, "https://app.test", 4), sendPendingEmails(db, mailer, "https://app.test", 4)]);
    expect(sent).toHaveLength(6);
  });
});
