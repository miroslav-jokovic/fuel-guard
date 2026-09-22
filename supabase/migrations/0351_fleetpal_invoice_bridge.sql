-- 0351: the invoice bridge — the half of the coverage ratio that was never staged.
--
-- FLEETPAL-INTEGRATION-PLAN.md step F9 (D-FP1, D-FP4, D-FP9), and a correction to the plan's own
-- claim that F9 needs no migration.
--
-- ── WHY THIS EXISTS: A STEP THAT COULD NOT BE BUILT AS WRITTEN ─────────────────────────────────
-- D-FP4 says no surface prints FleetPal money without the coverage ratio beside it, and §2.4 says
-- the ratio's numerator is FleetPal's own invoiced total, reached along
-- `work_order -> /v1/purchase-orders -> /v1/purchase-order-invoices`. F6 staged the repair record
-- (0349), F7 the condition tier (0350), F12 will stage the parts catalogue, and F13 reads receipt
-- ITEMS straight into `recordMovement` without staging them. Nowhere in F0–F15 does anything stage
-- purchase orders or their invoices. The contracts have existed in
-- `packages/shared/src/fleetpal/purchasing.ts` since F1 and were corrected against the live account
-- at F4; the client can walk both collections today. There was simply no table for the answer to
-- land in, so F9's first cost figure had nothing to print its ratio from — which, under D-FP4, meant
-- it could not print the cost either.
--
-- The alternative was to compute the ratio live, per request, by walking 3,969 purchase orders and
-- 4,010 invoices through an API whose measured p95 is 2.29s per page and which publishes no rate
-- limit at all (F4). That is not a read model; it is the collector run from a web request.
--
-- ── ⚠ NONE OF THIS MONEY IS FINANCIAL (D-FP3, D-FLEET2) ────────────────────────────────────────
-- Same posture as 0349, and it matters more here because these rows are literally invoices. Nothing
-- below projects into `financial_entries`, nothing reaches the fleet report, and no dedup key is
-- introduced. These tables exist to produce a RATIO — a statement about how much of the ledger's
-- maintenance spend FleetPal saw — and a ratio is not a second source of money. The general ledger
-- remains the entire financial input.
--
-- ── ⚠ `payable_to` IS NULL 81.5% OF THE TIME, AND THE VENDOR OF RECORD IS THE COALESCE ─────────
-- Measured F4, 2026-09-21: 3,269 of 4,010 invoices leave it null, and the spec agrees it is only
-- set when the payee DIFFERS from the location that supplied the goods. A carrier that pays its
-- suppliers directly leaves it null forever. Both columns are stored as sent and neither is
-- collapsed here: the read model computes `coalesce(payable_to, vendor_location)` because that is a
-- READ-TIME interpretation of two facts, and a database column holding the coalesce would destroy
-- the distinction between "the payee is the supplier" and "the payee was never recorded".
--
-- ── ⚠ A `CREDIT` CARRIES A POSITIVE `amount` ───────────────────────────────────────────────────
-- The type is what makes it a credit, not the sign. `invoice_type` is stored beside `amount` and no
-- signed column is derived here, for the same reason as 0349's cost split: a derived column would
-- hide the vendor sending something unexpected. The read model reads the type; a sum that ignored
-- it overstates spend by twice every credit note.
--
-- ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────────────────────────
-- Purchase-order ITEMS, receipts and receipt items. F13 turns receipt items into `received`
-- movements through `recordMovement` (D-FP12) and needs no staging table of its own; the coverage
-- ratio needs the invoice and nothing below it. A table staged "because we will want it" is a
-- table nobody has ever read, and 0349's header makes the same argument about vendor contact
-- details.

-- raw-access-waiver: both `fleetpal_*` tables below are raw-layer tables of THIS migration's own
-- module, created here, and the only things referencing them are the two `stage_fleetpal_*`
-- functions this same file defines. The gate cannot read ownership out of a .sql file — there is no
-- module directory for one — so the waiver is how the authoring PR names the collector that
-- consented, which here is the collector being extended. 0334 and 0349 carry the same line for the
-- same reason. Nothing outside `modules/fleetpal/` reads them: the coverage endpoint goes through
-- the module's index, which is the `maintenance -> fleetpal` edge already declared in
-- `check-feature-boundaries.mjs`.
--
-- Rollback: drop the two stage_fleetpal_* functions, then drop table fleetpal_po_invoices,
-- fleetpal_purchase_orders.

