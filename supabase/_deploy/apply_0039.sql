-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- MANUAL DEPLOY — Phase 2: learned combined tank capacity (docs/12 §B)
-- Copy-paste this whole block into the Supabase SQL editor and run it. Safe to re-run (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────

alter table vehicles add column if not exists observed_max_fill_gal numeric(6,1);

comment on column vehicles.observed_max_fill_gal is
  'Learned p95 of recent single-fill gallons ≈ true (combined, for dual-tank) capacity. Raises effective capacity above an under-entered nameplate; never lowers it. Null until enough history.';

-- Verify:
-- select id, unit_number, tank_capacity_gal, observed_max_fill_gal from vehicles order by unit_number;
