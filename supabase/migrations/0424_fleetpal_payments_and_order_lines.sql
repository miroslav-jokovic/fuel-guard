-- 0424: FleetPal payments and purchase-order lines, staged.
--
-- MAINTENANCE-MONEY-CONTROL-PLAN.md step C1 (D-MMC1, D-MMC2), owner's ruling of 2026-10-04: both
-- collectors hold every repair transaction, so FleetPal can be matched against McLeod as a money
-- control. 0351 staged the purchase order and the vendor's invoice and stopped there. It said
-- payments were not needed because the coverage ratio needs the invoice and nothing below it. The
-- control does need them: a payment carries the CHECK NUMBER (company check or EFS check), which
-- is a far stronger key into McLeod and EFS than an invoice number a human typed.
--
-- ── MEASURED BEFORE WRITING (M-9, live account, 2026-10-04) ──────────────────────────────────
-- 2,840 payments and 2,106 order lines all-time; every one parses under the contracts in
-- `packages/shared/src/fleetpal/purchasing.ts`. `updated_after` is EXCLUSIVE on both endpoints
-- (asked with the newest `updated`, each answers zero rows), so 0334's watermark holds unchanged.
--
-- ── ⚠ MONEY IS numeric(14,3), NOT 0351's numeric(14,2) ──────────────────────────────────────
-- The vendor documents up to three decimal places, and the live data uses them: 1 payment amount,
-- 64 item prices, 36 item totals. A (14,2) column rounds each one, and a control whose identity is
-- "the four boxes sum to each side's total to the cent" (D-MMC3) cannot stand on columns that
-- already rounded. 0351's invoice amount has the same defect on 2 of 4,095 rows; that is recorded
-- in the plan's log as its own follow-up rather than widened silently here.
--
-- ── ⚠ STORED AS SENT, INCLUDING WHAT LOOKS WRONG (D-MMC2, D-MMC5) ────────────────────────────
--   · `payment_number` is `''` on 615 payments, never null. It is stored as the empty string: a
--     null here would claim the vendor did not send the field, and it did.
--   · `method` is null on 20.
--   · Two amounts are $9,146,990,499 (2026-07-27) and $4,007,362,959 (2025-07-24), both shaped like
--     a check number typed into the amount. They fit numeric(14,3) and are staged unchanged.
--     Finding them is the control's job; a CHECK constraint here would turn the vendor's typo into
--     a failed sweep that stops every later payment staging.
--   · `invoice_fleetpal_ids` is an ARRAY: 43 payments settle no invoice, and some settle two.
--
-- ── ⚠ NONE OF THIS MONEY IS FINANCIAL (D-FP3, D-MMC7) ────────────────────────────────────────
-- Nothing here reaches `financial_entries` or the fleet report.
--
-- raw-access-waiver: both `fleetpal_*` tables below are raw-layer tables of THIS migration's own
-- module, created here; the only things referencing them are the two `stage_fleetpal_*` functions
-- this same file defines. Nothing outside `modules/fleetpal/` reads them.
--
-- Rollback: drop the two stage_fleetpal_* functions, then drop table fleetpal_po_items,
-- fleetpal_po_payments.

-- ── the payment ────────────────────────────────────────────────────────────────────────────────

create table if not exists fleetpal_po_payments (
  id                           uuid primary key default gen_random_uuid(),
  org_id                       uuid not null references organizations(id) on delete cascade,
  fleetpal_id                  text not null check (length(btrim(fleetpal_id)) > 0),
  purchase_order_fleetpal_id   text,
  -- The check number for CHECK / EFS_CHECK, a reference otherwise. Byte-exact (`009326` keeps its
  -- zeros); the matcher's normalising rules live in code with their own tests (D-MMC2).
  payment_number               text,
  -- A calendar day, as the vendor sends it. Not an instant.
  paid_on                      date,
  amount                       numeric(14,3),
  method                       text,
  payable_to_fleetpal_id       text,
  invoice_fleetpal_ids         text[] not null default '{}',
  notes                        text,
  vendor_created_at            timestamptz,
  vendor_updated_at            timestamptz,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  constraint fleetpal_po_payments_org_vendor_id_key unique (org_id, fleetpal_id)
);

