-- 0083: driver RLS matrix — the SELECT half.
--
-- Background (plan §21 SB1, decision D9). The manager PERMISSIVE policies on the core tables read
-- `org_id = auth_org_id()`, which is correct for admins/fleet_managers/dispatchers/auditors — they
-- see the whole org. When the driver app arrives, that predicate becomes a leak: a driver at the
-- customer's phone would see every driver's fuel, every truck's telematics, every peer's anomaly.
--
-- The fix is a RESTRICTIVE policy per table, AND-combined with the existing PERMISSIVE, that
-- narrows the read to the driver's OWN rows when `auth_role() = 'driver'` and is transparent
-- otherwise. Keeping the manager policies untouched is deliberate: it means this migration cannot
-- regress a currently-working manager surface, only tighten a role that today has no read at all.
--
-- ── safety net: auth_user_id() ───────────────────────────────────────────────
-- 0089 is the migration that introduces this helper, but every policy below already needs it.
-- Defining it here as CREATE OR REPLACE keeps the file order self-consistent: 0089 will overwrite
-- with an identical body if it runs later, and a from-scratch replay of migrations doesn't fail on
-- an unknown function. The body matches 0089 verbatim.
create or replace function auth_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;

-- ── the driver-id helper every driver policy reads ────────────────────────────
-- SECURITY DEFINER because a driver's own predicate needs to look up a row in `drivers` — and the
-- driver's own SELECT policy will call this function, which would recurse without the definer.
-- STABLE so the planner caches it inside a single statement. `set search_path = ''` guards against
-- a search-path attack the way every other definer function in this codebase does.
create or replace function auth_driver_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id
    from public.drivers d
   where d.user_id = public.auth_user_id()
     and d.org_id  = public.auth_org_id()
     and d.status  = 'active'
   limit 1;
$$;

comment on function auth_driver_id() is
  'The driver row bound to the calling login, or NULL if the caller is not a driver in this org.
   Read by every driver-scoped RESTRICTIVE policy (0083–0087).';

-- ── drivers ───────────────────────────────────────────────────────────────────
-- A driver may only see their OWN row. Anyone else (admin/fleet_manager/dispatcher/auditor) is not
-- gated by this policy — RESTRICTIVE returns true for them and the existing PERMISSIVE decides.
drop policy if exists drivers_driver_scope on drivers;
create policy drivers_driver_scope on drivers
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or id = auth_driver_id()
  );

-- ── vehicles ──────────────────────────────────────────────────────────────────
-- A driver sees vehicles currently pinned to them by the domicile default OR — anticipating 0086 —
-- currently active in one of their open duty segments. The 0086 side is added by that migration;
-- until then this policy covers the domicile pin, which is the only driver↔vehicle link that
-- exists at the point 0083 lands.
drop policy if exists vehicles_driver_scope on vehicles;
create policy vehicles_driver_scope on vehicles
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or assigned_driver_id = auth_driver_id()
  );

-- ── fuel_transactions ─────────────────────────────────────────────────────────
-- A driver sees only their own fills. The join is on driver_id (present since 0003).
drop policy if exists fuel_tx_driver_scope on fuel_transactions;
create policy fuel_tx_driver_scope on fuel_transactions
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or driver_id = auth_driver_id()
  );

-- ── driver_performance_weeks ──────────────────────────────────────────────────
-- A driver sees only their own week snapshots — never a peer's score.
drop policy if exists dpw_driver_scope on driver_performance_weeks;
create policy dpw_driver_scope on driver_performance_weeks
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or driver_id = auth_driver_id()
  );

-- ── anomalies ─────────────────────────────────────────────────────────────────
-- A driver sees only anomalies raised on their own fills. There is no driver_id column on this
-- table — the link goes through the anomaly's parent transaction. The RESTRICTIVE lets non-driver
-- roles through unchanged so every manager report keeps working.
drop policy if exists anomalies_driver_scope on anomalies;
create policy anomalies_driver_scope on anomalies
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or exists (
      select 1 from fuel_transactions ft
       where ft.id = anomalies.transaction_id
         and ft.driver_id = auth_driver_id()
    )
  );

-- ── memberships ───────────────────────────────────────────────────────────────
-- A driver sees only their OWN membership row (the one that says they are a driver in this org).
-- Every manager surface that lists teammates keeps working via the PERMISSIVE policy.
drop policy if exists memberships_driver_scope on memberships;
create policy memberships_driver_scope on memberships
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or user_id = auth_user_id()
  );

-- ── anomaly_thresholds ────────────────────────────────────────────────────────
-- A driver never needs to see thresholds — but until we prove out a per-driver view, tightening to
-- 'no rows for drivers' is simplest and matches D9 ("SELECT covered").
drop policy if exists anomaly_thresholds_driver_scope on anomaly_thresholds;
create policy anomaly_thresholds_driver_scope on anomaly_thresholds
  as restrictive for select
  using (
    auth_role() <> 'driver'
  );

-- ── audit / self-check ────────────────────────────────────────────────────────
-- The RLS matrix in the API test suite exercises the real predicates rather than these comments —
-- but the comment is here as a compact contract for the next reader.
--
--   role=driver      → SELECT returns only rows tied to auth_driver_id()
--   role in (admin,fleet_manager,dispatcher,auditor,safety_manager)
--                    → RESTRICTIVE is a no-op; existing PERMISSIVE decides (org-wide read).
