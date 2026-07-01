-- FuelGuard — 0004 Row Level Security
-- docs/02-DATA-MODEL.md §5 (+ §10). RLS is MANDATORY: every table is enabled with policies.
-- The Supabase service_role key has BYPASSRLS and is used only by the API for engine/audit/import
-- writes AFTER its own auth+ownership checks (audit B5). Policies below govern normal user JWTs.

-- ── organizations ────────────────────────────────────────────────────────────
alter table organizations enable row level security;

create policy organizations_select on organizations
  for select using (id = auth_org_id());

create policy organizations_update on organizations
  for update using (id = auth_org_id() and auth_role() = 'admin')
  with check (id = auth_org_id() and auth_role() = 'admin');

-- ── memberships ──────────────────────────────────────────────────────────────
alter table memberships enable row level security;

create policy memberships_select on memberships
  for select using (org_id = auth_org_id());

create policy memberships_write on memberships
  for all
  using (org_id = auth_org_id() and auth_role() = 'admin')
  with check (org_id = auth_org_id() and auth_role() = 'admin');

-- ── invites ──────────────────────────────────────────────────────────────────
alter table invites enable row level security;

create policy invites_admin_all on invites
  for all
  using (org_id = auth_org_id() and auth_role() = 'admin')
  with check (org_id = auth_org_id() and auth_role() = 'admin');

-- ── drivers ──────────────────────────────────────────────────────────────────
alter table drivers enable row level security;

create policy drivers_select on drivers
  for select using (org_id = auth_org_id());

create policy drivers_write on drivers
  for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));

-- ── vehicles ─────────────────────────────────────────────────────────────────
alter table vehicles enable row level security;

create policy vehicles_select on vehicles
  for select using (org_id = auth_org_id());

create policy vehicles_write on vehicles
  for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));

-- ── fuel_transactions ────────────────────────────────────────────────────────
alter table fuel_transactions enable row level security;

create policy ftxn_select on fuel_transactions
  for select using (org_id = auth_org_id());

-- Drivers may log fill-ups; managers/admins too.
create policy ftxn_insert on fuel_transactions
  for insert
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'driver'));

-- Edits/deletes are manager/admin only.
create policy ftxn_update on fuel_transactions
  for update
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));

create policy ftxn_delete on fuel_transactions
  for delete
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));

-- ── anomalies ────────────────────────────────────────────────────────────────
-- Engine inserts/deletes via service role (bypasses RLS). Users read; managers triage (update).
alter table anomalies enable row level security;

create policy anomalies_select on anomalies
  for select using (org_id = auth_org_id());

create policy anomalies_update on anomalies
  for update
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));

-- ── anomaly_thresholds ───────────────────────────────────────────────────────
alter table anomaly_thresholds enable row level security;

create policy thresholds_select on anomaly_thresholds
  for select using (org_id = auth_org_id());

create policy thresholds_write on anomaly_thresholds
  for all
  using (org_id = auth_org_id() and auth_role() = 'admin')
  with check (org_id = auth_org_id() and auth_role() = 'admin');

-- ── audit_logs ───────────────────────────────────────────────────────────────
-- Read by admin + auditor; no client writes (service role only).
alter table audit_logs enable row level security;

create policy audit_select on audit_logs
  for select using (org_id = auth_org_id() and auth_role() in ('admin', 'auditor'));
