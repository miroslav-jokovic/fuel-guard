# Phase 6 — High-Growth Data Review

Static review of index coverage for the hot query paths, a retention/rollup plan for the highest-volume
tables, and an `EXPLAIN ANALYZE` runbook you run against your own database to validate before shipping.

This is the "don't turn back and re-solve the same scaling problem" pass: the app already indexes almost
everything with `org_id`-leading composites (good for RLS, which injects `org_id = <tenant>` into every
web query). This review found only **two** real gaps worth an index today; the rest is either already
covered or should wait for a measurement.

## How the queries reach Postgres

Two different access patterns, and they matter for indexing:

- **Web reads go through Supabase with RLS on.** Every `supabase.from(...)` in `apps/web` runs as the
  logged-in user, so the RLS policy silently adds `WHERE org_id = <tenant>`. That means an index must lead
  with `org_id` to be usable by these queries — which the existing ones do.
- **The scoring/backfill write path uses the service-role `admin` client, RLS OFF.** Those queries do
  **not** get an implicit `org_id`; several filter only on `vehicle_id`. An `org_id`-leading index is
  therefore *unusable* by them (see the `idx_ftxn_vehicle_tank` note below).

## Cross-check: every hot path vs. current coverage

| Path (composable / query) | Effective filter + sort | Covered by | Verdict |
|---|---|---|---|
| Anomaly queue — default | `org_id`, `status <> superseded`, `ORDER BY fueled_at desc`, LIMIT 500 | `idx_anomaly_org_fueled (org_id, fueled_at desc)` | OK (bounded by LIMIT) |
| Anomaly queue — status tab | `org_id`, `status = ?`, `ORDER BY fueled_at desc` | `idx_anomalies_org_status (org_id, status)` — **no sort** | **GAP → new index #1** |
| Fuel log — default | `org_id`, `ORDER BY fueled_at desc`, paged | `idx_ftxn_org_time (org_id, fueled_at desc)` | OK |
| Fuel log — by vehicle | `org_id`, `vehicle_id = ?`, sort fueled_at | `idx_ftxn_vehicle_time (vehicle_id, fueled_at desc)` | OK |
| Fuel log — by driver | `org_id`, `driver_id = ?`, sort fueled_at | **nothing leads with driver_id** | **GAP → new index #2** |
| Dashboard — fills | `org_id`, `fueled_at >= from`, sort asc | `idx_ftxn_org_time` | OK |
| Dashboard — idle | `org_id`, `started_at >= from` | `idx_idle_events_org_started (org_id, started_at)` | OK |
| Dashboard — declined count | `org_id`, `declined_at >= from` | `idx_declined_org_time` | OK |
| Odometer mismatches | `org_id`, `fueled_at >= from`, NOT NULL residuals, sort fueled_at | `idx_ftxn_org_time` | OK (NOT NULLs are residual filters) |
| Reefer coverage | `org_id`, `fueled_at >= from`, sort asc | `idx_ftxn_org_time` | OK |
| Long idles | `org_id`, `classification = 'discretionary'`, `started_at >= from`, `ORDER BY duration_sec desc` | `idx_idle_events_org_started` narrows the window; duration sort is residual | OK for bounded windows — **watch** (see runbook) |
| Idle scores | `org_id`, `started_at >= from`, sort started_at | `idx_idle_events_org_started` | OK |
| Driver performance | `driver_scores (org_id, week_start IN …)` + idle window | `idx_driver_scores_org_week`, `idx_idle_events_org_started` | OK |
| Vehicle detail — fills | `org_id`, `vehicle_id = ?`, sort fueled_at, LIMIT 200 | `idx_ftxn_vehicle_time` | OK |
| Vehicle detail — anomalies | `org_id`, `vehicle_id = ?`, `ORDER BY created_at desc` | **no (vehicle_id) index on anomalies** | Low — optional (see runbook) |
| scoring prev/window fills (backfill) | `vehicle_id`, `tank_type`, `fueled_at` — **no org_id** | `idx_ftxn_vehicle_time` (tank_type residual); `idx_ftxn_vehicle_tank` is **unusable** (org_id-leading) | OK today — code note below |

## What migration 0066 adds (the two clear wins)

1. **`idx_anomalies_org_status_fueled (org_id, status, fueled_at desc)`** — the anomaly queue is the most
   opened screen; clicking a status tab today forces a Sort. This serves filter **and** sort from the index.
   It makes the old `idx_anomalies_org_status` a strict prefix, so 0066 drops that one (no net index growth).
2. **`idx_ftxn_org_driver_time (org_id, driver_id, fueled_at desc) WHERE driver_id IS NOT NULL`** — driver
   filtering on the fuel log / driver detail has zero index support today. Partial to stay off driver-less rows.

Both use `CREATE INDEX IF NOT EXISTS`, matching the 0001–0065 convention.

### Applying on a live DB

A plain `CREATE INDEX` locks the table against writes while it builds. That is fine on dev, but on a
production `fuel_transactions` / `anomalies` with real rows, build them **without** the write lock:

