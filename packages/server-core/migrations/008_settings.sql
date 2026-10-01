-- Settings that administrators change while the service runs, such as the classification markings (PMK-1).
CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by text REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
