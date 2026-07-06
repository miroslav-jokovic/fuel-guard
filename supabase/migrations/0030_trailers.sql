-- 0030: trailers (reefer) reference table. Trailers are unpowered assets Samsara tracks separately from
-- powered vehicles, so the vehicle sync never sees them. Reefer flag + tank capacity live HERE (Samsara
-- doesn't classify reefers). assigned_vehicle_id is the current tractor pairing (Samsara or manual).
create table if not exists trailers (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references organizations(id) on delete cascade,
  unit_number              text not null,
  make                     text,
  model                    text,
  year                     int,
  plate                    text,
  reefer_tank_capacity_gal numeric(7,2) not null default 50,
  status                   text not null default 'active',           -- active | maintenance | retired
  assigned_vehicle_id      uuid references vehicles(id) on delete set null,
  samsara_asset_id         text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create unique index if not exists idx_trailers_org_unit on trailers (org_id, unit_number);
create index  if not exists idx_trailers_org_status on trailers (org_id, status);

-- RLS: members read; managers (admin / fleet_manager) write. Mirrors the vehicles policies.
alter table trailers enable row level security;
drop policy if exists trailers_select on trailers;
create policy trailers_select on trailers for select using (org_id = auth_org_id());
drop policy if exists trailers_write on trailers;
create policy trailers_write on trailers for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));
