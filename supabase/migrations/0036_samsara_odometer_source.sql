-- 0036: record WHERE the fueling-time Samsara odometer came from, for transparency + confidence.
--   'obd'           – read straight from the truck's ECU (most accurate)
--   'gps'           – Samsara's GPS-derived odometer (used when the ECU doesn't report one)
--   'reconstructed' – no reading stamped near the fill, so it was rebuilt from the nearest reading + the
--                     driven GPS distance to the fueling moment (lowest-confidence tier)
alter table fuel_transactions add column if not exists samsara_odometer_source text
  check (samsara_odometer_source in ('obd', 'gps', 'reconstructed'));
