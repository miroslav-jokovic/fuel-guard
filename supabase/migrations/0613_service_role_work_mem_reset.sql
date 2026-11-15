-- 0613: `service_role` goes back to the platform's default work_mem, because 0610's role setting took
-- every API read in production down for 30 minutes (outage 2026-11-15, 17:40–18:10Z, release
-- v2026.11.15 / run 43741878376).
--
-- ── WHAT HAPPENED ─────────────────────────────────────────────────────────────────────────────────
-- 0610 ran `alter role service_role set work_mem = '16MB'`. PostgREST applies an impersonated role's
-- settings at the start of every transaction, and production's PostgREST (14.5) hands the value to
-- set_config LOWERCASED: every service-role request failed with
--   invalid value for parameter "work_mem": "16mb"
-- (CloudWatch /silvicom/production: 285+ in 25 minutes — odometer, FMCSA, Med-Stop, TMS ingest, the
-- scheduler leases). Postgres memory units are case-sensitive; `mb` is not one. Both scheduler leases
-- stopped renewing when the release applied 0610, BEFORE the new code deployed, so the code was
-- innocent and a code rollback would not have helped.
--
-- Staging carried 0610 from its merge with ZERO such errors (CloudWatch /silvicom/staging, 2 h): its
-- PostgREST passes the value through. So staging cannot prove a PostgREST-applied role setting —
-- the two projects do not run the same PostgREST build.
--
-- ── THE FIX ───────────────────────────────────────────────────────────────────────────────────────
-- Production was repaired by hand at 18:09Z with exactly the statements below (owner-run, `supabase db
-- query --linked`); this file makes the migrations say the same, so a fresh database and staging do
-- not keep a setting production no longer has. On production it is a no-op.
--
-- What it gives up: 0610's reason for the setting — two paged idle reads sorting on disk (364 GB of
-- temp files in 41 days) — is back. 0610's index on idle_park_sessions stays and removes one of the
-- two sorts on its own. Restoring the larger sort memory is an open question, not this file: a
-- unitless value ('16384', kB) has no case to lose, but it must be proven against production's
-- PostgREST build, not staging's.
--
-- 0610's `authenticator` settings (idle_in_transaction_session_timeout = 60s, track_io_timing = on)
-- are untouched: they are session settings of the login role, which PostgREST does not re-apply per
-- transaction, and production ran clean on them after the reset.

alter role service_role reset work_mem;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
