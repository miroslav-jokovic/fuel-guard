-- 0028: persist the tank-rise fueling-event outputs — the truck's ACTUAL observed location at the fill,
-- the post-fill tank level, and HOW the fueling instant was determined (confidence ladder). These make
-- the odometer/location/time audit exact for every reconciled fill, not just flagged mismatches.
alter table fuel_transactions add column if not exists samsara_observed_state   text;
alter table fuel_transactions add column if not exists samsara_observed_city    text;
alter table fuel_transactions add column if not exists samsara_observed_address text;
alter table fuel_transactions add column if not exists samsara_observed_lat     numeric(9,6);
alter table fuel_transactions add column if not exists samsara_observed_lng     numeric(9,6);
alter table fuel_transactions add column if not exists samsara_fuel_pct_after   numeric(5,1);
-- tank_confirmed | stop_estimated | reported | date_only  (null on rows never reconciled)
alter table fuel_transactions add column if not exists fueling_time_basis       text;
