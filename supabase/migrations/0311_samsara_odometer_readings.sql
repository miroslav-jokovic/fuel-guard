-- Silvicom 360 — 0311 samsara_odometer_readings: the odometer as the source asserts it, so distance
-- over any period is a subtraction rather than a schema change (W3, D-FLEET9,
-- docs/plans/financial/FINANCE-FLEET-REPORT-PLAN.md §1.8.2).
--
-- What gap. Weekly cost per mile needs a weekly DRIVEN denominator, and we had none. §1.8.2 recorded
-- why: the IFTA report is month-grained by the vendor's own API, and the stats feed reduces the
-- odometer array it receives to `vehicles.current_odometer` — one value per truck, last-write-wins,
-- no history to difference. That second half was true of what we STORE and false of what Samsara
-- SERVES, which the vendor documentation settled on 2026-09-04:
--
--   · `GET /fleet/vehicles/stats/history` takes arbitrary `startTime`/`endTime` and returns
--     per-vehicle arrays of `{time, value}` samples. We already call it hourly for fuel recon.
--   · Samsara's "calculating distance traveled" guide ranks the counters: `obdOdometerMeters` from
--     the ECU is "the most accurate", `gpsDistanceMeters` is the fallback where the ECU exposes no
--     odometer, `gpsOdometerMeters` (GPS plus a hand-entered starting value) is the last resort.
--   · There is **no distance-over-range endpoint**. The vendor's own documented method is to read
--     the history and subtract. All three counters are cumulative, in metres.
--
-- Why this table stores READINGS and not daily miles. D-FLEET9: a collector stages the finest grain
-- the source asserts and the harness does the arithmetic. "The counter read 663,428,113 metres at
-- 23:50:04" is a fact Samsara asserts. "412 miles on 3 July" is not — it is a subtraction across a
-- boundary somebody chose, and choosing it here would put the day, the timezone and the reporting
-- period inside an extraction layer, making every later question about a week, a fortnight or a
-- custom range a migration instead of a different SUM. That is the exact mistake W1 was written to
-- undo for the general ledger, and it is not worth making twice.
--
-- Why one reading per day rather than every sample. A single 2026-04-15 day returned 9,075
-- odometer samples across 8 vehicles (SAMSARA-COLLECTION-PLAN §check-1), so the whole fleet at full
-- density is ~200k rows a day — which is why Q-SAM5 declined a general sample store. One reading per
-- vehicle per day is ~190 rows a day, and it is enough: with the reading taken at the END of each
-- day, any period's distance is the difference between the two readings that BOUND it, and no day is
-- split. Nothing is averaged and nothing is apportioned.
--
-- `source` is the counter, not a quality flag: an ECU odometer and a GPS distance have different
-- origins — one starts at the engine's life, the other at the gateway's install — so they may never
-- be subtracted from one another. The harness picks the best counter that can answer a period, in
-- the vendor's order, and never mixes them.
--
-- Deny-all RLS: Samsara staging is service-role only, read through the owning collector's interface
-- (D-SEP1, D-SEP7).
--
-- raw-access-waiver: this file creates the samsara raw staging table it names, on behalf of the
-- samsara collector — the owning collector's own DDL, no cross-module read.
create table if not exists samsara_odometer_readings (
  id                  uuid        not null default gen_random_uuid() primary key,
  org_id              uuid        not null references organizations(id) on delete cascade,
  vehicle_id          uuid        not null references vehicles(id) on delete cascade,
  samsara_vehicle_id  text        not null,
  -- The day this reading CLOSES, in the organisation's own timezone. A slot, never an arithmetic
  -- input: every figure is computed from `reading_at` and `meters`.
  day                 date        not null,
  -- The instant Samsara says the counter was read. Never re-derived, never rounded to the day.
  reading_at          timestamptz not null,
  -- The cumulative counter in METRES, exactly as the vendor reports it. Converted at the point of
  -- display, never on the way in — a store that converts is a store that has an opinion.
  meters              numeric(14,1) not null,
  source              text        not null
                        constraint samsara_odometer_readings_source_check
                        check (source in ('obd', 'gps_distance', 'gps_odometer')),
  synced_at           timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

-- One reading per vehicle per day per counter. The counter is in the key because a truck can report
-- both an ECU and a GPS figure for the same day and both are worth keeping.
create unique index if not exists samsara_odometer_readings_identity
  on samsara_odometer_readings (org_id, vehicle_id, source, day);

-- The read path: every reading for a fleet across a window, ordered as the harness wants them.
create index if not exists idx_samsara_odometer_readings_org_at
  on samsara_odometer_readings (org_id, reading_at);

alter table samsara_odometer_readings enable row level security;

comment on table samsara_odometer_readings is
  'Samsara odometer readings staged verbatim — one per vehicle per day per counter, in metres, with the instant the vendor reported (W3, D-FLEET9). Distance over a period is the difference between the two readings that bound it, computed by the harness; this table never stores a distance. Service-role only.';
