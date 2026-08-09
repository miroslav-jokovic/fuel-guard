-- 0159: operational scoring reliability
-- Atomic claim for durable EFS post-acquisition processing. PostgREST cannot row-lock, so the old
-- select-then-update claim allowed two workers to process the same import concurrently.

create or replace function public.claim_efs_processing_run(p_id uuid)
returns setof public.efs_processing_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.efs_processing_runs;
begin
  select * into v_row
    from public.efs_processing_runs
   where id = p_id
     and status in ('pending', 'failed')
     and next_attempt_at <= now()
   for update skip locked;

  if v_row.id is null then
    return;
  end if;

  update public.efs_processing_runs
     set status = 'running',
         attempts = attempts + 1,
         scoring_started_at = now(),
         last_error = null,
         updated_at = now()
   where id = p_id
   returning * into v_row;

  return next v_row;
end;
$$;

revoke all on function public.claim_efs_processing_run(uuid) from public;
grant execute on function public.claim_efs_processing_run(uuid) to service_role;

comment on function public.claim_efs_processing_run(uuid) is
  'Atomically claims one due EFS processing run with row locking; concurrent workers receive no row.';

-- Pattern sweeps are enrichment, not scoring, but a dispatch outage must not lose the request.
create table if not exists public.pattern_sweep_requests (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  anomaly_id     uuid not null references public.anomalies(id) on delete cascade,
  status         text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed')),
  attempts       int not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (anomaly_id)
);
create index if not exists idx_pattern_sweep_due
  on public.pattern_sweep_requests (next_attempt_at)
  where status in ('pending', 'failed');
alter table public.pattern_sweep_requests enable row level security;
drop policy if exists pattern_sweep_requests_select on public.pattern_sweep_requests;
create policy pattern_sweep_requests_select on public.pattern_sweep_requests
  for select using (org_id = auth_org_id());
