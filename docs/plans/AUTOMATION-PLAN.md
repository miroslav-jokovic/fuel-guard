# Automation & Freshness Plan — Samsara sync + Anomaly rebuild

**Date:** 2026-07-06 · Analysis only, no code changed. Companion to DATA-RELIABILITY-CHANGES.md.

## What exists today

**Samsara sync.** A background scheduler (`samsaraScheduler.ts`) already runs every `SAMSARA_SYNC_HOURS` (default 6h): drivers → vehicles → current odometer + fuel % → driver assignments, per org, sequential. On top of that, Vehicles and Drivers pages have manual "Sync from Samsara" buttons (admin-only endpoints). Per-transaction GPS reconciliation happens on demand during scoring.

**Rebuild.** A manual "Rebuild" button on the Anomalies page (`POST /transactions/rebuild`, background, skipRecon), a rebuild-on-boot after each deploy, and a toast after every import telling the user to go click Rebuild manually. A weekly digest scheduler exists for email reports.

## The problems

1. **One cadence for everything.** Identity data (trucks, drivers) changes weekly; odometer/fuel-level change constantly. A single 6h loop makes live stats stale for hours while re-fetching identity data far more often than needed.
2. **No rate-limit handling anywhere.** No 429/Retry-After handling, no backoff, no request budget. Today it works because volume is low; an org with 188 trucks doing a deep re-scoring plus a sync can hit Samsara's per-token limits and fail silently (recon returns null → "unknown" location confidence).
3. **Freshness is invisible.** `integration_credentials.last_synced_at` is stored but pages don't show it. Users can't tell stale from fresh, so they click Sync "just in case" — the button IS the freshness mechanism right now.
4. **Manual rebuild is a chore that shouldn't exist.** Importing a file changes MPG baselines for neighboring fills, so we tell the user to go press Rebuild. That's the system asking the human to finish its own job.
5. **No job visibility.** Rebuild/backfill/sync all run as fire-and-forget background promises. No progress, no history, no failure surfacing (errors go to server logs only), and two admins can start overlapping runs.

## Proposed solution

### 1. Jobs table — the backbone (do this first)
A single `jobs` table: `org_id, kind, status (queued|running|done|failed), progress, total, started_at, finished_at, error, stats jsonb, requested_by`. Every background operation (sync, rebuild, backfill, efs-repair, digest) writes through it.

- A partial unique index on `(org_id, kind) where status in ('queued','running')` makes duplicate concurrent runs impossible — DB-enforced, not in-memory flags.
- UI gets one hook: `useJob(kind)` → freshness label, progress bar, disabled buttons while running (for ALL users, not just the one who clicked).
- Failures become visible: a red "last sync failed 2h ago — retry" chip instead of silent staleness.

### 2. Tiered Samsara sync cadences
Split the one loop into three tiers, each an independently scheduled job:

| Tier | What | Default cadence | Cost per run |
|---|---|---|---|
| Live stats | current odometer + fuel % (one paginated `/fleet/vehicles/stats` call) | **every 15–30 min** | 1–3 requests |
| Identity | vehicles, drivers, assignments | every 6–12 h | ~6–10 requests |
| Recon | per-transaction GPS history | on-demand (import/scoring/backfill) | heavy — budgeted (below) |

Live stats are what pages actually need fresh (current odometer, tank level); they're nearly free to refresh often. Env knobs: `SAMSARA_STATS_SYNC_MINUTES=20`, `SAMSARA_IDENTITY_SYNC_HOURS=12`.

### 3. Central Samsara client with real rate limiting
One wrapper used by every Samsara call (sync, recon, diagnostics):

- **429 handling:** honor `Retry-After`, exponential backoff with jitter, bounded retries; a run that exhausts retries fails its job visibly instead of returning nulls.
- **Token bucket per org token** (e.g. 5 req/s, configurable) shared across schedulers and recon, so a deep backfill can't starve the live-stats tier.
- **Single-flight per org** (already sequential per org — keep, and stagger orgs).

### 4. UI: freshness instead of buttons
- Vehicles/Drivers pages: "Samsara data as of 14:32 · auto-refreshes every 20 min" chip; the manual button becomes "Refresh now" (enqueues the same job; disabled while one is running).
- Vue Query `refetchInterval` (~60s) on vehicles/drivers/dashboard queries so scheduler results appear without a reload.

### 5. Anomalies: kill the manual rebuild
- **Auto-cascade after import:** after `score-import` finishes, automatically re-score the affected vehicles' neighboring fills (scoped — not the whole org). The "Tip: run Rebuild" toast disappears.
- **Nightly reconcile job** (per org, ~03:00 org-local): EFS-store repair (`sync-from-efs`, already built — self-heals drift) → quick rebuild (skipRecon) → integrity check (per-day store-vs-events diff). Result lands in the jobs table; the dashboard health card gains a row: "Data integrity — checked 03:00, 0 drift."
- **Deep re-reconciliation** (fresh Samsara recon for every fill) stays admin-triggered + optionally weekly during off-hours, because it's the expensive one — now safely rate-limited by (3).
- **Rebuild button UX:** stays for on-demand use, but shows real progress ("Re-scored 412/1,890") from the jobs table instead of "refresh in a minute."

### 6. Reports
- The weekly digest scheduler already exists; add the integrity summary (drift count, sync failures) to it so problems reach email, not just the dashboard.
- Odometer-accuracy / summary.pdf stay on-demand (they're cheap reads); no caching needed at current fleet size.

## Suggested build order

1. **Jobs table + useJob hook** — everything else hangs off it. (migration + small API/service refactor)
2. **Samsara client with backoff + token bucket** — safety before frequency.
3. **Tiered schedulers** (split stats from identity; wire to jobs).
4. **Auto-cascade after import + nightly reconcile job** — removes the two biggest manual chores.
5. **UI freshness chips + progress bars** on Vehicles, Drivers, Anomalies, Import.
6. Digest additions; optional Samsara webhooks (push-based freshness) as a later phase.

Steps 1–3 are one coherent change set; 4–5 a second. Everything runs in-process on the single Railway instance (as today) — no new infrastructure. If the app ever scales to multiple instances, the jobs table is already the coordination point (swap `setInterval` for `pg_cron` or a queue then, not now).

## Rate-limit reference points (for the knobs)

- Samsara API: per-token rate limits vary by endpoint class; stats-history is the heavy one — the token bucket default (5 req/s) stays far under typical limits while letting a 188-truck backfill finish in minutes.
- Nominatim geocoding: already throttled to ~1 req/s in code (keep).
- Supabase/PostgREST: sync upserts are batched already; no concern at this fleet size.
