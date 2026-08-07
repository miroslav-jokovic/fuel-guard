-- FuelGuard — 0140 expose the applied migration version to the API
--
-- WHY THIS EXISTS. On 2026-08-07 an hour was spent answering "why don't I see my changes?" by hand:
-- checking git, probing route shapes over HTTPS to infer which build Railway was running, and
-- guessing at whether `supabase db push` had ever run. Nothing in this system could state its own
-- version. This function is the database half of the fix — `GET /api/version` reads it and compares
-- it against the highest migration file in the repo, so drift between code and schema is a fact you
-- can read, not a theory you test by clicking around the driver app.
--
-- SECURITY. `supabase_migrations` is not in PostgREST's exposed schemas and must stay that way, so
-- this is SECURITY DEFINER with a pinned search_path and EXECUTE granted to `service_role` alone —
-- the API's own client. `anon` and `authenticated` are explicitly revoked: the deployment's schema
-- version is operational metadata for our API, not something a signed-in driver's token can query
-- directly. The API decides what to publish (see routes/version.ts), and it publishes only the
-- version string.
--
-- The function returns NULL rather than raising when the ledger is unreadable, because a version
-- endpoint that 500s is useless exactly when it is needed. The API renders NULL as "unknown", which
-- is itself a drift signal.

create or replace function public.applied_schema_version()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select max(version)::text from supabase_migrations.schema_migrations;
$$;

comment on function public.applied_schema_version() is
  'Highest migration version recorded in the Supabase ledger. Read by GET /api/version to detect code/schema drift. service_role only (0140).';

revoke all on function public.applied_schema_version() from public;
revoke all on function public.applied_schema_version() from anon;
revoke all on function public.applied_schema_version() from authenticated;
grant execute on function public.applied_schema_version() to service_role;
