-- Boards imported from another tool remember where they came from, so a repeated import can be refused (MIG-5).
ALTER TABLE boards ADD COLUMN source_ref text;
CREATE UNIQUE INDEX boards_source_ref ON boards (source_ref) WHERE source_ref IS NOT NULL AND deleted_at IS NULL;
