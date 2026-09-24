-- 0367: the unit McLeod states a load's weight in, kept beside the weight (LOADS-MIRROR-PLAN.md LR3).
--
-- ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────────────────────
-- 0364 stores `orders.weight` but not `orders.weight_um`, so the raw copy holds a number without its
-- unit. 0366 then named the core column `weight_lbs` on the strength of a measurement — 69 of 69
-- weighted orders on the open board were `weight_um = 'LB'` on 2026-09-24 — and left LR4's projection
-- to convert or refuse any other unit. It cannot do either from a row that never says which unit it
-- was. Found while building LR3's writer, before a row had been written.
--
-- The rejected alternative was to have the agent send the weight only when the unit is LB and null
-- otherwise. That is the collector interpreting McLeod's facts instead of keeping them (D-LMR3), and
-- a kilogram load would arrive looking exactly like an unweighed one.
--
-- ── SCHEMA ONLY ──────────────────────────────────────────────────────────────────────────────────
-- A new column on an existing table, so its writer (LR3) ships in a later merge
-- (`lint:migration-ordering`). Nothing writes the table yet, so there is no row to backfill.
-- Nullable, no default: a weight with no stated unit is exactly that.
--
-- raw-access-waiver: the mcleod collector's own DDL on its own raw table — no cross-module read.

alter table mcleod_dispatch_movements
  add column if not exists weight_um text;               -- orders.weight_um, char: 'LB' measured
