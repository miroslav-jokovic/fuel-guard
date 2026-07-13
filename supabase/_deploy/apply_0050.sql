-- ────────────────────────────────────────────────────────────────────
-- MANUAL DEPLOY — resolved idle gallons per event (CP3)
-- Copy-paste into the Supabase SQL editor and run. Idempotent.
--
-- Stores the gallons actually used for the idle cost (measured when Samsara reports it, else the learned
-- per-truck / temperature estimate) so cost and gallon figures are precise and agree. After running, the next
-- idle sync populates idle_gal.
-- ────────────────────────────────────────────────────────────────────
alter table idle_events add column if not exists idle_gal numeric(9,3);

-- Verify:
-- select count(*) filter (where fuel_gal is not null) as measured, count(*) as total from idle_events;
