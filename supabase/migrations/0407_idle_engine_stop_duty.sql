-- 0407: a park's running time, split by the driver's duty status (IE3, D-IE4)
--
-- D-IE4's avoidable rules are decided per park by WHAT THE DRIVER WAS DOING while the engine ran:
-- running on duty past the first hour is avoidable on any truck (R10); running through a rest is
-- allowed up to half the park on a battery-APU truck (Q-IE3) and is an equipment opportunity on a
-- truck with no APU (R7). `idle_engine_stops` (0404) holds a park's running seconds as one total, and
-- a total cannot be split afterwards: a ten-hour park with three hours on duty and seven asleep needs
-- the engine's on/off timeline laid over the duty timeline, which only the collector holds, in memory,
-- for the length of one run. So the collector measures the split and this migration gives it a home.
--
-- ── FOUR MEASUREMENTS, NO VERDICT ───────────────────────────────────────────────────────────────
-- Running seconds while the duty log said rest (off duty, sleeper), on duty (on duty not driving, and
-- "driving" logged while the truck stood — the driver is working either way), excluded (yard move,
-- personal conveyance), or nothing usable (no segment, or two drivers' logs disagreeing on the truck).
-- They add up to `running_sec`, which a CHECK holds. The verdict — avoidable, equipment opportunity,
-- allowed — is TypeScript's, evaluated on read against the truck's declared equipment and the org's
-- `idle_settings` (`sql-returns-measurement-ts-owns-verdict`). Stored verdicts would freeze the 50%
-- allowance the owner said he will revisit once the battery-APU distribution is measured (Q-IE3).
--
-- ── NULL IS "NOT MEASURED", NEVER ZERO ──────────────────────────────────────────────────────────
-- Every park written by ie2-v1 (from 2026-10-02 15:07Z) has no split. All four are null together or
-- present together (CHECK). The nightly run re-writes the trailing two days, so parks inside that
-- reach are re-measured on the first nightly after the collector ships; older ones stay null and
-- read as "not measured", which the reader reports rather than counting as no running.
--
-- ── MEASURED BEFORE BUILDING (production, read-only, 2026-10-02) ────────────────────────────────
-- 348 parks with the engine running in the last 30 hours, 747,917 running seconds. Duty segments
-- that name the truck themselves cover ~37% of that; through the driver↔vehicle assignment timeline
-- (the `idleDutyEvidenceSync` path, incident 2026-08-11) every one of the 348 has duty coverage
-- (running-weighted estimate 99.96%). The collector reuses that attribution, not a second one.
--
-- ── DEPLOY WINDOW ───────────────────────────────────────────────────────────────────────────────
-- Additive: four nullable columns, and the writer re-created with the same signature reading four
-- more optional keys. Old code against this schema sends no such keys → null. New code against the
-- old writer has its keys ignored. The first reader ships in the next merge (lint:migration-ordering).

alter table public.idle_engine_stops
  add column running_rest_sec int,
  add column running_on_duty_sec int,
  add column running_excluded_sec int,
  add column running_unknown_sec int;

alter table public.idle_engine_stops
  add constraint idle_engine_stops_duty_all_or_none check (
    (running_rest_sec is null and running_on_duty_sec is null and running_excluded_sec is null and running_unknown_sec is null)
    or (running_rest_sec is not null and running_on_duty_sec is not null and running_excluded_sec is not null and running_unknown_sec is not null)
  ),
  add constraint idle_engine_stops_duty_nonneg check (
    coalesce(running_rest_sec, 0) >= 0 and coalesce(running_on_duty_sec, 0) >= 0
    and coalesce(running_excluded_sec, 0) >= 0 and coalesce(running_unknown_sec, 0) >= 0
  ),
  add constraint idle_engine_stops_duty_parts check (
    running_rest_sec is null
    or running_rest_sec + running_on_duty_sec + running_excluded_sec + running_unknown_sec = running_sec
  );

comment on column public.idle_engine_stops.running_rest_sec is 'Running seconds while the duty log said off duty or sleeper. Null = not measured (ie2-v1). 0407.';
comment on column public.idle_engine_stops.running_on_duty_sec is 'Running seconds while the duty log said on duty, or driving while the truck stood. 0407.';
comment on column public.idle_engine_stops.running_excluded_sec is 'Running seconds during yard move or personal conveyance. 0407.';
comment on column public.idle_engine_stops.running_unknown_sec is 'Running seconds with no usable duty status: no segment, or conflicting logs on the truck. 0407.';

-- The writer, as 0404 wrote it, reading the four keys too. Same signature, so every grant stands.

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
      state text, ambient_milli_c int, classifier_version text, running_rest_sec int,
      running_on_duty_sec int, running_excluded_sec int, running_unknown_sec int)
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
    lng, place, state, ambient_milli_c, classifier_version, running_rest_sec, running_on_duty_sec,
    running_excluded_sec, running_unknown_sec)
  select p_org, s.vehicle_id, s.started_at, s.ended_at, s.start_observed, s.duration_sec,
         s.running_sec, s.off_sec, s.no_data_sec, s.engine_starts, s.longest_run_sec, s.fuel_ml,
         s.lat, s.lng, s.place, s.state, s.ambient_milli_c, s.classifier_version,
         s.running_rest_sec, s.running_on_duty_sec, s.running_excluded_sec, s.running_unknown_sec
    from jsonb_to_recordset(coalesce(p_stops, '[]'::jsonb)) as s(
      vehicle_id uuid, started_at timestamptz, ended_at timestamptz, start_observed boolean,
      duration_sec int, running_sec int, off_sec int, no_data_sec int, engine_starts int,
      longest_run_sec int, fuel_ml int, lat double precision, lng double precision, place text,
      state text, ambient_milli_c int, classifier_version text, running_rest_sec int,
      running_on_duty_sec int, running_excluded_sec int, running_unknown_sec int);
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
  'Replaces the idle engine''s hour rows and overlapping stop rows for a set of trucks over an hour-aligned window, then re-derives the touched local days (IE2, D-IE3, D-IE8). Stops carry their running split by duty status (0407). service_role only.';

revoke all on function public.idle_engine_write(uuid, uuid[], timestamptz, timestamptz, text, jsonb, jsonb) from public;
revoke all on function public.idle_engine_write(uuid, uuid[], timestamptz, timestamptz, text, jsonb, jsonb) from anon;
revoke all on function public.idle_engine_write(uuid, uuid[], timestamptz, timestamptz, text, jsonb, jsonb) from authenticated;
grant execute on function public.idle_engine_write(uuid, uuid[], timestamptz, timestamptz, text, jsonb, jsonb) to service_role;
