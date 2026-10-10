-- 0453: the dispatch board's ETA, recorded as it is made, so it can be checked against the arrival
-- (DISPATCH-BOARD-PLAN DB7, Q-DB4).
--
-- ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────────────────────
-- Q-DB4 was ruled "distance ETA first, measured against actual arrivals for two weeks before anyone
-- pays HERE for precision". Measured 2026-10-10: nothing could be measured. `boardEta` runs on every
-- board read and is stored nowhere, so once a truck arrives there is no record of what the board said
-- it would do six hours earlier — and the position and HOS clocks it was computed from are current
-- state (`vehicle_positions`, `driver_hos_clocks`), overwritten since. The two weeks start at the
-- first row of this table.
--
-- ── ONE ROW PER (STOP, RECORDING) ────────────────────────────────────────────────────────────────
-- The recorder (`livemap/boardEtaRecorder.ts`) runs hourly and writes one row per truck with a
-- current load and an ETA to its next stop: about 120 rows an hour, ~2,900 a day. A stop is keyed
-- `(load_id, stop_seq)`, McLeod's own order inside the load, which is what `load_stops` carries and
-- what the comparison joins on to `load_stops.actual_arrival_at`. Hourly, not per board read: the
-- error by HOURS OUT is the question, and an hour is that axis's resolution.
--
-- The inputs ride along (`miles`, `rest_added`, `gps_age_seconds`, `hos_known`) because "the ETA was
-- wrong" has three different fixes — a road factor, a planning speed, or a stale position — and the
-- row must be able to say which one it was.
--
-- ── OWNED BY `loads`, NOT `livemap` ──────────────────────────────────────────────────────────────
-- `livemap` owns no table by rule (its index.ts). A prediction is a fact about a load's stop, judged
-- against that stop's arrival, so the loads module owns it and livemap writes through its index.
--
-- `load_id` cascades from `loads`: a prediction for a load that no longer exists measures nothing.
-- `vehicle_id` carries no FK — vehicles are never deleted (`vehicles.status` is the retirement), and a
-- cascade would be one more thing a vehicle merge has to know about.
--
-- ── DERIVED, PRUNED AT 60 DAYS ───────────────────────────────────────────────────────────────────
-- Not evidence: a measurement instrument. 60 days is two fortnight-long measurements with room to
-- re-run one after a basis change (`RETENTION_RULES`, `dataRetentionPolicy.ts`).
--
-- ── RLS: ENABLED, NO POLICY, DENY-ALL ON PURPOSE ─────────────────────────────────────────────────
-- Written and read by the API's service role only; the `.eq("org_id", …)` is the tenant boundary.
--
-- A NEW table, so its writer ships in the same merge (`lint:migration-ordering` exempts new tables).

create table if not exists load_stop_eta_predictions (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  load_id uuid not null references loads(id) on delete cascade,
  -- `load_stops.seq` of the stop the truck was heading to.
  stop_seq integer not null,
  vehicle_id uuid not null,
  -- When the board made the estimate, and what it said.
  predicted_at timestamptz not null,
  eta_at timestamptz not null,
  -- The basis: road miles (straight line × factor), whether a 10-hour reset was added, how old the
  -- GPS fix was, and whether HOS clocks were known at all (null clocks = no reset can be added).
  miles integer not null,
  rest_added boolean not null,
  gps_age_seconds integer,
  hos_known boolean not null,
  -- The appointment's close and the verdict shown, so "on time" can be scored as well as the ETA.
  window_closes_at timestamptz,
  verdict text not null,
  created_at timestamptz not null default now()
);

create index if not exists load_stop_eta_predictions_stop_idx
  on load_stop_eta_predictions (org_id, load_id, stop_seq);
create index if not exists load_stop_eta_predictions_predicted_idx
  on load_stop_eta_predictions (org_id, predicted_at);

alter table load_stop_eta_predictions enable row level security;
