-- Display names for members, so the share dialog can list people and groups without calling Graph.
ALTER TABLE board_members ADD COLUMN principal_name text;
