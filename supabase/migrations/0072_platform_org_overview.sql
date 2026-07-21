-- FuelGuard — 0072 platform_org_overview (control-plane read aggregate)
-- docs/plans/ADMIN-DASHBOARD.md §7.1. Powers the admin dashboard's cross-tenant customer list/detail.
--
-- SECURITY DEFINER so it aggregates across ALL orgs (owned by the migration role, which bypasses RLS);
-- EXECUTE is granted ONLY to service_role, so it is reachable exclusively by the admin-api service. It
-- never mutates and returns metadata + counts only. p_org_id filters to one org (detail view); null = all.

create or replace function platform_org_overview(p_org_id uuid default null)
returns table (
  org_id               uuid,
  name                 text,
  created_at           timestamptz,
  member_count         bigint,
  vehicle_count        bigint,
  active_vehicle_count bigint,
  driver_count         bigint,
  open_anomaly_count   bigint,
  last_txn_at          timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    o.id,
    o.name,
    o.created_at,
    (select count(*) from memberships m where m.org_id = o.id),
    (select count(*) from vehicles v where v.org_id = o.id),
    (select count(*) from vehicles v where v.org_id = o.id and v.status = 'active'),
    (select count(*) from drivers d where d.org_id = o.id),
    (select count(*) from anomalies a where a.org_id = o.id and a.status = 'open'),
    (select max(ft.fueled_at) from fuel_transactions ft where ft.org_id = o.id)
  from organizations o
  where p_org_id is null or o.id = p_org_id
  order by o.name;
$$;

-- Lock it down: only the service role (admin-api) may execute it. Never authenticated/anon/public.
revoke all on function platform_org_overview(uuid) from public, anon, authenticated;
grant execute on function platform_org_overview(uuid) to service_role;
