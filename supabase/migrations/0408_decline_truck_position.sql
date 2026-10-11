-- 0408: where the card's truck was when a card was declined (CF1, docs/plans/fuel/CARD-FRAUD-ALERTS-PLAN.md)
--
-- ── THE GAP ─────────────────────────────────────────────────────────────────────────────────────
-- The decline scorer asks Samsara whether the card's truck was at the station and keeps ONLY the
-- verdict (`samsara_location_matched`, `samsara_location_confidence`). That verdict was right for the
-- stolen card the week of 2026-09-22 — every South Bend, IN attempt on card …27564 scored `alert` —
-- and it was all the notification could say, so it said "Unit 729: 3 — INACTIVE CARD …". The sentence
-- a person can act on ("truck 729 was in Memphis, TN, 496 miles away") needs the truck's position at
-- the attempt, and nothing stored it. The vendor columns that look like it on the raw table
-- (`efs_truck_position_at`, `efs_proximity_miles`, 0079) are 0 of 322 filled over 30 days: EFS's
-- reject export does not carry them, so we measure it ourselves from Samsara.
--
-- ── WHY THE SATELLITE ───────────────────────────────────────────────────────────────────────────
-- A Samsara read made by the scorer is a scoring output, and scoring outputs live in
-- `declined_txn_scores` (0263, D-SEP3), not on the raw EFS reject row. 0263's mirror trigger
-- upserts only the columns it names, so a legacy write on `declined_transactions` cannot clear
-- these.
--
-- ── A MEASUREMENT, NO VERDICT ───────────────────────────────────────────────────────────────────
-- The GPS sample nearest the attempt within 30 minutes (`truckPositionAt`, TRUCK_POSITION_MAX_GAP_MIN),
-- with the SAMPLE'S own instant so the alert can name its source and time, plus the great-circle
-- miles to the station's geocode. What a distance means is the incident fold's (CF2), read in
-- TypeScript (`sql-returns-measurement-ts-owns-verdict`). NULL IS "NOT MEASURED": no sample near
-- enough, no Samsara mapping, or scored before this shipped. It is never read as "at the station".
-- `truck_station_miles` alone may be null with a position present (the station had no geocode).
--
-- ── DEPLOY WINDOW ───────────────────────────────────────────────────────────────────────────────
-- Additive: seven nullable columns on a table only the anomalies scorer writes. Old code never
-- names them; the writer and the first reader ship in the next merge (lint:migration-ordering).

alter table public.declined_txn_scores
  add column truck_position_at   timestamptz,
  add column truck_lat           numeric(9,6),
  add column truck_lng           numeric(9,6),
  add column truck_city          text,
  add column truck_state         text,
  add column truck_address       text,
  add column truck_station_miles numeric(7,1);

alter table public.declined_txn_scores
  add constraint declined_txn_scores_truck_position_all_or_none check (
    (truck_position_at is null and truck_lat is null and truck_lng is null
       and truck_city is null and truck_state is null and truck_address is null and truck_station_miles is null)
    or (truck_position_at is not null and truck_lat is not null and truck_lng is not null)
  ),
  add constraint declined_txn_scores_truck_station_miles_nonneg check (
    truck_station_miles is null or truck_station_miles >= 0
  );

comment on column public.declined_txn_scores.truck_position_at is
  'Instant of the Samsara GPS sample nearest the decline (within 30 min). NULL = not measured, never "at the station". CF1 (0408).';
comment on column public.declined_txn_scores.truck_station_miles is
  'Great-circle miles from that sample to the station geocode. NULL = no position, or the station has no geocode. CF1 (0408).';
