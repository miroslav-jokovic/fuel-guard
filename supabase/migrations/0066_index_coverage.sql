-- Phase 6 (high-growth data review): index coverage for the hot read paths.
--
-- Static analysis of every hot query (anomaly queue, fuel log, dashboard, idle, driver, vehicle-detail)
-- against the existing indexes found two real gaps where a filter or sort is NOT index-backed and would
-- degrade to a Sort / Seq-Scan once a tenant has hundreds of thousands of rows. Everything else is already
-- covered by an org_id-leading composite (see docs/plans/PHASE-6-DATA-REVIEW.md for the full cross-check).
--
-- NOTE ON LOCKING: a plain CREATE INDEX takes an ACCESS EXCLUSIVE-ish lock that blocks writes to the table
-- while it builds. On an empty / small dev DB (where these `if not exists` statements are no-ops after the
-- first apply) that is fine. On a PRODUCTION table that already holds real data, build these with
-- CREATE INDEX CONCURRENTLY instead, run OUTSIDE a transaction (psql, not inside this migration wrapper) —
-- see the runbook in PHASE-6-DATA-REVIEW.md §"Applying on a live DB". The bodies below are written the
-- Supabase-migration way (transactional, plain CREATE) to match the existing 0001–0065 convention.

-- ── 1. Anomaly queue, status-tab views (HIGH — the most-viewed screen) ───────────────────────────────
-- useAnomalies filters `status = <tab>` (open / investigating / resolved / dismissed) and sorts
-- `fueled_at DESC`. Today idx_anomalies_org_status (org_id, status) satisfies the equality but NOT the
-- sort, so Postgres materializes the matching rows and Sorts them by fueled_at every time a tab is opened.
-- This composite serves filter + sort from the index (no Sort node), bounded by the LIMIT 500.
create index if not exists idx_anomalies_org_status_fueled
  on anomalies (org_id, status, fueled_at desc);

-- idx_anomalies_org_status (org_id, status) is now a strict PREFIX of the index above, so it can no longer
-- do anything the new one can't — drop it to avoid maintaining two overlapping indexes on every write.
-- (Safe: any planner use of (org_id) or (org_id, status) is served by the superset index.)
drop index if exists idx_anomalies_org_status;

-- ── 2. Driver-filtered fuel log / driver detail (MEDIUM) ─────────────────────────────────────────────
-- useFuelLog supports `driver_id = ?` + sort `fueled_at DESC`, and the driver views page the fuel log by
-- driver. There is currently NO index that leads with driver_id on fuel_transactions (only vehicle_id and
-- org_id/card variants), so a driver filter falls back to scanning the org's fills by date and discarding
-- non-matching drivers. Partial (driver_id IS NOT NULL) keeps it off the many driver-less rows.
create index if not exists idx_ftxn_org_driver_time
  on fuel_transactions (org_id, driver_id, fueled_at desc)
  where driver_id is not null;

-- ── Deliberately NOT added here (measure first) ──────────────────────────────────────────────────────
-- The following are plausible but speculative; adding an index that the planner never picks is pure write
-- overhead. Each is documented with an EXPLAIN trigger in PHASE-6-DATA-REVIEW.md and should only be added
-- if that measurement shows the cost:
--   • Partial active-queue index  anomalies (org_id, fueled_at desc) WHERE status <> 'superseded'
--       — only if the DEFAULT (no-tab) queue is slow because rebuild churn leaves many superseded rows.
--   • anomalies (org_id, vehicle_id, created_at desc)
--       — only if the vehicle-detail anomaly history is slow (per-vehicle anomaly counts are usually tiny).
--   • The scoreTransaction write-path prev/window reads omit org_id (service-role, RLS bypassed), which
--       makes idx_ftxn_vehicle_tank (org_id-leading) unusable; they use idx_ftxn_vehicle_time today. The
--       fix is a code change (add .eq("org_id", orgId)), not a new index — see the runbook.
