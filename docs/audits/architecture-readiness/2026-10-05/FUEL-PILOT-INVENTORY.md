# APR0.1 — fuel pilot data-path inventory, 2026-10-05

The machine-readable half is `fuel-pilot-inventory.json`, produced by `inventory.mjs` in this folder
(39 tables matching the fuel/EFS/scoring/spend/price names in `scripts/table-modules.json`). For every
table it lists module, layer, lifecycle, writers, API/web/other readers, the migration functions whose
latest body names the table, triggers, policy kinds, and the two gates' grandfathered exceptions. Its
limits are stated in the generator's header; the most important is that dynamic `.from(var)` and reads
through views/RPCs are not resolved to callers.

The generator was cross-checked before use: `git grep` finds 50 non-test files with
`.from("fuel_transactions")`; the inventory has 11 writers + 31 API readers + 8 web readers = 50. Its
grandfather totals (29 raw-access, 58 writer) equal what `lint:table-access` and `lint:table-modules`
print.

This page records what the structure cannot: the path, and where it breaks the plan's invariants.

## The path

| Stage                                     | Where                                                                                            | Evidence                                                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source                                    | EFS (SOAP)                                                                                       | `modules/efs/services/efsSync.ts`, `efsIngest.ts`                                                                                                                                                |
| Source evidence                           | `efs_transactions` (raw, `RETENTION_FORBIDDEN`)                                                  | upsert on `(org_id, external_ref)`, `ignoreDuplicates: true` — `efsIngest.ts:196`, `efsSync.ts:237`                                                                                              |
| Canonical record                          | `fuel_transactions` (core, `RETENTION_FORBIDDEN`)                                                | projected by the same collector, same key, `ignoreDuplicates: true` — `efsIngest.ts:246`                                                                                                         |
| Harness trigger                           | EFS processing calls scoring directly                                                            | `efs/services/efsProcessing.ts` imports `scoreImportWithCascade`, `scoreDeclinedImport`                                                                                                          |
| Harness                                   | anomaly scoring                                                                                  | `modules/anomalies/scoring/*`; version `rs-<ruleset hash>+<build commit>` (`persist.ts:59`)                                                                                                      |
| Derived                                   | `anomalies`, `scoring_attempts` (45 d), `declined_txn_scores`                                    | `persist_scoring_outcome_v2` (0319, definer)                                                                                                                                                     |
| Derived written onto the canonical row    | `fuel_transactions.has_anomaly`, `max_severity`, `vehicle_id`, `logbook_vehicle_id`, `driver_id` | `anomalyFlagReconcile.ts:76,96`; `scoreTransaction.ts:87`; `context.ts:145,183`                                                                                                                  |
| Enrichment written onto the canonical row | `ambient_temp_f`, `station_id`, `driver_id`                                                      | `fuel/fillWeather.ts:55`, `fuel/fuelStationResolve.ts:135`, `fuel/driverAttribution.ts:68`                                                                                                       |
| Human decision on the canonical row       | `audit_verdict`, `audit_note`, `audit_by`, `audit_at`                                            | `org/routes/audit.ts:152`                                                                                                                                                                        |
| Satellites (0261)                         | `fuel_txn_scores`, `fuel_txn_recon`, `fuel_txn_dispositions`                                     | **0 writers and 0 readers in application code**; filled only by the `sync_fuel_txn_satellites` trigger                                                                                           |
| Derived rollup                            | `fuel_spend_days`                                                                                | `fuel-spend/fuelSpendRollup.ts` reads `fuel_transactions`, `efs_transactions` (DEF lines), `vehicle_engine_days`, `vehicles`; trailing-fortnight nightly rebuild (`fuelSpendRollupScheduler.ts`) |
| Readers                                   | API 31 files, web 8 files directly on `fuel_transactions`; `fuel_spend_days` API 3, web 2        | JSON                                                                                                                                                                                             |
| Browser writer                            | `apps/web/src/features/fuel/useCreateFillUp.ts` inserts manual fills over PostgREST              | grandfathered writer                                                                                                                                                                             |

## Against the plan's invariants

These are classifications with evidence, not yet failing tests. Each names the plan task that owns it.

1. **One row holds four categories (D-APR3, APR4.1).** `fuel_transactions` carries vendor facts,
   identity resolved by the harness, harness flags, enrichment, and a human verdict. The 0261
   satellites were meant to separate them and are write-only shadows. Phase 4 starts from zero
   readers, not from a partial migration.
2. **The harness rewrites canonical identity (D-APR1, APR4.1).** Scoring reattributes `vehicle_id` from
   logbook + GPS with an audit row, and fills `vehicle_id`/`driver_id` only when null. **No lost human
   edit was found**: no application path lets a person set a fuel transaction's vehicle, so there is
   nothing for scoring to overwrite today. It becomes a defect the moment such a path exists.
   Both updates (`scoreTransaction.ts:87`, `context.ts:145`) filter by `id` alone, without the
   `org_id` filter D-APR7 asks of service-role queries; the id is a UUID, so this is a missing
   second check, not a known leak.
3. **A re-sent vendor row with changed values is discarded (D-APR4, Q4).** Both the raw and canonical
   upserts are `ON CONFLICT DO NOTHING`. Whether EFS ever re-sends a corrected transaction under the
   same `external_ref` is **unverified**; if it does, neither table records the correction.
4. **Collector completion depends on the harness (APR3.1).** EFS processing invokes scoring in-line,
   confirmed in source today (the baseline row in the plan).
5. **Derived output carries no generation (D-APR5, APR5.1).** `fuel_spend_days` has `updated_at` and no
   algorithm version, input cutoff or publication id. Stale rows are swept by timestamp after chunked
   upserts, so a reader can see a partial generation. A correction older than the trailing fortnight is
   not rebuilt by the nightly run (APR3.4).
6. **Scoring's version moves every deploy.** `rs-<hash>+<commit>` makes reproducibility unprovable
   across deploys without the ruleset hash alone (already recorded in `q6-programme-position`).
7. **Boundary debt is concentrated here.** The fuel tables hold **21 of 29** grandfathered raw-access
   sites (`declined_transactions` 8, `efs_transactions` 4, `fuel_prices_posted` 3, `efs_cards` 2,
   `fuel_events` 2, `fuel_prices` 2) and **16 of 58** grandfathered writer sites (`fuel_transactions`
   8, `fuel_stations` 5, `declined_transactions` 2, `route_fuel_settings` 1).

## Not covered yet

- Other domains (telemetry/idle, finance) — after the pilot, per APR0.2.
- Pilot fixtures (missing data, corrections, duplicates, DST, …) — APR0.2's second half.
- Readers through views and RPCs mapped to their callers; the 10 dynamic `.from()` sites.
- Whether EFS re-sends corrections (point 3) — needs EFS documentation or a measured duplicate with
  different values in `efs_processing_runs` / raw payloads.
