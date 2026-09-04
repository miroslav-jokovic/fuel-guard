-- Silvicom 360 — 0308 finance_month_closes drops the allocation columns: the monthly close proves
-- the sweeps landed the month, and stops proving an attribution nobody makes (G7b, owner ruling
-- 2026-09-04, docs/plans/financial/FINANCE-FLEET-REPORT-PLAN.md).
--
-- What these columns were. 0306 built the close to record the per-truck report's own bucket
-- accounting for each month — what it attributed directly, what the office schedule charged, what
-- overhead it spread and what it could not, the owner-operator pool, and the residual left over —
-- and a month HARDENED only when that residual read 0.00 (D-FIN11 inside D-FIN14). That was the
-- right instrument while the report attributed cost to trucks.
--
-- Why they go. The owner ruled on 2026-09-03 that finance is a fleet report and that nothing is
-- allocated (D-FLEET1, D-FLEET8). The buckets these columns record are the allocation apparatus's
-- own, and the report stopped reading a single one of them at G7. Worse, the close was the LAST
-- live caller of that apparatus: ~1,500 lines of harness kept alive to compute one boolean about a
-- decomposition the product no longer performs.
--
-- What replaces the check, and why it is not a loss. The fleet report asserts its own tie-out on
-- EVERY request — `computeFleetReport` refuses to build a report where company + contractors do not
-- equal the ledger — so the identity these columns re-proved monthly is now guaranteed at the
-- moment a figure is produced, which is strictly stronger than a monthly re-check. What only the
-- close can prove is whether the SWEEPS landed the whole month, and those columns
-- (`settlement_drift`, `billing_drift`, `fuel_residual`) stay exactly as they are. A month now
-- hardens when it is at least two months old and all three read 0.00.
--
-- What is lost, stated plainly: the historical VALUES in these five columns for months already
-- closed. They are a record of an attribution the report no longer makes, computed under rules
-- (`overheadBasis`, the estimate deadhead basis, the per-unit schedule) that no longer exist, so
-- they cannot be recomputed or compared against anything current. `finance_month_closes` is not an
-- evidence table and is not pinned in RETENTION_FORBIDDEN; the verdict and the drift residuals —
-- the parts that still mean something — are untouched.
--
-- The deploy window (docs/MIGRATION-DISCIPLINE.md §the-deploy-window). The writer stops writing
-- these columns in the SAME merge, which is the safe direction for a drop: for the ~9 minutes
-- between Railway serving the code and migrate.yml applying this file, the new writer simply omits
-- columns that still exist and still have defaults. The dangerous ordering — a reader arriving
-- before its column — does not apply, and nothing reads these five (the Books check page that
-- displayed them went at G7).
alter table finance_month_closes drop column if exists anchored;
alter table finance_month_closes drop column if exists attributed_direct;
alter table finance_month_closes drop column if exists fixed_charged;
alter table finance_month_closes drop column if exists allocated_overhead;
alter table finance_month_closes drop column if exists unallocated_overhead;
alter table finance_month_closes drop column if exists owner_operator_pool;
alter table finance_month_closes drop column if exists cpm_residual;
