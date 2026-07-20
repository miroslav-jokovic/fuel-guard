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

- [ ] **`scoring/scoreTransaction.ts` (~600 lines) is the last grandfathered god-file.** Correct sequence:
      add tests for `scoreTransaction`/`learnVehicleValues` FIRST (they're essentially untested), then
      decompose. Do not refactor it blind.
- [ ] **Wire the RLS test into CI.** `supabase/tests/rls.test.mjs` exists but isn't a required CI job; it
      needs a Supabase test-DB connection secret in CI.
- [ ] **Tighten the module-boundary rule.** Web features currently reach into siblings
      (`anomalies→fleet/ai/settings`, `dashboard→fleet/settings`, `fueling→fleet`). Extract the shared
      composables (`useVehicles`, `useDrivers`, `useOrgSettings`) to a common location, THEN extend the
      ESLint `no-restricted-imports` rule to block cross-feature reach-ins. (Today it only blocks deep
      `@fuelguard/shared` imports — zero violations.)

## C. Remaining plan phases (not started)

- [ ] **Phase 4 leftovers (optional, lower value):** decompose `DashboardPage.vue` (400, already partly on a
      `useDashboard` composable), `AppShell.vue` (377, layout), `AnomaliesPage.vue` (353).
- [ ] **Phase 6 — high-growth data review:** `EXPLAIN ANALYZE` the hot queries (anomaly list, fuel log,
      dashboard aggregates, reconcile) on a scale-sized dataset; add composite indexes only where a seq-scan
      shows up (core tables are already well-indexed); decide a retention/rollup policy for the highest-volume
      tables (`idle_events`, `route_geometries`).
- [ ] **Phase 7 — YAML SSOT + codegen:** the consistency layer (generate contracts/types/scaffolding from a
      single source of truth; business logic stays hand-authored). Prereq: Phases 1–6 landed. Prove on one
      module first.

## D. Guardrail hygiene (ongoing)

- [ ] The file-size grandfather list in `scripts/check-file-size.mjs` may only **shrink** — currently 1
      entry (`scoring/scoreTransaction.ts`). Removing it happens in item B-1.
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
- **`scoreTransaction` (B1) — NOT started, by design.** It is ~600 lines orchestrating Supabase + Samsara
  + anomaly persistence with near-zero test coverage. Shallow characterization tests would give false
  confidence on the most critical path. Correct approach (its own focused session): build a full fake
  Supabase admin + Samsara mock, characterize the `skipRecon` (rebuild) path first, then the live-recon
  path, verify green against current behavior, THEN split — keeping tests green. Remains the sole
  grandfathered file in `scripts/check-file-size.mjs`.
