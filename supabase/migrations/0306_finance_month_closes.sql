-- Silvicom 360 — 0306 finance_month_closes: the monthly close, persisted (D-FIN14,
-- docs/plans/financial/FINANCE-GO-LIVE-PLAN.md §1.14). New table; its writer is the financial
-- module's close pass (monthClose.ts), which lands in the same merge — a new table needs no
-- deploy-window split.
--
-- What gap. "100% precise" had no instrument. Ledger coverage DISPLAYED drift and asserted
-- nothing; the June 2026 proof of 2026-08-28 lived in a handoff file and could not be re-run
-- without a person; the CPM report's tie-out (D-FIN11) held for one request and was forgotten.
-- A month was "hardened" when somebody remembered it had been.
--
-- What this table is. One row per (organisation, McLeod company, month): every bucket the GL
-- anchor sorts the income statement into, every tie-out residual the sweeps can measure, the
-- sweep stamp the figures were computed from, and a status that is `hardened` ONLY when the month
-- is at least two months old — McLeod's manual entries land about a month late — AND every
-- residual reads 0.00. Anything else is `open`, with the residuals named. A hardened month whose
-- figures change on a later sweep is a finding (financialFreshness), never a silent update.
--
-- Why a table and not a view. The close is a fact about a MOMENT — "as of the sweep of
-- 2026-09-02 these numbers tied" — and a view would recompute it from whatever staging holds now.
-- The pages print the status and the date; an auditor reads the row.
--
-- Rollback: drop the table. No other data is migrated by this file.

create table if not exists finance_month_closes (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade,
  /** The McLeod company the books belong to (0303) — the close is per legal entity. */
  company_id            text not null,
  period_start          date not null,                 -- first day of month
  period_end            date not null,                 -- first day of next month, half-open

  /** The financial sweep stamp the figures were computed from (org_integrations.mcleod_financial). */
  swept_at              timestamptz,
  computed_at           timestamptz not null default now(),

  -- The income statement as the GL states it.
  gl_revenue            numeric(16,2) not null default 0,
  gl_expenses           numeric(16,2) not null default 0,

  -- The buckets the GL anchor sorts expenses into (cpmTieOut.ts). They sum to gl_expenses when
  -- `anchored`; `cpm_residual` is the proof.
  anchored              boolean not null default false,
  attributed_direct     numeric(16,2) not null default 0,
  fixed_charged         numeric(16,2) not null default 0,
  allocated_overhead    numeric(16,2) not null default 0,
  unallocated_overhead  numeric(16,2) not null default 0,
  owner_operator_pool   numeric(16,2) not null default 0,
  cpm_residual          numeric(16,2),

  -- Per-module tie-outs from ledger coverage, null when the module has no sweep behind it.
  settlement_drift      numeric(16,2),
  billing_drift         numeric(16,2),
  fuel_residual         numeric(16,2),

  status                text not null default 'open' check (status in ('open', 'hardened')),
  /** Why the month is open, one reason per line — printed on the page, never inferred from nulls. */
  open_reasons          text[] not null default '{}',

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists uq_finance_month_closes_key
  on finance_month_closes (org_id, company_id, period_start);
create index if not exists idx_finance_month_closes_org_period
  on finance_month_closes (org_id, period_start desc);

create trigger trg_finance_month_closes_updated before update on finance_month_closes
  for each row execute function set_updated_at();

-- Service-role only: the close is computed by the financial module and read through the
-- accounting section's role-gated API, never directly by a client (deny-all on purpose).
alter table finance_month_closes enable row level security;

comment on table finance_month_closes is
  'module=financial; layer=core. The monthly close (0306, D-FIN14): one row per org, McLeod company and month with every GL-anchor bucket and tie-out residual as of a sweep stamp; hardened only when the month is two months old and every residual is 0.00.';
comment on column finance_month_closes.status is
  'open | hardened. Hardened means: period at least two months old at computation, the CPM anchor held, and cpm_residual, settlement_drift, billing_drift and fuel_residual all 0.00. Any later change to a hardened month is a finding, not an update.';
