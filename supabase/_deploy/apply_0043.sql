-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- MANUAL DEPLOY — learned per-truck idle capability (idle Phase 2, docs/14)
-- Copy-paste into the Supabase SQL editor and run. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
alter table vehicles add column if not exists idle_capability     text;
alter table vehicles add column if not exists idle_optimized_pct  numeric(4,1);

comment on column vehicles.idle_capability is
  'Learned from engineStates park sessions: apu | ecu_optimized | continuous_only | unknown.';

-- Verify:
-- select unit_number, idle_capability, idle_optimized_pct from vehicles where idle_capability is not null;
