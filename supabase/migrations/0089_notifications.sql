-- FuelGuard — 0089 notifications (Phase 5N, decision D53)
--
-- WHY THIS EXISTS. Phase 3B built an approval gate: a load is invisible until a human releases it.
-- But releasing it does nothing a driver can perceive — they find out whenever they next happen to
-- open the app. An approval flow whose output nobody is told about is a workflow with a hole in it.
--
-- FOUR TABLES, each earning its place:
--   notification_events        what happened, addressed to one user
--   notification_reads         per-user read state (separate, so an event stays immutable)
--   device_push_tokens         where to reach them, and when to stop
--   notification_preferences   what they want, and when they do not want it
--
-- THE ONE THING THAT MAKES OR BREAKS THIS: `dedupe_key`. A scheduler retry, a double-clicked
-- Release, or an at-least-once worker must not buzz a driver's phone twice for the same fact. The key
-- encodes the *instance* of a transition, not just the entity — see `notify_dedupe_key()` below.
--
-- Gated on the `notifications` module (D55/0088): a tenant that has not bought it emits nothing and
-- reads nothing.

-- ── the caller's login id ─────────────────────────────────────────────────────
-- Supabase ships `auth_user_id()`, but every other policy in this codebase reads the claim through a
-- local `auth_*` helper (0002) — so notifications do the same. One reading path means the offline
-- RLS matrix exercises the real predicate rather than a shim that only exists in production.
create or replace function auth_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;

-- ── categories ────────────────────────────────────────────────────────────────
-- Each maps to a deep link, because a notification that lands the driver on Home is a wasted one.
create table if not exists notification_events (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  -- Addressed to a LOGIN, not a driver: office users get notified too (a decline, an amendment).
  audience_user_id  uuid not null references auth.users(id) on delete cascade,
  category          text not null,
  title             text not null,
  body              text,
  severity          text not null default 'info',
  -- What it is about, so the app can open the exact thing.
  entity_type       text,
  entity_id         uuid,
  deep_link         text,
  /** Set once delivery has been attempted, so the worker never re-sends the same row. */
  pushed_at         timestamptz,
  push_error        text,
  /** Idempotency across retries — one buzz per fact. Null is allowed for one-off system messages. */
  dedupe_key        text,
  created_at        timestamptz not null default now(),
  constraint notification_events_category_check check (category in (
    'load_offered', 'load_changed', 'load_canceled', 'message_received',
    'duty_auto_closed', 'performance_week', 'training_due', 'system'
  )),
  constraint notification_events_severity_check check (severity in ('info', 'warning', 'critical'))
);

-- THE idempotency guarantee. Partial so a null key (a genuine one-off) is never constrained.
create unique index if not exists uq_notification_dedupe
  on notification_events (org_id, audience_user_id, dedupe_key) where dedupe_key is not null;
-- The inbox read: newest first, per user.
create index if not exists idx_notification_events_audience
  on notification_events (audience_user_id, created_at desc);
-- The delivery sweep: anything not yet pushed.
create index if not exists idx_notification_events_unpushed
  on notification_events (created_at) where pushed_at is null;

