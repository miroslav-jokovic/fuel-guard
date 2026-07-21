-- FuelGuard — 0070 platform_admins (control-plane allowlist)
-- docs/plans/ADMIN-DASHBOARD.md §4, §9.
--
-- This table is the ONLY grant of cross-tenant power in the system. It is deliberately tiny and tightly
-- held: service-role only (RLS enabled, NO client policies) so it is reachable exclusively by the separate
-- admin-api service. Identity is proven by a verified Supabase JWT; AUTHORITY is a fresh lookup in this
-- table on every admin request — so a stale/stolen token can never carry god-mode, and revocation is
-- instant (flip status / delete the row). No JWT claim ever encodes platform access.

create extension if not exists citext;  -- case-insensitive email matching

do $$ begin
  create type platform_role as enum
    ('platform_owner', 'platform_admin', 'platform_support', 'platform_readonly');
exception when duplicate_object then null; end $$;

create table if not exists platform_admins (
  id              uuid primary key default gen_random_uuid(),
  email           citext not null unique,
  -- Linked on first login by email (admin-api stamps user_id the first time it authenticates them).
  user_id         uuid unique references auth.users(id) on delete set null,
  role            platform_role not null default 'platform_readonly',
  status          text not null default 'active' check (status in ('active', 'suspended')),
  mfa_enrolled_at timestamptz,
  -- Step-up "sudo" freshness: destructive/sensitive routes require this to be recent (see admin-api).
  last_reauth_at  timestamptz,
  -- Optional per-admin IP allowlist; empty array = no IP restriction.
  ip_allowlist    inet[] not null default '{}',
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  disabled_at     timestamptz
);
create index if not exists idx_platform_admins_user on platform_admins (user_id);

alter table platform_admins enable row level security;
-- No client policies → only the service role (admin-api) may read/write. Customer/anon roles never touch it.

create trigger trg_platform_admins_updated before update on platform_admins
  for each row execute function set_updated_at();

-- Seed the single owner. The matching Supabase auth user is created once out-of-band (dashboard or a seed
-- script) and linked by email on first login. No self-service platform-admin signup exists — ever.
insert into platform_admins (email, role, status)
values ('developmentteam@uncdevelopment.com', 'platform_owner', 'active')
on conflict (email) do nothing;
