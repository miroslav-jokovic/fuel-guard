-- 0621 — FleetPal moves the shelf (FLEETPAL-INTEGRATION-PLAN.md step F13; D-FP12, D-FP13, Q4 ruled
-- 2026-09-21; decisions D-FP23–D-FP25 recorded in the plan the same day as this migration).
--
-- ── WHAT CHANGES ────────────────────────────────────────────────────────────────────────────────
-- Three additive things, and one function taught to tell a phone from a vendor:
--
--   1. `part_movements.source` — null for every movement a person recorded (all of them, until the
--      next merge), `'fleetpal'` for a receipt line or a repair's part that the hourly sweep wrote.
--      The plan's F13 says "the drawer/ledger says the row came from FleetPal, so a technician can
--      see why a shelf moved without anyone touching it". `actor_user_id is null` cannot carry that:
--      a null actor also means a deleted member, and a fact inferred from an absence is a guess.
--   2. `stock_locations.fleetpal_from` — the instant THIS shelf starts following FleetPal. Null = it
--      does not. At most one location per org carries it (a partial unique index), which is what
--      answers Q4 without a "default location" the schema never had: FleetPal names no location,
--      so the admin names the one it moves. Set from the shop's locations screen, never by a deploy.
--      It lives on maintenance's table, not on `fleetpal_credentials`, because the ledger function
--      below reads it, and maintenance reading the collector's table is the edge D-FP2 forbids.
--   3. `record_part_movement` writes `source`, and judges a FleetPal row's clock differently (below).
--
-- ── D-FP23: NO BACKFILL, AND THE DATABASE IS WHAT REFUSES ONE ──────────────────────────────────
-- Measured in production on 2026-11-16: ONE stock location, ZERO movements ever recorded, ZERO
-- non-zero shelf lines, 3,624 FleetPal parts in the catalogue. FleetPal holds 1,936 receipt lines
-- and 16,240 part lines from 2025-01-01. Replaying that history would put 21 months of deliveries on
-- a shelf whose contents nobody has ever counted — stock long since bolted onto trucks would appear
-- as on hand, and every one of those numbers would be wrong in the direction that stops a re-order.
-- D-FP11 already says it: FleetPal supplies the catalogue, a COUNT supplies the balance. So FleetPal
-- moves a shelf only from its `fleetpal_from` forward, and the admin picks that instant — ideally the
-- morning after a count. A FleetPal row dated before it raises IV017 here, so a sweep with a bug in
-- its window, or a hand-run script, cannot backfill by accident.
--
-- ── D-FP24: THE 24-HOUR CLOCK RULE IS ABOUT PHONES ─────────────────────────────────────────────
-- IV014 exists because "a phone whose date is wrong would otherwise file today's count under 2019".
-- A FleetPal row's `occurred_at` is not a phone's clock: it is FleetPal's own `created`, set by their
-- server when the line was entered. Holding it to ±24 h of now would turn any sweep outage longer
-- than a day (the worker restarting, FleetPal 500-ing, a key rotation) into receipts silently never
-- reaching the shelf — or, worse, a caller that stamps them `now()` to get past the gate, so the
-- ledger says they arrived on the day the sweep recovered. So a FleetPal row may be any age back to
-- `fleetpal_from`, and is still refused more than 24 h in the FUTURE, which no vendor clock should be.
--
-- ── WHAT DOES NOT CHANGE ────────────────────────────────────────────────────────────────────────
-- Negative stock is still refused, for FleetPal too (D-INV26, IV010). Measured: 637 of 661 part
-- lines in the last 30 days name a catalogue part, and the shelf holds none of any of them, so on
-- day one most consumption WILL be refused. That is the rule working: "a shelf gone negative is a
-- counting problem, and a count movement fixes it". The sweep reports those lines and retries them
-- for a week (D-FP25, in the plan) rather than this function inventing stock to subtract from.
--
-- Every other rule — idempotency on the movement id first, the org boundary, the inactive part, the
-- guarded update, append-only — is the 0331 body verbatim. The function is restated whole because
-- `create or replace` has no other shape; the diff against 0331 is the source column, the clock
-- branch and IV017.

alter table public.part_movements
  add column if not exists source text check (source in ('fleetpal'));

comment on column public.part_movements.source is
  'Who wrote the movement when no person did: ''fleetpal'' for a receipt line or a repair''s part line the FleetPal sweep recorded (F13). Null for every movement a person recorded.';

