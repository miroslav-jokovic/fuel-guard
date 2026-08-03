-- FuelGuard — 0101 compliance index + documents (Master Data & Identity, M1 · plan §2.5)
--
-- TWO TABLES WITH OPPOSITE OWNERSHIP, which is the whole design:
--
--   compliance_items   a DERIVED ALERT INDEX. Nobody edits it — not admins, not the API. The
--                      nightly `compliance_scan` job (M5) recomputes it from the TYPED EXPIRY
--                      COLUMNS on drivers/vehicles/trailers (cdl_expires_at, medical_card_expires_at,
--                      registration_expires_at, insurance_expires_at, dot_annual_inspection_expires_at,
--                      driver_endorsements.expires_at). Admins fix an expiry by editing the source
--                      column; the index catches up on the next scan. Storing status here rather than
--                      computing it per query is what makes "show me everything expiring" one indexed
--                      read instead of a fleet-wide scan across five tables.
--                      → hence NO user write policy: RLS denies writes by default and only the
--                        service-role job (which bypasses RLS) upserts.
--
--   master_documents   the opposite: purely admin-owned. A pointer into Storage for the scanned
--                      CDL / medical card / registration / insurance / inspection certificate.
--
-- Lead time is a fixed global 30 days in v1 (decision #7) — it lives in the job, not the schema, so
-- making it per-item later is a column here plus a read there, with no data migration.

create table if not exists compliance_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  /** Polymorphic by design — one dashboard query spans people and equipment. No FK; the scan job
      deletes rows whose entity disappeared. */
  entity_type text not null,
  entity_id   uuid not null,
  item_type   text not null,
  /** Mirrored from the source column so the dashboard never joins back to five tables. */
  expires_at  date,
  status      text not null default 'unknown',
  computed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, entity_type, entity_id, item_type),
  constraint compliance_items_entity_type_check check (entity_type in ('driver', 'tractor', 'trailer')),
  constraint compliance_items_item_type_check check (item_type in (
    'cdl', 'medical', 'hazmat_training', 'mvr', 'drug_test',
    'clearinghouse', 'registration', 'insurance', 'dot_inspection', 'ifta'
  )),
  constraint compliance_items_status_check check (status in (
    'valid', 'expiring_soon', 'expired', 'missing', 'unknown'
  ))
);

create index if not exists idx_compliance_org_status on compliance_items(org_id, status);
create index if not exists idx_compliance_entity on compliance_items(org_id, entity_type, entity_id);

alter table compliance_items enable row level security;

drop policy if exists compliance_select on compliance_items;
create policy compliance_select on compliance_items
  for select using (org_id = auth_org_id());

-- NO write policy, on purpose. RLS denies by default, so the only writer is the service-role
-- nightly job. An admin who wants to change a status changes the expiry column it derives from.

drop trigger if exists trg_compliance_items_updated on compliance_items;
create trigger trg_compliance_items_updated before update on compliance_items
  for each row execute function set_updated_at();

create table if not exists master_documents (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  entity_type  text not null,
  entity_id    uuid not null,
  doc_type     text not null,
  /** Supabase Storage object path. The bytes never live in Postgres. */
  storage_path text not null,
  expires_at   date,
  uploaded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint master_documents_entity_type_check check (entity_type in ('driver', 'tractor', 'trailer')),
  constraint master_documents_doc_type_check check (doc_type in (
    'cdl', 'medical', 'registration', 'insurance', 'inspection', 'other'
  ))
);

create index if not exists idx_master_documents_entity on master_documents(org_id, entity_type, entity_id);

alter table master_documents enable row level security;

drop policy if exists master_documents_select on master_documents;
create policy master_documents_select on master_documents
  for select using (org_id = auth_org_id());

drop policy if exists master_documents_write on master_documents;
create policy master_documents_write on master_documents
  for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'safety_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'safety_manager'));

-- A driver may see their OWN documents (M6 profile screen) and nothing else. RESTRICTIVE, so it
-- AND-combines with the org-wide SELECT and is transparent to every non-driver role (0083 pattern).
drop policy if exists master_documents_driver_scope on master_documents;
create policy master_documents_driver_scope on master_documents
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or (entity_type = 'driver' and entity_id = auth_driver_id())
  );

drop policy if exists compliance_driver_scope on compliance_items;
create policy compliance_driver_scope on compliance_items
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or (entity_type = 'driver' and entity_id = auth_driver_id())
  );

comment on table compliance_items is
  'DERIVED alert index over the typed expiry columns — rebuilt by the compliance_scan job (plan §5).
   Never edited by hand: fix the source column, not this row.';
