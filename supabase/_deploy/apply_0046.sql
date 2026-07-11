-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- MANUAL DEPLOY — manual APU / idle-reduction attribute (idle Phase B)
-- Copy-paste into the Supabase SQL editor and run. Idempotent.
--
-- Adds the manual source-of-truth for the idle "avoidable" logic. A diesel APU is off the J1939 bus and can't
-- be reliably detected from telematics, so an admin sets it per truck. The learned idle_capability becomes a
-- cross-check. After running: set Has APU on the Vehicles page, then Rebuild to refresh the avoidable list.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
alter table vehicles add column if not exists has_apu  boolean;
alter table vehicles add column if not exists apu_type text;

-- Verify:
-- select unit_number, has_apu, idle_capability from vehicles order by unit_number;
