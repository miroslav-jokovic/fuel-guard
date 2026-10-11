# APR0.1 — telemetry/idle data-path inventory, 2026-10-05

The machine-readable half is `telemetry-inventory.json`, produced by `inventory.mjs telemetry` in this
folder (20 tables: modules `idle` and `samsara` in `scripts/table-modules.json`; `fuel_txn_recon` also
appears in the fuel pilot). Same fields and limits as the fuel pilot (see `FUEL-PILOT-INVENTORY.md`).

Cross-check: `git grep` finds 11 non-test files with `.from("idle_events")` (inventory: 1 writer + 6 API

- 4 web), 5 for `hos_duty_segments` (1 + 4) and 6 for `vehicle_engine_days` (1 + 4 + 1 other).

## The path

| Stage                | Where                                                                                                                                                                                  | Evidence                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Source               | Samsara: stats history and snapshot, stats and positions delta feeds, idling events, HOS logs, IFTA vehicle report, fuel webhook                                                       | `samsara/lib/samsaraStatsHistory.ts`, `lib/samsaraDeltaFeeds.ts`, `lib/samsaraIfta.ts`, `fuelEventsWebhook.ts` |
| Cadence              | `idle_engine` hourly (nightly window chosen inside it); `sync_stats` 20 min; positions 5 s tier; `idle_event_twins` → `sync_idle` → `sync_hos` 6 h; `sync_ifta`, `sync_odometer` daily | `samsaraScheduler.ts`, `queue/handlers/index.ts`, `handlers/idleEngine.ts`                                     |
| Cursors              | `samsara_feed_cursors`, advanced only after the page is applied (at-least-once)                                                                                                        | `samsara/lib/feedCursor.ts`                                                                                    |
| Source evidence      | `idle_events`, `hos_duty_segments`, `fuel_events`, `samsara_odometer_readings`, `samsara_ifta_*`, `vehicle_positions` (latest fix only), `idle_telemetry_windows` (statistics only)    | collectors in `samsara/` and `idle/`                                                                           |
| Idle engine (IE2)    | fetch a window, classify in memory, replace the window — **no raw stored** (D-IE8)                                                                                                     | `idle/idleEngineSync.ts:1-6`                                                                                   |
| Harness              | pure `classifyIdleEngine`, `IDLE_ENGINE_VERSION = "ie3-v3"`; no vendor import                                                                                                          | `packages/shared/src/idleEngine/classify.ts:47`                                                                |
| Derived (engine)     | `idle_engine_hours/stops/days` via `idle_engine_write` (0407), one transaction per 20-truck batch, validates window and vehicles before deleting                                       | 0407:64-179, `idleEngineSync.ts:312`                                                                           |
| Derived (foundation) | `vehicle_engine_days`, `idle_park_sessions`, `idle_rollup_days`, evidence columns via `apply_idle_*` RPCs                                                                              | `idleCapabilitySync.ts`, `idleRollupPersistence.ts`, 0174, 0183                                                |
| Readers              | `/api/idle/engine/{avoidable,burn-rates,parity}`, `/equipment`, `/cost-basis`; browser reads `idle_events`, `idle_rollup_days`; live map reads `vehicle_positions`                     | `idle/routes/index.ts`, `apps/web/src/features/idle/*`, `livemap/liveMapBoard.ts`                              |

## Against the plan's invariants

1. **Replay depends on Samsara (D-IE8, APR3.3, Q1).** The idle engine stores no samples;
   `idle_telemetry_windows` is one overwritten row of counts and min/max/avg per truck; `vehicle_positions`
   keeps only the latest fix (0342). Rebuilding a window after Samsara's history horizon is impossible.
   This is a recorded decision, not a defect, and needs the Q1 ruling.
2. **Corrections overwrite, with one exception (D-APR4, Q4).** `idle_events`, `hos_duty_segments`,
   `samsara_odometer_readings`, `samsara_ifta_jurisdiction_miles` and webhook `fuel_events` upsert over the
   stored row; HOS also deletes segments missing from a fetch for the drivers it covers. Stats-feed
   `fuel_events` insert and treat `23505` as "already filed", so the **first** detection wins
   (`samsaraStatsFeed.ts:115-128`). No prior values are kept anywhere.
3. **Version stamps are uneven (D-APR5).** `classifier_version` is on engine hours and stops, days take
   `max()`; `evidence_version` is on telemetry windows and park sessions; `idle_rollup_days` has none.
4. **Atomicity differs by path (APR5.1).** `idle_engine_write` is per-batch transactional, not
   fleet-wide; hourly/nightly races are prevented only by the single `(org, idle_engine)` job slot. The
   foundation writers are upserts followed by separate deletes, without a transaction.
5. **Derived values on raw or core rows (D-APR3).** `idle_events` mixes vendor fields with our cost,
   burn and temperature (manifest says derived, retention note says raw). `fuel_events` (raw) also holds
   our own fuel-drop detections. Idle capability and envelope are written onto roster's `vehicles`
   (grandfathered), from which trigger `trg_vehicle_learned_satellites` fills `vehicle_idle_learned`.
6. **Cross-module access.** Idle collectors import `samsara/lib/*` internals rather than the module
   index (`idleEngineSync.ts`, `idleTelemetrySync.ts`) — the APR3.2 target. Idle writes roster's
   `driver_vehicle_assignments` and `vehicles` (grandfathered); the browser writes `idle_settings`
   (grandfathered); `idleSync` writes `idle_settings.suggested_*`.
7. **Retention gaps.** In the policy: `idle_events`, `hos_duty_segments`, `idle_park_sessions`,
   `idle_telemetry_windows`, `vehicle_engine_days`, `weather_cache` (400 d), `idle_engine_hours` (60 d);
   `fuel_events` is forbidden. In neither list: `idle_engine_days`, `idle_engine_stops` (commented "kept"),
   `idle_rollup_days`, `vehicle_positions`, `vehicle_idle_learned`, `idle_settings`, every `samsara_*` table.
8. **Readers do not call Samsara.** The idle GET routes read only the database (and `fuel_prices` for
   cost basis); none of them writes.

## Not covered yet

- Bodies of `syncIdleEvents` and the equipment/envelope syncs beyond their write calls.
- Samsara's actual history horizon per endpoint (bounds invariant 1).
- Fixtures for late HOS edits, re-sent idle events, DST days and the hourly/nightly overlap (APR0.2).
