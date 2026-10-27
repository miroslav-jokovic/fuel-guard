-- 0523 — a tablet is held by a driver (DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md step DE1; D-DE1,
-- D-DE2, D-DE3). Truck inventory only: nothing here touches a shelf, a part or a count of one.
--
-- ── WHAT CHANGES, AND WHAT 0333 SAID ABOUT IT ───────────────────────────────────────────────────
-- 0333's header ruled the holder "a place, never a person" (D-INV3) and gave the reason: a signed
-- handover invites the deduction dispute it appears to settle. On 2026-10-27 the owner amended that
-- for ONE class of thing — tablets follow the driver, everything else stays with the truck — and
-- answered the signature half on paper (Q-DE1: drivers sign a paper hand-receipt; nothing is built
-- for it). So the amendment is narrow on purpose: a fourth holder column, `driver_id`, which an
-- asset may use only when its TYPE says so (`asset_types.held_by = 'driver'`, D-DE1). The type, not
-- a list of names, decides, because "Tablet" is a row the shop types and can rename.
--
-- ── ONE SPELLING OF "IS THIS HOLDER OURS" (D-DE2) ───────────────────────────────────────────────
-- `inventory_holder_is_ours` gains `p_driver`. The five-argument signature is DROPPED, not left
-- beside the new one, and every caller is re-issued below — the three guards 0333 wrote, 0332's
-- count-session guard and 0334's FleetPal unit match. A sixth argument with a default on a second
-- overload would have kept the old one resolvable, and the old one is the copy that goes stale.
--
-- A driver is a DESTINATION only while `active` or `on_leave` — a tablet cannot be handed to
-- somebody who has left. As a SOURCE a driver need only be ours: a terminated driver still holding a
-- tablet is exactly the row a return is written against. The same asymmetry `p_active` already
-- draws for a closed bay.
--
-- ── THE ASSET ROW ASKS "OURS", THE MOVEMENT ASKS "OPEN" ─────────────────────────────────────────
-- 0333's asset guard asked "ours AND open" on every write. With drivers that breaks two things the
-- product needs: a tablet whose driver was terminated is D-DE3's "not returned" row, and a note
-- written on it is an UPDATE of an asset held by somebody no longer active; and a roster merge moves
-- `driver_id` onto the surviving record whatever that record's status is. So the asset guard now
-- asks "open" only on INSERT (a creation is a placement, and nothing else checks it), and "ours" on
-- every write. Every holder CHANGE still meets the stricter question, because the only writer of a
-- holder is `move_asset`, whose ledger row's guard asks it of the destination before the asset row
-- is touched. A side effect, and a correct one: `rebuild_asset_holders` no longer fails on an asset
-- whose last destination bay has since closed — a rebuild replays history and must not refuse it.
--
-- ── IV025: THE WRONG KIND OF HOLDER FOR THE TYPE ────────────────────────────────────────────────
-- New. A `driver` type may sit with a driver, in a bay, or nowhere; a `unit` type in a bay, a truck,
-- a trailer or nowhere. Both may be in a bay, because the shelf between drivers is where a returned
-- tablet waits. Asked in three places, written once (`asset_holder_fits_type`): `move_asset`, so the
-- refusal comes before IV020's unit-capacity check and names the real fault; the asset guard, for a
-- creation; and a new guard on `asset_types`, so switching a type to `driver` while its assets sit
-- in trucks is refused instead of leaving rows the next move would trip over.
--
-- ── A ROSTER MERGE MOVES THE DRIVER ON A LEDGER ROW ─────────────────────────────────────────────
-- `asset_movements` is append-only (IV021). Three `drivers(id)` foreign keys arrive here, and
-- `merge_driver_v2` moves each through `DRIVER_REASSIGNMENTS` (modules/roster/mergeDriver.ts) —
-- which for the ledger means an UPDATE. The guard is re-issued on 0236's model: every column frozen
-- except `from_driver_id` and `to_driver_id`, and a moved driver must still be this org's. A merge
-- is the one correction the ledger accepts, because two driver records that are one person are one
-- holder; any other edit is still IV021, service role included.
--
-- ⚠ All three FKs are `on delete restrict`, like every holder reference in 0333. A merge that did NOT
-- list them would abort on the final `delete from drivers` instead of silently losing a tablet's
-- history — the loud shape, `financial_entries`' lesson. `inventory-driver-held.test.mjs` drives the
-- REAL list.
--
-- Measured on production 2026-10-27: 0 asset types, 0 assets, 0 asset movements — the new column
-- defaults and widened CHECKs apply to empty tables. No reader ships here (lint:migration-ordering):
-- the DTO, the verbs and the screens are DE2.

