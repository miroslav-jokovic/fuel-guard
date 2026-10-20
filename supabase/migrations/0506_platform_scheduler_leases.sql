-- Silvicom 360 — 0506 platform_scheduler_leases: the database decides which process runs the schedulers.
-- PLATFORM-RELIABILITY-PLAN D-REL-P2 (opened 2026-10-20).
--
-- ── THE GAP ──────────────────────────────────────────────────────────────────────────────────────
-- "The schedulers run in exactly one process" has been a rule held by an environment variable
-- (`RUN_SCHEDULERS_IN_PROCESS`, default true) and nothing else. Nothing in CI can see a Railway
-- variable, and the code cannot count its own copies. On 2026-09-05 both `@fleetguard/api` and
-- `@fleetguard/web` ran the full set for weeks because `web` had never been given the variable
-- (docs/DEPLOYMENT.md). The same rule is what has kept the API at ONE replica: a second copy of the
-- service would run every poller twice — and WEX's guide (p11) says excessive polling can suspend the
-- EFS account. One replica is why every deploy and every crash drops every user (measured 2026-10-20:
-- p50 140 ms, but one process serves people, the McLeod connector and ~20 schedulers at once).
--
-- ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────
-- A lease per scheduler LANE (a named, disjoint set of schedulers — apps/api/src/schedulerLanes.ts).
-- A process that wants to run a lane calls `acquire_scheduler_lease` every few seconds; the call
-- either renews the lease it already holds or takes one whose holder stopped renewing. Exactly one
-- holder per lane exists at any instant because the row is the lane and the take-over is a single
-- conditional `insert … on conflict do update … where`. A holder that fails to renew before its
-- expiry stops its own schedulers by exiting (the platform restarts it as a standby), so two holders
-- never overlap by more than the clock skew between the API and Postgres — and the jobs ledger's
-- `(org_id, kind)` slot already refuses an overlapping run of any per-org job inside that skew.
--
-- `release_scheduler_lease` is the graceful half: a process stopping for a deploy gives the lease up so
-- the next one takes it at once, instead of the lanes going quiet for a full TTL on every merge.
--
-- ── WHAT WAS REJECTED ────────────────────────────────────────────────────────────────────────────
--  · pg_try_advisory_lock: session-scoped, and the API reaches Postgres through PostgREST, where a
--    session is one HTTP request. The lock would be released the moment it was granted.
--  · A leader row in `jobs`: `jobs` is a per-org ledger with retention (90 d) and its own unique
--    index semantics; a platform lease has no org and must never be swept.
--  · Redis/an external lock service: a new vendor to keep alive for a problem Postgres solves, and
--    the schedulers cannot work without Postgres anyway.
--
-- Readers: apps/api/src/lib/schedulerLease.ts (acquire/renew/release), and `/api/version` → `schedulers`
-- (lane holder + seconds since the last renewal), which the external uptime monitor and
-- scripts/platform-health.mjs read: a lane with no live holder is "the background work has stopped",
-- the one failure no carrier's office can see.

create table if not exists platform_scheduler_leases (
  lane         text primary key check (lane ~ '^[a-z][a-z0-9_]{1,39}$'),
  -- `<service>:<replica or hostname>:<pid>:<boot nonce>` — unique per process start, so a restarted
  -- process is a NEW holder and never mistakes its predecessor's lease for its own.
  holder       text not null check (length(holder) between 1 and 200),
  -- Where the holder runs, for the person reading the row after an alarm. Never used for a decision.
  holder_meta  jsonb not null default '{}'::jsonb,
  acquired_at  timestamptz not null default now(),
  renewed_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  check (expires_at > renewed_at)
);

alter table platform_scheduler_leases enable row level security;
-- No client policies: only the service role (the API and worker processes) reaches it, like
-- platform_alert_recipients (0427). Which process runs the schedulers is nobody's business but ours.

comment on table platform_scheduler_leases is
  'org: one row per scheduler lane; the live holder is the only process allowed to run that lane''s schedulers. Written only by acquire_scheduler_lease / release_scheduler_lease (0506).';

-- ── acquire_scheduler_lease: take or renew. Returns the row as it stands after the attempt, and
-- whether p_holder is now its holder. TTL is bounded so a typo cannot park a lane for a day.
create or replace function acquire_scheduler_lease(
  p_lane text, p_holder text, p_ttl_seconds int default 45, p_meta jsonb default '{}'::jsonb
) returns table (held boolean, holder text, expires_at timestamptz, renewed_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_ttl int := least(greatest(coalesce(p_ttl_seconds, 45), 10), 300);
begin
  insert into public.platform_scheduler_leases as l (lane, holder, holder_meta, acquired_at, renewed_at, expires_at)
  values (p_lane, p_holder, coalesce(p_meta, '{}'::jsonb), now(), now(), now() + make_interval(secs => v_ttl))
  on conflict (lane) do update
     set holder      = excluded.holder,
         holder_meta = excluded.holder_meta,
         -- A renewal keeps the original take-over time; only a change of holder restarts it.
         acquired_at = case when l.holder = excluded.holder then l.acquired_at else now() end,
         renewed_at  = now(),
         expires_at  = excluded.expires_at
   where l.holder = excluded.holder or l.expires_at <= now();

  return query
    select (l.holder = p_holder) as held, l.holder, l.expires_at, l.renewed_at
      from public.platform_scheduler_leases l
     where l.lane = p_lane;
end $$;

-- ── release_scheduler_lease: give a held lease up now (graceful shutdown). A no-op for a non-holder,
-- so a process can never release a lease another process has since taken.
create or replace function release_scheduler_lease(p_lane text, p_holder text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  -- Ends the lease NOW; `renewed_at` steps back one microsecond only to keep the row's own check
  -- (expires_at > renewed_at) true. The take-over condition is `expires_at <= now()`, so the next
  -- asker gets it on its very next call.
  update public.platform_scheduler_leases
     set expires_at = now(), renewed_at = now() - interval '1 microsecond'
   where lane = p_lane and holder = p_holder and expires_at > now()
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

-- Service role only. 0412 closes new functions to clients by default; the revoke states the intent
-- and survives a changed default (supabase/CLAUDE.md).
revoke all on function acquire_scheduler_lease(text, text, int, jsonb) from public, anon, authenticated;
revoke all on function release_scheduler_lease(text, text) from public, anon, authenticated;
