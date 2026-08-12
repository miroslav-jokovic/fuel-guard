# DEVIN HANDOFF — Idle Avoidable: prove precision end-to-end, and build the harness that keeps it proven

**Date:** 2026-08-12 · **Repo:** FuelGuard monorepo (pnpm workspaces) · **You have:** Supabase CLI + service-role DB access, full repo, pnpm.

## Why you are here

The avoidable-idle number is going in front of leadership. It must be exactly right, and we must be able
to SHOW it is right — per truck, from raw stored facts to the dollar on the card. Your job is NOT to
change the scoring semantics. It is to (1) verify every arithmetic step of the existing pipeline against
the database, (2) explain one specific on-screen discrepancy, and (3) leave behind an automated
verification harness (`pnpm verify:idle`) that fails loudly if any step ever drifts.

## Context you must not rediscover (all confirmed by audits on 2026-08-12, scripts in `scripts/`)

- Pipeline: Samsara → `vehicle_engine_days` + `idle_park_sessions` + `hos_duty_segments` +
  `driver_vehicle_assignments` → evidence syncs write `hos_*` buckets onto sessions
  (`apps/api/src/services/idleDutyEvidenceSync.ts`, evidence version `vehicle-hos-v2`) →
  `idle_rollup_days` (per truck-day, `packages/shared/src/idleRollup.ts`) → the web page sums rollup
  rows per truck and calls `computeAvoidable` (`packages/shared/src/idleAvoidable.ts`) client-side
  (`apps/web/src/features/fleet/useIdleBreakdown.ts`).
- Session duty sufficiency is 81%; 65 of 89 judgeable trucks are ≥95% duty-evidenced. The seconds-
  weighted rule (deployed 2026-08-12) judges evidenced seconds and excludes unknown/ambiguous ones;
  `confident` additionally requires coverage ≥50% of the range and ≥80% duty-evidenced share
  (`minDutyEvidencedShare`).
- CRITICAL SEMANTICS: `confident` ≠ `avoidable > 0`. resolveAlternative grants an alternative ONLY from
  admin flags (`vehicles.has_apu`, `vehicles.has_optimized_idle`) or learned `continuous_only` (which
  yields alternative "none" → idle is UNAVOIDABLE, i.e. confident with avoidable=0). Learned
  "apu"/"ecu_optimized" patterns NEVER grant an alternative (audit A1.2: telematics cannot prove a
  diesel APU). Equipment census right now: 15 has_apu=true, 22 has_optimized_idle=true, 38 has_apu=false,
  23 continuous_only, 92 unset (excluded). Do not "fix" this policy; it is deliberate.
- Diagnostic scripts that already exist and work: `scripts/idle-avoidable-audit.mjs`,
  `scripts/idle-sync-diagnose.mjs`, `scripts/idle-confidence-diagnose.mjs`,
  `scripts/scoring-overflow-diagnose.mjs`. Read them before writing new ones; extend, don't duplicate.
- Repo conventions you must follow: tests use `createSupabaseRecorder`
  (`apps/api/src/testing/supabaseRecorder.ts`) so queries are asserted, not just results; every write
  path that owns a column subset uses a set-based RPC, never a partial upsert (`pnpm lint:upserts`
  gates this in CI); services live in `apps/api/src/services/`, pure logic in `packages/shared/src/`.

## Task 1 — Explain the 60-vs-13 discrepancy with data, not theory

The fleet card says "across ~60 trucks with confident data"; the table shows only ~13 rows with
Avoidable hours > 0. Expected explanation: the other confident trucks are (a) alternative="none" →
verdict unavoidable, or (b) equipped trucks whose idle is managed/rest with avoidable=0 after grace.
Prove it: write one SQL query (Supabase CLI, read-only) that reproduces the page's per-truck
computation over the default range and outputs, per confident truck: unit, alternative, avoidable_h,
unavoidable_h, uncertain_h, managed_h. The counts MUST tie out: `confident` = card count;
`confident AND avoidable_h > 0` = number of table rows with hours. If they do not tie out exactly,
you have found a real bug — isolate which stage disagrees (rollup row vs page sum vs computeAvoidable)
and report before changing anything.

## Task 2 — Invariant verification against the live database (read-only)

