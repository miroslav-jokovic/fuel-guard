-- 0178 — durable daily caps for card-control writes. Mirrors 0149 (driver write counters) on purpose.
--
-- WHY A SECOND COUNTER TABLE INSTEAD OF REUSING driver_write_counters. That table's `bucket` check
-- constraint enumerates driver buckets, its RPC is granted for driver flows, and its rows are safe to
-- purge after ~90 days. Card writes are a different retention story (they are evidence of who spent
-- money) and a different bucket vocabulary. Widening 0149's constraint would couple a driver
-- rate-limit change to a fuel-fraud control; two tables with one shape is the cheaper coupling.
--
-- WHY DURABLE AT ALL. The per-minute window lives in the API process, which is right for a burst
-- guard: losing it on a redeploy costs sixty seconds. A daily cap is a business statement — "twenty
-- five overrides is your maximum today" — and a cap that resets on every deploy is not a cap. It also
-- has to be exact under concurrency, which makes it Postgres's job, not a Map's.
--
-- KEYED ON THE AUTH USER. Same rule as 0149 and for the same reason: an IP-keyed limit throttles
-- everyone behind one office NAT the moment a single tab retries in a loop.
--
-- THE DEVIATION FROM 0149 WORTH KNOWING ABOUT. The driver limiter FAILS OPEN when this table is
-- unreachable, because refusing a completed stop loses real work. The card limiter fails CLOSED for
-- `card_override` and `card_prompts` (see middleware/cardWriteLimit.ts). Failing open there hands out
-- unmetered free fuel, which is the exact abuse this product exists to detect. That asymmetry is a
-- decision, not an inconsistency, and it is commented at both ends.
--
-- NUMBERING: 0178. See 0177's header — the ledger's max version is 0175 and 0172/0174/0175 are burned.
--
-- RLS: enabled, no policies. Service-role bookkeeping; a user who could read their own counter could
-- also delete it.

create table if not exists public.card_write_counters (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  bucket     text not null check (bucket in ('card_status', 'card_override', 'card_prompts')),
  -- UTC, stated rather than assumed. The API tells the client when it resets instead of leaving the
  -- browser to guess at a carrier's operating day.
  day        date not null,
  count      int  not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, bucket, day)
);

-- The only query a purge needs: everything older than N days, across all users.
create index if not exists idx_card_write_counters_day on public.card_write_counters (day);

alter table public.card_write_counters enable row level security;
-- NO POLICIES, deliberately. RLS denies by default, so no client — admin, fleet manager or auditor —
-- reaches this table through PostgREST. Service-role bookkeeping only.

comment on table public.card_write_counters is
  'Per-user daily counts of EFS card-control writes, behind the business caps in
   packages/shared/src/cardWriteLimits.ts. Service-role only: RLS denies all client access by design.
   Rows are safe to purge after ~90 days.';

/**
 * Increment and judge in one statement.
 *
 * Two dispatchers racing on the same key must not both read 24 and both be allowed: the upsert's
 * RETURNING gives each its own post-increment value, so exactly one sees 25 and the other sees 26.
 * SELECT-then-UPDATE in the API would be a lost-update bug that only appears under the traffic the
 * cap exists to survive.
 *
 * Increments BEFORE judging, so attempts over the cap are visible in the data as exactly that — a
 * person pushing past their limit is worth seeing, and a counter that stops counting hides it.
 */
create or replace function public.bump_card_write_counter(
  p_org uuid, p_user uuid, p_bucket text, p_limit int
) returns table (allowed boolean, used int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used int;
begin
  insert into public.card_write_counters (org_id, user_id, bucket, day, count)
  values (p_org, p_user, p_bucket, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, bucket, day) do update
    set count = public.card_write_counters.count + 1,
        updated_at = now()
  returning public.card_write_counters.count into v_used;

  return query select (v_used <= p_limit), v_used;
end;
$$;

comment on function public.bump_card_write_counter(uuid, uuid, text, int) is
  'Atomically increment a user''s daily card-write counter and report whether it is still within cap.
   Increments before judging, so over-cap attempts are visible (0178).';

revoke all on function public.bump_card_write_counter(uuid, uuid, text, int) from public;
grant execute on function public.bump_card_write_counter(uuid, uuid, text, int) to service_role;
