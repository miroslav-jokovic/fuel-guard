-- FuelGuard — 0024 weekly digest bookkeeping
-- Tracks the last time each org's weekly theft digest was sent, so the scheduler doesn't double-send
-- (and survives server restarts).
alter table organizations add column if not exists last_digest_at timestamptz;
