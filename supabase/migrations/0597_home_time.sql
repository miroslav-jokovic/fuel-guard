-- 0597 — home time: a period the office marks on a driver, with the time he is due back
-- (docs/plans/dispatch-loads/HOME-TIME-PLAN.md §3.1, step HT1).
--
-- ── WHAT GAP ─────────────────────────────────────────────────────────────────────────────────────
-- Measured on production 2026-11-13: `driver_time_off` (0068) has 0 rows and no writer but the McLeod
-- ingest, which nothing feeds — McLeod's home-date columns are refused to the connector login. So a truck
-- parked at its driver's house reads "Empty · Available Now" on the dispatch board, and nothing can say a
-- driver is due back, late, or has had the truck at home past the carrier's limit.
--
-- ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────
-- The period lives where time off already lives (D-HT1): the table is roster's, a driver merge already
-- carries it, and the fuel rule already reads it. Rows the office marks are `provider = 'silvicom'`,
-- `kind = 'home_time'`.
--
--   · **`end_at` keeps its meaning (D-HT2).** The fuel rule (`tmsGates.ts`) reads a null `end_at` as
--     "still off", so the promise is its own column, `expected_return_at`, and `end_at` stays "when it
--     actually ended". State is derived from the times and never stored: scheduled, active, overdue,
--     ended, canceled.
--   · **Where the truck is** (`truck_disposition`, `vehicle_id`): with the driver, at the yard, or the
--     driver has none. It is what the dispatcher said, not a GPS reading; the "truck at home too long"
--     alert reads it.
--   · **Canceled is not ended.** A period marked by mistake keeps its row with `canceled_at`, and its
--     `end_at` stays null (a canceled scheduled period has no honest end time). Every reader must
--     therefore skip canceled rows; the fuel rule learns to in HT2, one merge after this column, and no
--     canceled row can exist before then because nothing but HT2's API can make one.
--   · **One live period per driver, in the function, not an index (D-HT3).** `home_time_mark` and
--     `home_time_reopen` take a per-driver advisory lock and refuse a second live period (HT010, the
--     existing id in DETAIL). A unique index would make `merge_driver` fail when both drivers are home.
--   · **Only the two moves that need the lock are functions.** Change, end and cancel are single
--     conditional UPDATEs from the roster service; the `silvicom_shape` CHECK below holds them to a
--     consistent row whoever writes.
--   · **No note column.** The plan's form had one. The existing policies let any member of the carrier,
--     and the driver himself, read these rows (the policies of 0068 and 0136), and a dispatcher's
--     remark about a driver is not the driver's to read. The office already has notes on a driver
--     (`unit_notes`, 0592), office-only and shown on the board, so the form links there (plan D-HT20).
--   · **`home_time_settings`**: the carrier's three thresholds (D-HT12), one row per org, no column
--     defaults — the defaults are `HOME_TIME_DEFAULTS` in `@silvicom/shared`, read when the row is absent,
--     so the numbers are written once. RLS on, no client policies.
--
-- ── WHAT WAS REJECTED ────────────────────────────────────────────────────────────────────────────
-- A new `home_time` table: a second home for the fact the fuel rule and the merge already find here.
-- `drivers.status = 'on_leave'`: status is McLeod's for linked drivers, and a week at home would drop
-- the driver from lists that have nothing to do with it (D-HT4). A CHECK on `kind` for every provider:
-- what McLeod would send is not known (Q-HT1), so only our own rows are constrained.
--
-- ⚠ DEPLOY WINDOW: nullable columns and two timestamps with defaults on a table of 0 rows, one new
-- table, two functions nothing calls yet. No reader ships in this merge (`lint:migration-ordering`).
-- The McLeod ingest's upsert names its own columns and is untouched by the new ones.
--
-- Rollback: drop the two functions, `home_time_settings`, the three constraints, the two indexes and
-- the added columns.

-- ── 1. the period's new columns ──────────────────────────────────────────────────────────────────

