-- Retention (ADM-4): when a board was last opened, and when it was archived. An archived board is read-only until its owner restores it.
ALTER TABLE boards ADD COLUMN last_opened_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE boards ADD COLUMN archived_at timestamptz;
CREATE INDEX boards_stale ON boards (last_opened_at) WHERE archived_at IS NULL AND deleted_at IS NULL;
