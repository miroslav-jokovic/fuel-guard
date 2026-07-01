-- FuelGuard — 0006 Custom Access Token hook
-- docs/01-ARCHITECTURE.md §4. Injects org_id + user_role from the user's membership into the JWT,
-- so RLS (auth_org_id()/auth_role()) can authorize. Runs before each token is issued.
--
-- IMPORTANT: we inject `user_role` (NOT `role`). Supabase reserves the `role` claim for the
-- Postgres DB role (authenticated/anon); overwriting it breaks auth (audit B1/B3 follow-through).
-- If the user has no membership yet, NO org claim is added → the app shows "account pending" and
-- RLS denies tenant data (the correct, safe default — audit B3).
--
-- After applying, enable it in the Dashboard: Authentication → Hooks → Custom Access Token →
-- select public.custom_access_token_hook. For local dev, add to supabase/config.toml:
--   [auth.hook.custom_access_token]
--   enabled = true
--   uri = "pg-functions://postgres/public/custom_access_token_hook"

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims  jsonb;
  v_org   uuid;
  v_role  text;
begin
  -- A user belongs to exactly one org in v1 (audit M1); pick the earliest membership defensively.
  select m.org_id, m.role::text
    into v_org, v_role
  from public.memberships m
  where m.user_id = (event->>'user_id')::uuid
  order by m.created_at asc
  limit 1;

  claims := coalesce(event->'claims', '{}'::jsonb);

  if v_org is not null then
    claims := jsonb_set(claims, '{org_id}', to_jsonb(v_org::text));
    claims := jsonb_set(claims, '{user_role}', to_jsonb(v_role));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Only the Auth server may execute the hook; never expose it to the Data API.
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- Let the Auth admin read memberships (belt-and-suspenders; the function is SECURITY DEFINER).
grant select on public.memberships to supabase_auth_admin;
create policy memberships_auth_admin_read on public.memberships
  for select to supabase_auth_admin using (true);