comment on table fleetpal_po_payments is
  'FleetPal purchase-order payments, staged (MAINTENANCE-MONEY-CONTROL-PLAN.md C1). How each invoice was paid and with which check number. Operational only (D-FP3) — no dollar here reaches financial_entries.';
comment on column fleetpal_po_payments.payment_number is
  'As sent, including '''' (615 of 2,840 on 2026-10-04). Never normalised in the table (D-MMC2).';
comment on column fleetpal_po_payments.amount is
  'numeric(14,3): the vendor sends up to three decimals. Absurd values are staged as sent and flagged by the control (D-MMC5).';

create index if not exists idx_fleetpal_po_payments_org_paid_on
  on fleetpal_po_payments (org_id, paid_on desc);
create index if not exists idx_fleetpal_po_payments_org_number
  on fleetpal_po_payments (org_id, payment_number) where payment_number <> '';
create index if not exists idx_fleetpal_po_payments_org_po
  on fleetpal_po_payments (org_id, purchase_order_fleetpal_id);

alter table fleetpal_po_payments enable row level security;

-- ── the order line ─────────────────────────────────────────────────────────────────────────────

create table if not exists fleetpal_po_items (
  id                           uuid primary key default gen_random_uuid(),
  org_id                       uuid not null references organizations(id) on delete cascade,
  fleetpal_id                  text not null check (length(btrim(fleetpal_id)) > 0),
  purchase_order_fleetpal_id   text,
  -- PART · FEE · TAX. `type` on the wire; renamed for the same reason 0351 renamed the order's.
  item_type                    text,
  description                  text,
  part_fleetpal_id             text,
  part_number                  text,
  universal_product_code       text,
  manufacturer_fleetpal_id     text,
  manufacturer_part_number     text,
  -- A `/v1/vmrs-components` ID, never a code (FLEETPAL F9c). Resolved to words at read time only.
  component_fleetpal_id        text,
  unit_of_measure              text,
  quantity                     numeric(14,3),
  price                        numeric(14,3),
  total                        numeric(14,3),
  vendor_created_at            timestamptz,
  vendor_updated_at            timestamptz,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  constraint fleetpal_po_items_org_vendor_id_key unique (org_id, fleetpal_id)
);

comment on table fleetpal_po_items is
  'FleetPal purchase-order lines, staged (MAINTENANCE-MONEY-CONTROL-PLAN.md C1): what each order bought. Operational only (D-FP3).';

create index if not exists idx_fleetpal_po_items_org_po
  on fleetpal_po_items (org_id, purchase_order_fleetpal_id);

alter table fleetpal_po_items enable row level security;

-- ── ingest, set-based ─────────────────────────────────────────────────────────────────────────
--
-- 0349's three properties, unchanged: idempotent on `(org_id, fleetpal_id)`; never a partial upsert
-- (every column the vendor sends appears in both the INSERT and the DO UPDATE); the tenant comes
-- from `p_org`, never from the payload. `security definer` with an empty search_path, EXECUTE
-- revoked from everyone but the service role.

create or replace function public.stage_fleetpal_po_payments(p_org uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  written int;
begin
  insert into public.fleetpal_po_payments as t (
    org_id, fleetpal_id, purchase_order_fleetpal_id, payment_number, paid_on, amount, method,
    payable_to_fleetpal_id, invoice_fleetpal_ids, notes, vendor_created_at, vendor_updated_at
  )
  select p_org, r.fleetpal_id, r.purchase_order_fleetpal_id, r.payment_number, r.paid_on, r.amount,
         r.method, r.payable_to_fleetpal_id, coalesce(r.invoice_fleetpal_ids, '{}'), r.notes,
         r.vendor_created_at, r.vendor_updated_at
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      fleetpal_id text, purchase_order_fleetpal_id text, payment_number text, paid_on date,
      amount numeric(14,3), method text, payable_to_fleetpal_id text, invoice_fleetpal_ids text[],
      notes text, vendor_created_at timestamptz, vendor_updated_at timestamptz)
  on conflict (org_id, fleetpal_id) do update set
    purchase_order_fleetpal_id = excluded.purchase_order_fleetpal_id,
    payment_number = excluded.payment_number,
    paid_on = excluded.paid_on,
    amount = excluded.amount,
    method = excluded.method,
    payable_to_fleetpal_id = excluded.payable_to_fleetpal_id,
    invoice_fleetpal_ids = excluded.invoice_fleetpal_ids,
    notes = excluded.notes,
    vendor_created_at = excluded.vendor_created_at,
    vendor_updated_at = excluded.vendor_updated_at,
    updated_at = now();
  get diagnostics written = row_count;
  return written;
end;
$$;

create or replace function public.stage_fleetpal_po_items(p_org uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  written int;
begin
  insert into public.fleetpal_po_items as t (
    org_id, fleetpal_id, purchase_order_fleetpal_id, item_type, description, part_fleetpal_id,
    part_number, universal_product_code, manufacturer_fleetpal_id, manufacturer_part_number,
    component_fleetpal_id, unit_of_measure, quantity, price, total, vendor_created_at,
    vendor_updated_at
  )
  select p_org, r.fleetpal_id, r.purchase_order_fleetpal_id, r.item_type, r.description,
         r.part_fleetpal_id, r.part_number, r.universal_product_code, r.manufacturer_fleetpal_id,
         r.manufacturer_part_number, r.component_fleetpal_id, r.unit_of_measure, r.quantity,
         r.price, r.total, r.vendor_created_at, r.vendor_updated_at
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      fleetpal_id text, purchase_order_fleetpal_id text, item_type text, description text,
      part_fleetpal_id text, part_number text, universal_product_code text,
      manufacturer_fleetpal_id text, manufacturer_part_number text, component_fleetpal_id text,
      unit_of_measure text, quantity numeric(14,3), price numeric(14,3), total numeric(14,3),
      vendor_created_at timestamptz, vendor_updated_at timestamptz)
  on conflict (org_id, fleetpal_id) do update set
    purchase_order_fleetpal_id = excluded.purchase_order_fleetpal_id,
    item_type = excluded.item_type,
    description = excluded.description,
    part_fleetpal_id = excluded.part_fleetpal_id,
    part_number = excluded.part_number,
    universal_product_code = excluded.universal_product_code,
    manufacturer_fleetpal_id = excluded.manufacturer_fleetpal_id,
    manufacturer_part_number = excluded.manufacturer_part_number,
    component_fleetpal_id = excluded.component_fleetpal_id,
    unit_of_measure = excluded.unit_of_measure,
    quantity = excluded.quantity,
    price = excluded.price,
    total = excluded.total,
    vendor_created_at = excluded.vendor_created_at,
    vendor_updated_at = excluded.vendor_updated_at,
    updated_at = now();
  get diagnostics written = row_count;
  return written;
end;
$$;

-- Service role only. Since 0412 a new function is closed to anon/authenticated by default
-- privileges, so these revokes are the second layer, not the only one. Stated anyway: a function
-- that writes the carrier's payment history should say who may call it where it is defined, and
-- the matrix's 42501 check holds either layer (removing this revoke alone is measured to change
-- nothing, 2026-10-04).
revoke all on function public.stage_fleetpal_po_payments(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.stage_fleetpal_po_items(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.stage_fleetpal_po_payments(uuid, jsonb) to service_role;
grant execute on function public.stage_fleetpal_po_items(uuid, jsonb) to service_role;

-- The `updated_at` touch and the org-immutability guard, the pair every fleetpal_* table carries.
create trigger trg_fleetpal_po_payments_updated before update on fleetpal_po_payments
  for each row execute function set_updated_at();
create trigger trg_fleetpal_po_payments_org_immutable before update on fleetpal_po_payments
  for each row execute function forbid_org_change();
create trigger trg_fleetpal_po_items_updated before update on fleetpal_po_items
  for each row execute function set_updated_at();
create trigger trg_fleetpal_po_items_org_immutable before update on fleetpal_po_items
  for each row execute function forbid_org_change();
