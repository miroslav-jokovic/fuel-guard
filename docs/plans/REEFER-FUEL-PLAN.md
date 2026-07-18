# Reefer Fuel Integrity — Research, Analysis & Plan

**Date:** 2026-07-06 · Analysis only, no code changed.
**Goal:** detect whether drivers are actually fueling reefer (trailer refrigeration) tanks — or switching the gun to the tractor tank / a container while billing it as reefer fuel — and whether reefers are being fueled at all.

---

## 1. What the data already tells us (key discovery)

EFS Transaction Reports already separate reefer fuel as its own line item: **ULSR** (ultra-low-sulfur reefer/off-road diesel — dyed, tax-exempt) vs **ULSD** (tractor road diesel). A typical stop produces one invoice with two fuel lines: ULSD for the tractor, ULSR for the reefer. The raw signal we need is already flowing into `efs_transactions` on every import.

**However — a current defect this project must fix first:** the parser maps `ULSR → diesel` and merges it into the SAME fuel event as the tractor's ULSD (same `card|invoice|date` key). Consequences today:

- Reefer gallons inflate the tractor's `exceeds_tank_capacity`, `tank_space_exceeded` and cumulative-overfuel checks → false positives.
- Reefer gallons corrupt MPG (tractor "consumed" fuel it never burned) → false `mpg_deviation`.
- The tank-fill reconciliation compares the tractor's tank rise against tractor+reefer gallons combined → false `tank_fill_short` signals.

So separating reefer fuel isn't just a new feature — it removes an existing noise source from every volume/consumption rule. And since `efs_transactions` preserves the `item` column verbatim, the split is **fully backfillable from data we already have** via the existing repair path (`sync-from-efs`).

## 2. The fraud/misuse patterns to catch

| Pattern | What happens | Financial angle |
|---|---|---|
| **Gun switching** | ULSR is billed (cheap, untaxed) but pumped into the tractor tank | Theft of the tax delta + **illegal**: dyed diesel in a road tank carries IRS/state fines (~$10/gal or $1,000+ per violation) — company liability, not just cost |
| **Container fill** | ULSR billed, pumped into drums/another vehicle | Straight theft; ULSR is the preferred product to steal because per-gallon scrutiny is lower |
| **Reefer neglect** | Reefer never fueled; runs dry mid-load | Spoiled temp-controlled load — often a bigger loss than fuel theft |
| **Reverse switch** | Reefer fueled from the ULSD line | No theft, but paying road tax on off-road fuel — recoverable cost leak |

## 3. What Samsara can provide (verified against current API docs)

- **Trailer assets:** `GET /fleet/trailers` (list/create/retrieve) — trailers are separate assets from powered vehicles (which is why the current vehicle sync never sees them).
- **Reefer telemetry:** `GET /v1/fleet/assets/reefers` (legacy but live, paginated, time-windowed `startMs/endMs`) — reefer-specific stats per asset, including **fuel percentage** series, power status, set point, ambient/return air temps, alarms. Requires "Read Trailers" scope on the API token.
- **Tractor↔trailer pairing:** `GET /v1/fleet/trailers/{id}/assignments` (+ all-trailers variant) and automatic **tractor–trailer trip associations** (Samsara pairs a trailer's Asset Gateway with the tractor's Vehicle Gateway). Driver–trailer assignments can also be created/read. Requires "Read Assignments" scope.
- Practical caveat: reefer fuel-level telemetry requires the reefer integration (Thermo King / Carrier connection on the AG). **Whether your reefers report fuel % is the single biggest fork in this plan** — verify on one trailer before building Tier B.

## 4. Physical reference numbers (for thresholds)