alter table public.stock_locations
  add column if not exists fleetpal_from timestamptz;

comment on column public.stock_locations.fleetpal_from is
  'The instant this location starts following FleetPal (F13, D-FP23). Null = it does not; at most one per org. FleetPal movements here dated before it, or at any other location, are refused (IV017): there is no backfill, because the opening balance is a count (D-FP11).';

create unique index if not exists stock_locations_one_fleetpal_shelf
  on public.stock_locations (org_id) where fleetpal_from is not null;

create or replace function record_part_movement(p_org uuid, p_actor uuid, p_row jsonb)
returns public.part_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id        uuid := (p_row->>'id')::uuid;
  v_part      uuid := (p_row->>'partId')::uuid;
  v_from      uuid := (p_row->>'locationId')::uuid;
  v_to        uuid := nullif(p_row->>'toLocationId', '')::uuid;
  v_reason    text := p_row->>'reason';
  v_source    text := nullif(p_row->>'source', '');
  v_occurred  timestamptz := coalesce((p_row->>'occurredAt')::timestamptz, now());
  v_qty       integer := nullif(p_row->>'quantity', '')::integer;
  v_counted   integer := nullif(p_row->>'countedTotal', '')::integer;
  v_cost      numeric(12,2) := nullif(p_row->>'unitCost', '')::numeric;
  v_fleetpal_from timestamptz;
  v_onhand    integer;
  v_delta     integer;
  v_existing  public.part_movements;
  v_out       public.part_movements;
  v_active    boolean;
  v_moved     integer;