alter table public.driver_time_off
  add column if not exists expected_return_at timestamptz,
  add column if not exists truck_disposition  text,
  add column if not exists vehicle_id         uuid references public.vehicles(id) on delete set null,
  add column if not exists end_reason         text,
  add column if not exists canceled_at        timestamptz,
  add column if not exists created_by         uuid references auth.users(id) on delete set null,
  add column if not exists updated_by         uuid references auth.users(id) on delete set null,
  add column if not exists ended_by           uuid references auth.users(id) on delete set null,
  add column if not exists canceled_by        uuid references auth.users(id) on delete set null,
  add column if not exists created_at         timestamptz not null default now(),
  add column if not exists updated_at         timestamptz not null default now();

alter table public.driver_time_off drop constraint if exists driver_time_off_truck_disposition_check;
alter table public.driver_time_off add constraint driver_time_off_truck_disposition_check
  check (truck_disposition is null or truck_disposition in ('with_driver', 'at_yard', 'no_truck'));

alter table public.driver_time_off drop constraint if exists driver_time_off_end_reason_check;
alter table public.driver_time_off add constraint driver_time_off_end_reason_check
  check (end_reason is null or end_reason in ('returned', 'load_evidence', 'driver_left'));

-- What a row the office marked must always be, whoever writes it. `vehicle_id` may be null beside
-- 'with_driver' or 'at_yard' only because its foreign key sets it null; the mark function requires it.
alter table public.driver_time_off drop constraint if exists driver_time_off_silvicom_shape;
alter table public.driver_time_off add constraint driver_time_off_silvicom_shape
  check (provider <> 'silvicom' or (
    kind = 'home_time'
    and expected_return_at is not null and expected_return_at > start_at
    and truck_disposition is not null
    and (truck_disposition <> 'no_truck' or vehicle_id is null)
    and (end_at is null or end_at >= start_at)
    and ((end_at is null) = (end_reason is null))
    and (canceled_at is null or end_at is null)
  ));

-- The live period of a driver: the board's read, the lock's check and the alert job's scan.
create index if not exists ix_driver_time_off_live
  on public.driver_time_off (org_id, driver_id)
  where provider = 'silvicom' and end_at is null and canceled_at is null;
-- The Home time tab's history, newest first.
create index if not exists ix_driver_time_off_office_recent
  on public.driver_time_off (org_id, start_at desc)
  where provider = 'silvicom';

comment on column public.driver_time_off.expected_return_at is
  'HOME-TIME-PLAN D-HT2 (0597): when the driver is due back. end_at stays "when it actually ended"; null end_at = still off.';
comment on column public.driver_time_off.truck_disposition is
  'HOME-TIME-PLAN D-HT2 (0597): with_driver | at_yard | no_truck, as the dispatcher said. The truck-at-home alert reads it.';
comment on column public.driver_time_off.canceled_at is
  'HOME-TIME-PLAN D-HT2 (0597): marked by mistake. The row stays and end_at stays null, so every reader skips canceled rows.';

-- ── 2. mark and reopen: the two moves that need the one-live-period lock ─────────────────────────

