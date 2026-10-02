-- 0404 — the idle engine's own storage: hour rows, stop rows, day totals, and the one writer that
-- replaces a window of them (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md IE2; D-IE1, D-IE2, D-IE3, D-IE8;
-- Q-IE8..Q-IE10 below).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
-- R3: we stop reading Samsara's idling numbers and build our own. The engine classifies every second
-- of every truck into five buckets (D-IE2) from the ECU's engine state and OUR motion decision (D-IE1),
-- and reads fuel from the engine's total-fuel counter (IE2a: `fuelConsumedMilliliters` on all 185
-- active trucks, equal to Samsara's per-event idle fuel to the millilitre). It runs IN PARALLEL with
-- today's idle numbers and switches nothing (D-IE9 is IE5). This file is storage only; the pure
-- classifier is `packages/shared` and the collector is the api's `idle` module, in later merges — new
-- tables are exempt from `lint:migration-ordering`, and nothing reads these until their writer exists.
--
-- ── THREE GRAINS, BECAUSE HOURS CANNOT SEE CONTINUITY (D-IE3) ──────────────────────────────────
--   idle_engine_hours  one row per truck per UTC hour: the five buckets in seconds (they sum to 3,600
--                      — a CHECK, so a classifier bug that loses or invents time fails the write, not
--                      the report), the fuel counter's and the ECU engine-hours counter's delta over
--                      the hour, engine starts, mean ambient. Every hour is written for every truck the
--                      collector asked about, even when it is all `no_data`: an absent row and a
--                      measured absence must not look alike, and `no_data` is never counted as off.
--                      KEPT 60 DAYS (D-IE8).
--   idle_engine_stops  one row per park, stop → move (D-IE3): running / off / no-data seconds, engine
--                      starts, the LONGEST continuous run, the fuel burned while stopped (= idle fuel:
--                      a stopped truck burns fuel only by idling, PTO excepted — D-IE4 rule 1 is IE3's),
--                      where, and the ambient. A six-hour idle spans six hour rows; only the stop knows
--                      it was one run. `ended_at` null = still parked when last computed. Only parks of
--                      at least `idle_settings.min_idle_minutes` get a row; a shorter one is a
--                      `brief_stop` and lives in the hour rows only. KEPT.
--   idle_engine_days   per truck per local day, DERIVED IN SQL from the hour rows by the writer below,
--                      so a day can never disagree with its hours. It carries what D-IE9's gate reads
--                      (running seconds against the ECU engine-seconds delta) and outlives the hours.
--                      KEPT.
--
-- ── Q-IE8 — PLAIN TABLES, NOT pg_partman (decided here; the handoff left it open) ──────────────
-- D-IE8 named pg_partman daily partitions for the hour rows. Measured 2026-10-02: 0360's maintenance
-- job is installed and healthy (`lifecycle_maintenance_health()` = ok, last run 13:07 UTC) but manages
-- ZERO tables (`partman.part_config` empty; `pg_inherits` holds only Supabase's own `realtime`
-- partitions). So this would be the FIRST partitioned table, and that step is not free here:
--   • DATA-LIFECYCLE-PLAN D-LIFE10 requires the premake-headroom alarm to ship WITH the first
--     partitioned table, and that alarm needs a platform alert channel that does not exist — Q9 of
--     that plan, open since 2026-09-22, is the stated blocker of L7 (`audit_logs`, the table the
--     mechanism was built for). Partitioning a 40 MB table first would jump that queue and inherit
--     the blocker.
--   • PGlite has no pg_partman (0360's guard), so every matrix would test a DIFFERENT table from the
--     one production runs — the matrices are the only place a migration executes before production.
--   • The case for partitioning is a bounded working set without DELETE churn (D-LIFE0, D-LIFE6). At
--     ~185 trucks × 24 = 4,440 rows/day, 60 days is ~270k rows: a daily retention delete removes one
--     day, well inside `dataRetention.ts`'s bounded slices, and the vacuum debt is trivial.
-- So: a plain table, a 60-day `timeSlice` rule in RETENTION_RULES, and the lifecycle block says so.
-- Converting it later is the D-LIFE3 two-merge dance on a small table, if L7 ever makes it worth it.
--
-- ── Q-IE9 — WHAT `brief_stop` MEANS (decided here) ──────────────────────────────────────────────
-- D-IE2: "stopped-running segments under `min_idle_minutes` — traffic, scales, fuel lanes". Read per
-- STOP, not per engine run: a park shorter than `min_idle_minutes` is brief, and all its running time
-- is `brief_stop`. Read per run instead, a battery-APU truck whose engine cycles on for three minutes
-- at a time through a ten-hour rest would book every cycle as traffic — the exact running time D-IE4
-- rule 3 exists to measure. The classifier owns the threshold (passed in from `idle_settings`).
--
-- ── Q-IE10 — A STOP THAT STARTED BEFORE ANY DATA WE HOLD (decided here) ───────────────────────
-- The hourly run reads a trailing window, and a park can be days long. A stop in progress at the
-- window's start is continued from its stored row (the collector reads it, and re-fetches the engine
-- and counter history from its `started_at` — both sparse while parked). When there is NO stored row
-- (the first run, or after an outage longer than the window) the classifier cannot know when the park
-- began; it starts the stop at the first instant it saw and says so: `start_observed = false`. A
-- duration that is a lower bound is then never read as a measurement.
--
-- ── THE WRITER: replace a window, set-based (lint:upserts; the 0174/0175 pattern) ─────────────
-- `idle_engine_write(org, vehicles, from, to, tz, hours, stops)` makes the stored rows for those
-- vehicles over [from, to) EQUAL the payload: hour rows in the window, and every stop OVERLAPPING it,
-- are deleted and re-inserted, then the touched local days are re-derived from the hour rows. That
-- makes the hourly run (trailing 3 h) and the nightly run (previous 2 days) the same operation, makes
-- a re-run idempotent, and lets a late-uploading gateway correct a stop's start without leaving the
-- old one behind. It REFUSES a payload row outside its window or its vehicle set — such a row would
-- survive the next replace of its own window as a duplicate — and a vehicle that is not the org's.
-- The day boundary is the org's zone, passed in (`organizationTimezone()` in TS is its one
-- definition). An hour is attributed to the local day its start falls in, which is exact for every
-- whole-hour zone (all of the US).
--
-- Rollback: drop the function and the three tables. No existing data is touched.

