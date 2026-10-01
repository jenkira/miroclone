-- Information management markers and caveats on a board (PMK-6). Keys come from the list an administrator configures.
ALTER TABLE boards ADD COLUMN markers text[] NOT NULL DEFAULT '{}';
