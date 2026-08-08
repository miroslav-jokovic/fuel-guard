-- 0149 — server-counted daily caps for driver writes (D57 / D-L5, loads plan L4).
--
-- WHY A TABLE AND NOT MEMORY. The per-minute limit is a burst guard and lives in the API process:
-- losing it on a redeploy costs nothing, because the window it protects is sixty seconds long. A
-- daily cap is a business statement — "200 load actions is your maximum today" — and a cap that
-- resets every time the service restarts is not a cap. It has to be durable and it has to be exact
-- under concurrency, which makes it Postgres's job.
--
-- KEYED ON THE AUTH USER, NEVER ON IP. Drivers share a carrier's NAT; an IP-keyed limit throttles a
-- whole yard the moment one phone retries in a loop. That is the entire reason D57 exists.
--
-- ATTEMPTS OVER THE CAP ARE STILL COUNTED. `bump` increments before it judges, so a driver hammering
-- past their maximum shows up in the data as exactly that. The per-minute limiter runs FIRST and in
-- memory, so a runaway loop is bounded to (per-minute limit × 1440) writes a day before it ever
-- reaches this table — the worst case is roughly 14k rows-worth of increments on one row, not a
-- write storm.

create table if not exists public.driver_write_counters (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  bucket     text not null check (bucket in ('shift', 'load_action', 'stop_capture', 'message')),
  -- UTC. A carrier's operating day is not UTC, but a cap that shifts with a driver's timezone is a
  -- cap nobody can reason about; the API tells the app when it resets rather than leaving it to guess.
  day        date not null,
  count      int  not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, bucket, day)
);

-- The only query a purge needs: everything older than N days, across all users.
create index if not exists idx_driver_write_counters_day on public.driver_write_counters (day);

alter table public.driver_write_counters enable row level security;
-- NO POLICIES, deliberately. RLS denies by default, so no client — driver, manager or auditor — can
-- read or write this table through PostgREST. It is service-role bookkeeping, and a driver who could
-- see their own counter could also delete it.

comment on table public.driver_write_counters is
  'Per-driver daily write counts behind D57''s business caps. Service-role only: RLS denies all
   client access by design. Rows are safe to purge after ~90 days.';

/**
 * Increment and judge in one statement.
 *
 * Two callers racing on the same key must not both read 199 and both be allowed; the upsert's
 * RETURNING gives each its own post-increment value, so exactly one of them sees 200 and the other
 * sees 201. Doing this as SELECT-then-UPDATE in the API would be a lost-update bug that only shows
 * up under the traffic the cap exists to survive.
 */
create or replace function public.bump_driver_write_counter(
  p_org uuid, p_user uuid, p_bucket text, p_limit int
) returns table (allowed boolean, used int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used int;
begin
  insert into public.driver_write_counters (org_id, user_id, bucket, day, count)
  values (p_org, p_user, p_bucket, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, bucket, day) do update
    set count = public.driver_write_counters.count + 1,
        updated_at = now()
  returning public.driver_write_counters.count into v_used;

  return query select (v_used <= p_limit), v_used;
end;
$$;

comment on function public.bump_driver_write_counter(uuid, uuid, text, int) is
  'Atomically increment a driver''s daily write counter and report whether it is still within cap
   (D57). Increments before judging, so over-cap attempts are visible.';

revoke all on function public.bump_driver_write_counter(uuid, uuid, text, int) from public;
grant execute on function public.bump_driver_write_counter(uuid, uuid, text, int) to service_role;