Write `scripts/verify-idle-precision.mjs` (service-role, read-only, same .env convention as the other
scripts). It must check, for the trailing 30 days, and print PASS/FAIL per invariant with offending
rows named:

1. **Rollup ties to sources.** For every truck-day in `idle_rollup_days`: `drive_sec/idle_sec/off_sec/
   coverage_sec` equal the matching `vehicle_engine_days` row; `managed_idle_sec+continuous_idle_sec`
   equals the day's park-session idle split (clipped to day boundaries the way `buildIdleRollupDays`
   clips); `hos_*` bucket sums equal the day's session `hos_*` sums.
2. **Bucket algebra.** Per session: `hos_covered_sec ≤ duration_sec`; `hos_rest+hos_work+hos_driving+
   hos_excluded ≤ hos_covered (+rounding ≤1s)`; all buckets ≥ 0. Per rollup day: every `*_sec ≥ 0`;
   `continuous_idle_sec+managed_idle_sec ≤ idle_sec (+1s)`.
3. **Verdict algebra.** Recompute `computeAvoidable` for every truck over the range from rollup sums
   (import the real function — do not reimplement) and assert: `avoidable+unavoidable+justified+
   uncertain+grace = continuous (±1s)`; `avoidable ≤ continuous ≤ idle ≤ engineOn`; `avoidable = 0`
   whenever `hasAlternative = false`; cost = `avoidableH × burn × price` to the cent for the basis the
   page uses.
4. **Card/table consistency (Task 1 formalized).** confident count, avoidable-sum, and rows-with-hours
   derived here must equal what `useIdleBreakdown` produces for the same inputs. Port the sum logic or
   execute it directly (vitest with recorded fixtures is fine); byte-for-byte agreement.
5. **Freshness.** Newest `idle_rollup_days.updated_at` and newest successful `sync_idle`/`sync_hos` in
   `jobs` are < 26h old; else FAIL (stale data presented as current is a precision failure too).

## Task 3 — Deterministic regression fixtures (CI, no live DB)

Take three real trucks from the audit — one equipped-and-wasting (avoidable>0), one `continuous_only`
(confident, all unavoidable), one below the 80% evidenced bar (excluded) — snapshot their 30-day rollup
rows into fixtures, and add a vitest suite in `packages/shared` asserting the exact verdict numbers for
each (hours to 0.1h, dollars to the cent). This freezes today's verified behavior; any future change to
the math must consciously update these numbers.

## Task 4 — The precision report (what management sees)

Extend `verify-idle-precision.mjs` with `--report`: writes `docs/idle-precision-report.md` containing
run date, all invariant results, the three-truck worked examples (raw seconds → buckets → verdict →
dollars, every step shown), and the current funnel (total → covered → judgeable → confident, with the
equipment-census note that N trucks await admin confirmation). This file is the artifact Miki hands to
his bosses.

## Task 5 — Wire it in

`package.json`: `"verify:idle": "node scripts/verify-idle-precision.mjs"`. Add the Task-3 fixture suite
to the normal test run. Do NOT add the live-DB script to CI (CI has no DB creds); it is an operator
command, documented at the top of the script.

## Acceptance criteria

- Every invariant in Task 2 passes on production data, or each failure is isolated to a named stage
  with the offending rows and a one-paragraph root cause. No semantics changes without sign-off.
- Card count, table rows-with-hours, and dollar total tie out exactly, and the 60-vs-13 gap is
  explained in one sentence backed by the Task-1 query output.
- `pnpm verify:idle --report` produces the management-ready report; `pnpm -r test` green; typecheck
  no new errors (one pre-existing hazmat test error is known); `pnpm lint:upserts` green.
- Existing tests you may touch only to ADD assertions. All new code follows the recorder/test
  conventions above.

## Known open items you should NOT tackle (out of scope, listed so you don't "helpfully" change them)

- The 92 unset equipment flags (owner: Miki, via `scripts/export-equipment-worksheet.mjs` + the
  Vehicle Setup Import).
- Whether learned APU patterns should ever grant avoidability (product decision, explicitly deferred).
- The 9 trucks below the 80% evidenced bar (listed in `docs/idle-avoidable-audit.txt`).
