-- ────────────────────────────────────────────────────────────────────
-- MANUAL DEPLOY — independent engine-state idle measure (CP6)
-- Copy-paste into the Supabase SQL editor and run. Idempotent.
--
-- Stores each truck's total engine-on idle seconds derived from raw engine states, so the Data Confidence panel
-- can cross-check it against the Samsara idle-events total. After running, the next capability sync populates it.
-- ────────────────────────────────────────────────────────────────────
alter table vehicles add column if not exists idle_states_sec         bigint;
alter table vehicles add column if not exists idle_states_window_days int;
alter table vehicles add column if not exists idle_states_at          timestamptz;

-- Verify:
-- select unit_number, idle_states_sec, idle_states_window_days from vehicles where idle_states_sec is not null;
