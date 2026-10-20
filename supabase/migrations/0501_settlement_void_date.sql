-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- mcleod_settlements gains the date a void reverses the ledger on
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Driver pay per truck has to be the figure the general ledger books, or no per-truck month adds up
-- to the income statement. Every report reads `total_pay` today; the ledger books something else.
-- Measured on the sandbox 2026-10-19 (TMS, May–August 2026), the ledger's two settlement modules are
-- reproduced from `drs_settle_hist` by one rule:
--
--   · SET posts `orig_posted_pay` on the ACCRUAL date, once per `accrual_key`. A key carried by
--     several rows (a voided row and its re-issue — 302 keys in June) posts the live row's pay once:
--     302 of 302 exact. A key carried by one row posts that row's pay, voided or not: 2,569 of 2,569.
--   · SETV reverses a voided, posted row on its VOID date, joined on `post_key`, for −`orig_posted_pay`:
--     46 of 46 July keys exact, and the monthly SETV total to the cent in all four months
--     (−34,420.33 / −118,641.54 / −47,338.00 / −114,996.83).
--
-- What is left is SET lines with no settlement row at all ("Payable from Settlement", $1.1k–$8.2k a
-- month), reported as a named residual rather than absorbed. `total_pay` misses the ledger by 3–7%
-- a month (docs/plans/financial/TRUCK-DRIVER-PNL-PLAN.md §1.3 D3).
--
-- `void_date` is the one input the rule needs that we do not stage: `is_void` says a row was
-- reversed, not in which month. Nullable, verbatim; null on a live row, and null on every row swept
-- before this migration until the next sweep refills it. Schema only — the collector and the reader
-- follow one merge later (lint:migration-ordering).
alter table mcleod_settlements
  add column if not exists void_date timestamptz;

comment on column mcleod_settlements.void_date is
  'McLeod drs_settle_hist.void_date verbatim (org local wall time labelled UTC, like every McLeod stamp — 0305). The month GL module SETV reverses a voided settlement in. Null = live, or swept before 0501.';

-- raw-access-waiver: this migration widens the mcleod raw staging table it names — the owning
-- collector's own DDL, no cross-module read.
