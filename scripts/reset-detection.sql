-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- RESET DETECTION — pre-launch clean slate (run ONCE, then a full rebuild).
--
-- Deletes every alert and clears all per-fill detection outcomes and learned per-vehicle values,
-- so the next rebuild scores the entire history purely under the new system (WP-CAP measured
-- capacity, WP-ATTR logbook attribution, WP-BEH behavioral hardening — migrations 0118–0121).
--
-- WHAT IT KEEPS (deliberately):
--   • All Samsara reconciliation data on fills (samsara_* columns, station pins, tank percentages,
--     recovered times) — the rebuild reuses these (skipRecon), so nothing re-hits the Samsara API.
--   • Manually-entered values: tank_capacity_gal stays; a 'manual' odometer offset stays.
--   • HOS duty segments (the logbook timeline) and all raw EFS data.
--
-- WHAT IT DESTROYS (accept before running):
--   • Every anomalies row, INCLUDING reviewer dispositions (the precision ground truth). Fine
--     pre-launch; never run this once customers are labeling alerts.
--
-- ORDER OF OPERATIONS (the whole procedure):
--   1. Apply migrations first:  supabase db push   (0118..0121 MUST be live — without them the
--      scorer's select fails and a rebuild silently re-scores NOTHING, which is why old alerts
--      survived the previous rebuild.)
--   2. Run this script (Supabase SQL editor or psql).
--   3. Sync the logbook history once:  POST /integrations/samsara/sync-hos with a deep window
--      (or the Settings → Data sync button), so hos_duty_segments carry per-log vehicles.
--   4. Full rebuild:  POST /transactions/rebuild with an empty body ({} — no sinceDays) for the
--      unbounded full-history pass. Watch it complete on the jobs ledger.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

begin;

-- 1) Alerts: everything goes (open, superseded, resolved — full clean slate).
delete from anomalies;

-- 2) Per-fill detection outcomes → cleared. Samsara recon columns are NOT touched.
update fuel_transactions set
  has_anomaly         = false,
  max_severity        = null,
  case_level          = null,
  case_score          = null,
  case_signals        = null,
  case_gates          = null,
  attribution_verdict = null,
  logbook_vehicle_id  = null;

-- 3) Learned per-vehicle values → relearned from scratch under the new logic during the rebuild's
--    learn pre-pass. Manual entries are preserved.
update vehicles set
  sensor_capacity_gal     = null,
  sensor_capacity_samples = null,
  tank_residual_sigma     = null,
  observed_max_fill_gal   = null,
  tank_sensor_reliable    = false,
  tank_fill_ratio         = null,
  baseline_mpg            = null;

-- Auto-learned odometer offsets reset; human-set ones kept.
update vehicles set odometer_offset = 0
where odometer_offset_source is distinct from 'manual';

commit;
