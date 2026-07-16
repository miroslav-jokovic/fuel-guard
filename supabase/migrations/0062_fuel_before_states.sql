-- 0062: "fuel before entering" states for planned fueling.
-- These states require a top-off before the truck crosses the border (sparse fueling infrastructure —
-- e.g. Massachusetts has essentially one truck stop), but UNLIKE avoid_states their stations stay usable
-- for a normal fill. Detected the same way as avoid_states (reverse-geocode + binary search on the route).

alter table route_fuel_settings
  add column if not exists fuel_before_states text[] not null default '{MA}';
