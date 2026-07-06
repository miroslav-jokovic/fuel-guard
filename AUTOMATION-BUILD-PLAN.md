# Automation & Freshness — Build Plan (execution)
**Date:** 2026-07-06 · Companion to *Automation & Freshness Plan* and *DATA-RELIABILITY-CHANGES.md*.
**How we work this:** one chunk per response. Each chunk is self-contained, verified (typecheck + tests + lint), and left **uncommitted** for you to deploy. Nothing here changes infrastructure — everything runs in-process on the single Railway instance, as today.

Legend: ☐ not started · ◐ in progress · ☑ done

---

## Guiding decisions (locked)
- **`fueled_at` is never rewritten** (business time; migration 0026). All recovered instants live in `samsara_recon_at` / in-memory `eventAt`.
- **Do not commit** — every chunk ends uncommitted; you deploy + run SQL.
- **DB-enforced coordination**, not in-memory flags: the `jobs` table's partial unique index prevents duplicate concurrent runs.
- **Safety before frequency**: rate-limited Samsara client lands before we increase sync cadence.
- **One reorg, no rework**: the Vehicles/Anomalies button move happens *after* the jobs table exists, so the new Settings page shows real progress/freshness from day one.

---

## Chunk 1 — Jobs table backbone  ☑ (2026-07-06, uncommitted)
The spine everything hangs off.
- **Migration `0027_jobs.sql`** (+ fold into `reconcile_schema.sql`): `jobs(id, org_id, kind, status[queued|running|done|failed], progress int, total int, started_at, finished_at, error text, stats jsonb, requested_by, created_at)`. Partial unique index `(org_id, kind) where status in ('queued','running')`. RLS: org members read; service-role writes.
- **API `services/jobs.ts`**: `startJob(kind, {total, requestedBy})` → returns id or throws on duplicate (23505 → friendly "already running"); `updateJob(id, {progress})`; `finishJob(id, {status, error, stats})`; `latestJob(orgId, kind)`. A `runJob(kind, fn)` wrapper that guarantees finish/fail even on throw.
- **Wire existing ops through it (no behavior change yet):** `rebuild`, `backfill`, `score-import` cascade, `sync-vehicles` write start/progress/finish. Endpoints return the job id.
- **Web `useJob(kind)` hook**: polls `latestJob` (~5s while running), exposes `{ status, progress, total, freshnessLabel, isRunning, error }`.
- **Verify:** api typecheck; jobs service unit tests (duplicate-run rejection, finish-on-throw); lint.

## Chunk 2 — Central rate-limited Samsara client  ☑ (2026-07-06, uncommitted)
Safety before frequency.
- **`lib/samsaraClient.ts`**: single wrapper for every Samsara call (sync, recon, diagnostics). 429/`Retry-After` honoring, exponential backoff + jitter, bounded retries. Per-org-token **token bucket** (default 5 req/s, `SAMSARA_MAX_RPS`) shared across schedulers + recon so a backfill can't starve live stats. Exhausted retries → throw (job fails visibly) instead of returning null.
- Refactor `lib/samsara.ts` fetchers + `samsaraRecon` + `samsaraVehicleSync` to go through it.
- **Env:** `SAMSARA_MAX_RPS=5`, `SAMSARA_MAX_RETRIES=4`.
- **Verify:** unit tests for backoff math + bucket pacing (fake timers); typecheck; lint.

## Chunk 3 — Tiered schedulers  ☑ (2026-07-06, uncommitted)
Split the one 6h loop into independently scheduled jobs.
- **Live stats** (odometer + fuel %): every `SAMSARA_STATS_SYNC_MINUTES=20`.
- **Identity** (vehicles, drivers, assignments): every `SAMSARA_IDENTITY_SYNC_HOURS=12`.
- Both run through jobs + the rate-limited client; orgs staggered; single-flight per org kept.
- Retire the monolithic `SAMSARA_SYNC_HOURS` loop (keep the env as a deprecated alias for a release).
- **Verify:** scheduler unit tests (tier cadence selection); typecheck; lint.

## Chunk 4 — Kill the manual rebuild  ☑ (2026-07-06, uncommitted)
- **Auto-cascade after import**: after `score-import`, automatically re-score the affected vehicles' neighboring fills (scoped, not full-org), through a `jobs` entry. Remove the "Tip: run Rebuild" toast.
- **Nightly reconcile job** (per org, ~03:00 org-local): `sync-from-efs` repair → quick rebuild (skipRecon) → integrity check (per-day store-vs-events diff) → result to `jobs.stats`.
- **Verify:** cascade scoping test (only affected vehicles); nightly job assembles + records stats; typecheck; lint.

## Chunk 5 — Settings → Data & Sync page + clean pages  ☑ (2026-07-06, uncommitted)  ← the visible reorg
- **New page `/settings/data`** (card added to `SettingsPage.vue`): houses **Sync from Samsara**, **Re-sync Samsara** (backfill), **Rebuild anomalies**, each with a freshness chip ("as of 14:32 · auto every 20 min") and a real progress bar from `useJob`. Buttons disable for **all** users while a run is active; failures show a red "last run failed — retry" chip.
- **Remove** those buttons from `VehiclesPage.vue` and `AnomaliesPage.vue`; leave a small "Managed in Settings → Data & Sync" hint. Keep AI-triage where it is (case workflow, not sync).
- **Vue Query `refetchInterval`** (~60s) on vehicles/drivers/dashboard so scheduler results appear without reload.
- **Verify:** web typecheck; lint; screenshot check of the three pages.

## Chunk 6 — Reports / digest additions  ☑ (2026-07-06, uncommitted)
- Add integrity summary (drift count, sync failures in the last 7d from `jobs`) to the existing weekly digest.
- Odometer-accuracy / summary.pdf stay on-demand (cheap reads) — no change.
- **Verify:** digest aggregation test includes the new fields; typecheck; lint.

---

## Cross-cutting verification (every chunk)
`packages/shared` vitest · `apps/api` tsc + vitest · `apps/web` vue-tsc · eslint on changed files. Leave uncommitted.

## Deploy checklist (accumulates)
- Run new migrations (`0027_jobs`, …) or the updated `reconcile_schema.sql`.
- New env vars: `SAMSARA_MAX_RPS`, `SAMSARA_MAX_RETRIES`, `SAMSARA_STATS_SYNC_MINUTES`, `SAMSARA_IDENTITY_SYNC_HOURS`.
- After deploy: schedulers self-start; first nightly reconcile runs ~03:00 org-local.
