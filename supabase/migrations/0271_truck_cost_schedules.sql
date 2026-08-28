-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- truck_cost_schedules — the fixed costs McLeod structurally cannot attribute, entered per contract
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- The gap this closes (T1, docs/plans/financial/TRUCK-COST-ATTRIBUTION-PLAN.md): about $573k/month
-- of the June 2026 income statement — VIP Lease $400,000, insurance ~$161k net, GPS fees $11,663 —
-- reaches McLeod as vendor invoices and bank-statement entries carrying an account code and nothing
-- else. 0 of 188,179 gl_ledger lines carry a tractor (measured 2026-08-26, D-MC12), so no
-- extraction can ever put a lease payment on the truck that leases. The office CAN: the signed
-- contracts and policy schedules name units and monthly amounts. This table stores exactly that
-- knowledge, and the CPM harness charges it per truck alongside the measured direct costs — kept
-- apart from them at every level, because a schedule is a contract's assertion, not a measurement.
--
-- Why month-aligned ranges and whole-month charging: the amounts ARE monthly (a lease payment, a
-- premium instalment), and the owner's requirement is precision without improvisation — prorating a
-- monthly premium to a mid-month window invents daily granularity the contract does not have. So
-- `effective_from`/`effective_to` are constrained to first-of-month, the range is half-open
-- [from, to), and a month is charged whole when the range covers its first day. The charging rule
-- is printed in the report caveat, never hidden in code.
--
-- Rejected: deriving these figures from AP vouchers. The lessor is paid in blended cheques
-- (voucher_hist has amounts per vendor, not per unit), so a voucher-derived split would be exactly
-- the invented attribution D-FS5 forbids. The vouchers stay what they are — the control the
-- schedule's fleet totals are eyeballed against (the caveat prints per-category schedule totals so
-- an incomplete schedule is visible against the P&L line, e.g. VIP Lease ≈ $400k).
--
-- Rows are corrections-in-place (this is configuration, not evidence): an amount change mid-year is
-- modelled by CLOSING the old row (set effective_to) and adding a new one, so history stays
-- reconstructable; the API audits every write. Deny-all RLS on purpose — the accounting surface is
-- API-only (D-SEP7), service role with org scoping.
create table if not exists truck_cost_schedules (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,

  -- The harness's bucket key (movements/settlements attribute by tractor unit, not vehicle id).
  -- Free text on purpose: a leased unit may predate its first Samsara sync or McLeod movement.
  unit_number     text not null constraint truck_cost_schedules_unit_not_blank check (length(trim(unit_number)) > 0),

  -- Categories mirror the P&L families this plan attributes (T1 scope). `permit` here is a
  -- per-unit permit with a fixed monthly cost; jurisdiction taxes allocated by measured state
  -- miles are T2's business, not rows in this table.
  category        text not null
                    constraint truck_cost_schedules_category_check
                    check (category in ('lease', 'insurance', 'gps', 'permit', 'other')),

  -- The contract's own wording — "VIP Lease unit 1234", the policy number — so a reviewer can
  -- trace a charged dollar back to paper without asking anyone.
  label           text not null constraint truck_cost_schedules_label_not_blank check (length(trim(label)) > 0),

  monthly_amount  numeric(12,2) not null
                    constraint truck_cost_schedules_amount_positive check (monthly_amount > 0),

  -- Half-open [effective_from, effective_to), both first-of-month (see header for why).
  effective_from  date not null
                    constraint truck_cost_schedules_from_month_aligned check (extract(day from effective_from) = 1),
  effective_to    date
                    constraint truck_cost_schedules_to_month_aligned
                    check (effective_to is null or (extract(day from effective_to) = 1 and effective_to > effective_from)),

  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The CPM read path: every schedule row for an org touching a window's months.
create index if not exists idx_truck_cost_schedules_org_unit
  on truck_cost_schedules (org_id, unit_number, effective_from);

alter table truck_cost_schedules enable row level security;
