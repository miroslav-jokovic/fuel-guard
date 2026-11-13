-- 0599 — Lumper fees: the facts McLeod holds about each lumper, and one case per order.
--
-- LUMPER-REVISED-RC-PLAN.md, step LRC2 (D-LRC1, D-LRC2, D-LRC8). When we pay a lumper on the spot the
-- broker owes it back, and the proof is the broker's revised rate confirmation. McLeod records that a
-- lumper was paid and whether it was invoiced; it records the revised RC nowhere (plan §1.3). So 360
-- holds the case: the three McLeod facts are mirrored here by the connector's hourly sweep, and the
-- case row is where a person's facts live (closed with a reason; the RC file arrives with LRC3).
--
-- WHY THE STATE OF A CASE IS NOT A COLUMN. "Waiting for revised RC", "billed short" and the rest are
-- read from these rows by one pure function (`lumperCaseState`, packages/shared/src/lumperCase.ts)
-- every time they are shown. A stored state would be a second copy of the same facts, and the first
-- sweep after it was written could make it wrong without anything noticing.
--
-- WHY EVERYTHING IS KEYED BY ORDER. Billing deletes the dispatcher's `other_charge` row and keys it
-- again on the bill date (879 inserts and 489 deletions in one audited month), so a charge row's id
-- does not survive. The order number does.
--
-- WHY A SWEEP REPLACES. The feed is a bounded read of the last 90 days, not a change feed: a charge
-- that was deleted, a pending settlement line that was paid (it moves to another McLeod table under
-- another id), a payment that was removed, are all simply absent from the next sweep. So
-- `lumper_sweep_apply` writes what the sweep holds and deletes, inside the sweep's own window, what
-- it no longer holds, in ONE transaction: a sweep that fails half-way leaves the previous one whole.
--
-- raw-access-waiver: this file creates the mcleod raw staging tables it names, and the function that
-- writes them, on behalf of the mcleod collector that owns them (apps/api/src/modules/mcleod).
--
-- All six tables are read and written by the API with the service role only. RLS is on with no
-- client policy, which is deny-all on purpose.

-- ── The order: who the broker is, who the dispatcher is, where it delivered ──────────────────────
create table if not exists public.mcleod_lumper_orders (
  org_id                uuid not null references public.organizations(id) on delete cascade,
  company_id            text not null,            -- orders.company_id
  order_id              text not null,            -- orders.id
  order_status          text,
  ordered_at            timestamptz,
  bill_date             timestamptz,
  customer_id           text,
  customer_name         text,
  dispatcher_user_id    text,                     -- orders.operations_user (Q-LRC5)
  dispatcher_name       text,
  movement_id           text,                     -- orders.curr_movement_id
  -- McLeod does not say at which stop a lumper was paid (other_charge.stop_id is empty on every LUM
  -- row of 2026), so "where" is the order's consignee stop (D-LRC10).
  consignee_name        text,
  consignee_city        text,
  consignee_state       text,
  consignee_arrived_at  timestamptz,
  consignee_departed_at timestamptz,
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  primary key (org_id, company_id, order_id)
);
alter table public.mcleod_lumper_orders enable row level security;

-- ── To be billed: the LUM charges on the order as they stand now ─────────────────────────────────
create table if not exists public.mcleod_lumper_charges (
  org_id       uuid not null references public.organizations(id) on delete cascade,
  company_id   text not null,
  charge_id    text not null,                     -- other_charge.id; display only, it does not survive billing
  order_id     text not null,
  charge_code  text not null,
  descr        text,
  amount       numeric(12, 2) not null,
  sequence     integer,
  last_seen_at timestamptz not null default now(),
  primary key (org_id, company_id, charge_id)
);
create index if not exists ix_mcleod_lumper_charges_order on public.mcleod_lumper_charges (org_id, company_id, order_id);
alter table public.mcleod_lumper_charges enable row level security;

