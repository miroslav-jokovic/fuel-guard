# Re-sync Hardening — Enterprise-Grade, Non-Interrupting, Precise

**Goal:** make telematics re-sync fast, resumable, observable, and safe to run in the background of a paid multi-tenant service — without ever silently producing wrong/blind results. Grounded in the actual code (file:line refs), no assumptions.

## A. Why the last re-sync took ~3 h and why it interrupts service

All verified in code:
- **Strictly sequential.** `backfillOrg` (scoring.ts:601) runs `for (const id of ids) await scoreTransaction(...)` — one fill at a time, ~2,400 in series.
- **Per-fill Samsara history fetch, no dedup.** Each fill fetches its vehicle's GPS/fuel history over a 36–60 h window, paginated up to 40 pages (samsara.ts `MAX_STATS_PAGES`). Two fills for the same truck the same day re-fetch the overlapping window. With the decoration bug these 400'd instantly (hiding the cost); once fixed, the pagination *actually runs*, so the same run gets **slower**.
- **Shared single-cadence rate limiter = the service-interruption mechanism.** `samsaraFetch` paces ALL callers to one per-token cadence at `SAMSARA_MAX_RPS` (default **5**, env.ts:47). A backfill and the live 20-min stats sync draw from the *same* 5 req/s budget, so a heavy backfill starves live sync — live data goes stale during a re-sync. (samsaraHttp.ts `reserveSlot`.)
- **N+1 per-org queries.** `scoreTransaction` re-loads thresholds, operating hours, and the Samsara token *per fill* (scoring.ts loadThresholds/loadOperatingHours; reconcile loadSamsaraToken) — ~7k redundant round trips, plus ~10 scoring-context queries per fill (prev/anoms/window/card/trailer rows), ~30k sequential DB round trips total.
- **`full` scope reprocesses all history** (transactions.ts:240) even when only new rows need it.
- **Failures are silent.** `reconcileWithSamsara(...).catch(() => null)` (scoring.ts:292) treats a Samsara *error* identically to "no data" — which is exactly how a 400 became an invisible fleet-wide 0% (the decoration bug). This is the reliability defect that matters most for a paid product.

## B. Correctness landmine (must respect)

`matchFuelingStop` (shared/samsara.ts:367) and `findFuelingEvent` (:487) reason over the **entire** sample array passed in — `inStateAny = samples.some(...)`, "biggest/best rise across all readings," mismatch-coverage counts over all samples. They are correct today only because reconcile feeds them a single fill's window. **Any dedup that fetches a wider per-vehicle window MUST slice samples + fuel readings back to that fill's `[center−winMs, center+winMs]` window before matching.** Behavior-preserving; skip it and location/tank matching breaks.

## C. Fixes (staged; each with change, risk, test)

