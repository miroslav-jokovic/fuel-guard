# Reorganization — Open Items & Backlog

Living record of everything deferred during the reorg (Phases 1–5) so nothing is lost. Check items off as
they're done. "Owner: you" = needs your machine / Railway / Supabase / a decision; "Owner: Claude" = code
work that can resume in a session. Plan reference: the reorganization plan (delivered separately).

Status of phases: **1 Hygiene ✓ · 2 Guardrails ✓ · 3 God-files ✓ · 4 Components (core) ✓ · 5 Worker split (code) ✓.**
CI verification of each push (full `vite build` + `vue-tsc` + suites) is the authoritative gate.

---

## A. Needs you (machine / Railway / Supabase / a decision)

- [ ] **Finish the worker split (only when scaling the API past 1 instance).** Add a second Railway
      service from this repo — start command `pnpm --filter @fuelguard/api worker`, **1 replica**, same env
      as the API — then set `RUN_SCHEDULERS_IN_PROCESS=false` on the API service. Until then, nothing to do
      (default keeps schedulers in the API process). Runbook: `docs/WORKER-DEPLOYMENT.md`.
- [ ] **Reconcile migrations & retire `supabase/_deploy/`.** Run the steps in `docs/MIGRATION-DISCIPLINE.md`
      (Supabase CLI diff → capture drift as numbered migrations → delete `_deploy/`), then update the
      `schemaCheck.ts` warning to stop pointing at `_deploy/reconcile_schema.sql`. (Owner: Claude for the
      `schemaCheck.ts` edit once you've reconciled.)
- [ ] **Infra naming decision (D-infra).** The live Railway service/URL is `fleetguardweb-production…`.
      Decide: rename it to a FuelGuard URL (touches invite links, `ALLOWED_ORIGINS`, Supabase redirect URLs
      — user-visible) or keep the existing URL. Currently **kept** (docs left intact on purpose).
- [ ] **Move the repo out of `~/Documents` (iCloud).** iCloud sync created duplicated `node_modules` bins
      (`vitest 2`, `tsc 3`). Move to e.g. `~/Projects/FuelGuard`, reconnect the folder, then a clean
      `pnpm install`.
- [ ] **Delete leftover scratch on your machine.** `git rm -r _probes` (4 throwaway diagnostic scripts, if
      unwanted); `rm -rf _to_delete` (cloud-mount scratch — already gitignored); `git gc` to clear the
      `.git/objects/tmp_obj_*` cruft the cloud mount couldn't delete.
- [ ] **Visual smoke-test after deploy/preview:** the Alerts **detail panel** (AnomalyDetail) and the
      **Idling** page — the two components whose logic moved to composables (templates unchanged, but a
      30-second look confirms it).
- [ ] **Trademark check.** "Fleetguard" is a Cummins brand; you chose **FuelGuard** (good). Do a clearance
      check before heavy branding spend on the name.

## B. Code — deferred until a prerequisite is met (Owner: Claude)

- [x] **`scoring/scoreTransaction.ts` — DONE (b3c950c, 68bee10, 2d18910).** Test-then-split: built a fake
      Supabase admin harness + 5 characterization tests (clean fill, missing row, overfill→theft-case,
      supersede-stale-case, refresh-in-place) FIRST, then extracted the ~160-line Samsara-reconciliation
      block into `scoring/reconcile.ts` (`resolveReconciliation`). File 599→463 lines; grandfather list now
      empty. Behavior-preserving — the 5 tests + full api suite (120) stayed green throughout.
- [ ] **Wire the RLS test into CI.** `supabase/tests/rls.test.mjs` exists but isn't a required CI job; it
      needs a Supabase test-DB connection secret in CI.
- [x] **Tighten the module-boundary rule — DONE (9ca4ee6, see progress log B3).** Shared composables moved
      to `@/composables`; `scripts/check-feature-boundaries.mjs` fitness function wired into CI.

## C. Remaining plan phases (not started)

- [ ] **Phase 4 leftovers (optional, lower value):** decompose `DashboardPage.vue` (400, already partly on a
      `useDashboard` composable), `AppShell.vue` (377, layout), `AnomaliesPage.vue` (353).
- [~] **Phase 6 — high-growth data review — STATIC PASS DONE (this session).** Cross-checked every hot
      query (anomaly queue, fuel log, dashboard, idle, driver, vehicle-detail, scoring backfill) against
      existing indexes — schema is already `org_id`-anchored and almost fully covered. Found 2 real gaps →
      `supabase/migrations/0066_index_coverage.sql` (anomaly status-tab sort; driver-filtered fuel log) and
      wrote `docs/plans/PHASE-6-DATA-REVIEW.md` (full cross-check table, EXPLAIN runbook, retention/rollup
      plan for `idle_events` / `route_geometries` / `fuel_prices_posted`, 3 measure-first optional indexes).
      **USER-GATED remainder:** run the EXPLAIN runbook on a scale-sized tenant to confirm the 2 gaps + decide
      the 3 optional items; adopt the retention policy before those tables get large. `0066` on a live DB
      should be applied with `CREATE INDEX CONCURRENTLY` (see runbook §"Applying on a live DB").
- [~] **Phase 7 — YAML SSOT + codegen — PROVEN ON ONE MODULE (this session).** Built the pattern on the
      anomaly rule catalog: `catalog.yaml` (SSOT) → `scripts/gen-rule-catalog.mjs` (dependency-free) →
      `catalog.generated.ts`; `ids.ts`/`cases.ts` now consume it, logic stays hand-authored. `pnpm gen:rules`
      + `lint:codegen` drift guard. Byte-identical to prior constants; 636 shared + 120 api tests green, all
      packages typecheck. See `docs/plans/PHASE-7-SSOT-CODEGEN.md`. **TWO follow-ups for you:** (1) add the
      `Codegen up-to-date` step to `.github/workflows/ci.yml` (protected file — snippet in the doc); run
      `pnpm install` is NOT needed (no new deps). (2) Extend the recipe to the next module when ready —
      detection thresholds is the best next candidate (zod schema + defaults + type from `thresholds.yaml`).

## D. Guardrail hygiene (ongoing)

- [x] The file-size grandfather list in `scripts/check-file-size.mjs` is now **empty** (0 entries) — every
      source file is under the 500-line budget. The list may only ever grow by deliberate, documented choice.
- [ ] Design tokens: `DashboardPage` had 5 hardcoded colors (fixed + linter now enforced in CI). Watch for
      new ones as charts are added — CI blocks them.

---

## Done in this effort (for reference)
Phase 1: root docs → `docs/plans/`, comment pointers fixed, name normalized to FuelGuard. ·
Phase 2: file-size guardrail, design-token CI enforcement, **lint made meaningful (was red on ~7k lines of
vendor noise)**, route-auth fitness test, `@fuelguard/shared` barrel boundary rule, migration runbook. ·
Phase 3: split all four god-files (efsImport, anomalyRules, scoring, samsara) verbatim behind identical
barrels — grandfather list 4 → 1; 636 shared + 115 api tests green throughout. ·
Phase 4: AnomalyDetail (485→340) + IdlingPage (428→242) logic → composables, templates byte-identical. ·
Phase 5: schedulers → worker process behind `RUN_SCHEDULERS_IN_PROCESS`.

---

## Progress log (skipped-item cleanup)

- **B3 cross-feature boundary — DONE (9ca4ee6).** Moved `useVehicles`/`useDrivers`/`useOrgSettings` to
  `@/composables` (updated 18 importers); added `scripts/check-feature-boundaries.mjs` + CI step (a
  fitness function that blocks new cross-feature imports; `anomalies -> ai` allowlisted). `useTrailers`
  stays in `features/fleet` — only reached via pages, so no violation.
- **Phase 4 leftovers — partially done.** AnomaliesPage DONE (361a7f3): 353→168 + `useAnomaliesPage`
  (placed in `pages/` since it orchestrates across features). **DashboardPage: intentionally skipped** —
  its script is view-configuration (chart specs + KPI-tile definitions), already under the 500-line budget
  and already delegating data to `useDashboard`; extracting it would move view code away from the view
  with no maintainability gain. AppShell (layout) similarly not worth decomposing.
- **`scoreTransaction` (B1) — DONE (b3c950c → 68bee10 → 2d18910).** Test-then-split, in that order:
  (1) a reusable fake Supabase admin query-builder harness + 2 characterization tests on the `skipRecon`
  rebuild path (clean fill; missing row); (2) expanded to 5 — overfill fires a `theft_case` and flags the
  row (`has_anomaly`/`max_severity`), a stale open case is superseded when the fill re-scores clean, and an
  open case is refreshed in place (no duplicate) when the same signal re-fires; (3) extracted the
  ~160-line Samsara-reconciliation block (rebuild passthrough + live reconcile + wrong-station-pin
  suppression) into `scoring/reconcile.ts` as `resolveReconciliation`, which also applies the
  telematics-recovered instant to `txn` in memory. `scoreTransaction.ts` 599→463 lines; the file-size
  grandfather list is now empty. tsc + eslint clean and all 120 api tests green throughout. `learnVehicleValues`
  stayed in `scoreTransaction.ts` (still comfortably under budget); it can move to a `learn.ts` sibling later
  if that file grows.
