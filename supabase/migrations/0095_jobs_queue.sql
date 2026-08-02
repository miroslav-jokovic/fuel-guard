-- WQ0 (docs/plans/P0-WORKER-QUEUE-PLAN.md): evolve the `jobs` ledger (0027) into a durable work queue.
-- Additive + reversible. Adds a serializable payload, a general dedup axis, and lease/retry columns so a
-- worker POOL can claim + execute jobs via FOR UPDATE SKIP LOCKED with lease-based crash recovery —
-- replacing in-process runJob() execution and the single-instance boot sweep. All heavy claim logic is a
-- SECURITY DEFINER RPC because supabase-js (PostgREST) cannot row-lock.

alter table jobs
  add column if not exists payload          jsonb       not null default '{}',
  add column if not exists dedup_key        text,                       -- when set, THE active-dedup axis (else (org_id,kind))
  add column if not exists locked_by        text,                       -- worker id currently holding the lease
  add column if not exists lease_expires_at timestamptz,                -- a running row past this is reclaimable
  add column if not exists attempts         int         not null default 0,
  add column if not exists max_attempts     int         not null default 5,
  add column if not exists run_after        timestamptz not null default now(),  -- delayed / backoff visibility
  add column if not exists priority         int         not null default 0;      -- higher = claimed first

-- (org,kind) single-active dedup now applies ONLY to ledger kinds (dedup_key IS NULL); payload-keyed
-- kinds (e.g. per-load hazmat) use dedup_key so multiple can be active per (org,kind).
drop index if exists idx_jobs_active_one;
create unique index if not exists idx_jobs_active_one
  on jobs (org_id, kind) where status in ('queued','running') and dedup_key is null;
create unique index if not exists idx_jobs_active_dedup
  on jobs (dedup_key) where dedup_key is not null and status in ('queued','running');

-- Claim scan (ready queued rows) and lease sweep (expired running rows).
create index if not exists idx_jobs_claim on jobs (priority desc, run_after) where status = 'queued';
create index if not exists idx_jobs_lease on jobs (lease_expires_at)          where status = 'running';

-- ── enqueue_job: insert a queued job (dedup enforced by the unique indexes → 23505 → JobConflictError).
create or replace function enqueue_job(
  p_org uuid, p_kind text, p_payload jsonb default '{}', p_dedup_key text default null,
  p_requested_by uuid default null, p_priority int default 0, p_run_after timestamptz default now()
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.jobs (org_id, kind, status, payload, dedup_key, requested_by, priority, run_after)
  values (p_org, p_kind, 'queued', coalesce(p_payload,'{}'::jsonb), p_dedup_key, p_requested_by,
          coalesce(p_priority,0), coalesce(p_run_after, now()))
  returning id into v_id;
  perform pg_notify('jobs', p_kind);  -- wake a LISTENing worker (no-op today; poll is the WQ0 driver)
  return v_id;
end $$;

-- ── claim_next_job: atomically claim the next ready job for the given kinds, honoring a soft per-kind
-- concurrency cap (p_kind_caps: {kind: max_running}). FOR UPDATE SKIP LOCKED = safe across workers.
create or replace function claim_next_job(
  p_worker text, p_kinds text[], p_lease_seconds int default 300, p_kind_caps jsonb default '{}'
) returns setof public.jobs language plpgsql security definer set search_path = '' as $$
declare v_job public.jobs;
begin
  select j.* into v_job from public.jobs j
  where j.kind = any(p_kinds)
    and ( (j.status = 'queued'  and j.run_after <= now())
       or (j.status = 'running' and j.lease_expires_at is not null and j.lease_expires_at < now()) )
    and ( (p_kind_caps -> j.kind) is null
       or (select count(*) from public.jobs r
             where r.kind = j.kind and r.status = 'running'
               and r.lease_expires_at is not null and r.lease_expires_at >= now()
          ) < (p_kind_caps ->> j.kind)::int )
  order by j.priority desc, j.run_after asc
  for update skip locked
  limit 1;

  if v_job.id is null then return; end if;

  update public.jobs
     set status = 'running', locked_by = p_worker,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         started_at = coalesce(started_at, now()), attempts = attempts + 1, updated_at = now()
   where id = v_job.id
   returning * into v_job;
  return next v_job;
end $$;

-- ── renew_lease / complete_job / fail_job (retry w/ backoff, else park).
create or replace function renew_lease(p_id uuid, p_worker text, p_lease_seconds int default 300)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  update public.jobs set lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
   where id = p_id and locked_by = p_worker and status = 'running'
   returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

create or replace function complete_job(p_id uuid, p_stats jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  update public.jobs set status='done', stats=coalesce(p_stats,'{}'::jsonb),
         finished_at=now(), lease_expires_at=null, updated_at=now() where id=p_id;
$$;

create or replace function fail_job(p_id uuid, p_error text, p_retry boolean default true, p_backoff_seconds int default 30)
returns text language plpgsql security definer set search_path = '' as $$
declare v_job public.jobs; v_status text;
begin
  select * into v_job from public.jobs where id = p_id;
  if v_job.id is null then return 'missing'; end if;
  if p_retry and v_job.attempts < v_job.max_attempts then
    update public.jobs set status='queued', error=p_error, locked_by=null, lease_expires_at=null,
           run_after = now() + make_interval(secs => p_backoff_seconds), updated_at=now() where id=p_id;
    v_status := 'requeued';
  else
    update public.jobs set status='failed', error=p_error, finished_at=now(), lease_expires_at=null,
           updated_at=now() where id=p_id;
    v_status := 'failed';
  end if;
  return v_status;
end $$;

-- Worker-only RPCs: service-role executes them (bypasses RLS); no client/anon access.
revoke all on function enqueue_job(uuid,text,jsonb,text,uuid,int,timestamptz) from public;
revoke all on function claim_next_job(text,text[],int,jsonb) from public;
revoke all on function renew_lease(uuid,text,int) from public;
revoke all on function complete_job(uuid,jsonb) from public;
revoke all on function fail_job(uuid,text,boolean,int) from public;
grant execute on function enqueue_job(uuid,text,jsonb,text,uuid,int,timestamptz) to service_role;
grant execute on function claim_next_job(text,text[],int,jsonb) to service_role;
grant execute on function renew_lease(uuid,text,int) to service_role;
grant execute on function complete_job(uuid,jsonb) to service_role;
grant execute on function fail_job(uuid,text,boolean,int) to service_role;
