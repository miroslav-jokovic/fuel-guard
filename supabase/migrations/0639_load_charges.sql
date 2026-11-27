-- 0639: what a load pays, kept where no browser can read it (LOAD-RATES-PLAN.md R1, D-RATE2).
-- 0638 is the same fact in the raw McLeod mirror, which the projection reads to write this table.
--
-- ── WHY A TABLE OF ITS OWN, AND NOT COLUMNS ON `loads` ───────────────────────────────────────────
-- `loads` is readable from the browser, column by column, by every member of the org (`loads_select`,
-- 0085: `org_id = auth_org_id()`), and a driver reads their own loads (`loads_driver_scope`, 0087/0371).
-- A price on `loads` would reach every office role and every driver through PostgREST, whatever the
-- screens hide and whatever Settings → Permissions says. The owner's rule is the opposite: admins
-- always, every other role only when an admin switches "See load rates" on (D-RATE6). So the figures
-- live here, with RLS on and NO policy: deny-all from the browser. Only the API's service role reads
-- them, and it sends them only to a caller who holds the switch (D-RATE7).
--
-- ── ONE ROW PER PRICED LOAD ──────────────────────────────────────────────────────────────────────
-- Written by the mirror projection (R2) from the raw McLeod mirror (0638), for LOADED movements only:
-- an empty movement repeats its order's charge (3,631 of 4,403 orders in 90 days have one), and
-- showing it would count the same freight twice (D-RATE3). A load with no row has no price to show.
-- A row exists only when McLeod stated a total, so `total_charge` is NOT NULL; its two parts may be
-- blank in McLeod and are kept nullable.
--
-- Figures are McLeod's, verbatim, at McLeod's precision (decimal(16,2) money, decimal(10,1) miles).
-- No sign CHECK: McLeod records negative other charges (10 orders since 2026-01-01, as low as −$1,000)
-- and a CHECK would refuse the whole board post over a real credit. `billed_miles` is the ORDER's billed
-- distance, written only when McLeod's unit is miles (D-RATE5); rate per mile is computed when read,
-- never stored. `order_loaded_movements` > 1 marks an order split over that many loaded trips: each
-- leg shows the order's whole total, labelled, because McLeod never divides it (D-RATE4).
--
-- ── NOT EVIDENCE ─────────────────────────────────────────────────────────────────────────────────
-- Rebuilt from the raw mirror by re-running the projection; not in RETENTION_FORBIDDEN, no
-- append-only trigger. It goes with its load (`on delete cascade`) and its organization.
--
-- ── SCHEMA ONLY ──────────────────────────────────────────────────────────────────────────────────
-- A new table, so `lint:migration-ordering` would allow its writer in this merge. It ships without one
-- anyway, because the writer reads 0638's new columns, and those may not share a merge with their
-- reader. `check-table-producers.mjs` carries a waiver naming R2 until then.
--
-- Rollback: drop table public.load_charges; (nothing reads or writes it until R2).

create table if not exists load_charges (
  load_id                uuid primary key references loads(id) on delete cascade,
  org_id                 uuid not null references organizations(id) on delete cascade,
  total_charge           numeric(16,2) not null,  -- orders.total_charge: what the customer pays for the order
  linehaul               numeric(16,2),           -- orders.freight_charge
  other_charges          numeric(16,2),           -- orders.otherchargetotal; can be negative
  currency               text,                    -- orders.total_charge_c, trimmed: 'USD' on every row measured
  billed_miles           numeric(10,1),           -- orders.bill_distance, only when bill_distance_um = 'MI'
  order_loaded_movements integer check (order_loaded_movements is null or order_loaded_movements >= 0),
  updated_at             timestamptz not null default now()
);

create index if not exists load_charges_org_idx on load_charges (org_id);

alter table load_charges enable row level security;

-- A row never walks into another tenant (0161's invariant, as 0564 applies it).
drop trigger if exists trg_load_charges_org_immutable on load_charges;
create trigger trg_load_charges_org_immutable
  before update on load_charges
  for each row execute function forbid_org_change();

comment on table load_charges is
  'What each loaded McLeod load pays (LOAD-RATES-PLAN D-RATE2). Projected from the raw McLeod mirror (0638); API-only: RLS on, no policies, sent only to callers holding dispatch.load_rates.';
