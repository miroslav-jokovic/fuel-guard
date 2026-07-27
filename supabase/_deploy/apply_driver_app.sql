-- ═══════════════════════════════════════════════════════════════════════════════
-- FuelGuard — Driver App deploy bundle (migrations 0083 + 0084)
--
-- Everything the Driver App needs in the database, in one runnable script. Paste into the Supabase
-- SQL editor (or psql) against the target project. Source of truth remains the individual migration
-- files — this bundle mirrors them exactly:
--     supabase/migrations/0083_driver_identity.sql
--     supabase/migrations/0084_driver_scoped_rls.sql
-- Plan: docs/plans/drivers-app/DRIVER-APP-PLAN.md §12 / §16 (D3, D9, D10, D14, SB1).
--
-- SAFE TO RE-RUN. Every statement is guarded (`if not exists` / `or replace` / `drop policy if
-- exists` before create), so applying twice is a no-op rather than an error.
--
-- ADDITIVE ONLY. No existing table, column, or policy is dropped or narrowed. The driver policies
-- are RESTRICTIVE (AND-combined): they constrain ONLY the 'driver' role and leave every existing
-- manager/admin PERMISSIVE policy untouched.
--
-- WHY RLS AND NOT JUST THE API: the driver app ships the anon key plus a driver JWT, so a driver can
-- call PostgREST directly. The database — not the API and not the UI — is the authorization
-- boundary (audit §21 / D10).
--
-- ── TWO OPS STEPS THIS SCRIPT CANNOT DO (dashboard settings, not SQL) ──────────
--   T1  Enable the Custom Access Token hook  →  Dashboard › Authentication › Hooks
--       (points at public.custom_access_token_hook). WITHOUT IT no org_id / user_role claims are
--       issued, auth_org_id() and auth_role() return null, and every driver sticks on "pending".
--   T9  Allow the app's deep link            →  Dashboard › Authentication › URL Configuration
--       Add redirect URL:  fuelguard://accept-invite
--       Without it GoTrue falls back to site_url and invite links open the web, not the app.
-- ═══════════════════════════════════════════════════════════════════════════════

begin;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 0083 — DRIVER IDENTITY
-- Links a login user to a roster driver so a signed-in driver resolves to exactly one drivers row,
-- and lets an auth user be deleted (offboarding) without an FK violation.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Which roster driver an invite provisions (required at the app layer when role = 'driver').
alter table invites add column if not exists driver_id uuid references drivers(id) on delete set null;

-- One login per driver, one driver per login, within an org — auth_driver_id() must be single-valued.
create unique index if not exists uq_drivers_org_user
  on drivers (org_id, user_id) where user_id is not null;

-- Offboarding: deleting an auth user must NULL the link, not fail. The original FK had no on-delete
-- action, which would block auth.admin.deleteUser once a driver is linked (audit §21 SB3 / D14).
alter table drivers drop constraint if exists drivers_user_id_fkey;
alter table drivers
  add constraint drivers_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 0084 — DRIVER-SCOPED RLS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Resolve the caller's driver row from the verified JWT `sub` claim.
-- SECURITY DEFINER so the internal read of drivers bypasses RLS — otherwise the drivers restrictive
-- policy below would recurse. `set search_path = ''` forces fully-qualified names (injection-safe).
create or replace function auth_driver_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id
  from public.drivers d
  where d.org_id = public.auth_org_id()
    and d.user_id = nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
  limit 1;
$$;

-- ── drivers: a driver sees only their own row ────────────────────────────────
drop policy if exists drivers_driver_scope on drivers;
create policy drivers_driver_scope on drivers as restrictive
  for select using (auth_role() <> 'driver' or id = auth_driver_id());

-- ── vehicles: a driver sees only vehicle(s) assigned to them ──────────────────
drop policy if exists vehicles_driver_scope on vehicles;
create policy vehicles_driver_scope on vehicles as restrictive
  for select using (auth_role() <> 'driver' or assigned_driver_id = auth_driver_id());

-- ── fuel_transactions: a driver reads only their own fills ────────────────────
drop policy if exists ftxn_driver_select on fuel_transactions;
create policy ftxn_driver_select on fuel_transactions as restrictive
  for select using (auth_role() <> 'driver' or driver_id = auth_driver_id());

-- ── fuel_transactions: a driver may insert ONLY their own fill, on an assigned
--    vehicle, with source 'manual' (closes attribution forgery — audit §21 SB1).
--    NOTE: D41 removed manual fuel capture from the driver app, so drivers no longer
--    insert fills at all. The policy is retained deliberately — it costs nothing and
--    keeps the DB defended if any client ever attempts a direct insert.
drop policy if exists ftxn_driver_insert on fuel_transactions;
create policy ftxn_driver_insert on fuel_transactions as restrictive
  for insert
  with check (
    auth_role() <> 'driver'
    or (
      driver_id = auth_driver_id()
      and source = 'manual'
      and exists (
        select 1 from public.vehicles v
        where v.id = fuel_transactions.vehicle_id
          and v.assigned_driver_id = auth_driver_id()
      )
    )
  );

-- ── driver_performance_weeks: a driver sees only their own settled week ────────
drop policy if exists dpw_driver_scope on driver_performance_weeks;
create policy dpw_driver_scope on driver_performance_weeks as restrictive
  for select using (auth_role() <> 'driver' or driver_id = auth_driver_id());

-- ── surfaces a driver has no business reading: deny the driver role outright ──
drop policy if exists anomalies_driver_deny on anomalies;
create policy anomalies_driver_deny on anomalies as restrictive
  for select using (auth_role() <> 'driver');

drop policy if exists memberships_driver_deny on memberships;
create policy memberships_driver_deny on memberships as restrictive
  for select using (auth_role() <> 'driver');

drop policy if exists thresholds_driver_deny on anomaly_thresholds;
create policy thresholds_driver_deny on anomaly_thresholds as restrictive
  for select using (auth_role() <> 'driver');

commit;


-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION — run after applying. Each block should return the row(s) noted.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1) Schema: expect invites.driver_id, the partial unique index, and the FK set to SET NULL.
select
  (select count(*) from information_schema.columns
     where table_name = 'invites' and column_name = 'driver_id')                     as invites_driver_id,
  (select count(*) from pg_indexes
     where indexname = 'uq_drivers_org_user')                                        as uq_drivers_org_user,
  (select confdeltype from pg_constraint
     where conname = 'drivers_user_id_fkey')                                         as fk_on_delete;  -- expect 'n' (SET NULL)

-- 2) Helper function exists and is SECURITY DEFINER (prosecdef = true).
select proname, prosecdef
from pg_proc
where proname = 'auth_driver_id';

-- 3) All eight driver policies present and RESTRICTIVE (permissive = 'RESTRICTIVE').
select tablename, policyname, permissive, cmd
from pg_policies
where policyname in (
  'drivers_driver_scope', 'vehicles_driver_scope', 'ftxn_driver_select', 'ftxn_driver_insert',
  'dpw_driver_scope', 'anomalies_driver_deny', 'memberships_driver_deny', 'thresholds_driver_deny'
)
order by tablename, policyname;

-- 4) Sanity: no driver is double-linked (the unique index guarantees it; this proves the data).
select org_id, user_id, count(*)
from drivers
where user_id is not null
group by org_id, user_id
having count(*) > 1;   -- expect zero rows

-- Behavioural proof (allow + raw-PostgREST deny cases for every policy above) lives in the offline
-- matrix: `node supabase/tests/rls.test.mjs` — 50/50 green as of Phase 1.
