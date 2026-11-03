-- 0557 — what the shop actually goes through: three read functions over FleetPal's repair record, so
-- Shop parts can list parts by use and a part's page can say where it went
-- (docs/plans/maintenance/SHOP-PARTS-USAGE-PLAN.md, step SP-U1; first of two merges).
--
-- ── THE GAP, MEASURED ON PRODUCTION 2026-11-03 ───────────────────────────────────────────────────
-- Shop parts lists 3,560 catalogue parts in part-number order. Manufacturer, category and last cost are
-- blank on every one of them (FleetPal's catalogue carries none of the three), so the page reads as a
-- part number and a sentence. Only 392 of those parts went on a repair in the last 90 days. Meanwhile
-- `fleetpal_job_items` holds 15,934 PART lines (March 2025 → today), every one with a job, a work
-- order and a unit; 11,862 name a part in our catalogue. Nothing reads them by part.
--
-- ── WHY FUNCTIONS, NOT POSTGREST READS ───────────────────────────────────────────────────────────
-- "Most used first, paged" is an aggregate over job items → jobs → work orders, sorted on the
-- aggregate. PostgREST cannot sort a table by another table's sum, and paging the 16k lines into the
-- API on every request to sort them there would be a slow copy of what Postgres does in one plan.
--
-- ── WHAT ONE USE IS ──────────────────────────────────────────────────────────────────────────────
--   · a PART line (`item_type = 'PART'`) naming a FleetPal part, on a job, on a work order that was
--     not CANCELED. A line whose work order did not arrive is not counted (zero on 2026-11-03).
--   · its DATE is the work order's `completed`, else `started`, else the line's own creation — the
--     day the repair happened, which is what "last used" means to a mechanic. A line's
--     `vendor_created_at` is when somebody typed it, which can trail the repair by days.
--   · `repairs` counts distinct WORK ORDERS, not lines: a brake job enters each shoe kit as its own
--     line (311 lines on 93 work orders in 90 days), and "used on 311 repairs" would be false.
--   · a price is a unit price (`price`; `total = price × quantity` on all 15,934 lines). Prices ≤ 0
--     are credits and returns (2 lines) and are left out of every price figure, never of quantity.
--
-- ── NO SPEND TOTALS (D-FP4) ──────────────────────────────────────────────────────────────────────
-- These functions return quantities and UNIT prices only — never a sum of money. A per-part spend
-- total is a cost figure, and D-FP4 forbids printing a FleetPal cost without its coverage bound.
--
-- ── SQL MEASURES, TYPESCRIPT JUDGES ──────────────────────────────────────────────────────────────
-- `shop_part_history` returns `days_since_previous_on_unit`, not "is this a repeat repair"; the
-- threshold lives in `packages/shared/src/shopPartsUsage.ts` (memory: SQL returns a measurement, TS
-- owns the verdict). Windows are passed IN (`p_since`, `p_now`) — no clock in here, so a matrix can
-- pin every boundary.
--
-- ── ORG SCOPE ────────────────────────────────────────────────────────────────────────────────────
-- Every function takes `p_org_id` and filters every table by it; they are called by the API with the
-- service role, which bypasses RLS. Service-role only: revoked from public, anon and authenticated.
--
-- raw-access-waiver: these are the fleetpal module's own readers over its own raw-layer tables
-- (`fleetpal_job_items`, `fleetpal_jobs`, `fleetpal_work_orders`, `fleetpal_units`); the API calls them
-- only from `apps/api/src/modules/fleetpal/partUsage.ts`, and maintenance reaches them through
-- fleetpal's index (the declared `maintenance -> fleetpal` edge), never with its own `.rpc()`.
-- cross-module-waiver: the functions READ `parts` (maintenance's catalogue) beside FleetPal's staged
-- repair record (fleetpal's), the same pairing F12's `fleetpal -> maintenance` edge already declares.
-- They write nothing.
--
-- ⚠ DEPLOY WINDOW: three new functions and nothing that calls them. `lint:migration-ordering` reads
-- columns, not functions, so the reader (SP-U2) is held behind this merge by hand: it merges after
-- migrate-staging has applied this file, and its PR body names the pg_proc check.

-- ── shared core: one row per (part, work order) ─────────────────────────────────────────────────
-- A plain SQL function the three readers select from, so "what one use is" has one definition.
create or replace function public.shop_part_uses(p_org_id uuid)
returns table (
  part_fleetpal_id text,
  work_order_fleetpal_id text,
  work_order_number integer,
  work_order_status text,
  unit_fleetpal_id text,
  used_at timestamptz,
  quantity numeric,
  priced_quantity numeric,
  priced_total numeric
)
language sql
stable
set search_path = public
as $fn$
  select
    ji.part_fleetpal_id,
    w.fleetpal_id,
    max(w.number),
    max(w.status),
    max(w.unit_fleetpal_id),
    max(coalesce(w.completed, w.started, ji.vendor_created_at)),
    coalesce(sum(ji.quantity), 0),
    coalesce(sum(ji.quantity) filter (where ji.price > 0), 0),
    coalesce(sum(ji.price * ji.quantity) filter (where ji.price > 0), 0)
  from fleetpal_job_items ji
  join fleetpal_jobs j on j.org_id = ji.org_id and j.fleetpal_id = ji.job_fleetpal_id
  join fleetpal_work_orders w on w.org_id = j.org_id and w.fleetpal_id = j.work_order_fleetpal_id
  where ji.org_id = p_org_id
    and ji.item_type = 'PART'
    and ji.part_fleetpal_id is not null
    and coalesce(w.status, '') <> 'CANCELED'
  group by ji.part_fleetpal_id, w.fleetpal_id
$fn$;

-- ── 1. the list: catalogue parts with their use, searched, sorted, paged ─────────────────────────
-- `p_sort` is one of used | repairs | last_used | last_price | part_number; anything else is refused
-- (SPU01) rather than silently sorted by part number. Ties and unused parts fall back to part number,
-- so a page boundary is stable. `total_count` is the whole filtered count on every row.
create or replace function public.shop_parts_list(
  p_org_id uuid,
  p_since timestamptz,
  p_search text,
  p_used_only boolean,
  p_sort text,
  p_descending boolean,
  p_limit integer,
  p_offset integer
)
returns table (
  part_id uuid,
  part_number text,
  description text,
  unit_of_measure text,
  fleetpal_id text,
  fleetpal_unit text,
  used_quantity numeric,
  used_repairs bigint,
  last_used_at timestamptz,
  last_price numeric,
  total_count bigint
)
language plpgsql
stable
set search_path = public
as $fn$
#variable_conflict use_column
declare
  v_term text;
begin
  if p_org_id is null or p_since is null then
    raise exception 'org and window are required' using errcode = 'SPU02';
  end if;
  if p_sort is null or p_sort not in ('used', 'repairs', 'last_used', 'last_price', 'part_number') then
    raise exception 'unknown sort %', p_sort using errcode = 'SPU01';
  end if;
  -- LIKE's own wildcards in what was typed are literal characters: a part number with `_` in it
  -- must match itself, not any character.
  v_term := nullif(btrim(coalesce(p_search, '')), '');
  if v_term is not null then
    v_term := '%' || replace(replace(replace(v_term, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  with uses as (
    select * from public.shop_part_uses(p_org_id)
  ),
  windowed as (
    select u.part_fleetpal_id,
           sum(u.quantity) as qty,
           count(*) as repairs
    from uses u
    where u.used_at >= p_since
    group by u.part_fleetpal_id
  ),
  latest as (
    select distinct on (u.part_fleetpal_id)
           u.part_fleetpal_id, u.used_at
    from uses u
    order by u.part_fleetpal_id, u.used_at desc nulls last, u.work_order_fleetpal_id desc
  ),
  latest_price as (
    select distinct on (u.part_fleetpal_id)
           u.part_fleetpal_id, round(u.priced_total / u.priced_quantity, 2) as price
    from uses u
    where u.priced_quantity > 0
    order by u.part_fleetpal_id, u.used_at desc nulls last, u.work_order_fleetpal_id desc
  ),
  listed as (
    select p.id, p.part_number, p.description, p.unit_of_measure, p.fleetpal_id, p.fleetpal_unit,
           coalesce(w.qty, 0) as qty, coalesce(w.repairs, 0) as repairs,
           l.used_at, lp.price
    from parts p
    left join windowed w on w.part_fleetpal_id = p.fleetpal_id
    left join latest l on l.part_fleetpal_id = p.fleetpal_id
    left join latest_price lp on lp.part_fleetpal_id = p.fleetpal_id
    where p.org_id = p_org_id
      and p.active
      and (not coalesce(p_used_only, false) or w.repairs > 0)
      and (
        v_term is null
        or p.part_number ilike v_term
        or p.description ilike v_term
        or p.upc ilike v_term
        -- The number on the box is often the MANUFACTURER's (10,193 lines carry one that differs
        -- from the shop's part number), so a search for it finds the part it was entered against.
        or (p.fleetpal_id is not null and exists (
              select 1 from fleetpal_job_items ji
              where ji.org_id = p_org_id
                and ji.part_fleetpal_id = p.fleetpal_id
                and ji.manufacturer_part_number ilike v_term))
      )
  )
  select r.id, r.part_number, r.description, r.unit_of_measure, r.fleetpal_id, r.fleetpal_unit,
         r.qty, r.repairs, r.used_at, r.price,
         count(*) over ()
  from listed r
  order by
    case when p_sort = 'used' and p_descending then r.qty end desc nulls last,
    case when p_sort = 'used' and not p_descending then r.qty end asc nulls last,
    case when p_sort = 'repairs' and p_descending then r.repairs end desc nulls last,
    case when p_sort = 'repairs' and not p_descending then r.repairs end asc nulls last,
    case when p_sort = 'last_used' and p_descending then r.used_at end desc nulls last,
    case when p_sort = 'last_used' and not p_descending then r.used_at end asc nulls last,
    case when p_sort = 'last_price' and p_descending then r.price end desc nulls last,
    case when p_sort = 'last_price' and not p_descending then r.price end asc nulls last,
    case when p_sort = 'part_number' and p_descending then r.part_number end desc,
    r.part_number asc,
    r.id asc
  limit greatest(least(coalesce(p_limit, 50), 200), 1)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$fn$;

-- ── 2. one part's figures: last 90 days, last 12 months, prices ─────────────────────────────────
-- One row always (zeros and nulls for an unused part, or a part of another org — the API has already
-- answered 404 for that). Prices are per unit; `priced_repairs_365d` is how many repairs the typical
-- price stands on, so the page can decline to call two of them "typical".
create or replace function public.shop_part_summary(p_org_id uuid, p_part_id uuid, p_now timestamptz)
returns table (
  quantity_90d numeric,
  repairs_90d bigint,
  quantity_365d numeric,
  repairs_365d bigint,
  units_365d bigint,
  first_used_at timestamptz,
  last_used_at timestamptz,
  last_price numeric,
  typical_price_365d numeric,
  low_price_365d numeric,
  high_price_365d numeric,
  priced_repairs_365d bigint
)
language sql
stable
set search_path = public
as $fn$
  with part as (
    select p.fleetpal_id from parts p where p.org_id = p_org_id and p.id = p_part_id
  ),
  uses as (
    select u.*,
           case when u.priced_quantity > 0 then u.priced_total / u.priced_quantity end as unit_price
    from public.shop_part_uses(p_org_id) u
    join part on part.fleetpal_id = u.part_fleetpal_id
  )
  select
    coalesce(sum(quantity) filter (where used_at >= p_now - interval '90 days'), 0),
    count(*) filter (where used_at >= p_now - interval '90 days'),
    coalesce(sum(quantity) filter (where used_at >= p_now - interval '365 days'), 0),
    count(*) filter (where used_at >= p_now - interval '365 days'),
    count(distinct unit_fleetpal_id) filter (where used_at >= p_now - interval '365 days'),
    min(used_at),
    max(used_at),
    (select round(x.unit_price, 2) from uses x where x.unit_price is not null
      order by x.used_at desc nulls last, x.work_order_fleetpal_id desc limit 1),
    round((percentile_cont(0.5) within group (order by unit_price)
      filter (where used_at >= p_now - interval '365 days' and unit_price is not null))::numeric, 2),
    round(min(unit_price) filter (where used_at >= p_now - interval '365 days'), 2),
    round(max(unit_price) filter (where used_at >= p_now - interval '365 days'), 2),
    count(unit_price) filter (where used_at >= p_now - interval '365 days')
  from uses
$fn$;

-- ── 3. where it went: one row per work order, newest first, paged ───────────────────────────────
-- `days_since_previous_on_unit` is the gap to the previous work order that put THIS part on THIS
-- unit — null on the first, and null when the work order names no unit. Measured over the whole
-- history before paging, so page 3's first row still knows its predecessor on page 4.
create or replace function public.shop_part_history(
  p_org_id uuid,
  p_part_id uuid,
  p_limit integer,
  p_offset integer
)
returns table (
  work_order_fleetpal_id text,
  work_order_number integer,
  work_order_status text,
  used_at timestamptz,
  unit_fleetpal_id text,
  unit_number text,
  vehicle_id uuid,
  trailer_id uuid,
  quantity numeric,
  unit_price numeric,
  days_since_previous_on_unit integer,
  total_count bigint
)
language sql
stable
set search_path = public
as $fn$
  with part as (
    select p.fleetpal_id from parts p where p.org_id = p_org_id and p.id = p_part_id
  ),
  uses as (
    select u.*,
           case when u.unit_fleetpal_id is null then null
                else lag(u.used_at) over (partition by u.unit_fleetpal_id
                                          order by u.used_at, u.work_order_fleetpal_id)
           end as previous_at
    from public.shop_part_uses(p_org_id) u
    join part on part.fleetpal_id = u.part_fleetpal_id
  )
  select
    u.work_order_fleetpal_id,
    u.work_order_number,
    u.work_order_status,
    u.used_at,
    u.unit_fleetpal_id,
    fu.number,
    fu.vehicle_id,
    fu.trailer_id,
    u.quantity,
    case when u.priced_quantity > 0 then round(u.priced_total / u.priced_quantity, 2) end,
    case when u.previous_at is not null
         then floor(extract(epoch from (u.used_at - u.previous_at)) / 86400)::integer end,
    count(*) over ()
  from uses u
  left join fleetpal_units fu on fu.org_id = p_org_id and fu.fleetpal_id = u.unit_fleetpal_id
  order by u.used_at desc nulls last, u.work_order_fleetpal_id desc
  limit greatest(least(coalesce(p_limit, 25), 200), 1)
  offset greatest(coalesce(p_offset, 0), 0)
$fn$;

revoke all on function public.shop_part_uses(uuid) from public, anon, authenticated;
revoke all on function public.shop_parts_list(uuid, timestamptz, text, boolean, text, boolean, integer, integer) from public, anon, authenticated;
revoke all on function public.shop_part_summary(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.shop_part_history(uuid, uuid, integer, integer) from public, anon, authenticated;
-- The API calls these with the service-role key. Supabase's default privileges already give it
-- EXECUTE (0412 leaves service_role alone); written out so the intent does not rest on a default.
grant execute on function public.shop_part_uses(uuid) to service_role;
grant execute on function public.shop_parts_list(uuid, timestamptz, text, boolean, text, boolean, integer, integer) to service_role;
grant execute on function public.shop_part_summary(uuid, uuid, timestamptz) to service_role;
grant execute on function public.shop_part_history(uuid, uuid, integer, integer) to service_role;
