-- FuelGuard — 0019 geocode precision
-- Track how precise each cached geocode is: "site" = we resolved the specific station (tight radius can
-- confirm a fill), "city" = only the town centroid (too coarse to confirm, used for display only).
alter table geocode_cache add column if not exists precision text; -- 'site' | 'city'
