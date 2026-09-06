-- 0324: the nightly fuel-spend sweep gets a marker that survives a deploy.
--
-- ── THE DEFECT, MEASURED 2026-09-06 ─────────────────────────────────────────────────────────────
-- `fuelSpendRollupScheduler` is `setInterval(run, 24h)` with a deliberate "NOT run on boot" — the
-- comment's reasoning is sound in isolation: a fortnight across every org is heavy, and a deploy loop
-- would run it on every restart. What it does not survive is how often this service actually deploys.
-- `main` took between 8 and 42 merges a day over the ten days to 2026-09-06, and every merge restarts
-- the API and resets that timer. A 24-hour interval on a process that rarely lives 24 hours fires
-- approximately never.
--
-- The cost is not theoretical. C6 shipped the policy scan on 2026-09-05 and it rides this same sweep;
-- `fuel_exceptions` still holds ONE row, a `recon_missing_on_report` from 2026-09-02, and zero policy
-- findings — against a configured policy (`route_fuel_settings.avoid_states = {CA}`) and ~14,800 EFS
-- fills to scan. `fuel_spend_days`' newest derivation is 2026-09-04, which predates C6 entirely. The
-- step whose whole purpose was to give the ledger its first row has never executed.
--
-- ── WHY A COLUMN AND NOT A `jobs` ROW ───────────────────────────────────────────────────────────
-- A `jobs` row was the tempting answer: it would carry the dedupe, the observability and the
-- cross-process race guard the scheduler's own header worries about, all without a migration. It is
-- rejected because `JobKind` carries an invariant — `queue/handlers/index.ts` states that "every job
-- kind now has a single handler definition served in both modes" — and this sweep is scheduler-only
-- and has nothing to dispatch. Adding a kind with no handler to buy a timestamp trades a missing
-- column for a hole in an invariant, which is the more expensive of the two.
--
-- So it takes the shape CLAUDE.md already names as the scheduler pattern: a per-org `last_*_at`
-- dedupe, copied from `digestScheduler.ts`, whose own comment says it exists "so restarts don't
-- double-send". Same problem, same answer, one table over.
--
-- Nullable with no default and no backfill: NULL means "never swept", which is the honest state for
-- every org today and is exactly the condition that makes the first run happen. A default of now()
-- would have started every org's clock at deploy time and delayed the first sweep by a day.
--
-- The READER ships in the next merge (`lint:migration-ordering`): Railway serves a merge before
-- `migrate.yml` applies its schema, and this column's reader is the EXISTING scheduler rather than a
-- new code path, so the new-table exemption does not describe it.
--
-- Rollback: alter table organizations drop column last_fuel_sweep_at;

alter table organizations add column if not exists last_fuel_sweep_at timestamptz;

comment on column organizations.last_fuel_sweep_at is
  'When the fuel-spend rollup + policy scan last completed for this org. Written by fuelSpendRollupScheduler; NULL means never. Exists so the sweep survives a redeploy resetting its interval (0324).';
