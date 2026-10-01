-- Files that boards reference, such as images. The bytes live in object storage under object_key.
CREATE TABLE board_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  object_key text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  uploaded_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX board_files_board ON board_files (board_id);
