-- 0154: durable post-EFS scoring and alert processing
--
-- EFS acquisition, scoring, notification and inspection are separate stages. The source cursor may
-- advance after raw rows commit, but a durable processing row keeps any failed scoring/alert stage
-- retryable and visible instead of making it look complete.

create table if not exists public.efs_processing_runs (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  import_id             uuid not null references public.imports(id) on delete cascade,
  feed                  text not null check (feed in ('posted', 'rejected')),
  status                text not null default 'pending'
                          check (status in ('pending', 'running', 'succeeded', 'failed')),
  attempts              int not null default 0 check (attempts >= 0),
  next_attempt_at       timestamptz not null default now(),
  scoring_started_at    timestamptz,
  scoring_completed_at  timestamptz,
  alerts_created        int not null default 0 check (alerts_created >= 0),
  notifications_created int not null default 0 check (notifications_created >= 0),
  last_error            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (org_id, import_id)
);

create index if not exists idx_efs_processing_due
  on public.efs_processing_runs (org_id, next_attempt_at)
  where status in ('pending', 'failed');
create index if not exists idx_efs_processing_import
  on public.efs_processing_runs (org_id, import_id);

alter table public.efs_processing_runs enable row level security;
drop policy if exists efs_processing_runs_select on public.efs_processing_runs;
create policy efs_processing_runs_select on public.efs_processing_runs
  for select using (org_id = auth_org_id());

create trigger trg_efs_processing_runs_updated
  before update on public.efs_processing_runs
  for each row execute function set_updated_at();

-- Some production environments have the notification migration recorded but not the objects. Recreate the
-- notification primitives idempotently here so EFS alert emission cannot depend on a missing historical table.
create or replace function public.auth_user_id()
returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  audience_user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  title text not null,
  body text,
  severity text not null default 'info',
  entity_type text,
  entity_id uuid,
  deep_link text,
  pushed_at timestamptz,
  push_error text,
  dedupe_key text,
  created_at timestamptz not null default now(),
  constraint notification_events_severity_check check (severity in ('info', 'warning', 'critical'))
);
create table if not exists public.notification_reads (
  event_id uuid not null references public.notification_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create table if not exists public.device_push_tokens (
  token text primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null default 'unknown',
  app_version text,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  muted_categories text[] not null default '{}',
  quiet_hours_start time,
  quiet_hours_end time,
  timezone text not null default 'UTC',
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_notification_dedupe
  on public.notification_events (org_id, audience_user_id, dedupe_key) where dedupe_key is not null;
create index if not exists idx_notification_events_audience
  on public.notification_events (audience_user_id, created_at desc);
create index if not exists idx_notification_events_unpushed
  on public.notification_events (created_at) where pushed_at is null;
create index if not exists idx_push_tokens_user
  on public.device_push_tokens (user_id) where revoked_at is null;

alter table public.notification_events enable row level security;
alter table public.notification_reads enable row level security;
alter table public.device_push_tokens enable row level security;
alter table public.notification_preferences enable row level security;
drop policy if exists notification_events_own on public.notification_events;
create policy notification_events_own on public.notification_events for select
  using (org_id = public.auth_org_id() and audience_user_id = public.auth_user_id());
drop policy if exists notification_reads_own on public.notification_reads;
create policy notification_reads_own on public.notification_reads for all
  using (user_id = public.auth_user_id()) with check (user_id = public.auth_user_id());
drop policy if exists push_tokens_own on public.device_push_tokens;
create policy push_tokens_own on public.device_push_tokens for all
  using (org_id = public.auth_org_id() and user_id = public.auth_user_id())
  with check (org_id = public.auth_org_id() and user_id = public.auth_user_id());
drop policy if exists notification_prefs_own on public.notification_preferences;
create policy notification_prefs_own on public.notification_preferences for all
  using (org_id = public.auth_org_id() and user_id = public.auth_user_id())
  with check (org_id = public.auth_org_id() and user_id = public.auth_user_id());

create or replace function public.notification_allowed(
  p_org uuid, p_user uuid, p_category text, p_severity text default 'info', p_at timestamptz default now()
)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare p record; v_local time;
begin
  if not public.org_module_enabled(p_org, 'notifications') then return false; end if;
  select * into p from public.notification_preferences where user_id = p_user;
  if p is null then return true; end if;
  if p_category = any (p.muted_categories) then return false; end if;
  if p_severity = 'critical' then return true; end if;
  if p.quiet_hours_start is null or p.quiet_hours_end is null then return true; end if;
  v_local := (p_at at time zone p.timezone)::time;
  if p.quiet_hours_start <= p.quiet_hours_end then
    return not (v_local >= p.quiet_hours_start and v_local < p.quiet_hours_end);
  end if;
  return not (v_local >= p.quiet_hours_start or v_local < p.quiet_hours_end);
exception when others then return true;
end;
$$;

create or replace function public.emit_notification(
  p_org uuid, p_user uuid, p_category text, p_title text, p_body text default null,
  p_severity text default 'info', p_entity_type text default null, p_entity_id uuid default null,
  p_deep_link text default null, p_dedupe_key text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.notification_allowed(p_org, p_user, p_category, p_severity) then return null; end if;
  insert into public.notification_events
    (org_id, audience_user_id, category, title, body, severity, entity_type, entity_id, deep_link, dedupe_key)
  values
    (p_org, p_user, p_category, p_title, p_body, p_severity, p_entity_type, p_entity_id, p_deep_link, p_dedupe_key)
  on conflict (org_id, audience_user_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- Notification categories for the office alert and inspection workflow.
alter table public.notification_events drop constraint if exists notification_events_category_check;
alter table public.notification_events add constraint notification_events_category_check check (category in (
  'load_offered', 'load_changed', 'load_canceled', 'message_received',
  'duty_auto_closed', 'performance_week', 'training_due', 'system',
  'hazmat_review', 'hazmat_cleared', 'hazmat_rejected',
  'fuel_alert', 'declined_alert', 'efs_processing_failed', 'efs_feed_stale'
));