### Stage 1 — Safety & observability (deploy first; low risk)
**F1. Never hide a telematics failure.** Make `reconcileWithSamsara` throw a distinct `SamsaraUnavailableError` on a *fetch* failure (network/4xx/5xx after retries), while still returning `null` for legitimate "no data / not mapped." In `scoreTransaction`, catch that error, record `reconFailed`, and leave the row untouched (don't stamp it reconciled). `backfillOrg` counts failures and **aborts loudly** if the first N calls (e.g. 20) all fail — a systemic outage (bad token/scope/param) surfaces immediately instead of writing thousands of blind rows. Surface counts in the job result + a health row.
- *Risk:* low, contained. *Test:* fetcher that 400s → run aborts with error; fetcher returning empty data → treated as no-data (row not failed).

**F2. Hoist per-org context.** Load thresholds, operating hours, and Samsara token **once per run**, pass into `scoreTransaction` via an optional `ctx`. Backward compatible (load if absent).
- *Risk:* low (same values). *Test:* existing scoring tests stay green; add a call-count assertion.

### Stage 2 — Performance (the speed win)
**F3. Fetch once per (vehicle, time-bucket), slice per fill.** Ids are already ordered by vehicle then time (collectTxnIds). Group consecutive fills whose windows overlap into one fetch covering their union; pass the pre-fetched raw into reconcile via a new optional `prefetchedRaw`; reconcile parses once and **slices to each fill's window** (per §B) before matching. Collapses ~2,400 window-fetches → roughly one per vehicle-day.
- *Risk:* medium (touches recon hot path). *Test:* golden fills — result identical with prefetched vs per-fill fetch; window-slice unit test.

**F4. Concurrency within a rate budget.** Process vehicle-buckets with bounded concurrency (e.g. p-limit 4–8). Throughput is still capped by the limiter, so pair with F5.

### Stage 3 — Non-interruption & resumability (the "paid customers" requirements)
**F5. Two-tier rate budget (live > backfill).** Split the token cadence: live sync/recon get priority; backfill uses only leftover headroom (e.g. reserve ~60% of `SAMSARA_MAX_RPS` for live, cap backfill at the rest), so a re-sync can never starve live data. Raise `SAMSARA_MAX_RPS` toward Samsara's real limits (stats endpoint 50/s, 150/s token) to give both room. Implement as a priority arg to `reserveSlot`.
- *Risk:* medium; *Test:* interleave live+backfill calls, assert live latency bounded.

**F6. Resumable + cancellable.** Default re-sync to `onlyUnreconciled` (checkpoint = `samsara_recon_at`), so a crash/restart resumes where it stopped and a re-run is cheap. Honor a job-cancellation flag between buckets; commit progress incrementally (already `report` every 50). Make it idempotent (re-running yields the same result).
- *Risk:* low–medium; *Test:* kill mid-run → resume processes only the remainder.

### Stage 4 — Precision (original odometer intent, done right)
**F7. GPS odometer as a TYPE.** Request `types=gps,fuelPercents,gpsOdometerMeters` (≤3 allowed) and merge the gpsOdometerMeters series into GPS samples by timestamp in `parseSamsaraSamples`, used as fallback when the OBD decoration is absent — so trucks without ECU odometer get verified. (NOT as a decoration — that's the bug just fixed.)
- *Risk:* medium (parser change); *Test:* merge-by-timestamp unit tests; OBD-present still prefers OBD.

## D. Verification (no regressions to the fraud core)
- All existing recon/scoring/samsara tests stay green.
- Golden-fill set: for a fixed set of fills, output is **byte-identical** before vs after F2/F3 (proves perf changes don't alter scoring).
- New tests per fix above. Property: a re-run over already-reconciled rows changes nothing (idempotent).
- Dry-run on a copy/one org before enabling for all tenants.

## E. Rollout order / status
1. ✅ **DONE:** decoration fix (obdOdometerMeters only).
2. ✅ **DONE — F1** (loud failure + abort guard) and **F2** (hoisted per-org context). Tested.
3. ✅ **DONE — F3** (fetch once per vehicle-bucket, per-fill window slice). Tested incl. the landmine regression (prefetched == per-fill; out-of-window decoy ignored).
4. ✅ **DONE — F4** bounded concurrency: a per-vehicle worker pool (`SAMSARA_BACKFILL_CONCURRENCY=4`) overlaps fetch latency + DB writes; sequential within a vehicle (order-safe), parallel across vehicles; abort/cancel shared. Tested.
5. ✅ **DONE — F5** two-tier rate budget (live reserved 60% via `SAMSARA_LIVE_RPS_FRACTION=0.6`; `SAMSARA_MAX_RPS` 5→20; backfill on its own lane) and **F6** resumable (onlyUnreconciled + `samsara_recon_at` checkpoint + incremental commits) + cancellable (cooperative `stats.cancel_requested`, `POST /jobs/cancel`, polled per vehicle). No DB migration needed. Tested.
6. ✅ **DONE — F7** GPS-odometer as a stat TYPE (`types=gps,fuelPercents,gpsOdometerMeters`), merged into samples by nearest time so non-ECU trucks get a verified odometer; OBD still preferred. Tested.

**All changes: 93/93 API + 54/54 shared tests green, typecheck clean. Every hardening item (F1–F7) is complete.** New env: `SAMSARA_MAX_RPS`(20), `SAMSARA_LIVE_RPS_FRACTION`(0.6), `SAMSARA_BACKFILL_CONCURRENCY`(4). Follow-up UI (optional): a "Cancel" button on Data & Sync calling `POST /jobs/cancel {kind:"backfill"}` (backend ready).

Decisions needed before Stage 3: the live/backfill rate split (default: reserve 60% live) and target `SAMSARA_MAX_RPS` (recommend raising 5 → 20–25, well under Samsara's 50/s stats limit).
