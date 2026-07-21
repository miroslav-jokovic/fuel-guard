-- FuelGuard — 0071 platform_audit_log (immutable control-plane audit trail)
-- docs/plans/ADMIN-DASHBOARD.md §4, §7.7, §9.
--
-- Append-only record of EVERY platform action (who, what org/entity, why, before/after, from where). This
-- is the accountability spine of the admin plane. Service-role only; UPDATE/DELETE/TRUNCATE are blocked at
-- the database level so history cannot be rewritten even by the table owner. Platform-wide actions that
-- have no single target org live here (tenant audit_logs.org_id is NOT NULL); org-scoped platform actions
-- are ALSO mirrored into that org's audit_logs by admin-api for customer-facing transparency.

create table if not exists platform_audit_log (
  id            uuid primary key default gen_random_uuid(),
  admin_id      uuid references platform_admins(id) on delete set null,
  admin_email   citext not null,                -- denormalized so the trail survives admin-row deletion
  action        text not null,                  -- e.g. 'org.suspend', 'billing.comp', 'impersonation.start'
  target_org_id uuid references organizations(id) on delete set null,
  target_entity text,                           -- table / entity name, when applicable
  target_id     uuid,
  reason        text,
  before        jsonb,
  after         jsonb,
  ip            inet,
  user_agent    text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_platform_audit_time  on platform_audit_log (created_at desc);
create index if not exists idx_platform_audit_admin on platform_audit_log (admin_id, created_at desc);
create index if not exists idx_platform_audit_org   on platform_audit_log (target_org_id, created_at desc);

alter table platform_audit_log enable row level security;
-- No client policies → service-role only. admin-api only ever INSERTs.

-- Structural immutability: fail loudly on any attempt to change or remove history (fires for service-role
-- and table owner alike; RLS alone would not stop the owner).
create or replace function platform_audit_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'platform_audit_log is append-only (no update/delete/truncate)';
end;
$$;
create trigger trg_platform_audit_no_mutate
  before update or delete on platform_audit_log
  for each row execute function platform_audit_immutable();
create trigger trg_platform_audit_no_truncate
  before truncate on platform_audit_log
  for each statement execute function platform_audit_immutable();
