-- 0530 — what a piece of truck equipment was bought on (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md
-- §7a.4, step M10a; owner Q-MX10, 2026-10-28). Truck inventory only (DRIVER-EQUIPMENT-AND-UNIT-TAGS-
-- PLAN.md §0): nothing here touches a shop part, which is FleetPal's (M8).
--
-- ── WHY A ROW OF ITS OWN ────────────────────────────────────────────────────────────────────────
-- An item has `purchased_at` and `purchase_cost` (0333) and nothing else — no vendor, no invoice
-- number, no paper. One bill usually pays for many items (ten tablets on one AT&T order), so the
-- invoice is its own row and each item points at it, rather than three fields copied onto ten items
-- that the next correction updates on seven. The item's own `purchase_cost` stays: it is what that one
-- item cost, and the invoice total includes tax, shipping and things that are not equipment.
--
-- ── WHERE THE INVOICES ARE TODAY (Q-MX10, measured 2026-10-28) ───────────────────────────────────
-- Tablets are not bought through FleetPal, and McLeod's AP holds no device purchase under any
-- equipment-like account (one vendor, ATTAUIL, bills ≈ $622 on the 7th of every month with no account
-- attached — AT&T line service, not devices; accounting to confirm). FleetPal does hold 33 purchase
-- orders (≈ $13,471) for truck equipment bought as shop stock: cargo and E-track straps, chains. So:
--   · an invoice is typed here, once, for anything bought outside FleetPal (tablets);
--   · an item FleetPal bought points at FleetPal's purchase order (`fleetpal_purchase_order_id`)
--     instead of somebody retyping a bill FleetPal already has.
-- Matching McLeod's AP vouchers is NOT built: it waits on accounting saying where device bills are
-- booked (§7a.4's "optional, later").
--
-- ── APPEND-ONLY, THE WAY `fuel_statements` IS (0243) ─────────────────────────────────────────────
-- A bill is evidence of what the company paid. A typo in the total is corrected by a NEW row that
-- the old one points at (`superseded_by`), never by editing the old one, so "what did the office
-- record on 10/02 and who changed it" stays answerable. The supersede pair is the only thing an
-- UPDATE may set, once; a DELETE is refused outright (IV026). Pinned in `RETENTION_FORBIDDEN`.
-- One LIVE row per vendor + invoice number: typing the same bill twice is refused by the index
-- `idx_equipment_purchases_live_invoice`, which the API will map by NAME (M10b), as it does 0527's.
--
-- ── ONE WRITER: record_equipment_purchase ───────────────────────────────────────────────────────
-- Recording a bill is three writes — the bill, the bill it corrects, the items it paid for — and
-- two of them half-done is an invoice that names no items or a correction with two live bills. So
-- one service-role function does all three or none. Its id is minted by the caller, because the
-- scan of the paper is filed against it first (a `documents` row, subject `equipment_purchase`,
-- polymorphic like every subject since 0146) — and a retry with the same id returns the row it
-- already wrote (D-INV27's rule for movements).
--
-- The items: the list is the WHOLE set the bill paid for. A correction moves every item of the bill
-- it replaces onto itself unless the new list leaves one out, which clears it. An item another live
-- bill already names is refused (IV029) rather than silently taken from it — that bill's item count
-- would change without anybody opening it. So an item points only at a live bill, by construction.
--
-- ── SAME ORG, BY KEY ────────────────────────────────────────────────────────────────────────────
-- Each reference carries `org_id` in its foreign key — the item's bill, the bill's correction, the
-- bill's FleetPal purchase order — so no write, the client policy on `inventory_assets` included,
-- can point across orgs. `fleetpal_purchase_orders` gains the `(id, org_id)` key that needs; it is
-- staged by upsert and never deleted (0351), so the reference cannot strand.
--
-- ── THE PAPER ───────────────────────────────────────────────────────────────────────────────────
-- `documents` gains subject `equipment_purchase` and kind `equipment_invoice`: filed as `other` it
-- would be a scan nobody can later ask for by name (0490's reasoning). Neither restrictive policy
-- (0211, 0237, 0376) names it; the API gates it by the `maintenance` section.
--
-- ── SQLSTATES ───────────────────────────────────────────────────────────────────────────────────
-- New: `IV026 equipment_purchases_append_only`, `IV027 unknown_purchase`, `IV028 purchase_superseded`
-- (somebody corrected it first), `IV029 asset_on_another_purchase`. Reused from 0333: `IV015` (no
-- client-generated id), `IV024` (an item that is not this org's).
--
-- ── DEPLOY ORDER (lint:migration-ordering) ──────────────────────────────────────────────────────
-- Schema only. The two CHECK widenings are safe under either order: old code never writes the new
-- words. Nothing reads `purchase_id` or calls the function until M10b, a later merge.
--
-- Measured on production 2026-10-29: 0 inventory assets, 4,295 FleetPal purchase orders (the new key
-- builds in milliseconds). RLS on, no client policy: the API is the only reader (deny-all on purpose).
-- Matrix: supabase/tests/equipment-purchases.test.mjs.
--
-- cross-module-waiver: one act — "a bill paid for these items" — needs the evidence module's
-- `documents` to admit the bill's paper and the fleetpal module's purchase orders to be referable by
-- org; both are vocabulary or key widenings, and the only new table and writer are maintenance's.
-- raw-access-waiver: the new key on `fleetpal_purchase_orders` is a unique (id, org_id) so a bill can
-- reference a staged purchase order inside its own org; no row is read or written here.

-- ── the key a same-org reference needs ──────────────────────────────────────────────────────────
alter table public.fleetpal_purchase_orders drop constraint if exists fleetpal_purchase_orders_id_org_key;
alter table public.fleetpal_purchase_orders
  add constraint fleetpal_purchase_orders_id_org_key unique (id, org_id);

-- ── the bill ────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.equipment_purchases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- As the bill prints it ("AT&T Business", "Amazon"); no vendor table — 33 FleetPal orders and a
  -- handful of tablet bills do not need one, and FleetPal's own vendor is on its purchase order.
  vendor text not null check (length(btrim(vendor)) between 1 and 120),
  invoice_number text not null check (length(btrim(invoice_number)) between 1 and 64),
  invoice_date date not null,
  -- The bill's total as printed, tax and shipping included (header).
  total numeric(12,2) not null check (total >= 0),
  notes text check (notes is null or length(notes) <= 2000),
  fleetpal_purchase_order_id uuid,
  superseded_by uuid,
  superseded_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint equipment_purchases_id_org_key unique (id, org_id),
  constraint equipment_purchases_fleetpal_po_fk foreign key (fleetpal_purchase_order_id, org_id)
    references public.fleetpal_purchase_orders (id, org_id),
  -- Deferred: the function points the old bill at the new one BEFORE inserting it, so the live-
  -- invoice index never sees two live rows for one bill (see the function).
  constraint equipment_purchases_superseded_by_fk foreign key (superseded_by, org_id)
    references public.equipment_purchases (id, org_id) deferrable initially deferred,
  constraint equipment_purchases_supersede_pair check ((superseded_by is null) = (superseded_at is null)),
  constraint equipment_purchases_no_self_supersede check (superseded_by is null or superseded_by <> id)
);

create unique index if not exists idx_equipment_purchases_live_invoice
  on public.equipment_purchases (org_id, lower(btrim(vendor)), lower(btrim(invoice_number)))
  where superseded_by is null;
create index if not exists idx_equipment_purchases_live_date
  on public.equipment_purchases (org_id, invoice_date desc)
  where superseded_by is null;
create index if not exists idx_equipment_purchases_fleetpal_po
  on public.equipment_purchases (org_id, fleetpal_purchase_order_id)
  where fleetpal_purchase_order_id is not null;

alter table public.equipment_purchases enable row level security;

comment on table public.equipment_purchases is
  'M10a (0530, Q-MX10): an equipment bill — vendor, number, date, total, optionally FleetPal''s purchase order. Append-only: a correction is a new row the old one points at (superseded_by). Written only by record_equipment_purchase; service role only.';

-- ── append-only (IV026) ─────────────────────────────────────────────────────────────────────────
create or replace function public.guard_equipment_purchases_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'equipment_purchases is append-only: a bill is corrected by a new one, never deleted'
      using errcode = 'IV026';
  end if;
  -- Once superseded the row is frozen whole — re-pointing it would rewrite when the correction happened.
  if old.superseded_by is not null then
    raise exception 'this bill was already corrected; correct its replacement instead'
      using errcode = 'IV026';
  end if;
  if to_jsonb(new) - 'superseded_by' - 'superseded_at' is distinct from to_jsonb(old) - 'superseded_by' - 'superseded_at' then
    raise exception 'equipment_purchases is append-only: only superseded_by/superseded_at may change'
      using errcode = 'IV026';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_equipment_purchases_append_only on public.equipment_purchases;
create trigger trg_equipment_purchases_append_only
  before update or delete on public.equipment_purchases
  for each row execute function public.guard_equipment_purchases_append_only();

-- ── the item's bill ─────────────────────────────────────────────────────────────────────────────
alter table public.inventory_assets add column if not exists purchase_id uuid;
alter table public.inventory_assets drop constraint if exists inventory_assets_purchase_fk;
alter table public.inventory_assets
  add constraint inventory_assets_purchase_fk foreign key (purchase_id, org_id)
    references public.equipment_purchases (id, org_id);
create index if not exists idx_inventory_assets_purchase
  on public.inventory_assets (org_id, purchase_id)
  where purchase_id is not null;

comment on column public.inventory_assets.purchase_id is
  'The live bill that paid for this item (M10a, 0530). Set only by record_equipment_purchase, which moves it onto a correction. purchase_cost stays the item''s own price.';

-- ── the paper ───────────────────────────────────────────────────────────────────────────────────
alter table public.documents drop constraint if exists documents_subject_type_check;
alter table public.documents add constraint documents_subject_type_check check (subject_type in (
  'driver','tractor','trailer','load','organization',
  'roadside_inspection',
  'equipment_purchase'));

alter table public.documents drop constraint if exists documents_kind_check;
alter table public.documents add constraint documents_kind_check check (kind in (
  'cdl','medical_card','endorsement','hazmat_training','twic',
  'registration','annual_inspection','insurance','ifta','irp',
  'lease','permit',
  'phmsa_registration','hazmat_safety_permit','security_plan',
  'financial_responsibility','operating_authority',
  'employment_application','mvr','annual_mvr_review','road_test',
  'cdl_equivalency','previous_employer_inquiry','previous_employer_response',
  'clearinghouse_full','clearinghouse_limited','eldt','spe_certificate',
  'medical_registry_verification','drug_test','alcohol_test','accident',
  'psp_report','return_to_duty',
  'orientation','handbook',
  'clearinghouse_portal_consent',
  'title',
  'other',
  'roadside_inspection_report','citation','court_disposition',
  'dataqs_packet','dataqs_correspondence',
  'roadside_repair_record',
  'equipment_invoice'));

-- ── the one writer ──────────────────────────────────────────────────────────────────────────────
-- p_row: { id, vendor, invoiceNumber, invoiceDate, total, notes?, fleetpalPurchaseOrderId?,
--          supersedes?, assetIds: [] }
create or replace function public.record_equipment_purchase(p_org uuid, p_actor uuid, p_row jsonb)
returns public.equipment_purchases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id         uuid := nullif(p_row->>'id', '')::uuid;
  v_supersedes uuid := nullif(p_row->>'supersedes', '')::uuid;
  v_assets     uuid[] := array(
    select distinct x::uuid from jsonb_array_elements_text(coalesce(p_row->'assetIds', '[]'::jsonb)) x);
  v_old        public.equipment_purchases;
  v_out        public.equipment_purchases;
  v_found      integer;
  v_taken      text;
begin
  if v_id is null then
    raise exception 'a bill needs a client-generated id' using errcode = 'IV015';
  end if;

  -- 1. Idempotency before anything else (D-INV27).
  select * into v_out from public.equipment_purchases p where p.id = v_id and p.org_id = p_org;
  if found then
    return v_out;
  end if;

  -- 2. The bill it corrects, locked, and still the live one.
  if v_supersedes is not null then
    select * into v_old from public.equipment_purchases p
     where p.id = v_supersedes and p.org_id = p_org for update;
    if not found then
      raise exception 'unknown bill %', v_supersedes using errcode = 'IV027';
    end if;
    if v_old.superseded_by is not null then
      raise exception 'that bill was already corrected by somebody else; open the newest one'
        using errcode = 'IV028';
    end if;
  end if;

  -- 3. The items: every one ours, locked, and on no other live bill.
  select count(*)::integer into v_found from (
    select a.id from public.inventory_assets a
     where a.org_id = p_org and a.id = any (v_assets) for update) s;
  if v_found <> cardinality(v_assets) then
    raise exception 'an item on this bill is not this org''s' using errcode = 'IV024';
  end if;
  select string_agg(p.vendor || ' ' || p.invoice_number, ', ') into v_taken
    from public.inventory_assets a
    join public.equipment_purchases p on p.id = a.purchase_id and p.org_id = a.org_id
   where a.org_id = p_org and a.id = any (v_assets)
     and a.purchase_id is distinct from v_supersedes;
  if v_taken is not null then
    raise exception 'an item on this bill is already on %', v_taken using errcode = 'IV029';
  end if;

  -- 4. Retire the old bill first (its FK to the new one is deferred), then write the new one.
  if v_supersedes is not null then
    update public.equipment_purchases p
       set superseded_by = v_id, superseded_at = now()
     where p.id = v_supersedes and p.org_id = p_org;
  end if;

  insert into public.equipment_purchases (
    id, org_id, vendor, invoice_number, invoice_date, total, notes, fleetpal_purchase_order_id, created_by
  ) values (
    v_id, p_org, btrim(p_row->>'vendor'), btrim(p_row->>'invoiceNumber'), (p_row->>'invoiceDate')::date,
    (p_row->>'total')::numeric, nullif(btrim(coalesce(p_row->>'notes', '')), ''),
    nullif(p_row->>'fleetpalPurchaseOrderId', '')::uuid, p_actor
  )
  returning * into v_out;

  -- 5. The items follow the bill: the corrected bill's leave unless named again; the named ones join.
  if v_supersedes is not null then
    update public.inventory_assets a
       set purchase_id = null, updated_at = now()
     where a.org_id = p_org and a.purchase_id = v_supersedes and not (a.id = any (v_assets));
  end if;
  update public.inventory_assets a
     set purchase_id = v_id, updated_at = now()
   where a.org_id = p_org and a.id = any (v_assets);

  return v_out;
end;
$$;

revoke all on function public.record_equipment_purchase(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_equipment_purchase(uuid, uuid, jsonb) to service_role;

comment on function public.record_equipment_purchase(uuid, uuid, jsonb) is
  'M10a (0530): the only writer of equipment_purchases and inventory_assets.purchase_id. Records a bill, optionally correcting a live one (IV027 unknown, IV028 already corrected), and the whole list of items it paid for (IV024 not ours, IV029 on another live bill). Idempotent on the caller-minted id (D-INV27).';
