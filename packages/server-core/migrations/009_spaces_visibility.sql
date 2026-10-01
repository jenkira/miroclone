-- Organisation-wide visibility (IAM-8): everyone in the organisation gets this role on the board.
-- The API blocks it on PROTECTED boards.
ALTER TABLE boards ADD COLUMN org_visibility text CHECK (org_visibility IN ('viewer', 'commenter', 'editor'));

-- Spaces are folders that can be shared with people and groups (BRD-3).
CREATE TABLE spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE space_members (
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  principal_type text NOT NULL CHECK (principal_type IN ('user', 'group')),
  principal_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor', 'owner')),
  principal_name text,
  PRIMARY KEY (space_id, principal_type, principal_id)
);
CREATE INDEX space_members_principal ON space_members (principal_type, principal_id);

-- A deleted space leaves its boards where they are, and they fall back to their own grants.
ALTER TABLE boards ADD COLUMN space_id uuid REFERENCES spaces(id) ON DELETE SET NULL;
CREATE INDEX boards_space ON boards (space_id);

-- Every way to get access to a board, in one place, so each check reads the same rules:
--   direct and group grants on the board, grants on the board's space, and organisation-wide visibility.
-- A space owner manages the space, but only edits boards in it, so the role maps down to editor.
CREATE VIEW board_access AS
  SELECT board_id, principal_type, principal_id, role FROM board_members
  UNION ALL
  SELECT b.id, sm.principal_type, sm.principal_id, CASE WHEN sm.role = 'owner' THEN 'editor' ELSE sm.role END
    FROM boards b JOIN space_members sm ON sm.space_id = b.space_id
  UNION ALL
  SELECT id, 'org', '*', org_visibility FROM boards WHERE org_visibility IS NOT NULL;