-- ── Paid: settlement lines for the EFS money code (UNL) and the driver's reimbursement (LUM) ─────
create table if not exists public.mcleod_lumper_payments (
  org_id           uuid not null references public.organizations(id) on delete cascade,
  company_id       text not null,
  settlement_state text not null check (settlement_state in ('paid', 'pending')),
  payment_id       text not null,                 -- drs_deduct_hist.id or drs_pending_deduct.id
  order_id         text,                          -- null on about 1 line in 13; the page lists those to be matched
  movement_id      text,
  deduct_code      text not null,
  deduction_type   text,
  amount           numeric(12, 2) not null,
  transacted_at    timestamptz,
  reference_no     text,                          -- on a UNL line, the EFS reference
  driver_code      text,
  payee_id         text,
  tractor_unit     text,
  is_void          boolean not null default false,
  last_seen_at     timestamptz not null default now(),
  primary key (org_id, company_id, settlement_state, payment_id)
);
create index if not exists ix_mcleod_lumper_payments_order on public.mcleod_lumper_payments (org_id, company_id, order_id);
alter table public.mcleod_lumper_payments enable row level security;

-- ── Billed: every invoice and credit memo of the order, with the lumper amount on it ─────────────
create table if not exists public.mcleod_lumper_bills (
  org_id        uuid not null references public.organizations(id) on delete cascade,
  company_id    text not null,
  bill_id       text not null,                    -- billing_history.id
  order_id      text not null,
  invoice_no    text,
  bill_date     timestamptz,
  bill_type     text,                             -- I invoice, C credit memo; a credit's amounts are POSITIVE
  canceled      text,
  rebilled      text,
  total_charges numeric(14, 2),
  lumper_amount numeric(12, 2) not null default 0,
  lumper_lines  integer not null default 0,       -- 0 = this bill went out with no lumper on it
  last_seen_at  timestamptz not null default now(),
  primary key (org_id, company_id, bill_id)
);
create index if not exists ix_mcleod_lumper_bills_order on public.mcleod_lumper_bills (org_id, company_id, order_id);
alter table public.mcleod_lumper_bills enable row level security;

-- ── When the feed last ran: the page says so, and a reminder says so when it is older than a day ─
create table if not exists public.mcleod_lumper_sweeps (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  company_id text not null,
  since      date not null,
  swept_at   timestamptz not null default now(),
  orders     integer not null,
  charges    integer not null,
  payments   integer not null,
  bills      integer not null,
  primary key (org_id, company_id)
);
alter table public.mcleod_lumper_sweeps enable row level security;

-- ── The case: one per order and charge code (D-LRC1; Q-LRC7 keys it by code so detention can join) ─
create table if not exists public.lumper_cases (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  company_id   text not null,
  order_id     text not null,
  charge_code  text not null default 'LUM',
  opened_at    timestamptz not null default now(),
  -- A person's decision that this one will not be billed (D-LRC4). Who and why are kept; reopening
  -- clears all four together, and the audit log holds the history.
  closed_at    timestamptz,
  closed_by    uuid,
  close_reason text check (close_reason in ('broker_paid_directly', 'broker_refused', 'included_in_rate', 'not_a_lumper')),
  close_note   text check (close_note is null or char_length(close_note) <= 500),
  constraint uq_lumper_cases_order unique (org_id, company_id, order_id, charge_code),
  constraint ck_lumper_cases_closed_together check (
    (closed_at is null and closed_by is null and close_reason is null and close_note is null)
    or (closed_at is not null and closed_by is not null and close_reason is not null)
  )
);
alter table public.lumper_cases enable row level security;

