-- 0027: background job ledger — the coordination backbone for sync / rebuild / backfill / reconcile.
-- Every long-running background operation writes a row here so the UI can show progress + freshness,
-- surface failures, and (via the partial unique index) refuse to start a second concurrent run of the
-- same kind for the same org — DB-enforced, not an in-memory flag.
create table if not exists jobs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  kind          text not null,                         -- rebuild | backfill | score_import | sync_vehicles | …
  status        text not null default 'queued',        -- queued | running | done | failed
  progress      int  not null default 0,
  total         int,
  error         text,
  stats         jsonb not null default '{}',
  requested_by  uuid,                                  -- null for scheduler-initiated runs
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_jobs_org_kind_created on jobs (org_id, kind, created_at desc);
-- At most ONE active run per (org, kind): a second start hits a 23505 the service turns into "already running".
create unique index if not exists idx_jobs_active_one on jobs (org_id, kind) where status in ('queued', 'running');

-- RLS: org members can READ their jobs (progress/freshness in the UI); all writes are service-role only
-- (the API/schedulers use the service key, which bypasses RLS) — no insert/update/delete policy exists.
alter table jobs enable row level security;
drop policy if exists jobs_select on jobs;
create policy jobs_select on jobs for select using (org_id = auth_org_id());
