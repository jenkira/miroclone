-- Teams activity notifications (COL-9). The job tracks its own attempts, apart from the email job's.
ALTER TABLE notifications ADD COLUMN teams_sent_at timestamptz;
ALTER TABLE notifications ADD COLUMN teams_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN teams_attempt_at timestamptz;
-- Notifications that existed before this change are marked done, so turning Teams on doesn't send old news.
UPDATE notifications SET teams_sent_at = now();
CREATE INDEX notifications_teams_unsent ON notifications (created_at) WHERE teams_sent_at IS NULL;
