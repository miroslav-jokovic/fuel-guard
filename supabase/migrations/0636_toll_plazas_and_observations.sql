-- 0636 — Where each toll plaza stands, and what Samsara saw there when each toll was printed
-- (TOLLS-PER-TRUCK-PLAN.md TL8a, D-TL14, D-TL21).
--
-- ── A PLAZA IS LEARNED, AND EVERY ATTEMPT IS KEPT ──────────────────────────────────────────────
-- `toll_plazas` holds one row per attempt to learn a plaza (provider + agency + plaza + location, and
-- entry or exit: `plaza_key`). A plaza is placed from tolls whose truck the tag history already names:
-- where those trucks met, under the one reading of the printed time that the zone at that place agrees
-- with (`@silvicom/shared` tollGps.learnPlaza). The row carries the samples it used and every reading of
-- the clock it tried, so a plaza that is NOT placed says why in a sentence and shows the evidence ("2
-- of 6 known tolls meet", "two readings both place it, each in a zone that agrees"). The current plaza
-- is the newest row for its key at the current engine version; an attempt is never changed, a new
-- attempt is a new row (the inspection attribution's versioned-row pattern, 0473).
--
-- ── AN OBSERVATION, NEVER A VERDICT ────────────────────────────────────────────────────────────
-- `toll_line_observations` holds, per toll line and checkpoint (exit, and entry where printed), what GPS
-- saw at the placed plaza in the plaza's own window: every Samsara vehicle (and, for a toll billed by
-- plate, trailer gateway) within 10 km with how close it came and when, and the ids of EVERY asset that
-- reported in the window. Which truck the toll belongs to is derived at read time (D-TL3) and so is
-- the verdict (TL8b): stored, it would freeze today's tag history onto last April's toll. The reporting
-- ids are what lets "absent" be proven later: the truck reported, and was not there. Samsara ids are
-- numeric (bigint, half the size of text; the worker refuses to write one that is not, rather than
-- drop it). Measured 2026-11-19: ~140 assets report in a window, ~1.1 KB a toll, ~35 MB for the
-- April–October statements.
--
-- A printed time in the autumn's repeated hour is two instants and one in the spring's skipped hour
-- is none: the checkpoint is recorded as such with no fetch, so it is decided as evidence, not
-- silently left out.
--
-- New tables only, so the column/first-reader rule (lint:migration-ordering) does not apply. RLS on,
-- no client policy: service-role only, like 0633.

create table if not exists public.toll_plazas (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  provider        text not null check (provider in ('ezpass', 'ktag', 'expresstoll')),
  role            text not null check (role in ('exit', 'entry')),
  plaza_key       text not null check (length(plaza_key) between 5 and 300),
  engine_version  integer not null check (engine_version >= 1),
  outcome         text not null check (outcome in ('placed', 'not_placed')),
  reason          text,
  lat             double precision,
  lon             double precision,
  spread_m        integer,
  -- The tz dataset's zone at the place, never the agency's (D-TL14).
  time_zone       text,
  -- Seconds from the printed instant to the moment the known trucks passed, and how far they strayed.
  offset_s        integer,
  offset_spread_s integer,
  sample_count    integer,
  day_count       integer,
  -- How many known tolls the plaza had when tried: a plaza not placed is tried again only with more.
  known_count     integer not null check (known_count >= 0),
  samples         jsonb not null check (jsonb_typeof(samples) = 'array'),
  readings        jsonb not null check (jsonb_typeof(readings) = 'array'),
  created_at      timestamptz not null default now(),
  constraint toll_plazas_shape check (
    (outcome = 'placed' and reason is null and lat between -90 and 90 and lon between -180 and 180
      and spread_m >= 0 and time_zone is not null and length(time_zone) between 3 and 64
      and offset_s is not null and offset_spread_s >= 0 and sample_count >= 1 and day_count >= 1)
    or (outcome = 'not_placed' and reason is not null and length(btrim(reason)) between 1 and 500
      and lat is null and lon is null and spread_m is null and time_zone is null and offset_s is null
      and offset_spread_s is null)
  )
);
create index if not exists ix_toll_plazas_current on public.toll_plazas (org_id, engine_version, plaza_key, created_at desc);
alter table public.toll_plazas enable row level security;

create table if not exists public.toll_line_observations (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  line_id        uuid not null references public.toll_statement_lines(id) on delete cascade,
  role           text not null check (role in ('exit', 'entry')),
  plaza_id       uuid not null references public.toll_plazas(id) on delete cascade,
  outcome        text not null check (outcome in ('observed', 'clock_ambiguous', 'clock_skipped')),
  -- The middle of the window (printed instant in the plaza's zone + its offset) and its half-width.
  at             timestamptz,
  half_window_s  integer,
  -- [{samsaraId, kind: vehicle|trailer, distanceM, offsetS}] within 10 km, nearest first.
  nearby         jsonb not null default '[]'::jsonb check (jsonb_typeof(nearby) = 'array'),
  -- Every Samsara asset with a fix inside the window.
  reporting      bigint[] not null default '{}',
  created_at     timestamptz not null default now(),
  constraint toll_line_observations_shape check (
    (outcome = 'observed' and at is not null and half_window_s between 60 and 600)
    or (outcome <> 'observed' and at is null and half_window_s is null and nearby = '[]'::jsonb
      and cardinality(reporting) = 0)
  ),
  unique (line_id, role, plaza_id)
);
create index if not exists ix_toll_line_observations_line on public.toll_line_observations (org_id, line_id);
create index if not exists ix_toll_line_observations_plaza on public.toll_line_observations (org_id, plaza_id);
alter table public.toll_line_observations enable row level security;

-- An observation belongs to its line's org and to a PLACED plaza of the same org and provider: a
-- foreign key checks neither, and an observation filed under another carrier's line, or measured
-- against a plaza that was never placed, is evidence of nothing.
create or replace function public.toll_line_observation_belongs() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_line record;
  v_plaza record;
begin
  select l.org_id, s.provider into v_line
    from public.toll_statement_lines l join public.toll_statements s on s.id = l.statement_id
   where l.id = new.line_id;
  select p.org_id, p.provider, p.role, p.outcome into v_plaza from public.toll_plazas p where p.id = new.plaza_id;
  if v_line.org_id is distinct from new.org_id or v_plaza.org_id is distinct from new.org_id then
    raise exception 'an observation, its line and its plaza belong to one organisation' using errcode = 'TG103';
  end if;
  if v_plaza.outcome <> 'placed' or v_plaza.provider <> v_line.provider or v_plaza.role <> new.role then
    raise exception 'an observation is made at a placed plaza of the line''s provider and role' using errcode = 'TG104';
  end if;
  return new;
end;
$$;
revoke all on function public.toll_line_observation_belongs() from public, anon, authenticated;
drop trigger if exists trg_toll_line_observations_belongs on public.toll_line_observations;
create trigger trg_toll_line_observations_belongs before insert on public.toll_line_observations
  for each row execute function public.toll_line_observation_belongs();

-- Plaza attempts and observations are evidence: written once, never changed, never deleted except with
-- their organisation (or, for an observation, with the statement line it observed, which 0633 never
-- deletes either).
create or replace function public.toll_gps_evidence_guard() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from organizations o where o.id = old.org_id) then
      raise exception 'a toll plaza attempt or observation is never deleted' using errcode = 'TG101';
    end if;
    return old;
  end if;
  raise exception 'a toll plaza attempt or observation is never changed' using errcode = 'TG102';
end;
$$;
revoke all on function public.toll_gps_evidence_guard() from public, anon, authenticated;

drop trigger if exists trg_toll_plazas_guard on public.toll_plazas;
create trigger trg_toll_plazas_guard before update or delete on public.toll_plazas
  for each row execute function public.toll_gps_evidence_guard();
drop trigger if exists trg_toll_line_observations_guard on public.toll_line_observations;
create trigger trg_toll_line_observations_guard before update or delete on public.toll_line_observations
  for each row execute function public.toll_gps_evidence_guard();
