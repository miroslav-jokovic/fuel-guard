-- 0403 — a truck's idle equipment is DECLARED with its source, and behaviour is measured beside it
-- (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md IE1, D-IE7, R7, Q-IE1, Q-IE4; Q-IE5 and Q-IE6 below).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
-- The idle engine's avoidable rules (D-IE4) turn on one fact per truck: battery APU, or no APU and no
-- Optimized Idle. McLeod records neither (§1.6), so the fact lives only in `has_apu` / `apu_type` /
-- `has_optimized_idle` (0046, 0048) — and on 2026-10-01 those said nothing for 128 of 205 in-service
-- trucks and contradicted the owner's ruling on others (769–783: ruled no APU, several entered battery
-- and most entered Optimized Idle). The owner has now ruled the whole fleet (R7, Q-IE1). This file
-- writes that ruling, and records WHERE each truck's equipment came from, so an office correction is
-- never mistaken for the ruling and the ruling is never mistaken for a guess.
--
-- ── 1. `vehicles.equipment_source` ──────────────────────────────────────────────────────────────
--   'owner_ruling_2026-10-01'  written below from R7 + Q-IE1
--   'manual'                   an office edit (Vehicles form, setup import), or a value entered before
--                              this file that the ruling does not cover (712–717, 754, 762–763 — §1.6
--                              "entered → keep")
--   null                       nothing declared
-- The stamp is a trigger, not a convention callers must remember: any write that changes one of the
-- three equipment columns WITHOUT also setting the source is a manual edit, so the two browser
-- writers need no change and a later writer cannot forget. A per-unit override of the ruling is
-- therefore just an edit: it flips the source to 'manual', and `audit_vehicles` (0352 keeps all four
-- columns audited) records who did it and what it replaced.
--
-- ── 2. The ruling, written once ────────────────────────────────────────────────────────────────
--   Battery APU (`battery_hvac`): 723–726, 728–753, and every MY 2027 truck (R7 — read from `year`,
--     which McLeod owns, so the rule is the ruling and not a copy of today's unit list: 764–768,
--     784–813 today). Optimized Idle stays only where it was already entered true (Q-IE1).
--   No APU, no Optimized Idle (`none`, false, false): 500–635, 637–711, 718, 727 (Q-IE4), 769–783.
--   Not touched:
--   - 719–722, ruled "per unit from behaviour, flagged for review" (Q-IE1). **Q-IE5**, decided here:
--     behaviour does not WRITE a declaration (D-IE7: it never sets `has_apu`), and two of the four
--     cannot be judged at all — measured 2026-10-02, long parks since 08/15: 719 84 parks, 7% idling /
--     69% off (behaves like battery APU); 722 53 parks, 55% / 40% (behaves like no APU); 720 and 721
--     ONE park each. So they keep what is entered, and the "behaves like…" check (function below, its
--     reader in the next merge) raises the review the ruling asked for, and keeps raising it while
--     declaration and behaviour disagree.
--   - 814–864, on order with no model year in McLeod (54 reserved rows, D-FC10). **Q-IE6**, decided
--     here: R7 says "MY 2027", and a unit number on a reservation is not a model year, so nothing is
--     declared for them. This file runs once and will not see the year arrive; the next merge's
--     reader shows them as "not entered", FL2's parity check reports the year when McLeod records it,
--     and the office declares them then (one batch edit, D-IE7's batch entry).
--   - `- OLD` / `- SOLD` record rows: their unit_number is not a bare number, and they are the same
--     trucks' retired records (Q-FL2), never the truck itself.
-- Statuses are not filtered: a retired or in-shop truck's equipment is still a fact about it, and
-- its idle history is still read.
--
-- ── 3. `vehicle_long_park_behaviour` — a measurement, the verdict is TypeScript's ─────────────────
-- Per truck, over a window: how many parks of at least `p_min_park_sec`, how many spent more than
-- `p_idling_share` of the park running, how many less than `p_off_share`. These are the §1.6 columns
-- (parks ≥ 4 h; > 80% / < 20%), which the 2026-10-01 rulings were read against. The shares are
-- parameters with no default so the ONE constant in `packages/shared` owns them; what counts as
-- "behaves like a battery APU" is decided there (`sql-returns-measurement-ts-owns-verdict`).
-- Aggregated here because PostgREST caps a response at 1,000 rows and a 45-day window is ~8,000 parks.
-- Service role only, org-filtered by its own parameter (the API bypasses RLS).
--
-- ── WHAT IS NOT HERE ────────────────────────────────────────────────────────────────────────────
-- No batch column. A purchase batch is make + model + model year + purchase MONTH (**Q-IE7**,
-- decided here: our rows carry McLeod's purchase DAY, 39 distinct groups in service, while trucks
-- bought as one order arrive over days — 2020-12-10 → 12-24 is one run of 27 Cascadias, and no ruling
-- splits a month). Every input is already on the row, so the key is derived in `packages/shared`,
-- never stored: a stored key would go stale the next time McLeod corrects a date.
--
-- Ships ALONE (lint:migration-ordering): the batch key, the "behaves like…" verdict and their screen
-- arrive in the next merge. Until then nothing reads `equipment_source` or the function.
--
-- cross-module-waiver: the only org-module table touched is `audit_logs`, for the ruling's one summary
-- row — the record of a one-off owner act, which every module writes the same way (0359, 0400).
--
-- Rollback: drop the trigger, its function, the measurement function and the column. To undo the
-- ruling itself, the summary row (`roster.vehicle_equipment_declared`) carries every value it
-- REPLACED, per unit. That has to be written here: `audit_vehicles` records which columns changed
-- (`meta.changed`), never their old values — this file's matrix found it while asserting the opposite.

alter table public.vehicles add column if not exists equipment_source text;

comment on column public.vehicles.equipment_source is
  'Where has_apu / apu_type / has_optimized_idle came from (IE1, D-IE7): owner_ruling_2026-10-01 |
   manual (office edit; set by trigger on any equipment change that does not name a source) |
   null (nothing declared). Behaviour never writes it.';

-- ── the stamp ──────────────────────────────────────────────────────────────────────────────────
create function public.stamp_vehicle_equipment_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.equipment_source is null
       and (new.has_apu is not null or new.apu_type is not null or new.has_optimized_idle is not null) then
      new.equipment_source := 'manual';
    end if;
  elsif (new.has_apu, new.apu_type, new.has_optimized_idle)
          is distinct from (old.has_apu, old.apu_type, old.has_optimized_idle)
        and new.equipment_source is not distinct from old.equipment_source then
    new.equipment_source := 'manual';
  end if;
  return new;
end
$$;

comment on function public.stamp_vehicle_equipment_source() is
  'IE1: an equipment change that does not name its source is a manual edit.';

create trigger trg_stamp_vehicle_equipment_source
  before insert or update on public.vehicles
  for each row execute function public.stamp_vehicle_equipment_source();

-- ── the ruling ─────────────────────────────────────────────────────────────────────────────────
do $ruling$
declare
  org constant uuid := '86d6b3ea-4361-4f71-877f-e8373615769b';
  src constant text := 'owner_ruling_2026-10-01';
  battery integer;
  no_apu integer;
  kept integer;
  prior jsonb;
  replaced jsonb;
begin
  if not exists (select 1 from public.organizations where id = org) then
    raise notice '0403: organisation not present — no ruling to write';
    return;
  end if;

  select coalesce(jsonb_object_agg(v.id, jsonb_build_object(
           'unit', v.unit_number, 'has_apu', v.has_apu, 'apu_type', v.apu_type,
           'has_optimized_idle', v.has_optimized_idle)), '{}'::jsonb)
    into prior
    from public.vehicles v
   where v.org_id = org;

  with u as (
    select v.id from public.vehicles v
     where v.org_id = org
       and v.unit_number ~ '^[0-9]+$'
       and (v.unit_number::int between 723 and 726
            or v.unit_number::int between 728 and 753
            or v.year = 2027)
  )
  update public.vehicles v
     set has_apu = true,
         apu_type = 'battery_hvac',
         has_optimized_idle = (v.has_optimized_idle is true),
         equipment_source = src
    from u
   where v.id = u.id;
  get diagnostics battery = row_count;

  with u as (
    select v.id from public.vehicles v
     where v.org_id = org
       and v.unit_number ~ '^[0-9]+$'
       and v.year is distinct from 2027
       and (v.unit_number::int between 500 and 635
            or v.unit_number::int between 637 and 711
            or v.unit_number::int in (718, 727)
            or v.unit_number::int between 769 and 783)
  )
  update public.vehicles v
     set has_apu = false,
         apu_type = 'none',
         has_optimized_idle = false,
         equipment_source = src
    from u
   where v.id = u.id;
  get diagnostics no_apu = row_count;

  -- Values entered before this file that the ruling does not cover keep their value and are named
  -- for what they are.
  update public.vehicles v
     set equipment_source = 'manual'
   where v.org_id = org
     and v.equipment_source is null
     and (v.has_apu is not null or v.apu_type is not null or v.has_optimized_idle is not null);
  get diagnostics kept = row_count;

  select coalesce(jsonb_object_agg(p.value ->> 'unit', p.value - 'unit'), '{}'::jsonb)
    into replaced
    from jsonb_each(prior) p
    join public.vehicles v on v.id = p.key::uuid
   where (v.has_apu, v.apu_type, v.has_optimized_idle)
         is distinct from ((p.value ->> 'has_apu')::boolean, p.value ->> 'apu_type',
                           (p.value ->> 'has_optimized_idle')::boolean);

  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, meta)
  values (org, null, 'roster.vehicle_equipment_declared', 'vehicle', null,
          jsonb_build_object(
            'source', src,
            'battery_apu', battery,
            'no_apu_no_oi', no_apu,
            'entered_kept_as_manual', kept,
            'replaced', replaced,
            'migration', '0403',
            'plan', 'FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md IE1'));

  raise notice '0403: battery APU %, no APU %, entered values kept as manual %', battery, no_apu, kept;
