-- 0638: what McLeod says an order pays, in the raw dispatch mirror (LOAD-RATES-PLAN.md R1, D-RATE1).
-- 0639 is the same fact on the loads side (`load_charges`).
--
-- ── WHAT THE OFFICE ASKED FOR ────────────────────────────────────────────────────────────────────
-- Owner, 2026-11-19: show each load's price on Loads and the Dispatch board, admins always, every other
-- role only when switched on in Settings → Permissions. McLeod states it on `orders`, which the
-- connector's login already reads (`SILVICOM-GRANTS.sql`: "Already granted on LME … orders").
--
-- ── WHAT McLEOD HAS (measured on lme_analytics, restored 2026-10-09) ─────────────────────────────
-- Declared: `total_charge`, `freight_charge`, `otherchargetotal` decimal(16,2); `bill_distance`
-- decimal(10,1); `total_charge_c` char(3); `bill_distance_um` char(2). All nullable in McLeod.
-- Loaded movements on orders since 2026-01-01, 13,478 of them:
--   · total = freight + other charges on 13,478 / 13,478 (±$0.01) — one figure and its two parts;
--   · total null 0, zero 10, negative 0; other charges NEGATIVE on 10 (as low as −$1,000) — so no
--     sign CHECK here or in 0639: a credit McLeod recorded is refused by nobody;
--   · currency `USD` and distance unit `MI` on every row.
-- `rate`, `rate_units` and `rate_type` exist too and are deliberately NOT taken: on a flat-rated order
-- (F on 13,453 of 13,478) the linehaul already IS rate × units, and nothing asks for them — a column
-- nothing reads is a column that reads null forever (0383's rule).
--
-- ── THE PRICE IS THE ORDER'S, AND AN ORDER HAS SEVERAL MOVEMENTS ─────────────────────────────────
-- Our load is a McLeod movement; the charge is on the ORDER. Last 90 days, 4,403 orders: 3,631 have one
-- loaded and one empty movement, 45 have two loaded ones. `order_loaded_movements` is how many non-void
-- loaded movements the order has, counted by the connector in the same read, so the projection can
-- give the price to loaded movements only and say "split over N trips" (D-RATE3, D-RATE4) without
-- reading McLeod twice. It is the one column here that is the connector's count, not a McLeod column.
--
-- ── NULL MEANS TWO THINGS UNTIL THE VM IS UPDATED ────────────────────────────────────────────────
-- Every column is nullable with no default. A movement synced before the Board VM runs the new
-- connector reads null: nobody has asked McLeod yet. After it, null is McLeod's own blank. The ingest
-- (R2) tells the two apart from the payload, never from this table (D-RATE9).
--
-- ── SCHEMA ONLY, AND IN ITS OWN MERGE ────────────────────────────────────────────────────────────
-- New columns on a table written every minute, and Railway can serve a merge before `migrate.yml`
-- applies its schema. So nothing names them in this merge (`lint:migration-ordering`): the ingest and
-- the projection follow in R2.
--
-- raw-access-waiver: mcleod collector's own DDL on its own raw table — no cross-module read.

alter table mcleod_dispatch_movements
  add column if not exists total_charge           numeric,  -- orders.total_charge, decimal(16,2)
  add column if not exists freight_charge         numeric,  -- orders.freight_charge (linehaul), decimal(16,2)
  add column if not exists otherchargetotal       numeric,  -- orders.otherchargetotal, decimal(16,2); can be negative
  add column if not exists total_charge_c         text,     -- orders.total_charge_c, char(3): 'USD' on every row measured
  add column if not exists bill_distance          numeric,  -- orders.bill_distance, decimal(10,1)
  add column if not exists bill_distance_um       text,     -- orders.bill_distance_um, char(2): 'MI' on every row measured
  add column if not exists order_loaded_movements integer;  -- the connector's count of the order's non-void loaded movements