-- ── the type decides who may hold it (D-DE1) ────────────────────────────────────────────────────
alter table asset_types
  add column if not exists held_by text not null default 'unit' check (held_by in ('unit', 'driver'));

comment on column asset_types.held_by is
  'Who holds an asset of this type (D-DE1): ''unit'' — a bay, truck or trailer; ''driver'' — a bay or a driver (tablets). IV025 refuses the other kind.';

-- ── the fourth holder ───────────────────────────────────────────────────────────────────────────
alter table inventory_assets
  add column if not exists driver_id uuid references drivers(id) on delete restrict;
alter table asset_movements
  add column if not exists from_driver_id uuid references drivers(id) on delete restrict;
alter table asset_movements
  add column if not exists to_driver_id uuid references drivers(id) on delete restrict;

alter table inventory_assets drop constraint if exists inventory_assets_one_holder;
alter table inventory_assets add constraint inventory_assets_one_holder
  check (num_nonnulls(location_id, vehicle_id, trailer_id, driver_id) <= 1);

alter table asset_movements drop constraint if exists asset_movements_one_source;
alter table asset_movements add constraint asset_movements_one_source
  check (num_nonnulls(from_location_id, from_vehicle_id, from_trailer_id, from_driver_id) <= 1);
alter table asset_movements drop constraint if exists asset_movements_one_destination;
alter table asset_movements add constraint asset_movements_one_destination
  check (num_nonnulls(to_location_id, to_vehicle_id, to_trailer_id, to_driver_id) <= 1);
alter table asset_movements drop constraint if exists asset_movements_report_moves_nothing;
alter table asset_movements add constraint asset_movements_report_moves_nothing
  check (reason not in ('reported_missing','reported_damaged')
         or num_nonnulls(to_location_id, to_vehicle_id, to_trailer_id, to_driver_id) = 0);

-- "What does this driver hold" — the driver page's Equipment card and D-DE3's not-returned count.
create index if not exists idx_inventory_assets_driver on inventory_assets (org_id, driver_id)
  where driver_id is not null;
-- A roster merge updates by these two; without an index each is a scan of the whole ledger.
create index if not exists idx_asset_movements_from_driver on asset_movements (from_driver_id)
  where from_driver_id is not null;
create index if not exists idx_asset_movements_to_driver on asset_movements (to_driver_id)
  where to_driver_id is not null;

-- ── the question, re-asked with the driver (D-DE2) ──────────────────────────────────────────────
drop function if exists inventory_holder_is_ours(uuid, uuid, uuid, uuid, boolean);