-- ── the purchase order — the first link of the bridge ───────────────────────────────────────────
--
-- 2,899 of 3,969 name a work order (F4). That column is the whole reason this table is staged
-- rather than the invoices alone: it is what ties a dollar back to a repair, and through the repair
-- to a truck.

create table if not exists fleetpal_purchase_orders (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references organizations(id) on delete cascade,
  fleetpal_id          text not null check (length(btrim(fleetpal_id)) > 0),
  -- `number` is sequential and shop-blind; `reference_number` carries the shop's code prefix and is
  -- what a human is holding, the same split as 0349's work orders.
  number               integer,
  reference_number     text,
  -- WORK_ORDER for parts and services bought against a specific repair; only then is
  -- `work_order_fleetpal_id` set. Other types exist and are staged, because a purchase order that
  -- is NOT against a work order still spends money the ledger will show.
  po_type              text,
  status               text,
  shop_fleetpal_id     text,
  -- The location that supplied the goods. Populated on every row (F4), which is what makes it the
  -- vendor of record when `payable_to` is null — see the header.
  vendor_location_fleetpal_id text,
  -- ⚠ Null on every purchase order on the live account, 2026-09-21. Stored as sent; the coalesce
  -- that turns the pair into one vendor happens at READ.
  payable_to_fleetpal_id text,
  -- Set only when `po_type` is WORK_ORDER. The join from a repair to what it cost to buy.
  work_order_fleetpal_id text,
  description          text,
  payment_method       text,
  date_last_received   timestamptz,
  closed_on            timestamptz,
  canceled_on          timestamptz,
  cancellation_reason  text,
  invoices_count       integer,
  -- Every `total_*` here is nullable at the vendor and a dash is what a surface prints for a null
  -- (D-FIN10). A zero would say "this purchase order cost nothing", which is a different claim.
  total_invoices       numeric(14,2),
  payments_count       integer,
  total_payments       numeric(14,2),
  total_items          numeric(14,2),
  vendor_created_at    timestamptz,
  vendor_updated_at    timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint fleetpal_purchase_orders_org_vendor_id_key unique (org_id, fleetpal_id)
);

comment on table fleetpal_purchase_orders is
  'FleetPal purchase orders, staged (F9). The first link of the §2.4 coverage bridge: 2,899 of 3,969 name a work order, which is what ties a dollar to a repair and through it to a truck. Operational only (D-FP3) — no dollar here reaches financial_entries.';
comment on column fleetpal_purchase_orders.payable_to_fleetpal_id is
  'Null on 81.5% of rows (F4, 2026-09-21) — the vendor sets it only when the payee differs from the supplying location. The vendor of record is coalesce(payable_to, vendor_location), computed at read so the distinction survives.';

create index if not exists idx_fleetpal_purchase_orders_org_work_order
  on fleetpal_purchase_orders (org_id, work_order_fleetpal_id)
  where work_order_fleetpal_id is not null;

alter table fleetpal_purchase_orders enable row level security;

-- ── the vendor's invoice — the second link, and the numerator ───────────────────────────────────

