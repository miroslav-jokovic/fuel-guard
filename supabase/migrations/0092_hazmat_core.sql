-- 0092: HazmatGuard core schema (plan H4). Loads, documents, analysis runs, reviews, cargo-tank
-- profiles and per-org policy — plus the RLS matrix that IS the access spec (mirrors the table in
-- docs/18-HAZMATGUARD-PLAN.md §H4 and the section-capability model in packages/shared/src/auth.ts).
--
-- Enforcement model (D10): RLS is the boundary. The six roles are admin, fleet_manager, driver,
-- auditor, dispatcher, safety_manager (0077). Helpers reused: auth_org_id(), auth_role(),
-- auth_user_id() (0083), auth_driver_id() (0083). Service role bypasses RLS (the analysis writer +
-- signed-URL server + retention job run as service role).
--
-- Immutability (G6): hazmat_runs and hazmat_reviews have NO update/delete policy at all — corrections
-- create NEW runs/reviews, never edits. hazmat_documents are insert-only evidence. The load state
-- machine + cleared-load immutability are enforced in the API layer (H4-3) on top of these tables.
--
-- Everything is org-scoped and RLS-enabled from day one. Client-generated UUIDs where the app replays
-- idempotently (loads, documents — 02 §10.2); server-generated for append-only rows (runs, reviews).

-- ── enums (locked value sets; state machine is fixed per the plan) ─────────────
create type hazmat_load_status as enum
  ('draft', 'submitted', 'extracting', 'needs_review', 'cleared', 'rejected', 'superseded', 'cancelled');
create type hazmat_doc_kind as enum ('bol', 'securement', 'placard_photo', 'special_permit', 'other');

