-- FuelGuard — 0073 support_impersonation_grants (audited "view as customer")
-- docs/plans/ADMIN-DASHBOARD.md §6. Support access to a customer's data is never a silent backdoor:
-- it is an explicit, time-boxed, reason-required, revocable grant. Phase 1 is READ-ONLY. Service-role
-- only (RLS enabled, no client policies) — reachable exclusively by admin-api. Starting a grant is also
-- mirrored into the customer's own audit_logs (actor = the platform admin) so it is transparent to them.

create table if not exists support_impersonation_grants (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  admin_id   uuid not null references platform_admins(id) on delete cascade,
  scope      text not null default 'read_only' check (scope in ('read_only', 'read_write')),
  reason     text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
-- Fast "is there an ACTIVE grant for this admin+org" lookup (the gate on every view-as read).
create index if not exists idx_sig_active
  on support_impersonation_grants (admin_id, org_id, expires_at desc)
  where revoked_at is null;

alter table support_impersonation_grants enable row level security;
-- No client policies → service-role only (admin-api).
