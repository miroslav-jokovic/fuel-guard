-- FuelGuard — 0020 pre-fill tank level
-- Stores the Samsara tank level (%) just before each fill, so the physical tank-space check
-- (billed gallons vs. empty space in the tank) can run — including on rules-only rebuilds.
alter table fuel_transactions add column if not exists samsara_fuel_pct_before numeric(5,1);
