-- ────────────────────────────────────────────────────────────────────
-- MANUAL DEPLOY — split APU from OEM Optimized Idle (idle Phase B follow-up)
-- Copy-paste into the Supabase SQL editor and run. Idempotent.
--
-- has_apu (0046) conflated a real APU with Freightliner Cascadia "Optimized Idle". They score differently, so
-- Optimized Idle gets its own flag; apu_type (already present from 0046) is now used by the app for the
-- equipment detail. After running: set each truck's equipment + Optimized Idle on the Vehicles page, then
-- Rebuild to refresh the idle scorecard.
-- ────────────────────────────────────────────────────────────────────
alter table vehicles add column if not exists has_optimized_idle boolean;

-- Verify:
-- select unit_number, has_apu, apu_type, has_optimized_idle, idle_capability from vehicles order by unit_number;
