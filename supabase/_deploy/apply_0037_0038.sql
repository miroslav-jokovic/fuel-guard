-- ─────────────────────────────────────────────────────────────────────────────
-- Run this ONCE in the Supabase SQL editor BEFORE deploying, then push + re-sync.
-- Idempotent (add column if not exists) — safe to run more than once.
-- Covers migrations 0037 + 0038. No data is modified, only columns added.
-- ─────────────────────────────────────────────────────────────────────────────

-- 0038: LEARNED per-truck — does the Samsara fuel sensor reflect the WHOLE billed fill (ratio ~1)?
-- Gates the tank-fill-short anomaly so a dual-independent-tank truck (ratio ~0.5 / erratic) never
-- produces a false short. Default false (suppressed) until enough history clusters.
alter table vehicles add column if not exists tank_sensor_reliable boolean not null default false;
alter table vehicles add column if not exists tank_fill_ratio       numeric(5,3);

-- 0037: legacy column kept for schema/migration consistency (superseded by the learned flag above; unused
-- by current code). Harmless.
alter table vehicles add column if not exists monitored_tank_capacity_gal numeric(7,2);

-- Sanity check — should return three rows:
-- select column_name from information_schema.columns
--   where table_name='vehicles'
--     and column_name in ('tank_sensor_reliable','tank_fill_ratio','monitored_tank_capacity_gal');
