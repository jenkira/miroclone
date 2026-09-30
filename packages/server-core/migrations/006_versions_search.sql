-- Saved copies of a board (BRD-6). The state is a Yjs update that rebuilds the whole board.
CREATE TABLE board_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('auto', 'named')),
  name text,
  state bytea NOT NULL,
  object_count int NOT NULL,
  created_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX board_versions_board ON board_versions (board_id, created_at DESC);

-- What people can search for (BRD-4). The worker keeps it up to date.
CREATE TABLE board_search (
  board_id uuid PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  body text NOT NULL,
  tsv tsvector NOT NULL,
  indexed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX board_search_tsv ON board_search USING gin (tsv);