begin
  if v_id is null then
    raise exception 'a movement needs a client-generated id' using errcode = 'IV015';
  end if;

  -- 1. IDEMPOTENCY BEFORE ANYTHING ELSE (0331). A replay returns the row it already produced.
  select * into v_existing from public.part_movements m where m.id = v_id and m.org_id = p_org;
  if found then
    return v_existing;
  end if;

  -- 2. The clock. A person's movement: ±24 h of now (0331). A FleetPal movement: never in the future,
  --    only at the location that follows FleetPal, and never before its `fleetpal_from` (D-FP23,
  --    D-FP24 — see the header). An unknown location reads as null here and is IV017, not IV012:
  --    either way nothing is written.
  if v_occurred > now() + interval '24 hours' then
    raise exception 'occurred_at % is more than 24 hours from now', v_occurred using errcode = 'IV014';
  end if;
  if v_source is null then
    if v_occurred < now() - interval '24 hours' then
      raise exception 'occurred_at % is more than 24 hours from now', v_occurred using errcode = 'IV014';
    end if;
  elsif v_source = 'fleetpal' then
    select l.fleetpal_from into v_fleetpal_from
      from public.stock_locations l where l.id = v_from and l.org_id = p_org;
    if v_fleetpal_from is null or v_occurred < v_fleetpal_from then
      raise exception 'FleetPal movement at % precedes this location''s FleetPal start %', v_occurred, v_fleetpal_from
        using errcode = 'IV017';
    end if;
  else
    raise exception 'unknown movement source %', v_source using errcode = 'IV015';
  end if;

  -- 3. The location, and the org boundary (0331).
  if not exists (select 1 from public.stock_locations l
                 where l.id = v_from and l.org_id = p_org and l.active) then
    raise exception 'unknown or inactive stock location %', v_from using errcode = 'IV012';
  end if;
  if v_reason = 'transferred' then
    if v_to is null or v_to = v_from then
      raise exception 'a transfer needs a different destination location' using errcode = 'IV012';
    end if;
    if not exists (select 1 from public.stock_locations l
                   where l.id = v_to and l.org_id = p_org and l.active) then
      raise exception 'unknown or inactive stock location %', v_to using errcode = 'IV012';
    end if;
  end if;

  -- 4. The part (0331).
  select p.active into v_active from public.parts p where p.id = v_part and p.org_id = p_org;
  if not found then
    raise exception 'unknown part %', v_part using errcode = 'IV013';
  end if;
  if not v_active and v_reason not in ('counted', 'adjusted') then
    raise exception 'part % is inactive', v_part using errcode = 'IV013';
  end if;

  -- 5. The stock lines exist before the ledger touches them (0331).
  insert into public.part_stock (org_id, part_id, location_id, quantity_on_hand)
  values (p_org, v_part, v_from, 0)
  on conflict (org_id, part_id, location_id) do nothing;
  if v_reason = 'transferred' then
    insert into public.part_stock (org_id, part_id, location_id, quantity_on_hand)
    values (p_org, v_part, v_to, 0)
    on conflict (org_id, part_id, location_id) do nothing;
  end if;

  -- 6. Lock the source line (0331).
  select s.quantity_on_hand into v_onhand
  from public.part_stock s
  where s.org_id = p_org and s.part_id = v_part and s.location_id = v_from
  for update;

  -- 7. The sign lives here and only here (0331).
  v_delta := case v_reason
    when 'received'    then v_qty
    when 'returned'    then v_qty
    when 'issued'      then -v_qty
    when 'transferred' then -v_qty
    when 'adjusted'    then nullif(p_row->>'quantityDelta', '')::integer
    when 'counted'     then v_counted - v_onhand
  end;
  if v_delta is null then
    raise exception 'movement % (%) carries no quantity', v_id, v_reason using errcode = 'IV015';
  end if;

  insert into public.part_movements (
    id, org_id, part_id, location_id, reason, adjust_reason, quantity_delta, counted_total,
    count_session_id, unit_cost, supplier, vehicle_id, trailer_id, work_order_ref, note,
    actor_user_id, transfer_group_id, blind, occurred_at, source
  ) values (
    v_id, p_org, v_part, v_from, v_reason,
    nullif(p_row->>'adjustReason', ''), v_delta, v_counted,
    nullif(p_row->>'countSessionId', '')::uuid, v_cost, nullif(p_row->>'supplier', ''),
    nullif(p_row->>'vehicleId', '')::uuid, nullif(p_row->>'trailerId', '')::uuid,
    nullif(p_row->>'workOrderRef', ''), nullif(p_row->>'note', ''),
    p_actor,
    case when v_reason = 'transferred' then v_id end,
    case when p_row ? 'blind' then (p_row->>'blind')::boolean end,
    v_occurred,
    v_source
  )
  on conflict (id) do nothing
  returning * into v_out;

  -- The in-flight half of D-INV27 (0331): the loser of a race falls through to here.
  if v_out is null then
    select * into v_existing from public.part_movements m where m.id = v_id and m.org_id = p_org;
    if found then
      return v_existing;
    end if;
    raise exception 'movement % is already being recorded', v_id using errcode = 'IV016';
  end if;

  -- 8. The guarded UPDATE (D-INV26) — for FleetPal rows too.
  update public.part_stock s
     set quantity_on_hand = s.quantity_on_hand + v_delta,
         updated_at = now()
   where s.org_id = p_org and s.part_id = v_part and s.location_id = v_from
     and s.quantity_on_hand + v_delta >= 0;
  get diagnostics v_moved = row_count;
  if v_moved = 0 then
    raise exception 'part % at location % has % on hand and cannot move %',
      v_part, v_from, v_onhand, v_delta using errcode = 'IV010';
  end if;

  -- 9. The inbound leg of a transfer (0331).
  if v_reason = 'transferred' then
    insert into public.part_movements (
      id, org_id, part_id, location_id, reason, quantity_delta, note, actor_user_id,
      transfer_group_id, occurred_at
    ) values (
      (md5(v_id::text || ':in'))::uuid, p_org, v_part, v_to, 'transferred', v_qty,
      nullif(p_row->>'note', ''), p_actor, v_id, v_occurred
    )
    on conflict (id) do nothing;

    update public.part_stock s
       set quantity_on_hand = s.quantity_on_hand + v_qty,
           updated_at = now()
     where s.org_id = p_org and s.part_id = v_part and s.location_id = v_to;
  end if;

  -- 10. Last cost (D-INV15).
  if v_reason = 'received' and v_cost is not null then
    update public.parts p set last_cost = v_cost, updated_at = now()
     where p.id = v_part and p.org_id = p_org;
  end if;

  return v_out;
end;
$$;

revoke all on function record_part_movement(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function record_part_movement(uuid, uuid, jsonb) to service_role;

comment on function record_part_movement(uuid, uuid, jsonb) is
  'The only writer of part_stock.quantity_on_hand (D-INV4). Idempotent on the client-generated movement id (D-INV27); refuses to go negative (IV010, D-INV26); a transfer writes both legs. A FleetPal-sourced row (0621) keeps the vendor''s clock but lands only at the location carrying fleetpal_from, never before it (IV017).';
