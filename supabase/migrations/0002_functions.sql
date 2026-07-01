-- FuelGuard — 0002 helper functions & triggers
-- docs/02-DATA-MODEL.md §4 and §10.1

-- Maintains updated_at on any table that has the column.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Tenant id from the JWT claim injected by the Custom Access Token hook (docs/01 §4).
-- Returns null when no claim is present (e.g. a user with no membership yet → RLS denies).
create or replace function auth_org_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'org_id', '')::uuid;
$$;

-- App role from the JWT claim. NB: we use `user_role` (not `role`) because Supabase reserves the
-- `role` claim for the Postgres DB role (authenticated/anon) — overwriting it breaks auth. The
-- Custom Access Token hook (0006) injects `user_role` from the user's membership.
create or replace function auth_role()
returns text
language sql
stable
as $$
  select current_setting('request.jwt.claims', true)::jsonb ->> 'user_role';
$$;