- Reefer tank capacity: **50 gal is the standard**; 75/120 gal options exist → per-trailer `reefer_tank_capacity_gal`, default 50.
- Burn rate: **0.4–0.9 gal/h** typical (cycle-sentry / moderate temps); up to **1.2–1.5 gal/h** worst case (continuous mode, deep-frozen, hot ambient). → configurable `max_reefer_burn_gph`, default 1.5 (deliberately generous).
- A 50-gal tank lasts roughly 2–4 days of running → expected fueling cadence every 2–4 duty days for active reefer loads.
- Expected reefer:tractor gallon ratio on refrigerated lanes ≈ 8–20% (useful fleet-baseline heuristic, not a hard rule).

## 5. Detection design — three tiers by data availability

### Tier A — transaction data only (works day 1, no telematics needed)
1. **`reefer_exceeds_capacity`** (critical): one ULSR purchase > trailer tank capacity (+tolerance). The fuel physically cannot fit in the reefer — the strongest single-transaction signal of gun-switching or container fill. Mirrors the existing tractor rule.
2. **`reefer_overfuel_rate`** (high): rolling window — ULSR gallons since the last reefer fill exceed `max burn rate × elapsed hours + one tank`. A reefer that "burned" 2.5 gal/h for three days straight didn't — the fuel went elsewhere. Mirrors `cumulative_overfuel`.
3. **`reefer_not_fueled`** (medium, review): truck historically buys ULSR (or has a paired reefer trailer) but has bought none for N days while the tractor fuels normally → either spoilage risk or reverse-switch. Surfaced as review, not alert.
4. **`reefer_ratio_outlier`** (low, corroborator): driver/truck reefer:tractor ratio far outside the fleet baseline in either direction. Feeds the case-correlation score; never fires alone.

### Tier B — with Samsara reefer telemetry (the smoking gun)
5. **`reefer_tank_fill_short`** (critical when corroborated): at the ULSR purchase moment, read the PAIRED trailer's reefer fuel % before/after (same logic as the existing tractor tank-fill check). *"Billed 45 reefer gallons; the reefer tank rose 0%"* is as close to proof as this domain gets.
6. **`reefer_tank_space`**: billed ULSR > empty space in the reefer tank before the fill.
7. **Tractor cross-check** (powerful corroborator): at the same stop, the tractor's fuel % (already collected) rose by MORE than its ULSD line explains while the reefer didn't rise → the ULSR went into the tractor. Two independent sensors agreeing.

### Tier C — burn-model refinement (optional, later)
Use reefer power-status/run-time series to compute actual run hours between fills → expected consumption band; tightens Tier A-2 from "physically impossible" to "statistically implausible." Only worth it after Tier B proves the telemetry is reliable.

All rules feed the existing multi-signal case model (new `reefer` evidence axis with weights mirroring the volume axis), so a lone weak signal stays quiet and corroborated signals raise one case — consistent with how the rest of FuelGuard behaves.

## 6. Data model & pipeline changes

