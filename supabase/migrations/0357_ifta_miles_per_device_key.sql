-- 0357 — a wider IFTA unique key that names the DEVICE, added beside the old one. Nothing reads it yet.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
-- `samsara_ifta_jurisdiction_miles` is keyed (org, vehicle, year, month, jurisdiction), which assumes
-- one Samsara device per truck per month. A gateway swap breaks that, and unit 732 is the live case
-- (FLEET-CENSUS-AND-IDLE-TRUTH-PLAN.md Q-9, §1.7a): its gateway was replaced on 2026-08-24, so
-- August's miles come from TWO devices. Today they sit on two `vehicles` rows, one per device, and
-- are correct. Q-9 merges those rows into one — and under this key, the next IFTA re-fetch of
-- August (`monthsToSync` re-reads the last three closed months) would UPSERT the new device's eight
-- days over the old device's twenty-four, and a tax filing would lose three weeks of one truck's
-- miles without an error. Every reader SUMS rows per vehicle and per jurisdiction
-- (`samsaraIftaReads.ts`, `ifta_period_jurisdictions`), so one row per device changes no total.
--
-- ── WHY ONLY THE INDEX, AND WHY IN ITS OWN MERGE ────────────────────────────────────────────────
-- Railway serves a merge before `migrate.yml` applies its schema (docs/MIGRATION-DISCIPLINE.md
-- §the-deploy-window, 2m44s). The upsert that names this key (`onConflict` in `samsaraIftaSync.ts`)
-- fails with 42P10 if it is served before the index exists, so the index lands first and the writer
-- follows in the next merge, which also drops `samsara_ifta_miles_unique`. Until then both hold, and
-- the wide key is implied by the narrow one, so it can refuse nothing the narrow one allows.
-- `samsara_vehicle_id` is NOT NULL on this table (0255), so no NULL can slip past the key.

create unique index if not exists uq_samsara_ifta_miles_device
  on public.samsara_ifta_jurisdiction_miles
  (org_id, vehicle_id, samsara_vehicle_id, period_year, period_month, jurisdiction);
