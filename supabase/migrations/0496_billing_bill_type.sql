-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- mcleod_billing gains the column that says whether a bill is an invoice or a credit
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- McLeod records a credit memo as its own `billing_history` row with `bill_type = 'C'` and a
-- POSITIVE `total_charges`; only the general ledger knows it is a credit. Measured on the sandbox
-- 2026-10-19 by joining July 2026's GL `BILL` receivable lines (12000000) to `billing_history` on
-- `post_key`: 1,467 invoices (`I`) post +5,028,444.73 and 55 credits (`C`) post −213,124.32, each
-- to the cent of its own `total_charges`. We did not collect `bill_type`, so every reader counted
-- those credits as revenue — $426k of July on the wrong side, 377 credits / $1.34M in 2026 —
-- on the truck, the dispatcher and the week the credited load belonged to
-- (docs/plans/financial/TRUCK-DRIVER-PNL-PLAN.md §1.3 D2). The fleet totals were never wrong: they
-- come from the ledger.
--
-- `canceled` and `rebilled` (0270) do not carry this: both read zero on every 2026 row, because this
-- carrier credits by issuing a `C` bill rather than by flagging the original.
--
-- Staged verbatim and nullable, with no CHECK. 2026 holds only `I` and `C`, but a constraint over a
-- vocabulary we have measured for one year would refuse the first new code McLeod sends and lose the
-- whole sweep batch with it; the readers decide what each value means. Null means "swept before
-- this column existed", and a re-sweep fills it.
--
-- Schema only. The collector, the ingest and every reader name this column one merge later, once
-- it has applied (lint:migration-ordering).
alter table mcleod_billing
  add column if not exists bill_type text;

comment on column mcleod_billing.bill_type is
  'McLeod billing_history.bill_type verbatim: I = invoice, C = credit memo (total_charges stays positive; the credit is the type). Null = swept before 0496.';

-- raw-access-waiver: this migration widens the mcleod raw staging table it names — the owning
-- collector's own DDL, no cross-module read.