-- ═══════════════════════════════════════════════════════════════════════════════
-- hazmat_policies — per-org OrgHazmatPolicy (H8 fills usage; created here so the loads driver-insert
-- policy below can read `driversMayCreateLoads`). Admin-only writes.
-- ═══════════════════════════════════════════════════════════════════════════════
create table hazmat_policies (
  org_id      uuid primary key references organizations(id) on delete cascade,
  policy      jsonb not null,                         -- OrgHazmatPolicy, Zod-validated at the API boundary
  updated_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- hazmat_loads
-- ═══════════════════════════════════════════════════════════════════════════════
create table hazmat_loads (
  id                     uuid primary key,            -- client-generated (idempotency, 02 §10.2)
  org_id                 uuid not null references organizations(id) on delete cascade,
  vehicle_id             uuid references vehicles(id) on delete restrict,
  trailer_id             uuid references trailers(id) on delete restrict,   -- 0030, PK = id
  driver_id              uuid references drivers(id)  on delete restrict,
  status                 hazmat_load_status not null default 'draft',
  tank_state             text not null default 'loaded'
                           check (tank_state in ('loaded', 'residue_uncleaned', 'cleaned_and_purged')),
  carrier_relationship   text not null default 'unknown'
                           check (carrier_relationship in
                             ('carrier_supplied_cargo_tank', 'shipper_supplied_common_carrier', 'private_carrier', 'unknown')),
  planned_pickup_at      timestamptz,
  declared_lines         jsonb not null default '[]', -- LoadInput.lines (manual path); immutable once cleared (API)
  bol_fields             jsonb,                       -- BolFields used for the verdict (extraction or manual)
  special_permit_numbers text[] not null default '{}',
  claimed_no_placards    boolean not null default false,   -- feeds engine claimedExceptions
  supersedes_load_id     uuid references hazmat_loads(id),
  version                int not null default 1,
  created_by             uuid references auth.users(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index idx_hazmat_loads_org_status  on hazmat_loads (org_id, status, created_at desc);
create index idx_hazmat_loads_org_creator on hazmat_loads (org_id, created_by);
create unique index idx_hazmat_loads_supersedes on hazmat_loads (supersedes_load_id)
  where supersedes_load_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════════
-- hazmat_documents — captured evidence (insert-only)
-- ═══════════════════════════════════════════════════════════════════════════════
create table hazmat_documents (
  id           uuid primary key,                       -- client UUID (idempotent replay)
  org_id       uuid not null references organizations(id) on delete cascade,
  load_id      uuid not null references hazmat_loads(id) on delete cascade,
  kind         hazmat_doc_kind not null,
  page         int not null default 1,
  storage_path text not null,                           -- bucket 'hazmat', key org_id/load_id/{doc}.webp
  sha256       text not null,                           -- integrity + extraction cache key component
  captured_at  timestamptz,
  uploaded_by  uuid references auth.users(id),
  quality      jsonb,                                   -- usability-gate result {usable, blurScore, ...}
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_hazmat_documents_load on hazmat_documents (org_id, load_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- hazmat_runs — one row per analysis run (IMMUTABLE; service-role writes only)
-- ═══════════════════════════════════════════════════════════════════════════════
create table hazmat_runs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  load_id         uuid not null references hazmat_loads(id) on delete cascade,
  engine_version  text not null,
  dataset_version text not null,
  extraction      jsonb,                                -- both passes + agreement + per-field confidence + bboxes
  verdict         jsonb not null,                       -- full engine Verdict incl. trace
  outcome         text not null check (outcome in ('green', 'flagged')),
  flags           jsonb not null default '[]',          -- blocking flags (drive needs_review)
  advisories      jsonb not null default '[]',          -- non-blocking (H9 photo checks); never affect status
  models          jsonb,                                -- {passA:{model,tokens},...}; null for manual runs
  input_hash      text not null,                        -- CACHE KEY ONLY (no unique constraint)
  created_at      timestamptz not null default now()
);
create index idx_hazmat_runs_org_input on hazmat_runs (org_id, input_hash);   -- duplicates allowed
create index idx_hazmat_runs_load      on hazmat_runs (org_id, load_id, created_at desc);

-- ═══════════════════════════════════════════════════════════════════════════════
-- hazmat_reviews — reviewer actions (IMMUTABLE; append-only)
-- ═══════════════════════════════════════════════════════════════════════════════
create table hazmat_reviews (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  load_id      uuid not null references hazmat_loads(id) on delete cascade,
  run_id       uuid not null references hazmat_runs(id),
  reviewer_id  uuid not null references auth.users(id),
  action       text not null check (action in
                 ('field_confirmed', 'field_corrected', 'cleared', 'rejected', 'override', 'cant_read')),
  field_path   text,
  old_value    jsonb,
  new_value    jsonb,
  attestation  text,                                    -- exact attestation string shown + accepted (D8)
  created_at   timestamptz not null default now()
);
create index idx_hazmat_reviews_load on hazmat_reviews (org_id, load_id, created_at desc);

-- ═══════════════════════════════════════════════════════════════════════════════
-- hazmat_cargo_tank_profiles — the producer for H2's vehicle block.
-- NOTE: vehicles.tank_capacity_gal / trailers.reefer_tank_capacity_gal are FUEL tanks — never cargo.
-- ═══════════════════════════════════════════════════════════════════════════════
create table hazmat_cargo_tank_profiles (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  trailer_id         uuid references trailers(id) on delete restrict,
  vehicle_id         uuid references vehicles(id),      -- straight trucks / bobtails; exactly one of the two
  cargo_capacity_gal numeric(8,1),                      -- null = unknown → engine conservative path (H2)
  compartments       jsonb not null default '[]',       -- [{index, capacityGal}]
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (num_nonnulls(trailer_id, vehicle_id) = 1)
);
create index idx_hazmat_ctp_org on hazmat_cargo_tank_profiles (org_id);

-- ── updated_at triggers (append-only tables have none) ────────────────────────
create trigger trg_hazmat_loads_updated    before update on hazmat_loads              for each row execute function set_updated_at();
create trigger trg_hazmat_documents_updated before update on hazmat_documents         for each row execute function set_updated_at();
create trigger trg_hazmat_ctp_updated       before update on hazmat_cargo_tank_profiles for each row execute function set_updated_at();
create trigger trg_hazmat_policies_updated  before update on hazmat_policies           for each row execute function set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════════
-- RLS — the access matrix (mirrors the plan §H4 table). All tables created above, so a policy may
-- reference another hazmat table (loads driver-insert reads hazmat_policies).
-- ═══════════════════════════════════════════════════════════════════════════════
alter table hazmat_policies              enable row level security;
alter table hazmat_loads                 enable row level security;
alter table hazmat_documents             enable row level security;
alter table hazmat_runs                  enable row level security;
alter table hazmat_reviews               enable row level security;
alter table hazmat_cargo_tank_profiles   enable row level security;

-- ── hazmat_policies: all members read; admin-only write ───────────────────────
create policy hazmat_policies_select on hazmat_policies for select
  using (org_id = auth_org_id());
create policy hazmat_policies_admin_write on hazmat_policies for all
  using (org_id = auth_org_id() and auth_role() = 'admin')
  with check (org_id = auth_org_id() and auth_role() = 'admin');

-- ── hazmat_cargo_tank_profiles: all read; safety_manager/fleet_manager/admin write (0078 precedent) ──
create policy hazmat_ctp_select on hazmat_cargo_tank_profiles for select
  using (org_id = auth_org_id());
create policy hazmat_ctp_write on hazmat_cargo_tank_profiles for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'safety_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'safety_manager'));

-- ── hazmat_loads ──────────────────────────────────────────────────────────────
-- Read: all org members (PERMISSIVE); a driver is narrowed to loads they created (RESTRICTIVE).
create policy hazmat_loads_select on hazmat_loads for select
  using (org_id = auth_org_id());
create policy hazmat_loads_driver_scope on hazmat_loads as restrictive for select
  using (auth_role() <> 'driver' or created_by = auth_user_id());

-- Insert: managers (admin/fleet_manager/dispatcher) freely; a driver only their own row, and only when
-- the org policy `driversMayCreateLoads` is true (D10 — the product gate lives at the boundary, not just
-- in the API).
create policy hazmat_loads_manager_insert on hazmat_loads for insert
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'));
create policy hazmat_loads_driver_insert on hazmat_loads for insert
  with check (
    auth_role() = 'driver'
    and org_id = auth_org_id()
    and created_by = auth_user_id()
    and coalesce(
      (select (p.policy ->> 'driversMayCreateLoads')::boolean
         from hazmat_policies p where p.org_id = auth_org_id()),
      false)
  );

-- Update: managers update org loads; a driver only their own DRAFT. safety_manager acts via the API
-- (service role) for status transitions, so it has no direct-write policy. The state machine +
-- cleared-load immutability are enforced in the API (H4-3).
create policy hazmat_loads_manager_update on hazmat_loads for update
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'));
create policy hazmat_loads_driver_update on hazmat_loads for update
  using (auth_role() = 'driver' and created_by = auth_user_id() and status = 'draft')
  with check (auth_role() = 'driver' and created_by = auth_user_id());

-- ── hazmat_documents: read org (driver → own loads); insert managers + driver-on-own-load; immutable ──
create policy hazmat_documents_select on hazmat_documents for select
  using (org_id = auth_org_id());
create policy hazmat_documents_driver_scope on hazmat_documents as restrictive for select
  using (
    auth_role() <> 'driver'
    or exists (select 1 from hazmat_loads l where l.id = hazmat_documents.load_id and l.created_by = auth_user_id())
  );
create policy hazmat_documents_manager_insert on hazmat_documents for insert
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'));
create policy hazmat_documents_driver_insert on hazmat_documents for insert
  with check (
    auth_role() = 'driver'
    and org_id = auth_org_id()
    and exists (select 1 from hazmat_loads l where l.id = hazmat_documents.load_id and l.created_by = auth_user_id())
  );

-- ── hazmat_runs: read org (driver → own loads); NO write policy (service role only); immutable ──
create policy hazmat_runs_select on hazmat_runs for select
  using (org_id = auth_org_id());
create policy hazmat_runs_driver_scope on hazmat_runs as restrictive for select
  using (
    auth_role() <> 'driver'
    or exists (select 1 from hazmat_loads l where l.id = hazmat_runs.load_id and l.created_by = auth_user_id())
  );

-- ── hazmat_reviews: safety_manager/fleet_manager/admin/auditor read; those (minus auditor) insert;
--    driver + dispatcher have NO access (separation of duties); immutable ──
create policy hazmat_reviews_select on hazmat_reviews for select
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'safety_manager', 'auditor'));
create policy hazmat_reviews_insert on hazmat_reviews for insert
  with check (
    org_id = auth_org_id()
    and auth_role() in ('admin', 'fleet_manager', 'safety_manager')
    and reviewer_id = auth_user_id()
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- Storage — bucket 'hazmat', keyed org_id/load_id/{doc}.webp (folder[1]=org, [2]=load).
-- INSERT-ONLY for authorized writers. NO client select, NO client delete: originals are served
-- exclusively through API-issued signed URLs (service role) and deleted only by the service-role
-- retention job (H11). Deliberately NOT the receipts-bucket pattern (which is member-deletable).
-- ═══════════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit)
values ('hazmat', 'hazmat', false, 25 * 1024 * 1024)      -- full-res original + display webp
on conflict (id) do nothing;

create policy hazmat_docs_write on storage.objects for insert
  with check (
    bucket_id = 'hazmat'
    and (storage.foldername(name))[1]::uuid = auth_org_id()
    and (
      auth_role() in ('admin', 'fleet_manager', 'dispatcher')
      or (
        auth_role() = 'driver'
        and exists (
          select 1 from hazmat_loads l
           where l.id = (storage.foldername(name))[2]::uuid
             and l.created_by = auth_user_id()
        )
      )
    )
  );
