CREATE TABLE users (
  id text PRIMARY KEY,            -- Entra object ID
  tenant_id text NOT NULL,
  display_name text NOT NULL,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_sign_in_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  classification text NOT NULL,
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE board_members (
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  principal_type text NOT NULL CHECK (principal_type IN ('user', 'group')),
  principal_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor', 'owner')),
  PRIMARY KEY (board_id, principal_type, principal_id)
);
CREATE INDEX board_members_principal ON board_members (principal_type, principal_id);

CREATE TABLE board_stars (
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id),
  PRIMARY KEY (board_id, user_id)
);

CREATE TABLE board_updates (
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  seq bigserial,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, seq)
);
