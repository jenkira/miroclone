-- Lets the email job back off between attempts and claim rows without two workers sending the same one.
ALTER TABLE notifications ADD COLUMN last_attempt_at timestamptz;