create or replace function inventory_holder_is_ours(
  p_org uuid, p_location uuid, p_vehicle uuid, p_trailer uuid, p_driver uuid, p_active boolean default true
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_location is not null then
    return exists (
      select 1 from public.stock_locations l
       where l.id = p_location and l.org_id = p_org and (l.active or not p_active)
    );
  elsif p_vehicle is not null then
    return exists (select 1 from public.vehicles v where v.id = p_vehicle and v.org_id = p_org);
  elsif p_trailer is not null then
    return exists (select 1 from public.trailers t where t.id = p_trailer and t.org_id = p_org);
  elsif p_driver is not null then
    -- `on_leave` keeps a tablet and may be given one; `inactive` and `terminated` have left (D-DE3).
    return exists (
      select 1 from public.drivers d
       where d.id = p_driver and d.org_id = p_org
         and (d.status in ('active', 'on_leave') or not p_active)
    );
  end if;
  return true;
end;
$$;

revoke all on function inventory_holder_is_ours(uuid, uuid, uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function inventory_holder_is_ours(uuid, uuid, uuid, uuid, uuid, boolean) to service_role;

comment on function inventory_holder_is_ours(uuid, uuid, uuid, uuid, uuid, boolean) is
  'Does the named bay, truck, trailer or driver belong to this org (IV012)? With p_active, a bay must be open and a driver active or on leave. The guarantee the holder foreign keys cannot give.';

-- ── IV025, written once ─────────────────────────────────────────────────────────────────────────
-- A bay or nowhere is right for both kinds; only the unit/driver columns depend on the type.
create or replace function asset_holder_fits_type(
  p_type uuid, p_vehicle uuid, p_trailer uuid, p_driver uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case (select t.held_by from public.asset_types t where t.id = p_type)
           when 'driver' then p_vehicle is null and p_trailer is null
           else p_driver is null
         end;
$$;

revoke all on function asset_holder_fits_type(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function asset_holder_fits_type(uuid, uuid, uuid, uuid) to service_role;

-- ── the callers, re-issued with `p_driver => null` where they never name one ────────────────────
-- 0332 + 0333: unchanged behaviour; `count-sessions.test.mjs` still says so.
create or replace function guard_stock_count_session_holder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.inventory_holder_is_ours(new.org_id, new.location_id, new.vehicle_id, new.trailer_id, null, true) then
    if new.location_id is not null then
      raise exception 'stock location % is not this org''s, or is closed', new.location_id
        using errcode = 'IV012';
    elsif new.vehicle_id is not null then
      raise exception 'vehicle % is not this org''s', new.vehicle_id using errcode = 'IV012';
    else
      raise exception 'trailer % is not this org''s', new.trailer_id using errcode = 'IV012';
    end if;
  end if;
  return new;
end;
$$;

-- 0334: unchanged behaviour — a FleetPal unit may resolve to a retired truck, so `p_active => false`.
create or replace function guard_fleetpal_unit_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.inventory_holder_is_ours(new.org_id, null, new.vehicle_id, new.trailer_id, null, false) then
    if new.vehicle_id is not null then
      raise exception 'vehicle % is not this org''s', new.vehicle_id using errcode = 'IV012';
    else
      raise exception 'trailer % is not this org''s', new.trailer_id using errcode = 'IV012';
    end if;
  end if;
  return new;
end;
$$;

-- 0333: unchanged behaviour.
create or replace function guard_kit_expectation_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.inventory_holder_is_ours(new.org_id, null, new.vehicle_id, new.trailer_id, null, true) then
    raise exception 'that truck or trailer is not this org''s' using errcode = 'IV012';
  end if;
  if not exists (select 1 from public.asset_types t
                  where t.id = new.asset_type_id and t.org_id = new.org_id) then
    raise exception 'asset type % is not this org''s', new.asset_type_id using errcode = 'IV012';
  end if;
  return new;
end;
$$;

-- 0333's asset guard. "Open" on INSERT only (header); "ours" always; IV025 when the holder is set or
-- changed; IV022 unchanged.
create or replace function guard_inventory_asset()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_placed boolean := tg_op = 'INSERT'
    or (new.location_id, new.vehicle_id, new.trailer_id, new.driver_id)
       is distinct from (old.location_id, old.vehicle_id, old.trailer_id, old.driver_id);
begin
  if not public.inventory_holder_is_ours(
       new.org_id, new.location_id, new.vehicle_id, new.trailer_id, new.driver_id, tg_op = 'INSERT') then
    raise exception 'that bay, truck, trailer or driver is not this org''s, is closed, or has left'
      using errcode = 'IV012';
  end if;

  if v_placed and not public.asset_holder_fits_type(new.asset_type_id, new.vehicle_id, new.trailer_id, new.driver_id) then
    raise exception 'an asset of this type cannot be held by a %',
      case when new.driver_id is not null then 'driver' else 'truck or trailer' end
      using errcode = 'IV025';
  end if;

  if tg_op = 'UPDATE' and old.tag_code is not null and new.tag_code is distinct from old.tag_code then
    raise exception 'asset % already carries tag %: a tag is assigned once and never reprinted',
      old.id, old.tag_code using errcode = 'IV022';
  end if;

  if new.tag_code is not null and exists (
    select 1 from public.inventory_assets a
     where a.org_id = new.org_id and a.tag_code = new.tag_code and a.id <> new.id
  ) then
    raise exception 'tag % is already on another asset', new.tag_code using errcode = 'IV022';
  end if;

  return new;
end;
$$;

-- 0333's movement guard, with the driver on both sides.
create or replace function guard_asset_movement_holders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.inventory_holder_is_ours(
       new.org_id, new.from_location_id, new.from_vehicle_id, new.from_trailer_id, new.from_driver_id, false) then
    raise exception 'the place this movement came from is not this org''s' using errcode = 'IV012';
  end if;
  if not public.inventory_holder_is_ours(
       new.org_id, new.to_location_id, new.to_vehicle_id, new.to_trailer_id, new.to_driver_id, true) then
    raise exception 'the place this movement goes to is not this org''s, is closed, or is a driver who has left'
      using errcode = 'IV012';
  end if;
  if not exists (select 1 from public.inventory_assets a
                  where a.id = new.asset_id and a.org_id = new.org_id) then
    raise exception 'asset % is not this org''s', new.asset_id using errcode = 'IV024';
  end if;
  return new;
end;
$$;

-- ── append-only, except the merge's one correction (IV021) ──────────────────────────────────────
-- Compared as jsonb minus the two driver columns, so a column added to the ledger later is frozen
-- without anybody remembering to list it here — 0236's list-every-column shape forgets by default.
create or replace function guard_asset_movements_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(old) - 'from_driver_id' - 'to_driver_id') = (to_jsonb(new) - 'from_driver_id' - 'to_driver_id')
  then
    if not public.inventory_holder_is_ours(new.org_id, null, null, null, new.from_driver_id, false)
       or not public.inventory_holder_is_ours(new.org_id, null, null, null, new.to_driver_id, false) then
      raise exception 'a movement''s driver can only be moved to another of this org''s drivers'
        using errcode = 'IV012';
    end if;
    return new;
  end if;
  raise exception 'asset_movements is append-only: a correction is a new movement'
    using errcode = 'IV021';
end;
$$;

-- ── a type cannot change kind under assets that contradict it (IV025) ───────────────────────────
-- Retired assets hold nothing (move_asset clears the holder), so they never block.
create or replace function guard_asset_type_held_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.held_by is distinct from old.held_by and exists (
    select 1 from public.inventory_assets a
     where a.org_id = new.org_id and a.asset_type_id = new.id
       and not public.asset_holder_fits_type(new.id, a.vehicle_id, a.trailer_id, a.driver_id)
  ) then
    raise exception 'assets of type % are held by the other kind of holder: return them to a bay first', new.name
      using errcode = 'IV025';
  end if;
  return new;
end;
$$;

-- An AFTER trigger, so `asset_holder_fits_type` reads the NEW `held_by` from the table itself rather
-- than a second copy of its rule written against `new`.
drop trigger if exists trg_asset_types_held_by on asset_types;
create trigger trg_asset_types_held_by
  after update of held_by on asset_types
  for each row
  execute function guard_asset_type_held_by();

-- ── the one door, with the driver (0333's move_asset; changes marked DE1) ───────────────────────
create or replace function move_asset(p_org uuid, p_actor uuid, p_row jsonb)
returns public.asset_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id        uuid := (p_row->>'id')::uuid;
  v_asset     uuid := (p_row->>'assetId')::uuid;
  v_reason    text := p_row->>'reason';
  v_occurred  timestamptz := coalesce((p_row->>'occurredAt')::timestamptz, now());
  v_to_loc    uuid := nullif(p_row->>'toLocationId', '')::uuid;
  v_to_veh    uuid := nullif(p_row->>'toVehicleId', '')::uuid;
  v_to_tr     uuid := nullif(p_row->>'toTrailerId', '')::uuid;
  v_to_drv    uuid := nullif(p_row->>'toDriverId', '')::uuid;  -- DE1
  v_condition text := nullif(p_row->>'condition', '');
  v_moves     boolean;
  v_a         public.inventory_assets;
  v_existing  public.asset_movements;
  v_out       public.asset_movements;
  v_kind      text;
  v_serial    boolean;
  v_expected  integer;
  v_holds     integer;
begin
  if v_id is null then
    raise exception 'a movement needs a client-generated id' using errcode = 'IV015';
  end if;

  -- 1. Idempotency before anything else (D-INV27).
  select * into v_existing from public.asset_movements m where m.id = v_id and m.org_id = p_org;
  if found then
    return v_existing;
  end if;

  -- 2. The clock, on 0331's window.
  if v_occurred > now() + interval '24 hours' or v_occurred < now() - interval '24 hours' then
    raise exception 'occurred_at % is more than 24 hours from now', v_occurred using errcode = 'IV014';
  end if;

  -- 3. The asset, locked.
  select * into v_a from public.inventory_assets a
   where a.id = v_asset and a.org_id = p_org for update;
  if not found then
    raise exception 'unknown asset %', v_asset using errcode = 'IV024';
  end if;

  -- 4. Retired is terminal (IV023).
  if v_a.status = 'retired' then
    raise exception 'asset % is retired', v_asset using errcode = 'IV023';
  end if;

  v_moves := v_reason not in ('reported_missing', 'reported_damaged');

  -- 4b. DE1 — the right kind of holder for the type (IV025), ahead of IV020 so a tablet scanned
  --     into a truck is told it belongs to a driver, not that the truck already has one.
  if v_moves and v_reason <> 'retired'
     and not public.asset_holder_fits_type(v_a.asset_type_id, v_to_veh, v_to_tr, v_to_drv) then
    raise exception 'an asset of this type cannot be held by a %',
      case when v_to_drv is not null then 'driver' else 'truck or trailer' end
      using errcode = 'IV025';
  end if;

  -- 5. IV020 — one unit, one of a thing that only comes one to a unit (0333, unchanged).
  if v_moves and (v_to_veh is not null or v_to_tr is not null) then
    select t.serialized into v_serial
      from public.asset_types t where t.id = v_a.asset_type_id;

    if v_to_veh is not null then
      v_kind := 'tractor';
    else
      select case when tr.is_reefer then 'reefer_trailer' else 'trailer' end into v_kind
        from public.trailers tr where tr.id = v_to_tr;
    end if;

    if coalesce(v_serial, false) then
      select k.quantity into v_expected
        from public.kit_expectations k
       where k.org_id = p_org and k.asset_type_id = v_a.asset_type_id
         and (k.vehicle_id = v_to_veh or k.trailer_id = v_to_tr);
      if v_expected is null then
        select k.quantity into v_expected
          from public.kit_expectations k
         where k.org_id = p_org and k.asset_type_id = v_a.asset_type_id and k.unit_kind = v_kind
           and k.vehicle_id is null and k.trailer_id is null;
      end if;
      if v_expected is null then
        select t.default_kit_quantity into v_expected
          from public.asset_types t where t.id = v_a.asset_type_id;
      end if;

      if v_expected = 1 then
        select count(*)::integer into v_holds
          from public.inventory_assets a
         where a.org_id = p_org and a.asset_type_id = v_a.asset_type_id and a.id <> v_asset
           and ((v_to_veh is not null and a.vehicle_id = v_to_veh)
             or (v_to_tr  is not null and a.trailer_id = v_to_tr));
        if v_holds > 0 then
          raise exception 'that unit already holds a % and is expected to carry one',
            (select t.name from public.asset_types t where t.id = v_a.asset_type_id)
            using errcode = 'IV020';
        end if;
      end if;
    end if;
  end if;

  -- 6. The ledger row; `from_*` is where the asset stands right now, driver included.
  insert into public.asset_movements (
    id, org_id, asset_id, reason,
    from_location_id, from_vehicle_id, from_trailer_id, from_driver_id,
    to_location_id, to_vehicle_id, to_trailer_id, to_driver_id,
    condition, note, actor_user_id, actor_driver_id, count_session_id, occurred_at
  ) values (
    v_id, p_org, v_asset, v_reason,
    v_a.location_id, v_a.vehicle_id, v_a.trailer_id, v_a.driver_id,
    case when v_moves then v_to_loc end,
    case when v_moves then v_to_veh end,
    case when v_moves then v_to_tr  end,
    case when v_moves then v_to_drv end,
    v_condition, nullif(p_row->>'note', ''), p_actor,
    nullif(p_row->>'actorDriverId', ''), nullif(p_row->>'countSessionId', '')::uuid,
    v_occurred
  )
  on conflict (id) do nothing
  returning * into v_out;

  if v_out is null then
    select * into v_existing from public.asset_movements m where m.id = v_id and m.org_id = p_org;
    if found then
      return v_existing;
    end if;
    raise exception 'movement % is already being recorded', v_id using errcode = 'IV016';
  end if;

  -- 7. The holder, and only what this movement decided.
  update public.inventory_assets a
     set location_id = case when v_moves then (case when v_reason = 'retired' then null else v_to_loc end) else a.location_id end,
         vehicle_id  = case when v_moves then (case when v_reason = 'retired' then null else v_to_veh end) else a.vehicle_id end,
         trailer_id  = case when v_moves then (case when v_reason = 'retired' then null else v_to_tr  end) else a.trailer_id end,
         driver_id   = case when v_moves then (case when v_reason = 'retired' then null else v_to_drv end) else a.driver_id end,
         status      = case when v_reason = 'retired' then 'retired' else a.status end,
         condition   = coalesce(v_condition, a.condition),
         updated_at  = now()
   where a.id = v_asset and a.org_id = p_org;

  return v_out;
end;
$$;

revoke all on function move_asset(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function move_asset(uuid, uuid, jsonb) to service_role;

comment on function move_asset(uuid, uuid, jsonb) is
  'The only writer of an asset''s holder columns (D-INV3, D-DE1). Idempotent on the client-generated movement id (D-INV27); a report does not move anything (D-INV24); IV025 for the wrong kind of holder for the type; IV020 when a unit already holds the one it is expected to carry; IV023 once retired.';

-- ── the projection, rebuilt with the fourth column ──────────────────────────────────────────────
create or replace function rebuild_asset_holders(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed integer;
begin
  with last_move as (
    select distinct on (m.asset_id)
           m.asset_id, m.to_location_id, m.to_vehicle_id, m.to_trailer_id, m.to_driver_id
      from public.asset_movements m
     where m.org_id = p_org
       and m.reason not in ('reported_missing', 'reported_damaged')
     order by m.asset_id, m.occurred_at desc, m.received_at desc, m.id desc
  )
  update public.inventory_assets a
     set location_id = l.to_location_id,
         vehicle_id  = l.to_vehicle_id,
         trailer_id  = l.to_trailer_id,
         driver_id   = l.to_driver_id,
         updated_at  = now()
    from last_move l
   where a.org_id = p_org
     and a.id = l.asset_id
     and (a.location_id is distinct from l.to_location_id
       or a.vehicle_id  is distinct from l.to_vehicle_id
       or a.trailer_id  is distinct from l.to_trailer_id
       or a.driver_id   is distinct from l.to_driver_id);
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

revoke all on function rebuild_asset_holders(uuid) from public, anon, authenticated;
grant execute on function rebuild_asset_holders(uuid) to service_role;

comment on table inventory_assets is
  'One thing with an identity (D-INV18). Holder is a bay, a truck, a trailer, or — for a type held by drivers, i.e. tablets — a driver (D-INV3 as amended by D-DE1); the holder columns are a projection of asset_movements, written only by move_asset.';
comment on column inventory_assets.driver_id is
  'The driver holding this asset (D-DE1), only for an asset type with held_by = ''driver''. "Not returned" is derived from the driver''s status at read time and stored nowhere (D-DE3).';
