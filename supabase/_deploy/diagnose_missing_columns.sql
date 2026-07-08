-- FuelGuard — diagnose missing columns/tables (migrations 0016 → 0032)
-- Read-only. Lists every column the current app expects that is NOT present in your database, so you
-- can see the full extent of the drift in one shot instead of discovering errors one by one.
-- Run this in the Supabase SQL editor. An EMPTY result = your schema is complete.

with expected(tbl, col) as (values
  -- 0016
  ('vehicles','samsara_fuel_percent'), ('vehicles','samsara_fuel_at'),
  -- 0017
  ('imports','file_hash'),
  -- 0018
  ('fuel_transactions','samsara_location_confidence'), ('fuel_transactions','station_lat'), ('fuel_transactions','station_lng'),
  -- 0019
  ('geocode_cache','precision'),
  -- 0020
  ('fuel_transactions','samsara_fuel_pct_before'),
  -- 0022
  ('declined_transactions','suspicion_level'), ('declined_transactions','suspicion_reasons'),
  ('declined_transactions','samsara_location_matched'), ('declined_transactions','samsara_location_confidence'),
  ('declined_transactions','station_lat'), ('declined_transactions','station_lng'), ('declined_transactions','scored_at'),
  -- 0023
  ('anomalies','fueled_at'),
  -- 0024
  ('organizations','last_digest_at'),
  -- 0025  (the reported error)
  ('vehicles','odometer_offset'), ('vehicles','odometer_offset_source'),
  -- 0026
  ('fuel_transactions','fueled_at_precision'), ('imports','summary'), ('geocode_cache','updated_at'),
  -- 0028
  ('fuel_transactions','samsara_observed_state'), ('fuel_transactions','samsara_observed_city'),
  ('fuel_transactions','samsara_observed_address'), ('fuel_transactions','samsara_observed_lat'),
  ('fuel_transactions','samsara_observed_lng'), ('fuel_transactions','samsara_fuel_pct_after'),
  ('fuel_transactions','fueling_time_basis'),
  -- 0029
  ('fuel_transactions','tank_type'),
  -- 0030 / 0032 (trailers)
  ('trailers','unit_number'), ('trailers','reefer_tank_capacity_gal'), ('trailers','assigned_vehicle_id'),
  ('trailers','samsara_asset_id'), ('trailers','is_reefer'),
  -- 0031
  ('anomaly_thresholds','max_reefer_burn_gph'), ('anomaly_thresholds','reefer_tank_default_gal')
)
select e.tbl as missing_in_table, e.col as missing_column
from expected e
left join information_schema.columns c
  on c.table_schema = 'public' and c.table_name = e.tbl and c.column_name = e.col
where c.column_name is null
order by e.tbl, e.col;