-- ── One sweep, one transaction ───────────────────────────────────────────────────────────────────
-- The arrays are the connector's payload as the API validated it (lumperContract.ts). Returns what
-- was written and what was removed, for the connector's log.
create or replace function public.lumper_sweep_apply(
  p_org      uuid,
  p_company  text,
  p_since    date,
  p_orders   jsonb,
  p_charges  jsonb,
  p_payments jsonb,
  p_bills    jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now             timestamptz := now();
  v_charges_removed integer;
  v_payments_removed integer;
  v_bills_removed   integer;
  v_cases_opened    integer;
begin
  if p_org is null or p_company is null or p_since is null then
    raise exception 'lumper_sweep_apply: org, company and since are required' using errcode = '22023';
  end if;

  insert into mcleod_lumper_orders as o (
    org_id, company_id, order_id, order_status, ordered_at, bill_date, customer_id, customer_name,
    dispatcher_user_id, dispatcher_name, movement_id, consignee_name, consignee_city, consignee_state,
    consignee_arrived_at, consignee_departed_at, first_seen_at, last_seen_at)
  select p_org, p_company, r.order_external_id, r.order_status, r.ordered_at, r.bill_date, r.customer_id, r.customer_name,
         r.dispatcher_user_id, r.dispatcher_name, r.movement_external_id, r.consignee_name, r.consignee_city, r.consignee_state,
         r.consignee_arrived_at, r.consignee_departed_at, v_now, v_now
    from jsonb_to_recordset(coalesce(p_orders, '[]'::jsonb)) as r(
      order_external_id text, order_status text, ordered_at timestamptz, bill_date timestamptz, customer_id text,
      customer_name text, dispatcher_user_id text, dispatcher_name text, movement_external_id text, consignee_name text,
      consignee_city text, consignee_state text, consignee_arrived_at timestamptz, consignee_departed_at timestamptz)
  on conflict (org_id, company_id, order_id) do update set
    order_status = excluded.order_status, ordered_at = excluded.ordered_at, bill_date = excluded.bill_date,
    customer_id = excluded.customer_id, customer_name = excluded.customer_name,
    dispatcher_user_id = excluded.dispatcher_user_id, dispatcher_name = excluded.dispatcher_name,
    movement_id = excluded.movement_id, consignee_name = excluded.consignee_name,
    consignee_city = excluded.consignee_city, consignee_state = excluded.consignee_state,
    consignee_arrived_at = excluded.consignee_arrived_at, consignee_departed_at = excluded.consignee_departed_at,
    last_seen_at = excluded.last_seen_at;

  -- Charges. The sweep reads the charges of every order it returned, and an order ordered inside the
  -- window that it did NOT return has no LUM charge left. Both sets are replaced; an order outside
  -- both keeps what it had.
  with gone as (
    delete from mcleod_lumper_charges c
     where c.org_id = p_org and c.company_id = p_company
       and c.order_id in (
         select o.order_id from mcleod_lumper_orders o
          where o.org_id = p_org and o.company_id = p_company
            and (o.last_seen_at = v_now or o.ordered_at >= p_since))
       and not exists (
         select 1 from jsonb_to_recordset(coalesce(p_charges, '[]'::jsonb)) as r(external_id text)
          where r.external_id = c.charge_id)
    returning 1)
  select count(*) into v_charges_removed from gone;

  insert into mcleod_lumper_charges (org_id, company_id, charge_id, order_id, charge_code, descr, amount, sequence, last_seen_at)
  select p_org, p_company, r.external_id, r.order_external_id, r.charge_code, r.descr, r.amount, r.sequence, v_now
    from jsonb_to_recordset(coalesce(p_charges, '[]'::jsonb)) as r(
      external_id text, order_external_id text, charge_code text, descr text, amount numeric, sequence integer)
  on conflict (org_id, company_id, charge_id) do update set
    order_id = excluded.order_id, charge_code = excluded.charge_code, descr = excluded.descr,
    amount = excluded.amount, sequence = excluded.sequence, last_seen_at = excluded.last_seen_at;

  -- Payments are read by date, so the window is the whole truth for every line dated inside it.
  with gone as (
    delete from mcleod_lumper_payments p
     where p.org_id = p_org and p.company_id = p_company
       and p.transacted_at >= p_since
       and not exists (
         select 1 from jsonb_to_recordset(coalesce(p_payments, '[]'::jsonb)) as r(external_id text, settlement_state text)
          where r.external_id = p.payment_id and r.settlement_state = p.settlement_state)
    returning 1)
  select count(*) into v_payments_removed from gone;

  insert into mcleod_lumper_payments (
    org_id, company_id, settlement_state, payment_id, order_id, movement_id, deduct_code, deduction_type,
    amount, transacted_at, reference_no, driver_code, payee_id, tractor_unit, is_void, last_seen_at)
  select p_org, p_company, r.settlement_state, r.external_id, r.order_external_id, r.movement_external_id, r.deduct_code,
         r.deduction_type, r.amount, r.transacted_at, r.reference_no, r.driver_external_id, r.payee_id, r.tractor_unit,
         coalesce(r.is_void, false), v_now
    from jsonb_to_recordset(coalesce(p_payments, '[]'::jsonb)) as r(
      external_id text, settlement_state text, order_external_id text, movement_external_id text, deduct_code text,
      deduction_type text, amount numeric, transacted_at timestamptz, reference_no text, driver_external_id text,
      payee_id text, tractor_unit text, is_void boolean)
  on conflict (org_id, company_id, settlement_state, payment_id) do update set
    order_id = excluded.order_id, movement_id = excluded.movement_id, deduct_code = excluded.deduct_code,
    deduction_type = excluded.deduction_type, amount = excluded.amount, transacted_at = excluded.transacted_at,
    reference_no = excluded.reference_no, driver_code = excluded.driver_code, payee_id = excluded.payee_id,
    tractor_unit = excluded.tractor_unit, is_void = excluded.is_void, last_seen_at = excluded.last_seen_at;

  -- Bills: every bill of every order the sweep returned.
  with gone as (
    delete from mcleod_lumper_bills b
     where b.org_id = p_org and b.company_id = p_company
       and b.order_id in (
         select o.order_id from mcleod_lumper_orders o
          where o.org_id = p_org and o.company_id = p_company and o.last_seen_at = v_now)
       and not exists (
         select 1 from jsonb_to_recordset(coalesce(p_bills, '[]'::jsonb)) as r(external_id text)
          where r.external_id = b.bill_id)
    returning 1)
  select count(*) into v_bills_removed from gone;

  insert into mcleod_lumper_bills (
    org_id, company_id, bill_id, order_id, invoice_no, bill_date, bill_type, canceled, rebilled,
    total_charges, lumper_amount, lumper_lines, last_seen_at)
  select p_org, p_company, r.external_id, r.order_external_id, r.invoice_no, r.bill_date, r.bill_type, r.canceled, r.rebilled,
         r.total_charges, coalesce(r.lumper_amount, 0), coalesce(r.lumper_lines, 0), v_now
    from jsonb_to_recordset(coalesce(p_bills, '[]'::jsonb)) as r(
      external_id text, order_external_id text, invoice_no text, bill_date timestamptz, bill_type text, canceled text,
      rebilled text, total_charges numeric, lumper_amount numeric, lumper_lines integer)
  on conflict (org_id, company_id, bill_id) do update set
    order_id = excluded.order_id, invoice_no = excluded.invoice_no, bill_date = excluded.bill_date,
    bill_type = excluded.bill_type, canceled = excluded.canceled, rebilled = excluded.rebilled,
    total_charges = excluded.total_charges, lumper_amount = excluded.lumper_amount,
    lumper_lines = excluded.lumper_lines, last_seen_at = excluded.last_seen_at;

  -- A case for every order the sweep returned. Never reopened, never closed here: both are a person's.
  with opened as (
    insert into lumper_cases (org_id, company_id, order_id, charge_code, opened_at)
    select p_org, p_company, o.order_id, 'LUM', v_now
      from mcleod_lumper_orders o
     where o.org_id = p_org and o.company_id = p_company and o.last_seen_at = v_now
    on conflict (org_id, company_id, order_id, charge_code) do nothing
    returning 1)
  select count(*) into v_cases_opened from opened;

  insert into mcleod_lumper_sweeps (org_id, company_id, since, swept_at, orders, charges, payments, bills)
  values (p_org, p_company, p_since, v_now,
          jsonb_array_length(coalesce(p_orders, '[]'::jsonb)), jsonb_array_length(coalesce(p_charges, '[]'::jsonb)),
          jsonb_array_length(coalesce(p_payments, '[]'::jsonb)), jsonb_array_length(coalesce(p_bills, '[]'::jsonb)))
  on conflict (org_id, company_id) do update set
    since = excluded.since, swept_at = excluded.swept_at, orders = excluded.orders,
    charges = excluded.charges, payments = excluded.payments, bills = excluded.bills;

  return jsonb_build_object(
    'orders', jsonb_array_length(coalesce(p_orders, '[]'::jsonb)),
    'charges', jsonb_array_length(coalesce(p_charges, '[]'::jsonb)),
    'payments', jsonb_array_length(coalesce(p_payments, '[]'::jsonb)),
    'bills', jsonb_array_length(coalesce(p_bills, '[]'::jsonb)),
    'chargesRemoved', v_charges_removed,
    'paymentsRemoved', v_payments_removed,
    'billsRemoved', v_bills_removed,
    'casesOpened', v_cases_opened);
end;
$$;

revoke all on function public.lumper_sweep_apply(uuid, text, date, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.lumper_sweep_apply(uuid, text, date, jsonb, jsonb, jsonb, jsonb) to service_role;
