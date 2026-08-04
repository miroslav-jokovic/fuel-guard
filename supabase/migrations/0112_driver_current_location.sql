-- 0112: current city location per driver, sourced from the driver's current truck's GPS snapshot
-- (GET /fleet/vehicles/stats?types=gps — Samsara's own reverse-geocoded `reverseGeo.formattedLocation`,
-- reduced to "City, ST"; no external geocoder involved). Written by the HOS sync alongside the
-- current_hos_* snapshot columns (0111). Display state only: refreshed each sync, cleared when the driver
-- has no truck or the truck has no GPS fix, left untouched when the GPS feed itself errors.
alter table drivers add column if not exists current_location text;

comment on column drivers.current_location is
  'Driver''s current "City, ST" from their current truck''s Samsara GPS snapshot (reverseGeo.formattedLocation). Display only; refreshed by the HOS sync; null when no truck/fix.';
