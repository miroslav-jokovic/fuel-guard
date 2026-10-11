-- 0412 — a function created from now on is NOT callable by `anon` or `authenticated` unless a migration
-- grants it (security audit 2026-10-02, finding 2; 0411 closed the two functions that had already leaked).
--
-- ── THE GAP ─────────────────────────────────────────────────────────────────────────────────────
-- 0411 existed because two migrations wrote `revoke … from public; grant … to service_role` and it did
-- nothing: on Supabase every new function in `public` is born executable by `anon` and `authenticated`
-- (an explicit default ACL for `postgres` in `public`, `pg_default_acl`, read 2026-10-02) AND by
-- PUBLIC (PostgreSQL's built-in function default, `=X/postgres` in `proacl` — 131 production functions
-- carry it). PostgREST exposes the whole `public` schema at /rest/v1/rpc/, so "born executable" is
-- "born callable by anyone holding the anon key". 144 of 241 functions are today; 39 are SECURITY
-- DEFINER. This migration changes the BIRTH state so the next one needs no review to be safe.
--
-- ── WHAT THE OFFICIAL RECIPE GETS WRONG, MEASURED ───────────────────────────────────────────────
-- Supabase's "Securing your API" page gives a schema-scoped
-- `alter default privileges for role postgres in schema public revoke execute on functions from public`.
-- On PostgreSQL that statement is a no-op for PUBLIC: the built-in default is not stored per schema, so
-- there is nothing in `public` to subtract it from. Tested 2026-10-02 on PGlite (real Postgres) with
-- production's starting ACLs: with the documented statements a new function came out `acl = null`
-- (the built-in default, PUBLIC included) and `has_function_privilege('anon', …)` was still true. Only
-- the GLOBAL form removes it. This is the same silent failure as 0411's — a revoke that matches
-- nothing — so the migration's matrix creates a function afterwards and asks the catalog.
--
-- ── WHAT IT DOES ────────────────────────────────────────────────────────────────────────────────
--   1. GLOBAL `revoke execute on functions from public` for role postgres — the only form that works.
--   2. `in schema public` revoke from `anon, authenticated` — the platform's explicit grants.
--   3. Restores PUBLIC execute in `extensions` and `partman`, because (1) is not schema-scoped and
--      would otherwise silently break the next `create extension` run by postgres: `postgres` owns 49
--      functions in `extensions` and 42 in `partman` today, all PUBLIC-executable, and migrations do
--      create extensions. Those schemas are not exposed through PostgREST (config.toml `schemas`).
--      Guarded by a catalog check, because `alter default privileges in schema X` errors when X does
--      not exist and the PGlite matrices have neither schema.
--
-- ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────────────────────────
-- · It does NOT touch any existing function. Default privileges apply at CREATE time only. The 4 RLS
--   helpers must stay executable (policies call them as the requesting role), and the 35 invoker
--   functions anon can still run — including the eight the browser calls through `supabase.rpc`
--   (`fuel_range_totals`, …) — need an RLS-as-anon review before they are revoked. Recorded as the
--   next step, not guessed at here.
-- · It does NOT revoke `service_role`. Supabase's recipe does. The service-role key already bypasses
--   RLS and can read or write every table, so withholding EXECUTE protects nothing, while a forgotten
--   `grant … to service_role` would surface only as a production 500 — the API's tests stub Supabase.
--   Least privilege that buys no protection and costs an outage is not an improvement.
-- · It does NOT cover other creating roles. Default privileges belong to the role that runs
--   CREATE FUNCTION: `postgres` for migrations (210 of 241 functions) and the SQL editor.
--   `supabase_admin` (31 pg_trgm functions, platform-installed) is out of reach — postgres is not a
--   member of it — and nothing in this repository creates objects as it.
--
-- ── WHAT CHANGES FOR WHOEVER WRITES THE NEXT FUNCTION ───────────────────────────────────────────
-- A new function is callable by postgres and service_role only. One an RLS policy calls, or one the
-- browser calls through `supabase.rpc`, now needs an explicit
-- `grant execute on function … to authenticated;` in the same migration. Forgetting it fails LOUDLY
-- (`permission denied for function`) instead of leaving a hole — the safe direction. Written into
-- supabase/CLAUDE.md. `supabase/tests/definer-rpc-grants.test.mjs` fails CI on a client-executable
-- SECURITY DEFINER function that is not an RLS helper.
--
-- ── DEPLOY WINDOW (docs/MIGRATION-DISCIPLINE.md §the-deploy-window) ─────────────────────────────
-- Order-independent: no existing function, table or column changes, so code served ahead of or behind
-- this migration behaves identically. The one thing that can differ is a migration merged AFTER this
-- one that creates a function and forgets a grant — it fails in CI's matrices or on its first call,
-- which is the point.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────────
-- `alter default privileges for role postgres grant execute on functions to public;` and
-- `… in schema public grant execute on functions to anon, authenticated;` restore the old birth state.
--
-- ── VERIFY AFTER IT APPLIES ─────────────────────────────────────────────────────────────────────
--   select defaclnamespace::regnamespace::text ns, defaclacl::text from pg_default_acl
--    where defaclrole = 'postgres'::regrole and defaclobjtype = 'f' order by 1;
--   -- expect: the global row (ns "-") = {postgres=X/postgres}; public = {postgres, service_role};
--   -- extensions and partman = {postgres, =X (PUBLIC)}. Then, in a rolled-back transaction, create a
--   -- function in public and read has_function_privilege('anon', …): expect false.

alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

do $$
declare
  s text;
begin
  foreach s in array array['extensions', 'partman'] loop
    if exists (select 1 from pg_namespace where nspname = s) then
      execute format('alter default privileges for role postgres in schema %I grant execute on functions to public', s);
    end if;
  end loop;
end
$$;