end
$ruling$;

-- ── the measurement ────────────────────────────────────────────────────────────────────────────
create function public.vehicle_long_park_behaviour(
  p_org uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_min_park_sec integer,
  p_idling_share numeric,
  p_off_share numeric
)
returns table (vehicle_id uuid, parks integer, idling_parks integer, off_parks integer)
language sql
stable
set search_path = ''
as $$
  select s.vehicle_id,
         count(*)::int,
         (count(*) filter (where s.idle_sec > p_idling_share * s.duration_sec))::int,
         (count(*) filter (where s.idle_sec < p_off_share * s.duration_sec))::int
    from public.idle_park_sessions s
   where s.org_id = p_org
     and s.started_at >= p_from
     and s.started_at < p_to
     and s.duration_sec >= p_min_park_sec
   group by s.vehicle_id
$$;

comment on function public.vehicle_long_park_behaviour(uuid, timestamptz, timestamptz, integer, numeric, numeric) is
  'IE1, D-IE7: per truck, long parks and how many were mostly running / mostly off. A measurement — the
   "behaves like…" verdict and its thresholds live in packages/shared.';

revoke all on function public.vehicle_long_park_behaviour(uuid, timestamptz, timestamptz, integer, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.vehicle_long_park_behaviour(uuid, timestamptz, timestamptz, integer, numeric, numeric)
  to service_role;