create or replace function public.home_time_mark(
  p_org uuid,
  p_driver uuid,
  p_actor uuid,
  p_start timestamptz,
  p_expected_return timestamptz,
  p_disposition text,
  p_vehicle uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_existing uuid;
  v_id uuid;
begin
  if not exists (select 1 from public.drivers d where d.id = p_driver and d.org_id = p_org) then
    raise exception 'home_time_driver_not_in_org' using errcode = 'HT001';
  end if;
  if p_vehicle is not null
     and not exists (select 1 from public.vehicles v where v.id = p_vehicle and v.org_id = p_org) then
    raise exception 'home_time_vehicle_not_in_org' using errcode = 'HT002';
  end if;
  if p_disposition is null or (p_disposition = 'no_truck') <> (p_vehicle is null) then
    raise exception 'home_time_truck_mismatch: a truck is named exactly when the driver has one'
      using errcode = 'HT003';
  end if;
  -- One marker per driver at a time: two dispatchers marking the same driver queue, and the second is
  -- told about the first one's period instead of making a second.
  perform pg_advisory_xact_lock(hashtextextended('home_time:' || p_org || ':' || p_driver, 0));
  select t.id into v_existing
    from public.driver_time_off t
   where t.org_id = p_org and t.driver_id = p_driver and t.provider = 'silvicom'
     and t.end_at is null and t.canceled_at is null
   order by t.start_at desc
   limit 1;
  if v_existing is not null then
    raise exception 'home_time_already_live' using errcode = 'HT010', detail = v_existing::text;
  end if;
  insert into public.driver_time_off
    (org_id, provider, driver_id, start_at, kind, expected_return_at, truck_disposition, vehicle_id,
     created_by, updated_by)
  values
    (p_org, 'silvicom', p_driver, p_start, 'home_time', p_expected_return, p_disposition, p_vehicle,
     p_actor, p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.home_time_mark(uuid, uuid, uuid, timestamptz, timestamptz, text, uuid) is
  'HOME-TIME-PLAN D-HT3 (0597): mark a driver''s home time. HT001 driver / HT002 vehicle not this carrier''s, HT003 truck and disposition disagree, HT010 a live period exists (its id in DETAIL). Service role only.';

create or replace function public.home_time_reopen(p_org uuid, p_id uuid, p_actor uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_driver uuid;
  v_ended timestamptz;
  v_canceled timestamptz;
  v_existing uuid;
begin
  select t.driver_id, t.end_at, t.canceled_at into v_driver, v_ended, v_canceled
    from public.driver_time_off t
   where t.id = p_id and t.org_id = p_org and t.provider = 'silvicom';
  if not found then
    raise exception 'home_time_not_found' using errcode = 'HT020';
  end if;
  if v_ended is null or v_canceled is not null then
    raise exception 'home_time_not_ended: only an ended period is reopened' using errcode = 'HT011';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('home_time:' || p_org || ':' || v_driver, 0));
  select t.id into v_existing
    from public.driver_time_off t
   where t.org_id = p_org and t.driver_id = v_driver and t.provider = 'silvicom'
     and t.end_at is null and t.canceled_at is null and t.id <> p_id
   order by t.start_at desc
   limit 1;
  if v_existing is not null then
    raise exception 'home_time_already_live' using errcode = 'HT010', detail = v_existing::text;
  end if;
  -- Checked again under the lock: two people reopening at once must not both pass the read above.
  update public.driver_time_off
     set end_at = null, end_reason = null, ended_by = null, updated_by = p_actor, updated_at = now()
   where id = p_id and org_id = p_org and end_at is not null and canceled_at is null;
  if not found then
    raise exception 'home_time_not_ended: only an ended period is reopened' using errcode = 'HT011';
  end if;
  return p_id;
end;
$$;

comment on function public.home_time_reopen(uuid, uuid, uuid) is
  'HOME-TIME-PLAN D-HT6 (0597): undo an end (a person''s, or the system''s on load evidence). HT020 not this carrier''s period, HT011 not ended, HT010 the driver has a newer live period. Service role only.';

revoke all on function public.home_time_mark(uuid, uuid, uuid, timestamptz, timestamptz, text, uuid) from public, anon, authenticated;
revoke all on function public.home_time_reopen(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.home_time_mark(uuid, uuid, uuid, timestamptz, timestamptz, text, uuid) to service_role;
grant execute on function public.home_time_reopen(uuid, uuid, uuid) to service_role;

-- ── 3. the carrier's thresholds (D-HT12) ─────────────────────────────────────────────────────────

create table if not exists public.home_time_settings (
  org_id              uuid primary key references public.organizations(id) on delete cascade,
  return_due_hours    smallint not null check (return_due_hours between 1 and 168),
  overdue_after_hours smallint not null check (overdue_after_hours between 0 and 72),
  truck_limit_days    smallint not null check (truck_limit_days between 1 and 60),
  updated_by          uuid references auth.users(id) on delete set null,
  updated_at          timestamptz not null default now()
);

alter table public.home_time_settings enable row level security;

comment on table public.home_time_settings is
  'HOME-TIME-PLAN D-HT12 (0597): when the three home-time alerts fire — hours before the return, hours after it, days a truck may stay with its driver. No row = HOME_TIME_DEFAULTS in @silvicom/shared. Service-role only (RLS, no policies).';