create table if not exists fleetpal_po_invoices (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references organizations(id) on delete cascade,
  fleetpal_id            text not null check (length(btrim(fleetpal_id)) > 0),
  purchase_order_fleetpal_id text,
  -- STANDARD for an amount owed, CREDIT for one credited back. ⚠ A CREDIT's `amount` is POSITIVE;
  -- the type is what makes it a credit. Nothing here derives a signed column — see the header.
  invoice_type           text,
  -- ⚠ THE VENDOR'S OWN INVOICE NUMBER, AS ENTERED, AND NOT UNIQUE ACROSS VENDORS.
  -- This is the only key the §2.4 bridge has into `mcleod_ap_vouchers.invoice_number`. FleetPal's
  -- own documentation offers `Vendor.code` as the accounting-system match key and it is populated
  -- on 1 of 761 vendors (F4), so there is no exact vendor key on the McLeod side and a normalised
  -- name comparison is the class of guess D-FS5 forbids. Q9 was ruled (a) by the owner on
  -- 2026-09-21: join on the number alone and report the result as a BOUND. Deliberately NOT unique
  -- here — a collision is a fact to be counted, not a constraint to be enforced.
  invoice_number         text,
  invoice_date           timestamptz,
  amount                 numeric(14,2),
  -- Null in practice, like the purchase order's. Same coalesce, same reason.
  payable_to_fleetpal_id text,
  payment_term_fleetpal_id text,
  vendor_created_at      timestamptz,
  vendor_updated_at      timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint fleetpal_po_invoices_org_vendor_id_key unique (org_id, fleetpal_id)
);

comment on table fleetpal_po_invoices is
  'Vendor invoices against FleetPal purchase orders (F9) — the numerator of the D-FP4 coverage ratio. 4,010 rows on the live account, 2026-09-21. A ratio is a statement about coverage, not a second source of money (D-FLEET2 untouched).';
comment on column fleetpal_po_invoices.invoice_number is
  'The vendor''s own number, as entered. NOT unique across vendors and deliberately not constrained. It is the sole key into mcleod_ap_vouchers.invoice_number (Q9(a), owner 2026-09-21), which is why the ratio is reported as a bound.';

-- The coverage query groups by month over `invoice_date` and joins on `invoice_number`; both are in
-- the index because the join is the expensive half and a sequential scan of 4,010 rows per page
-- render is the thing this avoids.
create index if not exists idx_fleetpal_po_invoices_org_date
  on fleetpal_po_invoices (org_id, invoice_date desc);
create index if not exists idx_fleetpal_po_invoices_org_number
  on fleetpal_po_invoices (org_id, invoice_number)
  where invoice_number is not null;
create index if not exists idx_fleetpal_po_invoices_org_po
  on fleetpal_po_invoices (org_id, purchase_order_fleetpal_id)
  where purchase_order_fleetpal_id is not null;

alter table fleetpal_po_invoices enable row level security;

-- ── the ingest, set-based ───────────────────────────────────────────────────────────────────────
--
-- The three properties 0349's header sets out hold here unchanged: idempotent on
-- `(org_id, fleetpal_id)`, never a partial upsert (`lint:upserts` — every column the vendor sends
-- appears in both the INSERT and the DO UPDATE), and the tenant comes from `p_org` and never from
-- the payload. `security definer` with an empty search_path, EXECUTE revoked from everyone but the
-- service role.

create or replace function public.stage_fleetpal_purchase_orders(p_org uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare written int;
begin
  insert into public.fleetpal_purchase_orders as t (
    org_id, fleetpal_id, number, reference_number, po_type, status, shop_fleetpal_id,
    vendor_location_fleetpal_id, payable_to_fleetpal_id, work_order_fleetpal_id, description,
    payment_method, date_last_received, closed_on, canceled_on, cancellation_reason,
    invoices_count, total_invoices, payments_count, total_payments, total_items,
    vendor_created_at, vendor_updated_at
  )
  select p_org, r.fleetpal_id, r.number, r.reference_number, r.po_type, r.status, r.shop_fleetpal_id,
         r.vendor_location_fleetpal_id, r.payable_to_fleetpal_id, r.work_order_fleetpal_id,
         r.description, r.payment_method, r.date_last_received, r.closed_on, r.canceled_on,
         r.cancellation_reason, r.invoices_count, r.total_invoices, r.payments_count,
         r.total_payments, r.total_items, r.vendor_created_at, r.vendor_updated_at
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
           fleetpal_id text, number integer, reference_number text, po_type text, status text,
           shop_fleetpal_id text, vendor_location_fleetpal_id text, payable_to_fleetpal_id text,
           work_order_fleetpal_id text, description text, payment_method text,
           date_last_received timestamptz, closed_on timestamptz, canceled_on timestamptz,
           cancellation_reason text, invoices_count integer, total_invoices numeric(14,2),
           payments_count integer, total_payments numeric(14,2), total_items numeric(14,2),
           vendor_created_at timestamptz, vendor_updated_at timestamptz)
  on conflict (org_id, fleetpal_id) do update
    set number = excluded.number, reference_number = excluded.reference_number,
        po_type = excluded.po_type, status = excluded.status,
        shop_fleetpal_id = excluded.shop_fleetpal_id,
        vendor_location_fleetpal_id = excluded.vendor_location_fleetpal_id,
        payable_to_fleetpal_id = excluded.payable_to_fleetpal_id,
        work_order_fleetpal_id = excluded.work_order_fleetpal_id,
        description = excluded.description, payment_method = excluded.payment_method,
        date_last_received = excluded.date_last_received, closed_on = excluded.closed_on,
        canceled_on = excluded.canceled_on, cancellation_reason = excluded.cancellation_reason,
        invoices_count = excluded.invoices_count, total_invoices = excluded.total_invoices,
        payments_count = excluded.payments_count, total_payments = excluded.total_payments,
        total_items = excluded.total_items, vendor_created_at = excluded.vendor_created_at,
        vendor_updated_at = excluded.vendor_updated_at, updated_at = now();
  get diagnostics written = row_count;
  return written;
