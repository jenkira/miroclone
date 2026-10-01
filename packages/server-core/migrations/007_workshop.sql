-- Templates that anyone in the organisation can start a board from (WSH-2).
CREATE TABLE org_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  -- The classification of the board it came from. A board made from it can't be lower.
  classification text NOT NULL,
  objects jsonb NOT NULL,
  object_count int NOT NULL,
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Dot voting (WSH-4). Votes go through the API, because viewers and commenters can't write to the board document.
CREATE TABLE vote_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  vote_limit int NOT NULL CHECK (vote_limit BETWEEN 1 AND 50),
  anonymous boolean NOT NULL,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
-- A board has at most one open voting session.
CREATE UNIQUE INDEX one_open_vote_session ON vote_sessions (board_id) WHERE state = 'open';

CREATE TABLE votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES vote_sessions(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id),
  object_id text NOT NULL CHECK (char_length(object_id) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX votes_session_user ON votes (session_id, user_id);
