-- FuelGuard — 0088 module entitlements (Phase 5E, decision D55)
--
-- WHY THIS EXISTS. The plan has said "entitlement-gated (`hazmatguard`)" since Phase 6 was first
-- sketched, but an audit found **no entitlement, plan or subscription model anywhere** — zero matches
-- across migrations, API, web and shared. HazmatGuard and Training are separately-sellable products,
-- so the gate has to exist before either ships, and a gate that lives only in the UI would not
-- survive a driver JWT hitting PostgREST directly.
--
-- THREE LAYERS, because one is not enough:
--   1. RLS — a disabled module's own tables return ZERO rows, even to a raw PostgREST call.
--   2. API — `requireModule()` returns 403 before any handler runs.
--   3. UI  — a disabled module's surfaces never render, so nobody is offered a dead button.
-- Layer 3 is courtesy. Layer 1 is the boundary (D10).
--
-- ── THE MIGRATION-SAFETY POINT, and it is the whole reason this file has a backfill ──────────────
-- "Absent key = disabled" is the correct default for a module nobody has bought yet. Applied naively
-- it is a REGRESSION: every existing org would lose Dispatch the moment this deploys. So the backfill
-- below explicitly ENABLES the currently-live capabilities for every existing org. New modules
-- (hazmatguard, training, messages, notifications) stay absent — which is exactly right, because
-- nobody is using them yet.

create table if not exists org_modules (
  org_id     uuid not null references organizations(id) on delete cascade,
  module_key text not null,
  enabled    boolean not null default true,
  enabled_at timestamptz not null default now(),
  enabled_by uuid references auth.users(id) on delete set null,
  -- Per-module settings that are not worth their own table (e.g. a training pass mark).
  config     jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, module_key),
  constraint org_modules_key_check check (module_key in (
    'hazmatguard', 'training', 'messages', 'notifications', 'dispatch', 'navigation'
  ))
);

create index if not exists idx_org_modules_enabled on org_modules (org_id) where enabled;

-- ── the helper every gate reads ───────────────────────────────────────────────
-- SECURITY DEFINER for the same reason as `auth_driver_id()` (0084): the internal read must bypass
-- RLS, or a RESTRICTIVE policy that calls this function would recurse through its own table.
-- Absent row = disabled, so a module a tenant has never been granted is off by construction.
create or replace function auth_module_enabled(p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select m.enabled
       from public.org_modules m
      where m.org_id = public.auth_org_id()
        and m.module_key = p_module),
    false
  );
$$;

/** The same question for an explicit org — used by the API and by service-role code paths. */
create or replace function org_module_enabled(p_org uuid, p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select m.enabled from public.org_modules m where m.org_id = p_org and m.module_key = p_module),
    false
  );
$$;

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table org_modules enable row level security;

-- Every member may READ their org's entitlements — the UI needs them to decide what to render, and
-- knowing which modules your own company bought is not sensitive.
drop policy if exists org_modules_select on org_modules;
create policy org_modules_select on org_modules for select using (org_id = auth_org_id());

-- Nobody inside the tenant may grant themselves a module. Entitlements are a commercial fact, set by
-- the platform control plane (`apps/admin-api`, service role) — not by an org admin, however senior.
-- There is deliberately NO insert/update/delete policy for any role.

-- ── backfill: keep every existing tenant working exactly as it does today ─────
-- Dispatch is live and in use. Navigation is enabled so the deferred programme (D52) finds its
-- tenants already provisioned when it lands. The four unbuilt modules are deliberately NOT seeded.
insert into org_modules (org_id, module_key, enabled)
select o.id, k.module_key, true
from organizations o
cross join (values ('dispatch'), ('navigation')) as k(module_key)
on conflict (org_id, module_key) do nothing;

-- A new tenant gets the same baseline, so signing up does not silently ship a crippled product.
create or replace function seed_default_org_modules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.org_modules (org_id, module_key, enabled)
  values (new.id, 'dispatch', true), (new.id, 'navigation', true)
  on conflict (org_id, module_key) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_seed_default_org_modules on organizations;
create trigger trg_seed_default_org_modules
  after insert on organizations
  for each row execute function seed_default_org_modules();
