-- Silvicom 360 — 0311 samsara_odometer_readings: the fleet's distance, staged as the READINGS the
-- vendor asserts rather than as miles we decided (W3b, D-FLEET9,
-- docs/plans/financial/FINANCE-FLEET-REPORT-PLAN.md §1.8.2).
--
-- What gap. The finance report divides money by miles, and it has had no MEASURED mile. The two
-- candidates both fail for the same reason, which is worth writing down because both look like they
-- work:
--
--   · `fuel_spend_days.miles` reads exactly like per-vehicle daily distance and is not a measurement
--     at all. `rollupDerive.ts`'s `allocate()` takes ONE fill-to-fill odometer interval and spreads
--     it across the days it spans by drive-second weight, or evenly when there are no drive seconds.
--     Every day in that interval then carries a number nobody observed. Finance must never read it
--     (D-FLEET8), and the fact that it would produce a plausible cost-per-mile is the danger.
--   · `vehicles.current_odometer` is the LATEST value and nothing else — `samsaraStatsFeed.ts`
--     patches it in place and keeps no series, so no period can be differenced out of what we hold.
--
-- So this table exists to hold the series. §1.8.2 originally concluded that Samsara could not answer
-- the question either; reading the vendor documentation on 2026-09-04 showed that was true of what
-- we STORE and false about what Samsara SERVES. `GET /fleet/vehicles/stats/history` takes arbitrary
-- start/end times and returns per-vehicle `{time, value}` arrays, and Samsara's own "calculating
-- distance traveled" guide ranks the counters — `obdOdometerMeters` from the ECU is "the most
-- accurate", `gpsDistanceMeters` the fallback where the ECU exposes none, `gpsOdometerMeters` (GPS
-- plus a hand-entered start) the last resort. All three are cumulative counters in METRES, and there
-- is no distance-over-range endpoint anywhere in the API: the vendor's own documented method is to
-- read the history and subtract.
--
-- ── WHY THIS STORES READINGS AND NEVER A DISTANCE (D-FLEET9) ────────────────────────────────────
-- "The counter read 663,428,113 metres at 23:50:04" is a fact the source asserts. "412 miles on
-- 3 July" is not — it is a subtraction between two of those facts across a boundary somebody chose.
-- A collector that stored the second would have decided the day boundary, the timezone and the
-- period inside an extraction layer, and every later question about a week, a fortnight or a custom
-- range would become a schema change instead of a different subtraction. That is the exact mistake
-- W1 exists to undo for the general ledger, made a second time. `packages/shared/src/tmsCost/
-- vehicleDistance.ts` owns the arithmetic and the three refusals; this table owns nothing but what
-- Samsara said.
--
-- ── WHY ONE ROW PER VEHICLE PER DAY PER COUNTER, AND WHY `day` IS A SLOT ────────────────────────
-- Q-SAM5 declined a full-density sample store: at telematics ping rates that is ~200k rows a day for
-- this fleet, to answer a question that needs two readings per period. One reading a day per counter
-- is ~380 rows a day for ~190 trucks, and it answers every period boundary a report can ask for,
-- because `distanceByVehicle` reads the last reading AT OR BEFORE each end of the period rather than
-- the readings inside it.
--
-- `day` is therefore a SLOT — the dedup key that bounds the volume — and no figure is ever computed
-- from it. Every figure comes from `reading_at` (the vendor's instant) and `meters` (the vendor's
-- unit). The slot is cut on the org's operating clock, the same boundary `vehicle_engine_days` uses,
-- and `tz_offset_minutes` records which offset was in force so the cut is checkable years later
-- rather than inferred from today's timezone table.
--
-- ── WHY `source` IS IN THE IDENTITY AND NOT A PREFERENCE RESOLVED AT WRITE TIME ─────────────────
-- An ECU odometer starts at the engine's life and a GPS distance counter at the gateway's install,
-- so a subtraction across the two produces a number with no meaning. Keeping both counters as
-- separate rows lets the rule pick the best one that can answer a given period — and lets a truck
-- whose ECU broke mid-month fall back rather than drop out of the fleet total. Resolving to one
-- counter here would throw away the fallback and bake today's ranking into stored data.
--
-- ── WHAT IS DELIBERATELY NOT CONSTRAINED ───────────────────────────────────────────────────────
-- No CHECK on `day` beyond NOT NULL. 0271 constrained `effective_from` to the first of a month and
-- the RLS matrix's generic seeder could not satisfy it, which cost that table a hand-written seeder;
-- a staging table should be seedable by anything that can write a row.
--
-- `meters >= 0` IS constrained, because a cumulative counter cannot be negative — a negative value
-- is a parse error or a sentinel, not a reading, and letting one land would put a nonsense
-- subtraction one row away from a fleet denominator.
--
-- Deny-all RLS on purpose: raw collected data is read through the owning collector's interface
-- (D-SEP1, D-SEP7), never by a browser over PostgREST.
--
-- ── AND WHY IT IS NOT IN `RETENTION_RULES`, WHICH IS A DECISION, NOT AN OVERSIGHT ───────────────
-- Every other raw telematics table is pruned at 400 days, on the stated grounds that its history
-- survives in a derived rollup (`idle_rollup_days`) and Samsara could re-backfill anyway. Neither
-- holds here. Nothing downstream mirrors these readings — they ARE the record of how far the fleet
-- drove — and a 400-day window is barely two months wider than the twelve-month trend the fleet
-- report already draws, so a year-over-year comparison would silently lose its earlier half. The
-- cost of keeping them is negligible by construction: ~380 rows a day for ~190 trucks across two
-- counters, under 140k rows a year. A prune here would buy nothing and would quietly shorten the
-- only measured denominator the finance section has.
-- raw-access-waiver: this file creates the samsara raw staging table it names, on behalf of the
-- samsara collector — the owning collector's own DDL, no cross-module read.
create table if not exists samsara_odometer_readings (
  id                uuid          not null default gen_random_uuid() primary key,
  org_id            uuid          not null references organizations(id) on delete cascade,
  vehicle_id        uuid          not null references vehicles(id) on delete cascade,
  -- Samsara's own three cumulative counters, in the vendor's ranking. The vocabulary is
  -- ODOMETER_COUNTERS in packages/shared/src/tmsCost/vehicleDistance.ts; `gps_odometer` is legal
  -- here although the collector does not request it today (see samsaraOdometerSync.ts), because the
  -- rule already ranks it and a later collector must not need a migration to write it.
  source            text          not null check (source in ('obd', 'gps_distance', 'gps_odometer')),
  day               date          not null,
  reading_at        timestamptz   not null,
  meters            numeric(16,2) not null check (meters >= 0),
  tz_offset_minutes integer       not null default 0,
  synced_at         timestamptz   not null default now(),
  created_at        timestamptz   not null default now()
);

-- The collector's upsert identity: one reading per truck per day per counter.
create unique index if not exists samsara_odometer_readings_identity
  on samsara_odometer_readings (org_id, vehicle_id, source, day);
-- The read path: a period is a range of instants, and the opening reading is the last one at or
-- before its start — so the reader scans backwards from a bound and needs the instant indexed.
create index if not exists idx_samsara_odometer_readings_org_reading_at
  on samsara_odometer_readings (org_id, reading_at);

alter table samsara_odometer_readings enable row level security;

comment on table samsara_odometer_readings is
  'Samsara cumulative odometer READINGS — one per vehicle per day per counter, in metres, at the vendor''s own instant (W3b, D-FLEET9). Never a distance: packages/shared/src/tmsCost/vehicleDistance.ts differences them. Service-role only.';