```sql
-- Run in psql against prod, NOT inside a transaction (CONCURRENTLY forbids it):
create index concurrently if not exists idx_anomalies_org_status_fueled
  on anomalies (org_id, status, fueled_at desc);
create index concurrently if not exists idx_ftxn_org_driver_time
  on fuel_transactions (org_id, driver_id, fueled_at desc) where driver_id is not null;
drop index concurrently if exists idx_anomalies_org_status;
```

Then mark 0066 as already-applied for that environment (or keep it for fresh/dev DBs, where the plain form
is a harmless no-op via `if not exists`).

## EXPLAIN ANALYZE runbook (you run this — it needs your data)

Run each against a **scale-sized** tenant (pick a real `:org` with the most rows) and a realistic window.
Replace `:org`. Read for a **Seq Scan on a big table**, a **Sort** node moving many rows, or high
`shared read` buffers.

```sql
-- 1. Anomaly status tab — BEFORE index #1 expect a Sort; AFTER expect an Index Scan, no Sort.
explain (analyze, buffers)
select * from anomalies
where org_id = :org and status = 'open'
order by fueled_at desc limit 500;

-- 2. Driver-filtered fuel log — BEFORE index #2 expect a filter/seq-scan on driver_id.
explain (analyze, buffers)
select * from fuel_transactions
where org_id = :org and driver_id = (select id from drivers where org_id = :org limit 1)
order by fueled_at desc limit 100;

-- 3. Default anomaly queue — decide the OPTIONAL partial index. If this shows the index scan reading
--    (and discarding) a large number of superseded rows, add:
--    create index concurrently ... on anomalies (org_id, fueled_at desc) where status <> 'superseded';
explain (analyze, buffers)
select * from anomalies
where org_id = :org and status <> 'superseded'
order by fueled_at desc limit 500;

-- 4. Long idles — confirm the duration_sec Sort stays cheap on your real idle window. If idle_events is
--    huge and the window is wide, consider (org_id, classification, started_at desc).
explain (analyze, buffers)
select * from idle_events
where org_id = :org and classification = 'discretionary'
  and started_at >= now() - interval '30 days'
order by duration_sec desc limit 100;

-- 5. Deep pagination sanity — .range() is OFFSET/LIMIT; deep pages scan+discard. Compare page 1 vs a deep page.
explain (analyze, buffers)
select * from fuel_transactions where org_id = :org
order by fueled_at desc offset 5000 limit 50;
```

### Two code-level follow-ups the runbook may justify

- **scoreTransaction service-role reads omit `org_id`.** The prev-fills and rolling-window queries in
  `scoring/scoreTransaction.ts` filter `vehicle_id` + `tank_type` but not `org_id`, so the tank-aware
  `idx_ftxn_vehicle_tank (org_id, vehicle_id, tank_type, fueled_at desc)` can never be used — they fall
  back to `idx_ftxn_vehicle_time` with `tank_type` as a residual filter. For dual-tank (reefer-hauling)
  trucks during a backfill this scans reefer rows it then throws away. If EXPLAIN #? on the backfill shows
  it, add `.eq("org_id", orgId)` to those two queries (safe — `vehicle_id` already implies the org) so the
  existing index applies. Left as a measured change, not done blind.
- **Deep `.range()` pagination** (fuel log, idle lists) is OFFSET-based. If query #5 shows deep pages
  getting slow, switch those lists to keyset pagination (`fueled_at < last_seen`) — a bigger change, worth
  it only for tenants that actually page deep.

## Retention / rollup for the highest-volume tables

These grow without bound and will dominate storage and vacuum cost long before `fuel_transactions` does.
Decide a policy now so it's a config change later, not a migration under fire.

- **`idle_events`** — the highest row-count table (one row per idle session, per truck, continuously).
  Recommendation: keep raw rows for a rolling window (13 months covers year-over-year), and roll older data
  into a per-vehicle / per-driver **monthly aggregate** table (total idle sec, discretionary sec, gallons)
  that the long-range dashboards read instead of the raw rows. Alternative: native **monthly range
  partitioning** on `started_at`, dropping old partitions cheaply. Either keeps the hot indexes small.
- **`route_geometries` + `route_geometry_steps`** — large geometry payloads per route. Recommendation:
  retain the geometry only as long as it's shown (e.g., 90 days), keep a lightweight route summary
  (distance, duration, endpoints) indefinitely, and drop or cold-store the raw steps past the window.
- **`fuel_before_states` / `fuel_prices_posted`** — high-churn append tables feeding fill confidence and
  pricing. Recommendation: a retention window (e.g., 12–18 months) plus a scheduled purge job; neither is
  needed at full resolution forever.

None of these are urgent at current scale — they're the "hundreds of companies / thousands of trucks"
horizon. The point is that the schema is ready and the policy is written down.

## Bottom line

The data layer is in good shape for the growth target: multi-tenant queries are `org_id`-anchored and
almost fully index-covered. Ship the two indexes in 0066, run the EXPLAIN runbook against a real tenant to
confirm the two gaps and decide the three optional items, and adopt the retention policy for `idle_events`
and `route_geometries` before those tables get large. No rewrite, no re-architecture — just closing two
gaps and writing down the retention plan.
