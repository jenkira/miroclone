-- People who have opened a board. They can be mentioned even when access comes through a group.
CREATE TABLE board_participants (
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, user_id)
);

-- Comments form threads. The first comment of a thread has thread_id equal to its own id.
CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL,
  author_id text NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  -- Where the thread sits: an object ID, a canvas point, or both. Only the first comment of a thread has one.
  anchor jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  resolved_at timestamptz,
  resolved_by text REFERENCES users(id)
);
CREATE INDEX comments_board ON comments (board_id, created_at);
CREATE INDEX comments_thread ON comments (thread_id, created_at);

-- In-app notifications. The email job reads the ones that have no emailed_at.
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id),
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  comment_id uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('mention', 'reply')),
  actor_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  emailed_at timestamptz,
  email_attempts int NOT NULL DEFAULT 0
);
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unsent ON notifications (created_at) WHERE emailed_at IS NULL;