1. **`trailers` table:** unit_number, samsara_asset_id, reefer_tank_capacity_gal (default 50), make/model/year, status, assigned_vehicle_id (manual fallback). Manual CRUD (you add them) + Samsara sync (`/fleet/trailers`) with the same match-don't-guess reconciliation used for vehicles.
2. **Split fuel events by tank:** `fuel_transactions.tank_type` (`tractor` | `reefer`), parser groups by `card|invoice|date|tank_type`. Reefer item codes configurable (`ULSR` + a per-org list — first implementation step: `select distinct item from efs_transactions` to see your merchants' actual codes; some chains use RFR/REEF variants).
3. **`trailer_id` on reefer events**, resolved by pairing at fueling time: Samsara trailer assignment covering the fueling day → else the manual assigned trailer → else null ("unpaired reefer fill" — visible, never guessed). Date-only EFS rows use whole-day assignment; if the trailer changed mid-day, pairing = unknown.
4. **Reefer telemetry snapshots:** extend the (planned) tiered sync — reefer fuel % lands in the same live-stats tier as tractor fuel %, one `/v1/fleet/assets/reefers` call per cycle for the whole fleet.
5. **Backfill:** re-derive historical events with the tank split from `efs_transactions` via the existing `sync-from-efs` repair — history gets reefer events (and cleaner tractor events) without re-uploading anything.

## 7. UI

- **Trailers page** (mirror of Vehicles): manual add, Samsara sync, tank capacity, pairing status, reefer fuel level (Tier B).
- **Fuel log / Transactions:** "Reefer" badge on ULSR events; filter by tank type.
- **Vehicle/Driver detail:** reefer fueling cadence + ratio vs fleet.
- **Dashboard:** reefer spend split out of the Fuel spend chart (stacked bars); reefer alerts in the existing case queue — no new queue.
- **Settings → Thresholds:** reefer tank default, max burn gph, not-fueled days, ratio band.

## 8. Rollout order

| Phase | Contents | Value |
|---|---|---|
| 0 | Tank-type split in parser + backfill from EFS store | Fixes existing false positives; unlocks everything below |
| 1 | Trailers table + manual CRUD + Samsara trailer/assignment sync | Reference data |
| 2 | Tier A rules + case integration + badges/filters | Detection live, no telemetry dependency |
| 3 | Reefer telemetry sync + Tier B reconciliation + tractor cross-check | Smoking-gun evidence |
| 4 | Ratio analytics, digest section, Tier C burn model | Refinement |

Phases 0–2 need nothing from Samsara beyond what's already connected. Phase 3 needs the reefer integration verified on your trailers.

## 9. Open questions — ANSWERED (2026-07-06)

1. **Item codes (from production data):** ULSD 2,132 · DEFD 1,512 · SCLE 378 · **ULSR 83** · STAX 46 · WWFL 19 · ADD 5 · ANFR 5 · null 4 · OIL 3. ULSR is the only reefer code; the rest are non-fuel and already skipped. Note: ULSR is only ~4% of fuel lines — itself a signal that reefers are under-fueled or fueled on the ULSD line; Tier A will break this down per truck/driver.
2. **No Thermo King/Carrier reefer integration** — it's a paid per-trailer add-on (reefer cable + enablement on the AG license). **Phase 3 (Tier B) deferred**; plan proceeds with Tier A. Trailers DO have AGs (they're tracked in Samsara), so a later reefer pilot only needs cables + enablement, not new gateways.
3. Trailer tank sizes: to be captured per trailer on the Trailers page (default 50 gal).
4. **Trailers are in Samsara and assigned to trucks** → pairing comes from Samsara trailer assignments / trip associations. Samsara doesn't classify them as reefers — irrelevant: the reefer flag + tank capacity live in FuelGuard (manual, on the synced trailer records).

**Confirmed scope to build: Phases 0–2** (tank-type split + backfill → Trailers page + Samsara trailer/assignment sync → Tier A rules + case integration + UI). Phase 3 revisit after a cable pilot, if ever.

## Sources

- [Samsara API — List stats for all reefers](https://developers.samsara.com/reference/v1getassetsreefers)
- [Samsara API — List stats for a given reefer](https://developers.samsara.com/reference/v1getassetreefer)
- [Samsara — Reefer Integration help article](https://kb.samsara.com/hc/en-us/articles/360043019611-Reefer-Integration)
- [Samsara API — trailer assignments](https://developers.samsara.com/reference/v1getalltrailerassignments) · [trailers CRUD](https://developers.samsara.com/reference/listtrailers)
- [Samsara — Tractor and Trailer Trip Associations](https://kb.samsara.com/hc/en-us/articles/4423287244045-Tractor-and-Trailer-Trip-Associations)
- [Hale Trailer — Understanding reefer fuel usage](https://haletrailer.com/blog/reefer-fuel-usage/) · [Fuel Logic — Reefer fuel tanks](https://www.fuellogic.net/reefer-fuel-tank/) · [Cargostore — Reefer fuel consumption guide](https://cargostore.com/reefer-unit-fuel-consumption/)
- [FreightWaves — What is reefer fuel (dyed diesel rules)](https://ratings.freightwaves.com/what-is-reefer-fuel/)
