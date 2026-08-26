-- 0257: the financial fact store — every earning and every expense, from every source, in one place
-- that cannot double-count.
--
-- ── THE PROBLEM THIS SCHEMA EXISTS TO SOLVE ──────────────────────────────────────────────────────
-- The obvious design is one table that every integration writes its rows into. It produces totals two
-- to three times reality, and the reason is not carelessness — it is that a single payment genuinely
-- exists many times in the source systems, and each copy looks like a legitimate row:
--
--   · WITHIN McLEOD, one driver settlement is an accrual under GL module SET, a payment under DRS, a
--     row in drs_check, and lines in gl_ledger. Four records, one payment (D-MC13).
--   · ACROSS McLEOD TABLES, June 2026's fuel is $1,017,601.81 in fuel_detail_hist, the same
--     $1,017,601.81 in GL account 20550000, and the same $1,017,601.81 again in the PILOKNTN accounts-
--     payable invoices. Three representations agreeing to the cent (D-MC21, spec §5.5).
--   · ACROSS SOURCES, that same fuel is what EFS already writes into `fuel_transactions`.
--
-- So one purchase can present as FOUR defensible rows. A convention — "remember to filter" — fails the
-- first time somebody writes a report without reading the docs. This schema makes the guarantee
-- structural instead: entries that represent the same money share a `dedup_key`, and a partial unique
-- index permits exactly ONE canonical row per key. A report that reads
-- `where is_canonical and not is_void` cannot double-count, because the database will not hold the
-- second row that would let it.
--
-- ── WHY BOTH DETAIL TABLES AND A CANONICAL TABLE ─────────────────────────────────────────────────
-- The per-source tables keep each system's own shape, its own keys and its own reconciliation. That is
-- what lets `mcleod_settlements` prove itself against GL module SET to the cent, and what makes each
-- table reusable for questions this store was not designed for. `financial_entries` is the projection:
-- narrow, uniform, searchable, and the only thing a report needs to sum. Drill-down runs the other
-- way, from an entry back to the row it came from.
--
-- Standard warehouse shape — staging plus fact — and the split is the point. Flatten it into one table
-- and you lose the reconciliation; keep only the detail tables and every report re-implements the
-- dedup rules, which is exactly where double-counting comes back.
--
-- ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────────────────────────
-- No allocation, no cost-per-mile, no overhead spreading. `financial_entries` holds what a source
-- ASSERTED; `vehicle_id` is null wherever McLeod itself carries no tractor, which is every accounts-
-- payable voucher and every office-settlement line. Filling those in is a policy decision belonging to
-- the reporting harness with finance's sign-off, and a store that guessed would make the guess
-- permanent and untraceable (D-MC12, D-MC28).
--
-- No RLS policies on any of these tables. RLS is enabled and no client policy is granted, so a browser
-- session reads nothing at all — deliberate, per CLAUDE.md. The API reads with the service role and
-- org-scopes every query itself.

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- financial_entries — the canonical fact
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists financial_entries (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,

  -- Earning or expense. Not a sign convention: `amount` stays positive and `direction` carries the
  -- meaning, so a report cannot mistake a credit memo for revenue by reading a minus sign. A refund is
  -- an expense with a negative amount, which is a different thing from an earning.
  direction       text not null
                    constraint financial_entries_direction_check
                    check (direction in ('earning', 'expense')),

  -- What kind of money, in FuelGuard's vocabulary rather than any vendor's. Deliberately coarse: a
  -- finer classification belongs in the detail tables, where it can be vendor-specific without
  -- forcing every future source to adopt McLeod's words.
  category        text not null
                    constraint financial_entries_category_check
                    check (category in (
                      'fuel',                 -- diesel, DEF, reefer fuel
                      'driver_pay',           -- company-driver settlement
                      'contractor_pay',       -- owner-operator settlement: buys the whole trip
                      'ap_expense',           -- accounts-payable voucher, unattributed by nature
                      'office',               -- office payroll, bonuses, staff reimbursement
                      'maintenance',          -- FleetPal, later
                      'linehaul_revenue',     -- the freight bill
                      'accessorial_revenue',  -- fuel surcharge, detention, lumper, stop-off
                      'other'
                    )),

  amount          numeric(14,2) not null,
  currency        char(3) not null default 'USD',

  -- WHEN THE ECONOMICS HAPPENED, not when cash moved. For settlement that is `accrual_date`, for
  -- billing the bill date, for fuel the transaction time (D-MC19). `settled_at` carries the cash date
  -- for the questions that genuinely want it. Reporting periods key off `occurred_at`; mixing the two
  -- silently compares different months, which is how the first settlement reconciliation missed by
  -- $135,000.
  occurred_at     timestamptz not null,
  settled_at      timestamptz,

  -- Attribution EXACTLY as the source asserted it. Null is a fact here, not a gap to be filled:
  -- gl_ledger populates its tractor column on 0 of 188,179 lines, and voucher_dist on 0 of 397.
  -- `on delete restrict` on vehicle and driver so history cannot be silently orphaned by a deletion;
  -- a load may legitimately vanish from dispatch, so that one nulls.
  vehicle_id      uuid references vehicles(id) on delete restrict,
  driver_id       uuid references drivers(id)  on delete restrict,
  load_id         uuid references loads(id)    on delete set null,

  -- Provenance and drill-down. `source_row_id` is intentionally NOT a foreign key: it points into
  -- whichever detail table `source_table` names, and a polymorphic FK cannot be declared. The pairing
  -- is enforced by the ingest service and covered by the matrix.
  source          text not null
                    constraint financial_entries_source_check
                    check (source in ('mcleod', 'efs', 'fleetpal', 'manual')),
  source_table    text not null,
  source_row_id   uuid,
  external_id     text not null,

  -- ── THE DOUBLE-COUNT CONTROLS ──────────────────────────────────────────────────────────────────
  -- Which view of the payment this row is. An accrual and its payment are both true and must never be
  -- summed together.
  lifecycle_stage text not null
                    constraint financial_entries_lifecycle_check
                    check (lifecycle_stage in ('accrual', 'payment', 'invoice')),

  -- Entries representing THE SAME MONEY share this key, whatever source or lifecycle stage they came
  -- from. It is the ingest service's job to compute it — e.g. a fuel purchase keyed on card, pump
  -- timestamp and gallons collides whether it arrived from EFS or from McLeod.
  dedup_key       text not null,

  -- Exactly one entry per dedup_key may carry this, enforced below. Everything else is retained for
  -- audit and drill-down but is invisible to any report that filters on it.
  is_canonical    boolean not null default true,

  -- A voided settlement or voucher is money that never moved. First-class rather than a filter applied
  -- at extraction time, so the row survives for audit and no report can forget to exclude it: 925 of
  -- 2026's settlements are voided, carrying $339,985 that was never paid (D-MC18).
  is_void         boolean not null default false,

  -- Reconciliation keys, kept so an entry can be proved against the carrier's own books.
  ledger_post_key text,
  ledger_module   text,
  ledger_account  text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- THE GUARANTEE. One canonical, non-void entry per dedup_key per org. The second insert that would
-- let a report double-count is refused by the database rather than caught by a reviewer.
create unique index if not exists uq_financial_entries_canonical
  on financial_entries (org_id, dedup_key)
  where is_canonical and not is_void;

-- Idempotency: re-running a sweep updates rather than duplicates.
create unique index if not exists uq_financial_entries_source_row
  on financial_entries (org_id, source, source_table, external_id);

-- The reporting access paths. Every one filters on the canonical predicate, because that is how every
-- report must read the table.
create index if not exists idx_financial_entries_org_time
  on financial_entries (org_id, occurred_at desc) where is_canonical and not is_void;
create index if not exists idx_financial_entries_vehicle
  on financial_entries (org_id, vehicle_id, occurred_at desc) where is_canonical and not is_void;
create index if not exists idx_financial_entries_category
  on financial_entries (org_id, category, occurred_at desc) where is_canonical and not is_void;
create index if not exists idx_financial_entries_driver
  on financial_entries (org_id, driver_id, occurred_at desc) where is_canonical and not is_void;
-- Payments must be individually searchable, which means reaching one by its own reference.
create index if not exists idx_financial_entries_external
  on financial_entries (org_id, external_id);

create trigger trg_financial_entries_updated before update on financial_entries
  for each row execute function set_updated_at();

alter table financial_entries enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- mcleod_settlements — driver and owner-operator pay, as McLeod recorded it
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Reconciles to GL module SET on `accrual_key`, which posts exactly one payable line per settlement:
-- 2,751 keys to 2,751 lines in June 2026, $1,262,893.74 against $1,262,893.74 (D-MC23).
create table if not exists mcleod_settlements (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  external_id       text not null,                       -- drs_settle_hist.id

  tractor_unit      text,
  trailer_unit      text,
  driver_external_id text,
  movement_external_id text,
  order_external_id text,

  payee_id          text,
  payee_type        text not null default 'other'
                      constraint mcleod_settlements_payee_type_check
                      check (payee_type in ('company_driver', 'owner_operator', 'other')),
  pay_method        text,

  accrued_at        timestamptz,
  paid_at           timestamptz,
  transferred_at    timestamptz,

  -- What the payee received. The cost figure.
  total_pay         numeric(14,2) not null default 0,
  -- What the ledger recorded at accrual. The figure that reconciles, and NOT the same number:
  -- $1,268,565.31 against $1,262,893.74 in June 2026, the gap being post-accrual adjustments on
  -- owner-operator rows (D-MC24). Both are kept because each answers a different question.
  posted_pay        numeric(14,2) not null default 0,

  -- McLeod's own pay basis. NOT a cost-per-mile denominator — `billed_distance` on the same table is
  -- the order's distance repeated per movement, and neither column declares a unit (D-MC17).
  pay_distance      numeric(10,1),

  is_void           boolean not null default false,
  accrual_key       text,
  post_key          text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists uq_mcleod_settlements_external
  on mcleod_settlements (org_id, external_id);
create index if not exists idx_mcleod_settlements_tractor
  on mcleod_settlements (org_id, tractor_unit, accrued_at desc);
create index if not exists idx_mcleod_settlements_accrual_key
  on mcleod_settlements (org_id, accrual_key);
create trigger trg_mcleod_settlements_updated before update on mcleod_settlements
  for each row execute function set_updated_at();
alter table mcleod_settlements enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- mcleod_ap_vouchers — the carrier's non-fuel payables
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Structurally unattributed: voucher_hist has no equipment column, and voucher_dist has `tractor` and
-- `trailer` and populates them on 0 of 397 rows. `ap_glid` is the only classification the source
-- carries, which is why it is indexed — it is where a finance decision about "which spend is a cost of
-- running trucks" has to be expressed.
--
-- ⚠ These rows INCLUDE the fuel-card invoices. 59 of June 2026's 183 expense rows are the fuel vendor,
-- totalling the same $1,017,601.81 that fuel already accounts for. The ingest gives those a dedup_key
-- matching the fuel entry so only one survives as canonical.
create table if not exists mcleod_ap_vouchers (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  external_id       text not null,                       -- voucher_hist.id

  voucher_no        integer,
  -- 'D' distribution, 'R' regular invoice, 'P' payment. The payment leg is excluded at extraction:
  -- this table stores the expense side only, because voucher_hist holds each voucher as an offsetting
  -- PAIR and summing it whole returns exactly $0.00 across 366 rows — a number that reads as an empty
  -- month rather than a bug (spec §5.5).
  voucher_type      text,
  vendor_id         text,
  invoice_number    text,
  purchase_order_no text,
  description       text,

  invoice_date      timestamptz,
  due_date          timestamptz,
  distribution_date timestamptz,

  amount            numeric(14,2) not null default 0,
  discount_amount   numeric(14,2) not null default 0,
  ap_glid           text,

  is_paid           boolean not null default false,
  check_number      text,
  post_key          text,
  post_module       text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists uq_mcleod_ap_vouchers_external
  on mcleod_ap_vouchers (org_id, external_id);
create index if not exists idx_mcleod_ap_vouchers_account
  on mcleod_ap_vouchers (org_id, ap_glid, invoice_date desc);
create index if not exists idx_mcleod_ap_vouchers_vendor
  on mcleod_ap_vouchers (org_id, vendor_id, invoice_date desc);
create trigger trg_mcleod_ap_vouchers_updated before update on mcleod_ap_vouchers
  for each row execute function set_updated_at();
alter table mcleod_ap_vouchers enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- mcleod_billing — the earnings side
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Reconciles to GL module BILL on the receivable account, one line per invoice: 1,595 keys to 1,595
-- lines in June 2026.
--
-- Unlike every expense table here, billing DOES carry equipment — `tractor_id`, `driver_id`,
-- `trailer_id` — so revenue per truck is available directly and does not need an allocation rule. That
-- makes margin per truck answerable on the same terms as cost per mile.
--
-- `invoiced_flag` is deliberately absent: it reads 'N' on all 1,640 June rows, so it does not
-- discriminate and a filter built on it would return nothing.
create table if not exists mcleod_billing (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  external_id       text not null,                       -- billing_history.id

  invoice_no        text,
  customer_id       text,
  order_external_id text,
  master_order_id   text,

  tractor_unit      text,
  trailer_unit      text,
  driver_external_id text,

  bill_date         timestamptz,
  ship_date         timestamptz,
  delivery_date     timestamptz,
  transfer_date     timestamptz,

  -- The freight bill, and the accessorials billed on it. Held apart because they answer different
  -- questions: linehaul is the lane's worth, accessorials are what went wrong or extra on the day.
  total_charges     numeric(14,2) not null default 0,
  other_charge      numeric(14,2) not null default 0,
  excise_tax        numeric(14,2) not null default 0,

  post_key          text,
  post_module       text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists uq_mcleod_billing_external
  on mcleod_billing (org_id, external_id);
create index if not exists idx_mcleod_billing_tractor
  on mcleod_billing (org_id, tractor_unit, bill_date desc);
create index if not exists idx_mcleod_billing_customer
  on mcleod_billing (org_id, customer_id, bill_date desc);
create index if not exists idx_mcleod_billing_post_key
  on mcleod_billing (org_id, post_key);
create trigger trg_mcleod_billing_updated before update on mcleod_billing
  for each row execute function set_updated_at();
alter table mcleod_billing enable row level security;