-- ── read state ────────────────────────────────────────────────────────────────
-- Separate from the event so an event row is written once and never updated — the same reasoning as
-- `load_events`. It also means a future shared/broadcast event needs no schema change.
create table if not exists notification_reads (
  event_id uuid not null references notification_events(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  read_at  timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- ── where to reach them ───────────────────────────────────────────────────────
-- `token` is the PK: the same device re-registering after a reinstall collides and updates rather
-- than accumulating dead rows. `revoked_at` is set on sign-out AND on offboarding — a fired driver's
-- personal phone must stop receiving fleet data immediately, which token expiry alone will not do.
create table if not exists device_push_tokens (
  token        text primary key,
  org_id       uuid not null references organizations(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  platform     text not null default 'unknown',
  app_version  text,
  last_seen_at timestamptz not null default now(),
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  constraint device_push_tokens_platform_check check (platform in ('ios', 'android', 'unknown'))
);
create index if not exists idx_push_tokens_user on device_push_tokens (user_id) where revoked_at is null;

-- ── what they want ────────────────────────────────────────────────────────────
-- Quiet hours are stored per USER with their own timezone, and enforced SERVER-side. Enforcing them
-- only on the device would still light up a phone at 03:00 for anyone whose OS settings differ.
create table if not exists notification_preferences (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  org_id             uuid not null references organizations(id) on delete cascade,
  /** Categories the user has switched OFF. Absent = on, so a new category ships enabled. */
  muted_categories   text[] not null default '{}',
  quiet_hours_start  time,
  quiet_hours_end    time,
  timezone           text not null default 'UTC',
  updated_at         timestamptz not null default now()
);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table notification_events enable row level security;
alter table notification_reads enable row level security;
alter table device_push_tokens enable row level security;
alter table notification_preferences enable row level security;

-- A notification is addressed to ONE person. Even an admin has no business reading another user's
-- inbox — this is the one place in the product where org-wide read would be wrong.
drop policy if exists notification_events_own on notification_events;
create policy notification_events_own on notification_events for select
  using (org_id = auth_org_id() and audience_user_id = auth_user_id());

-- No client INSERT/UPDATE/DELETE on events: they are emitted by the server (service role) and are a
-- record of what the system told someone. A user marking one read writes to `notification_reads`.
drop policy if exists notification_reads_own on notification_reads;
create policy notification_reads_own on notification_reads for all
  using (user_id = auth_user_id())
  with check (user_id = auth_user_id());

drop policy if exists push_tokens_own on device_push_tokens;
create policy push_tokens_own on device_push_tokens for all
  using (org_id = auth_org_id() and user_id = auth_user_id())
  with check (org_id = auth_org_id() and user_id = auth_user_id());

drop policy if exists notification_prefs_own on notification_preferences;
create policy notification_prefs_own on notification_preferences for all
  using (org_id = auth_org_id() and user_id = auth_user_id())
  with check (org_id = auth_org_id() and user_id = auth_user_id());

-- ═════════════════════════════════════════════════════════════════════════════
-- Emission (service role). One function so every caller gets dedupe, module-gating and preference
-- resolution for free — an emitter that hand-rolled an INSERT would skip all three.
-- ═════════════════════════════════════════════════════════════════════════════

/**
 * The dedupe key for a state transition. Includes the transition's own timestamp, so releasing a
 * load, having it declined, and releasing it again DOES notify twice — those are two different facts
 * — while a retry of either one does not.
 */
create or replace function notify_dedupe_key(p_category text, p_entity uuid, p_at timestamptz)
returns text
language sql immutable
as $$
  select p_category || ':' || coalesce(p_entity::text, '-') || ':' ||
         coalesce(extract(epoch from p_at)::bigint::text, '0');
$$;

/**
 * Is this category deliverable to this user right now? Three questions, in order of cost:
 * has the tenant bought notifications, has the user muted the category, and is it quiet hours in
 * THEIR timezone. Critical severity ignores quiet hours — a canceled load on a truck already rolling
 * is worth waking someone for; a settled performance week is not.
 */
create or replace function notification_allowed(
  p_org uuid, p_user uuid, p_category text, p_severity text default 'info', p_at timestamptz default now()
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p record;
  v_local time;
begin
  if not public.org_module_enabled(p_org, 'notifications') then
    return false;
  end if;

  select * into p from public.notification_preferences where user_id = p_user;
  if p is null then
    return true;                                  -- no preferences set = everything on
  end if;
  if p_category = any (p.muted_categories) then
    return false;
  end if;
  if p_severity = 'critical' then
    return true;                                  -- never suppressed
  end if;
  if p.quiet_hours_start is null or p.quiet_hours_end is null then
    return true;
  end if;

  v_local := (p_at at time zone p.timezone)::time;
  -- A window that wraps midnight (22:00 → 06:00) is the normal case, so handle it explicitly.
  if p.quiet_hours_start <= p.quiet_hours_end then
    return not (v_local >= p.quiet_hours_start and v_local < p.quiet_hours_end);
  else
    return not (v_local >= p.quiet_hours_start or v_local < p.quiet_hours_end);
  end if;
exception
  when others then
    -- An unknown timezone must not swallow a notification.
    return true;
end;
$$;

/** Emit one notification. Returns the id, or null when it was deduped or suppressed. */
create or replace function emit_notification(
  p_org uuid,
  p_user uuid,
  p_category text,
  p_title text,
  p_body text default null,
  p_severity text default 'info',
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_deep_link text default null,
  p_dedupe_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.notification_allowed(p_org, p_user, p_category, p_severity) then
    return null;
  end if;

  insert into public.notification_events
    (org_id, audience_user_id, category, title, body, severity, entity_type, entity_id, deep_link, dedupe_key)
  values
    (p_org, p_user, p_category, p_title, p_body, p_severity, p_entity_type, p_entity_id, p_deep_link, p_dedupe_key)
  on conflict (org_id, audience_user_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;

  return v_id;
end;
$$;

/**
 * Revoke every push token for a user — sign-out, and offboarding (D14/D53). Without this an
 * offboarded driver's personal phone keeps receiving load and message content from a fleet they no
 * longer work for, which no token expiry window fixes.
 */
create or replace function revoke_push_tokens(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.device_push_tokens
     set revoked_at = now()
   where user_id = p_user and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
