-- Silvicom 360 — 0360 partition maintenance: pg_partman + pg_cron, and a health reading for both
--
-- DATA-LIFECYCLE-PLAN L6 (D-LIFE6, D-LIFE10). This is the MECHANISM only. No table is partitioned
-- here; L7 partitions `audit_logs`, and until then `partman.part_config` is empty and the hourly job
-- is a no-op measured in milliseconds.
--
-- WHY NOW, AND WHY BEFORE L7. The instance is Micro — 948 MB of RAM under a 4,057 MB database, with
-- swap in active use (Q3, measured 2026-09-22) — so the bounded working set D-LIFE0 asks for is a
-- present problem, and L7 is the step that delivers it. L7 cannot ship without this, and D-LIFE3
-- keeps every step small: a merge that installs a scheduler should not also convert a 4.7M-row table.
--
-- ── WHAT IS INSTALLED, AND WHY EACH IS PERMITTED HERE ─────────────────────────────────────────────
-- `migrate.yml` runs `supabase db push` as `postgres`, which is NOT a superuser on Supabase. Checked
-- against production before this was written, not assumed:
--   • pg_cron 1.6.4 — superuser-only, but on `supautils.privileged_extensions` and already in
--     `shared_preload_libraries`, with `cron.database_name = postgres`. Installed into `pg_catalog`,
--     which is where Supabase's own dashboard toggle puts it; the extension creates `cron` itself.
--   • pg_partman 5.3.1 — NOT on the privileged list, but `superuser = false`, so any role with
--     CREATE on the database may install it, and `postgres` owns the database. Own schema, per D-LIFE6.
-- pg_partman's background worker is not available on managed Supabase (D-LIFE6), so pg_cron calls
-- `run_maintenance_proc()` hourly — idempotent, and cheap when there is nothing to make.
--
-- ── THE GUARD, AND WHY IT CANNOT HIDE A FAILURE IN PRODUCTION ───────────────────────────────────
-- Every PGlite matrix replays every migration, and PGlite ships neither extension, so the install is
-- conditional on `pg_available_extensions`. A conditional install is exactly the kind of thing that
-- can skip silently where it matters. It cannot here for two reasons: both extensions were measured
-- as available on this project (2026-09-22), and `lifecycle_maintenance_health()` below reports
-- `missing` whenever the job is not there — the next merge publishes that on `/api/version` and folds
-- it into `ok`. A skipped install is therefore a red boolean, not an absence.
--
-- ── WHAT THE HEALTH READING DOES NOT YET DO ─────────────────────────────────────────────────────
-- D-LIFE10's premake-headroom alarm (newest partition < 60 days ahead of the write head) ships with
-- the first partitioned table, as D-LIFE10 requires. Measured over zero partitioned tables it would
-- be a vacuously green fold; `partitioned_tables` is reported so that zero reads as zero.
-- And a PUSH alarm needs somewhere to go: this repo has no platform-level alert channel (every alarm
-- today notifies an org's office). That is recorded as Q9 in the plan, and must be answered before L7.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_partman') then
    create extension if not exists pg_cron with schema pg_catalog;
    create schema if not exists partman;
    create extension if not exists pg_partman with schema partman;
    -- Minute 7, not 0: the top of the hour is where every other hourly thing on this box lands.
    -- `cron.schedule` with a name upserts, so re-applying this file does not add a second job.
    perform cron.schedule(
      'partman-maintenance',
      '7 * * * *',
      'call partman.run_maintenance_proc()'
    );
    -- Not reachable through PostgREST (not an exposed schema), and not reachable by a token either.
    revoke all on schema partman from public;
    revoke all on schema partman from anon;
    revoke all on schema partman from authenticated;
  else
    raise notice '0360: pg_cron/pg_partman not available on this server — partition maintenance not installed (expected on PGlite only)';
  end if;
end
$$;

-- The one reading D-LIFE10 needs before any table is partitioned: does the job exist, is it active,
-- and has it succeeded recently? A state, never a guess:
--   missing  — pg_cron or pg_partman absent, or the job is not scheduled
--   inactive — the job exists and has been switched off
--   pending  — scheduled, no successful run yet (the first hour after this migration)
--              ⚠ `cron.job` carries no creation time, so "installed, never fired once" also reads
--              pending, indefinitely. That one case is checked by hand after this applies (§8); every
--              failure after the first success is caught by `stale`.
--   failing  — the most recent run did not succeed
--   stale    — no success in 3 hours against an hourly schedule
--   ok       — otherwise
-- plpgsql, not sql: its body is not resolved at CREATE time, so this function exists on PGlite, where
-- `cron` does not, and reports `missing` there — which is what the matrix pins.
create or replace function public.lifecycle_maintenance_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_jobid bigint;
  v_active boolean;
  v_last_status text;
  v_last_start timestamptz;
  v_last_success timestamptz;
  v_state text;
  v_tables int := 0;
begin
  if to_regclass('cron.job') is null or to_regclass('partman.part_config') is null then
    return jsonb_build_object('state', 'missing', 'last_run_at', null, 'last_succeeded_at', null,
                              'partitioned_tables', null);
  end if;

  execute 'select count(*)::int from partman.part_config' into v_tables;

  execute $q$select jobid, active from cron.job where jobname = 'partman-maintenance'$q$
    into v_jobid, v_active;
  if v_jobid is null then
    return jsonb_build_object('state', 'missing', 'last_run_at', null, 'last_succeeded_at', null,
                              'partitioned_tables', v_tables);
  end if;

  execute $q$select status, start_time from cron.job_run_details where jobid = $1
             order by start_time desc limit 1$q$
    into v_last_status, v_last_start using v_jobid;
  execute $q$select max(end_time) from cron.job_run_details where jobid = $1 and status = 'succeeded'$q$
    into v_last_success using v_jobid;

  -- pg_cron's statuses are starting / running / sending / connecting / succeeded / failed; only
  -- `failed` is a verdict, the rest are a run in flight.
  v_state := case
    when not v_active then 'inactive'
    when v_last_status = 'failed' then 'failing'
    when v_last_success is null and (v_last_start is null or v_last_start > now() - interval '3 hours')
      then 'pending'
    when v_last_success is null or v_last_success < now() - interval '3 hours' then 'stale'
    else 'ok'
  end;

  return jsonb_build_object('state', v_state, 'last_run_at', v_last_start,
                            'last_succeeded_at', v_last_success, 'partitioned_tables', v_tables);
end
$$;

comment on function public.lifecycle_maintenance_health() is
  'State of the hourly pg_partman maintenance job (DATA-LIFECYCLE-PLAN L6, D-LIFE10). Read by GET /api/version. service_role only (0360).';

revoke all on function public.lifecycle_maintenance_health() from public;
revoke all on function public.lifecycle_maintenance_health() from anon;
revoke all on function public.lifecycle_maintenance_health() from authenticated;
grant execute on function public.lifecycle_maintenance_health() to service_role;