-- cross-module-waiver: none needed — the three tables are the idle module's; `vehicles` and
-- `organizations` are only referenced, and `idle_settings` is not read here (its threshold is passed
-- in by the collector).

create table public.idle_engine_hours (
  org_id               uuid not null references public.organizations(id) on delete cascade,
  vehicle_id           uuid not null references public.vehicles(id) on delete cascade,
  hour_start           timestamptz not null,
  driving_sec          int not null,
  stopped_running_sec  int not null,
  brief_stop_sec       int not null,
  engine_off_sec       int not null,
  no_data_sec          int not null,
  -- Counter deltas over the hour, interpolated at its edges. Null when a counter has no reading on
  -- one side of an edge — never 0, which would read as "burned nothing".
  fuel_ml              int,
  engine_sec           int,
  engine_starts        int not null,
  ambient_milli_c      int,
  classifier_version   text not null,
  computed_at          timestamptz not null default now(),
  primary key (org_id, vehicle_id, hour_start),
  constraint idle_engine_hours_aligned check (hour_start = date_trunc('hour', hour_start)),
  constraint idle_engine_hours_nonneg check (
    driving_sec >= 0 and stopped_running_sec >= 0 and brief_stop_sec >= 0
    and engine_off_sec >= 0 and no_data_sec >= 0 and engine_starts >= 0
    and (fuel_ml is null or fuel_ml >= 0) and (engine_sec is null or engine_sec >= 0)),
  constraint idle_engine_hours_whole_hour check (
    driving_sec + stopped_running_sec + brief_stop_sec + engine_off_sec + no_data_sec = 3600)
);
-- Retention's timeSlice delete and every fleet-wide read go by time first.
create index idx_idle_engine_hours_org_hour on public.idle_engine_hours (org_id, hour_start);
alter table public.idle_engine_hours enable row level security;
-- No client policies: the API reads with the service role and org-filters itself.

create table public.idle_engine_stops (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  vehicle_id          uuid not null references public.vehicles(id) on delete cascade,
  started_at          timestamptz not null,
  ended_at            timestamptz,
  start_observed      boolean not null,
  duration_sec        int not null,
  running_sec         int not null,
  off_sec             int not null,
  no_data_sec         int not null,
  engine_starts       int not null,
  longest_run_sec     int not null,
  fuel_ml             int,
  lat                 double precision,
  lng                 double precision,
  place               text,
  state               text,
  ambient_milli_c     int,
  classifier_version  text not null,
  computed_at         timestamptz not null default now(),
  constraint idle_engine_stops_key unique (org_id, vehicle_id, started_at),
  constraint idle_engine_stops_order check (ended_at is null or ended_at > started_at),
  constraint idle_engine_stops_nonneg check (
    running_sec >= 0 and off_sec >= 0 and no_data_sec >= 0 and engine_starts >= 0
    and longest_run_sec >= 0 and (fuel_ml is null or fuel_ml >= 0)),
  constraint idle_engine_stops_parts check (running_sec + off_sec + no_data_sec = duration_sec),
  constraint idle_engine_stops_longest check (longest_run_sec <= running_sec),
  constraint idle_engine_stops_state check (state is null or state ~ '^[A-Z]{2}$')
);
create index idx_idle_engine_stops_org_started on public.idle_engine_stops (org_id, started_at);
-- The collector reads each truck's stop in progress; at most one per truck.
create index idx_idle_engine_stops_open on public.idle_engine_stops (org_id, vehicle_id)
  where ended_at is null;
