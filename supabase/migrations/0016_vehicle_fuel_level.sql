-- FuelGuard — 0016 Current fuel level from Samsara
-- Samsara's OBD fuel-percentage reading (`fuelPercents`) pulled onto each vehicle during sync, so the
-- Vehicles page can show the truck's current tank level. (Tank CAPACITY in gallons and baseline MPG
-- are not telematics data — capacity stays manual; baseline MPG is derived from fuel history.)

alter table vehicles
  add column samsara_fuel_percent numeric(5,1),  -- 0..100 (%)
  add column samsara_fuel_at      timestamptz;   -- when that reading was taken
