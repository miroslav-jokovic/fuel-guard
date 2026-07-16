-- 0061: min-drawdown fill cap for planned fueling.
-- Adds a per-org cap (% of tank) applied to a NON-cheapest partial fill, and switches the default fueling
-- policy to min-drawdown (buy just enough to reach the next cheaper stop) rather than always topping off.
-- Full fills still happen at the cheapest reachable stop and for the California border top-off, regardless.

alter table route_fuel_settings
  add column if not exists fill_cap_pct numeric not null default 75;  -- cap for non-cheapest partial fills (% of tank)

-- New orgs default to min-drawdown.
alter table route_fuel_settings
  alter column always_fill_full set default false;

-- The always_fill_full flag was inert before this release (the solver always topped off), so any stored `true`
-- is the old default, not a deliberate choice — switch existing orgs to the new min-drawdown default.
update route_fuel_settings set always_fill_full = false where always_fill_full;