alter table public.idle_engine_stops enable row level security;

create table public.idle_engine_days (
  org_id               uuid not null references public.organizations(id) on delete cascade,
  vehicle_id           uuid not null references public.vehicles(id) on delete cascade,
  day                  date not null,
  tz                   text not null,
  hours                int not null,
  driving_sec          int not null,
  stopped_running_sec  int not null,
  brief_stop_sec       int not null,
  engine_off_sec       int not null,
  no_data_sec          int not null,
  -- A sum over the hours that HAD a delta, and how many did: whether the day is complete enough to
  -- judge is TypeScript's verdict (`sql-returns-measurement-ts-owns-verdict`), not a null here.
  fuel_ml              bigint not null,
  fuel_hours           int not null,
  engine_sec           bigint not null,
  engine_sec_hours     int not null,
  engine_starts        int not null,
  classifier_version   text not null,
  computed_at          timestamptz not null default now(),
  primary key (org_id, vehicle_id, day)
);
create index idx_idle_engine_days_org_day on public.idle_engine_days (org_id, day);
alter table public.idle_engine_days enable row level security;

create or replace function public.idle_engine_write(
  p_org uuid,
  p_vehicles uuid[],
  p_from timestamptz,
  p_to timestamptz,
  p_tz text,
  p_hours jsonb,
  p_stops jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_known int;
  v_bad int;
  v_hours int;
  v_stops int;
  v_days int;
  v_first date;
  v_last date;
begin
  if p_org is null or p_from is null or p_to is null or p_from >= p_to then
    raise exception 'idle_engine_write: a window needs an org and from < to';
  end if;
  if p_from <> date_trunc('hour', p_from) or p_to <> date_trunc('hour', p_to) then
    raise exception 'idle_engine_write: the window must start and end on the hour';
  end if;
  -- An unknown zone raises here, before anything is deleted.
  v_first := (p_from at time zone p_tz)::date;
  v_last := ((p_to - interval '1 microsecond') at time zone p_tz)::date;

  select count(*) into v_known
    from public.vehicles v
   where v.id = any(coalesce(p_vehicles, '{}')) and v.org_id = p_org;
  if v_known <> coalesce(cardinality(p_vehicles), 0) then
    raise exception 'idle_engine_write: % of % vehicles are not this org''s',
      coalesce(cardinality(p_vehicles), 0) - v_known, coalesce(cardinality(p_vehicles), 0);
  end if;

  select count(*) into v_bad from jsonb_to_recordset(coalesce(p_hours, '[]'::jsonb)) as h(
      vehicle_id uuid, hour_start timestamptz, driving_sec int, stopped_running_sec int,
      brief_stop_sec int, engine_off_sec int, no_data_sec int, fuel_ml int, engine_sec int,
      engine_starts int, ambient_milli_c int, classifier_version text)
   where h.vehicle_id is null or not coalesce(h.vehicle_id = any(p_vehicles), false)
      or h.hour_start is null or h.hour_start < p_from or h.hour_start >= p_to;
  if v_bad > 0 then
    raise exception 'idle_engine_write: % hour row(s) outside the window or its vehicles', v_bad;
  end if;
  select count(*) into v_bad from jsonb_to_recordset(coalesce(p_stops, '[]'::jsonb)) as s(
      vehicle_id uuid, started_at timestamptz, ended_at timestamptz, start_observed boolean,
      duration_sec int, running_sec int, off_sec int, no_data_sec int, engine_starts int,
      longest_run_sec int, fuel_ml int, lat double precision, lng double precision, place text,
      state text, ambient_milli_c int, classifier_version text)
   where s.vehicle_id is null or not coalesce(s.vehicle_id = any(p_vehicles), false)
      or s.started_at is null or s.started_at >= p_to
      or (s.ended_at is not null and s.ended_at <= p_from);
  if v_bad > 0 then
    raise exception 'idle_engine_write: % stop row(s) do not overlap the window or its vehicles', v_bad;
  end if;

  delete from public.idle_engine_hours e
   where e.org_id = p_org and e.vehicle_id = any(p_vehicles)
     and e.hour_start >= p_from and e.hour_start < p_to;
  insert into public.idle_engine_hours (org_id, vehicle_id, hour_start, driving_sec,
    stopped_running_sec, brief_stop_sec, engine_off_sec, no_data_sec, fuel_ml, engine_sec,
    engine_starts, ambient_milli_c, classifier_version)
  select p_org, h.vehicle_id, h.hour_start, h.driving_sec, h.stopped_running_sec, h.brief_stop_sec,
         h.engine_off_sec, h.no_data_sec, h.fuel_ml, h.engine_sec, h.engine_starts,
         h.ambient_milli_c, h.classifier_version
    from jsonb_to_recordset(coalesce(p_hours, '[]'::jsonb)) as h(
      vehicle_id uuid, hour_start timestamptz, driving_sec int, stopped_running_sec int,
      brief_stop_sec int, engine_off_sec int, no_data_sec int, fuel_ml int, engine_sec int,
      engine_starts int, ambient_milli_c int, classifier_version text);
  get diagnostics v_hours = row_count;

  delete from public.idle_engine_stops e
   where e.org_id = p_org and e.vehicle_id = any(p_vehicles)
     and e.started_at < p_to and (e.ended_at is null or e.ended_at > p_from);
  insert into public.idle_engine_stops (org_id, vehicle_id, started_at, ended_at, start_observed,
    duration_sec, running_sec, off_sec, no_data_sec, engine_starts, longest_run_sec, fuel_ml, lat,
    lng, place, state, ambient_milli_c, classifier_version)
  select p_org, s.vehicle_id, s.started_at, s.ended_at, s.start_observed, s.duration_sec,
         s.running_sec, s.off_sec, s.no_data_sec, s.engine_starts, s.longest_run_sec, s.fuel_ml,
         s.lat, s.lng, s.place, s.state, s.ambient_milli_c, s.classifier_version
    from jsonb_to_recordset(coalesce(p_stops, '[]'::jsonb)) as s(
      vehicle_id uuid, started_at timestamptz, ended_at timestamptz, start_observed boolean,
      duration_sec int, running_sec int, off_sec int, no_data_sec int, engine_starts int,
      longest_run_sec int, fuel_ml int, lat double precision, lng double precision, place text,
      state text, ambient_milli_c int, classifier_version text);
  get diagnostics v_stops = row_count;

  -- Re-derive every local day the window touched, from ALL its stored hours (the window may cover
  -- only part of a day; the rest of the day's hours are already stored).
  delete from public.idle_engine_days d
   where d.org_id = p_org and d.vehicle_id = any(p_vehicles) and d.day between v_first and v_last;
  insert into public.idle_engine_days (org_id, vehicle_id, day, tz, hours, driving_sec,
    stopped_running_sec, brief_stop_sec, engine_off_sec, no_data_sec, fuel_ml, fuel_hours,
    engine_sec, engine_sec_hours, engine_starts, classifier_version)
  select p_org, e.vehicle_id, (e.hour_start at time zone p_tz)::date, p_tz, count(*)::int,
         sum(e.driving_sec)::int, sum(e.stopped_running_sec)::int, sum(e.brief_stop_sec)::int,
         sum(e.engine_off_sec)::int, sum(e.no_data_sec)::int,
         coalesce(sum(e.fuel_ml), 0), count(e.fuel_ml)::int,
         coalesce(sum(e.engine_sec), 0), count(e.engine_sec)::int,
         sum(e.engine_starts)::int, max(e.classifier_version)
    from public.idle_engine_hours e
   where e.org_id = p_org and e.vehicle_id = any(p_vehicles)
     and e.hour_start >= (v_first::timestamp at time zone p_tz)
     and e.hour_start < ((v_last + 1)::timestamp at time zone p_tz)
   group by e.vehicle_id, (e.hour_start at time zone p_tz)::date;
  get diagnostics v_days = row_count;

  return jsonb_build_object('hours', v_hours, 'stops', v_stops, 'days', v_days);
end
$$;

comment on function public.idle_engine_write(uuid, uuid[], timestamptz, timestamptz, text, jsonb, jsonb) is
  'Replaces the idle engine''s hour rows and overlapping stop rows for a set of trucks over an hour-aligned window, then re-derives the touched local days (IE2, D-IE3, D-IE8). service_role only (0404).';

revoke all on function public.idle_engine_write(uuid, uuid[], timestamptz, timestamptz, text, jsonb, jsonb) from public;
revoke all on function public.idle_engine_write(uuid, uuid[], timestamptz, timestamptz, text, jsonb, jsonb) from anon;
revoke all on function public.idle_engine_write(uuid, uuid[], timestamptz, timestamptz, text, jsonb, jsonb) from authenticated;
grant execute on function public.idle_engine_write(uuid, uuid[], timestamptz, timestamptz, text, jsonb, jsonb) to service_role;