end;
$$;

create or replace function public.stage_fleetpal_po_invoices(p_org uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare written int;
begin
  insert into public.fleetpal_po_invoices as t (
    org_id, fleetpal_id, purchase_order_fleetpal_id, invoice_type, invoice_number, invoice_date,
    amount, payable_to_fleetpal_id, payment_term_fleetpal_id, vendor_created_at, vendor_updated_at
  )
  select p_org, r.fleetpal_id, r.purchase_order_fleetpal_id, r.invoice_type, r.invoice_number,
         r.invoice_date, r.amount, r.payable_to_fleetpal_id, r.payment_term_fleetpal_id,
         r.vendor_created_at, r.vendor_updated_at
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
           fleetpal_id text, purchase_order_fleetpal_id text, invoice_type text,
           invoice_number text, invoice_date timestamptz, amount numeric(14,2),
           payable_to_fleetpal_id text, payment_term_fleetpal_id text,
           vendor_created_at timestamptz, vendor_updated_at timestamptz)
  on conflict (org_id, fleetpal_id) do update
    set purchase_order_fleetpal_id = excluded.purchase_order_fleetpal_id,
        invoice_type = excluded.invoice_type, invoice_number = excluded.invoice_number,
        invoice_date = excluded.invoice_date, amount = excluded.amount,
        payable_to_fleetpal_id = excluded.payable_to_fleetpal_id,
        payment_term_fleetpal_id = excluded.payment_term_fleetpal_id,
        vendor_created_at = excluded.vendor_created_at,
        vendor_updated_at = excluded.vendor_updated_at, updated_at = now();
  get diagnostics written = row_count;
  return written;
end;
$$;

-- Service role only. Postgres grants EXECUTE to PUBLIC by default on CREATE FUNCTION, so every
-- revoke below is load-bearing: without it a browser holding the anon key could write a carrier's
-- invoice history through PostgREST, past the deny-all RLS these tables carry.
revoke all on function public.stage_fleetpal_purchase_orders(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.stage_fleetpal_po_invoices(uuid, jsonb) from public, anon, authenticated;

grant execute on function public.stage_fleetpal_purchase_orders(uuid, jsonb) to service_role;
grant execute on function public.stage_fleetpal_po_invoices(uuid, jsonb) to service_role;

-- The `updated_at` touch and the org-immutability guard, the same pair every table in 0334, 0349
-- and 0350 carries.
create trigger trg_fleetpal_purchase_orders_updated before update on fleetpal_purchase_orders
  for each row execute function set_updated_at();
create trigger trg_fleetpal_purchase_orders_org_immutable before update on fleetpal_purchase_orders
  for each row execute function forbid_org_change();
create trigger trg_fleetpal_po_invoices_updated before update on fleetpal_po_invoices
  for each row execute function set_updated_at();
create trigger trg_fleetpal_po_invoices_org_immutable before update on fleetpal_po_invoices
  for each row execute function forbid_org_change();
