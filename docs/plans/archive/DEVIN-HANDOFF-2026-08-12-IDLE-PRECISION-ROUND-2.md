# DEVIN HANDOFF — Idle precision round 2: make the rollup converge to its sources

**Date:** 2026-08-12 · Follow-up to `DEVIN-HANDOFF-2026-08-12-IDLE-PRECISION.md` (round 1: harness built,
card/table tie-out proven). Round 1's verifier now correctly fails on production data. Your job is to
make invariants 1a–1d and 2b PASS by fixing DERIVATION AND LIFECYCLE — not by loosening the invariants
and not by changing scoring semantics.

## Division of labor — read first

Finding 4 from your report (the 900-second grace overage in `computeAvoidable`) is ALREADY FIXED
upstream of you: grace is now additionally capped by `continuous − justified − uncertain`
(`packages/shared/src/idleAvoidable.ts`, with two new algebra tests in `idleAvoidable.test.ts`, one
sweeping mixed partial-evidence inputs and asserting bucket sum == continuous). Rebase on latest main
before starting; the verdict-algebra check should drop from 20 offending trucks to ~0 on re-run. If
any truck still fails verdict algebra after the rebase, report it — do not patch around it.

Your scope is the remaining three findings, all in the rollup layer:

## Finding 1 — orphaned rollup rows (163 rows; invariant 1a)

`idle_rollup_days` retains truck-days whose `vehicle_engine_days` source rows no longer exist.
Likely mechanism: the rollup rebuild window (`rollupWindowDays` 35) outlives the engine-day sync
window (30) and/or engine-day stale-row deletion (`staleEngineDaysDeleted`) removes sources without a
matching rollup deletion. Diagnose the actual overlap first (which days, which trucks — your 1a
offending-row list has them), then fix the LIFECYCLE: `syncIdleRollup` must delete rollup rows whose
source day is gone, and the rebuild/source windows must be explicitly aligned (one constant, one
comment explaining the relationship — not two magic numbers that drifted apart once already).
Deletions must be org-scoped and set-based, following the repo's RPC-not-partial-upsert rules where a
new write path is needed.

## Finding 2 — rollup buckets stale vs current session facts (1,535 / 1,886 / 2,158 rows; 1b–1d)

Rollup mode splits and HOS buckets disagree with what today's `idle_park_sessions` +
`hos_evidence_*` columns say. Determine WHY before fixing: is the rebuild's diff/no-op check
(`idleRollup.ts` ~line 233, the `rowUnchanged` comparison) failing to detect changed evidence, is the
rebuild reading a narrower window than it rewrites, or are these the same orphaned-day tail as
Finding 1? Your offending-row lists make this answerable — bucket the failures by day-age and by
which columns disagree. Then fix so a completed `sync_idle`/`sync_hos` leaves rollup rows byte-equal
to a fresh derivation from sources (that is invariant 1's definition of done).

## Finding 3 — `buildIdleRollupDays` permits managed+continuous > day idle (1,322 rows; 2b)

`computeAvoidable` clamps at verdict time, so the PAGE is unaffected — but the stored rollup rows
violate their own algebra, and any future consumer that trusts them inherits the lie. Apply the same
proportional scale-down `computeAvoidable` uses (session split scaled to fit day idle) INSIDE
`buildIdleRollupDays` at build time, with a shared-package unit test mirroring the existing
"clamps classified idle to observed idle" test in `idleAvoidable.test.ts`. This is derivation
hygiene, not a semantics change — the verdict math already behaves this way.

## Acceptance

- `pnpm verify:idle` passes ALL invariants against production after one full `sync_idle` + `sync_hos`
  cycle on the fixed code (freshness, algebra, tie-outs, card/table).
- `pnpm verify:idle --report` regenerated; `docs/idle-precision-report.md` shows the clean run.
- The three live regression fixtures still pass UNCHANGED (units 754 / 688 / 646). If a fix legitimately
  changes a fixture number, stop and explain why before updating it.
- Shared + api suites green; `pnpm lint:upserts` green; no scoring-semantics changes.
- Every fix carries a WHY comment naming this incident, in the repo's documentation style.
