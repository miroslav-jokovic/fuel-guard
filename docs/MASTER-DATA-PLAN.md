# FuelGuard — Master Data & Identity: Authoritative Implementation Plan (v1.0)

**Date:** 2026-08-03 · **Status:** Execution-ready · **Supersedes:** `docs/MASTER-DATA-DESIGN-2026-08-03.md` (that doc is the narrative; THIS doc is the source of truth for building).

> **How to use this document.** It is self-contained. A fresh session can execute it top to bottom with no prior context. §0 is verified ground truth (every claim checked against code, with file:line). §1 locks every decision. §2–§9 are exact specs. §10 is the milestone sequence with a Definition-of-Done per milestone. Do not re-derive anything in §0 — it was verified on 2026-08-03 against migrations 0001–0096 and the current `apps/` tree. If a file has diverged, re-verify only the specific item.

---

## 0. Ground truth (verified — do not re-derive)

### 0.1 Current schema (post-migration 0001–0096)

**`drivers`** — the ONLY columns that exist: `id uuid pk`, `org_id uuid not null → organizations`, `user_id uuid → auth.users` (**nullable** — the login link), `full_name text not null`, `employee_id text`, `phone text`, `status text not null default 'active'` (plain text, not an enum), `created_at`, `updated_at`, `samsara_driver_id text` (0015), `efs_driver_id text` (0079), `driver_type text check (null|'company'|'owner_operator')` (0087). Unique partial indexes: `(org_id, samsara_driver_id)`, `(org_id, efs_driver_id)`.

**`vehicles`** (tractors) — has: `id, org_id, unit_number (unique per org), make, model, year, plate, vin, fuel_type (enum), tank_capacity_gal, baseline_mpg, current_odometer, status (vehicle_status enum: active|maintenance|retired), assigned_driver_id → drivers, created_at, updated_at`, plus telematics/idle/dims already present: `samsara_vehicle_id, samsara_fuel_percent, samsara_fuel_at, odometer_offset(_source), monitored_tank_capacity_gal, tank_sensor_reliable, tank_fill_ratio, observed_max_fill_gal, idle_capability, idle_optimized_pct, has_apu, apu_type, has_optimized_idle, idle_states_sec/window_days/at, height_in, length_in, width_in, axle_count, tare_weight_lb`.

**`trailers`** (0030) — has: `id, org_id, unit_number (unique per org), make, model, year, plate, reefer_tank_capacity_gal (default 50), status text, assigned_vehicle_id → vehicles, samsara_asset_id, created_at, updated_at, is_reefer (0032), pairing_source, pairing_confidence (0041), length_in (0058, inches — a physical dimension, NOT the nominal trailer length class)`.

**`invites`** (0003) — `id, org_id, email, role (user_role, default driver), status (invite_status: pending|accepted|revoked|expired), invited_by → auth.users, token (unique), expires_at, created_at, updated_at`, table unique `(org_id, email)`. **No `driver_id` column today.**

**`memberships`** (0003) — `id, org_id, user_id → auth.users, role (user_role, default driver), created_at, updated_at`, unique `(org_id, user_id)`.

**`organizations`** — includes `allowed_domains text[]`, `operating_hours jsonb`, `default_driver_type text check(company|owner_operator)` (0087), `duty_session_timeout_hours` (0086).

**Enums:** `user_role = admin, fleet_manager, driver, auditor, dispatcher, safety_manager` (last two added 0077). `vehicle_status = active, maintenance, retired`. `invite_status = pending, accepted, revoked, expired`. `fuel_type = diesel, gasoline, def, electric, other`.

**Related tables that EXIST (do not recreate; note exact names):** `driver_vehicle_assignments` (0051, keyed by samsara ids), `driver_duty_sessions` + `duty_equipment_segments` (0086), `org_modules` (0088, `module_key check in ('hazmatguard','training','messages','notifications','dispatch','navigation')`), `driver_performance_settings` (0053).

**Tables that DO NOT exist (safe to create):** `terminals`, `driver_endorsements`, `compliance_items`, `master_documents`, `telematics_match_candidates`.

### 0.2 Identity + auth path (verified)

- **Invite create** (`routes/invites.ts` POST `/`, gated `requireOrg, requireRole("admin")`, `validateBody(inviteCreateSchema)`): inserts `invites(org_id, email, role, invited_by, token, expires_at)`. **Never touches `drivers`.**
- **Invite accept** (`routes/invites.ts` POST `/accept`, `requireAuth` only, **no body schema**): finds newest pending invite by `email`, upserts `memberships(org_id, user_id, role)` onConflict `org_id,user_id`, sets invite `accepted`. **Never touches `drivers`.** → This is the root gap.
- **Driver bootstrap read** (`routes/me.ts` GET `/driver`, gated `driverOnly = [requireOrg, requireRole("driver")]`): `select id, full_name, status, employee_id, phone from drivers where org_id=:org and user_id=:uid` `.maybeSingle()` → **404 `no_driver_record`** if unlinked; then assigned vehicles. Response parsed by `meDriverResponseSchema`.
- **`req.auth`** comes from JWT claims: `userId←sub, email←email, orgId←org_id, role←user_role` (`claimsToContext`, `packages/shared/src/auth.ts:97`). `org_id`/`user_role` are injected by `custom_access_token_hook` (0006) from the earliest `memberships` row.
- **RLS**: `auth_driver_id()` (0083) = `select id from drivers where user_id=auth_user_id() and org_id=auth_org_id() and status='active'`. Manager SELECT policies are org-wide PERMISSIVE; manager WRITE gated to `admin, fleet_manager, safety_manager` (0078); driver RESTRICTIVE scope narrows drivers to their own row. Driver INSERT/UPDATE on drivers/vehicles/trailers is denied; only SECURITY DEFINER RPCs write on the driver's behalf.
- **Offboarding**: `members.ts` revoke sets `drivers.status='inactive'` + deletes membership; `me.ts` delete-account sets `drivers.user_id=null` + deletes membership + deletes auth user.
- **Role→capability** (`packages/shared/src/auth.ts` `SECTION_ACCESS`): section **`fleet`** = manage for `admin, fleet_manager, safety_manager`; view for `dispatcher, auditor`; none for `driver`. Helpers `rolesThatManage('fleet')` and `rolesThatCanView('fleet')` exist and must be used to gate master-data write/read.

### 0.3 Telematics sync (verified — current behavior we must change carefully)

- `samsaraDriverSync.ts`: matches existing driver by **`samsara_driver_id` → normalized phone → lowercased full_name**; on match **UPDATEs `{full_name, phone, samsara_driver_id}`** (so it _overwrites_ admin-edited name/phone today); on no match **auto-INSERTs** `{org_id, full_name, phone, samsara_driver_id, status}`. Never writes `employee_id`.
- `samsaraVehicleSync.ts`: matches by `samsara_vehicle_id → VIN(upper) → unit_number`; UPDATE writes `{make,model,year,plate,vin,samsara_vehicle_id}` (+odo/fuel); auto-INSERT with `tank_capacity_gal:0, fuel_type:diesel, status:active`; `23505` unit collision → relink. Also upserts `driver_vehicle_assignments` and sets `assigned_driver_id`.
- `samsaraTrailerSync.ts` (runs only when `sync_vehicles` payload `full:true`): matches `samsara_asset_id → unit_number`; UPDATE `{make,model,year,plate,samsara_asset_id}`; auto-INSERT `{..., reefer_tank_capacity_gal:50, status:active}`; `23505` relink; then trailer↔tractor pairing.
- `efsIngest.ts` / `driverAttribution.ts`: auto-provision drivers from EFS names (≥2 name tokens) with `{org_id, full_name, status:active}`, then learn `efs_driver_id` where unambiguous.
- Queue kinds (`services/jobs.ts`) + handlers (`services/queue/handlers/index.ts`): `sync_vehicles, sync_stats, sync_trailers, sync_idle, sync_drivers, sync_driver_scores, snapshot_driver_week, nightly_reconcile`. Scheduler (`samsaraScheduler.ts`) enqueues in `queue` mode or runs inline in `inprocess` mode. Durable Postgres queue (P0) is in place.

### 0.4 Build conventions (verified — mirror exactly)

- **API router**: `export function xRouter(): Router { const router = Router(); router.use(requireAuth); … }`. Per-route gates `requireOrg, requireRole(...), [validateBody(schema)], asyncHandler(...)`. `orgId = req.auth!.orgId!` always from JWT; every query chains `.eq("org_id", orgId)`; ownership-check before service-role writes; `writeAudit(admin, {orgId, actorId, action, entity, entityId, meta})` after mutations; success = bare JSON, errors = `apiError(code, message)`. Mount as a single line `app.use("/api/x", xRouter());` in `app.ts` (the `routeAuth.test.ts` fitness test auto-asserts 401-unauthenticated by scanning that exact pattern). **No `pathParam` helper** (`String(req.params.x ?? "")`), **no success wrapper**.
- **lib**: `apiError(code,message)→{error:{code,message}}`; `validateBody(schema)` sets `res.locals.body`; `asyncHandler(fn)`; `getSupabaseAdmin(env)`; `getAppLocals(req).env`; `writeAudit(admin, entry)` best-effort into `audit_logs`.
- **Shared contracts**: add Zod schema + inferred type to `packages/shared/src/apiContract.ts`; barrel auto-exports via `index.ts`. One source of truth for API + web + driver.
- **Tests**: route tests build `createApp(loadEnv({NODE_ENV:"test"}))`, inject `app.locals.verifyToken` (token string → `AuthContext`), `app.listen(0)`, real `fetch`, assert gating (401/403); teardown `server.close`. **No test mocks Supabase** — DB-backed logic is validated as pure service unit tests (`describe/it/expect`, real fixtures).
- **Web** (Vue 3 `<script setup>` + Pinia + vue-router): pages in `apps/web/src/pages/*.vue`; feature composables in `apps/web/src/features/<domain>/use*.ts`; UI primitives `components/ui/` (`DataTable`, `BaseCard`, `BaseButton`, `BaseInput`, `FormField`, `PageHeader`); routes in `router/index.ts` with `meta:{requiresAuth:true, requiresAdmin|requiresManage:true, title, parent}`; API via `apiFetch` (`lib/api.ts`, Supabase bearer auto-attached); types from `@silvicom/shared`. Canonical CRUD screen to mirror: `pages/SettingsUsersPage.vue`.
- **Driver app** (Expo Router): screens are files under `apps/driver/app/`; register top-level screens in `app/_layout.tsx` `<Stack>`; data via `useQuery` + shared-schema `apiFetch` (mirror `src/session/useDriverContext.ts`).

---

## 1. Locked decisions (decisions of record — override is a one-line change, but these are the plan's basis)

1. **Scope**: drivers + tractors + trailers master data built together as one cohesive model; compliance/expiry tracking included.
2. **Ownership**: admin-owned master data; telematics **enriches, never clobbers** admin edits. Enforced by an `identity_source ('samsara'|'manual')` flag per record (§4).
3. **Sync auto-create stays ON** (single-org bootstrap). The match-review queue (`telematics_match_candidates`) is **deferred to M6 (optional)**; it is NOT on the critical path. This preserves today's working single-tenant behavior while §4 stops the clobbering.
4. **PII**: **no SSN in v1.** `date_of_birth` is stored and manager-gated. (Override later if payroll needs it.)
5. **Owner-operator**: attributes only in v1 (`driver_type` exists; add `pay_type`, `pay_rate`, `per_diem`, `settlement_company`). Full settlement module deferred.
6. **Maintenance**: two PM-due fields on tractors now (`next_pm_due_odometer`, `next_pm_due_at`); full maintenance module deferred.
7. **Compliance lead time**: fixed global default **30 days** in v1 (per-item override deferred). `compliance_items` is a **job-derived alert index** over the typed expiry columns — admins edit the typed columns, never `compliance_items`.
8. **Status vocabularies**: `drivers.status` stays free `text`; canonical values `active | inactive | on_leave | terminated` (documented, not DB-enforced, to avoid touching existing rows). `auth_driver_id()` continues to require `status='active'`, so only `active` drivers get app data — intended.

---

## 2. Target data model — exact migrations

All migrations are **additive and idempotent** (`add column if not exists`, `create table if not exists`, `create index if not exists`). Numbering continues after 0096. Each file also adds RLS policies mirroring §0.2 for any new table. Apply in order.

### 2.1 `0097_terminals.sql`

```sql
create table if not exists terminals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  code text not null,
  name text not null,
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, code)
);
create index if not exists idx_terminals_org on terminals(org_id);
alter table terminals enable row level security;
-- read: anyone in org; write: fleet managers (rolesThatManage('fleet'))
create policy terminals_select on terminals for select using (org_id = auth_org_id());
create policy terminals_write on terminals for all
  using (org_id = auth_org_id() and auth_role() in ('admin','fleet_manager','safety_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin','fleet_manager','safety_manager'));
create trigger trg_terminals_updated before update on terminals for each row execute function set_updated_at();
```

### 2.2 `0098_drivers_master.sql` — extend `drivers`

```sql
alter table drivers add column if not exists identity_source text not null default 'samsara'
  check (identity_source in ('samsara','manual'));
alter table drivers add column if not exists app_access_enabled boolean not null default false;
alter table drivers add column if not exists first_name text;
alter table drivers add column if not exists middle_name text;
alter table drivers add column if not exists last_name text;
alter table drivers add column if not exists date_of_birth date;
alter table drivers add column if not exists photo_path text;
alter table drivers add column if not exists hire_date date;
alter table drivers add column if not exists termination_date date;
alter table drivers add column if not exists home_terminal_id uuid references terminals(id) on delete set null;
alter table drivers add column if not exists email text;
alter table drivers add column if not exists phone_alt text;
alter table drivers add column if not exists address_line1 text;
alter table drivers add column if not exists address_line2 text;
alter table drivers add column if not exists city text;
alter table drivers add column if not exists state text;
alter table drivers add column if not exists postal_code text;
alter table drivers add column if not exists emergency_contact_name text;
alter table drivers add column if not exists emergency_contact_phone text;
alter table drivers add column if not exists emergency_contact_relation text;
alter table drivers add column if not exists cdl_number text;
alter table drivers add column if not exists cdl_state text;
alter table drivers add column if not exists cdl_class text check (cdl_class is null or cdl_class in ('A','B','C'));
alter table drivers add column if not exists cdl_issued_at date;
alter table drivers add column if not exists cdl_expires_at date;
alter table drivers add column if not exists cdl_restrictions text;
alter table drivers add column if not exists medical_card_expires_at date;
alter table drivers add column if not exists medical_examiner_name text;
alter table drivers add column if not exists medical_registry_number text;
alter table drivers add column if not exists pay_type text check (pay_type is null or pay_type in ('mileage','hourly','percentage','salary'));
alter table drivers add column if not exists pay_rate numeric(10,2);
alter table drivers add column if not exists per_diem boolean;
alter table drivers add column if not exists settlement_company text;
alter table drivers add column if not exists eld_id text;

-- One login ↔ at most one driver (user_id is unique when present).
create unique index if not exists idx_drivers_user on drivers(user_id) where user_id is not null;

create table if not exists driver_endorsements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  driver_id uuid not null references drivers(id) on delete cascade,
  code text not null check (code in ('H','N','X','T','P','S')),
  expires_at date,
  created_at timestamptz not null default now(),
  unique (driver_id, code)
);
create index if not exists idx_driver_endorsements_org on driver_endorsements(org_id);
alter table driver_endorsements enable row level security;
create policy driver_endorsements_select on driver_endorsements for select using (org_id = auth_org_id());
create policy driver_endorsements_write on driver_endorsements for all
  using (org_id = auth_org_id() and auth_role() in ('admin','fleet_manager','safety_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin','fleet_manager','safety_manager'));
```

> Note: `full_name` remains the canonical display/synced field and stays `not null`. `first/middle/last` are optional structured fields; the drivers CRUD keeps `full_name` in sync when structured names are edited (API-side, §6). Endorsement `H`/`X` + a `hazmat_training` compliance item are what HazmatGuard reads.

### 2.3 `0099_tractors_master.sql` — extend `vehicles`

```sql
alter table vehicles add column if not exists identity_source text not null default 'samsara'
  check (identity_source in ('samsara','manual'));
alter table vehicles add column if not exists ownership_type text
  check (ownership_type is null or ownership_type in ('owned','leased','owner_operator'));
alter table vehicles add column if not exists owner_driver_id uuid references drivers(id) on delete set null;
alter table vehicles add column if not exists purchased_at date;
alter table vehicles add column if not exists purchase_cost numeric(12,2);
alter table vehicles add column if not exists lienholder text;
alter table vehicles add column if not exists title_number text;
alter table vehicles add column if not exists plate_state text;
alter table vehicles add column if not exists registration_expires_at date;
alter table vehicles add column if not exists irp_account text;
alter table vehicles add column if not exists ifta_account text;
alter table vehicles add column if not exists insurance_carrier text;
alter table vehicles add column if not exists insurance_policy text;
alter table vehicles add column if not exists insurance_expires_at date;
alter table vehicles add column if not exists dot_annual_inspection_expires_at date;
alter table vehicles add column if not exists next_pm_due_odometer numeric(10,1);
alter table vehicles add column if not exists next_pm_due_at date;
alter table vehicles add column if not exists engine_make text;
alter table vehicles add column if not exists engine_model text;
alter table vehicles add column if not exists horsepower int;
alter table vehicles add column if not exists transmission text;
alter table vehicles add column if not exists gvwr_lb numeric;
alter table vehicles add column if not exists sleeper boolean;
alter table vehicles add column if not exists home_terminal_id uuid references terminals(id) on delete set null;
alter table vehicles add column if not exists eld_id text;
```

### 2.4 `0100_trailers_master.sql` — extend `trailers`

```sql
alter table trailers add column if not exists identity_source text not null default 'samsara'
  check (identity_source in ('samsara','manual'));
alter table trailers add column if not exists vin text;
alter table trailers add column if not exists trailer_type text
  check (trailer_type is null or trailer_type in ('dry_van','reefer','flatbed','tanker','hopper','other'));
alter table trailers add column if not exists length_ft int;   -- nominal class (28/40/48/53); distinct from length_in (physical)
alter table trailers add column if not exists plate_state text;
alter table trailers add column if not exists ownership_type text
  check (ownership_type is null or ownership_type in ('owned','leased','owner_operator'));
alter table trailers add column if not exists purchased_at date;
alter table trailers add column if not exists lienholder text;
alter table trailers add column if not exists registration_expires_at date;
alter table trailers add column if not exists dot_annual_inspection_expires_at date;
alter table trailers add column if not exists insurance_expires_at date;
alter table trailers add column if not exists capacity_cube_ft numeric;
alter table trailers add column if not exists capacity_weight_lb numeric;
alter table trailers add column if not exists door_type text;
alter table trailers add column if not exists suspension text;
alter table trailers add column if not exists tare_weight_lb numeric;
alter table trailers add column if not exists home_terminal_id uuid references terminals(id) on delete set null;
```

### 2.5 `0101_compliance.sql` — derived alert index + documents

```sql
create table if not exists compliance_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('driver','tractor','trailer')),
  entity_id uuid not null,
  item_type text not null check (item_type in
    ('cdl','medical','hazmat_training','mvr','drug_test','clearinghouse','registration','insurance','dot_inspection','ifta')),
  expires_at date,
  status text not null default 'unknown'
    check (status in ('valid','expiring_soon','expired','missing','unknown')),
  computed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, entity_type, entity_id, item_type)
);
create index if not exists idx_compliance_org_status on compliance_items(org_id, status);
alter table compliance_items enable row level security;
create policy compliance_select on compliance_items for select using (org_id = auth_org_id());
-- written only by the service-role nightly job; no user write policy (RLS denies user writes by default).

create table if not exists master_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('driver','tractor','trailer')),
  entity_id uuid not null,
  doc_type text not null check (doc_type in ('cdl','medical','registration','insurance','inspection','other')),
  storage_path text not null,
  expires_at date,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_master_documents_entity on master_documents(org_id, entity_type, entity_id);
alter table master_documents enable row level security;
create policy master_documents_select on master_documents for select using (org_id = auth_org_id());
create policy master_documents_write on master_documents for all
  using (org_id = auth_org_id() and auth_role() in ('admin','fleet_manager','safety_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin','fleet_manager','safety_manager'));
```

### 2.6 `0102_invites_driver_link.sql` — identity

```sql
alter table invites add column if not exists driver_id uuid references drivers(id) on delete cascade;
create index if not exists idx_invites_driver on invites(driver_id) where driver_id is not null;
```

### 2.7 (M6, optional) `0103_telematics_match_queue.sql`

Deferred — only if/when we switch sync from auto-create to review-queue. Shape in the design doc §5. Not required for v1.

---

## 3. Identity & invite-from-roster (exact code)

**Goal:** invite a driver _from the roster_; bind login→driver on accept. This is the smallest slice that makes the driver app load (§0.2 explains why it 404s today).

### 3.1 New route — enroll a roster driver for app access

Add to the new roster drivers router (§6): `POST /api/roster/drivers/:id/invite`, gated `requireOrg, requireRole("admin","fleet_manager")`, body `{ email: z.email() }` (validated). Logic:

1. Load driver: `select id, org_id, user_id, status from drivers where id=:id and org_id=:orgId` → 404 if none.
2. Reject if `user_id` already set → `409 already_linked`.
3. Domain-check the email against `organizations.allowed_domains` (reuse `isEmailDomainAllowed`).
4. Upsert `invites` with `{ org_id, email, role:'driver', driver_id:id, invited_by, token, expires_at }` (onConflict `org_id,email`).
5. Reuse `deliverInvite(admin, env, orgName, email)` (already in `invites.ts`; export it or move to a shared helper).
6. `writeAudit({action:"driver.invited", entity:"drivers", entityId:id, meta:{email}})`.
7. Respond `{ ok:true, emailSent, reason, link }`.

### 3.2 Extend invite acceptance — bind login→driver

In `routes/invites.ts` POST `/accept`, after the existing `memberships` upsert and BEFORE marking accepted, add:

```ts
if (invite.driver_id) {
  const { data: drv } = await admin
    .from("drivers")
    .select("id, user_id")
    .eq("id", invite.driver_id)
    .eq("org_id", invite.org_id)
    .maybeSingle();
  if (!drv) {
    res.status(404).json(apiError("no_driver_record", "Invited driver no longer exists"));
    return;
  }
  if (drv.user_id && drv.user_id !== req.auth!.userId) {
    res
      .status(409)
      .json(apiError("already_linked", "This driver is already linked to another account"));
    return;
  }
  const { error: linkErr } = await admin
    .from("drivers")
    .update({ user_id: req.auth!.userId, app_access_enabled: true })
    .eq("id", invite.driver_id)
    .eq("org_id", invite.org_id);
  if (linkErr) {
    res.status(500).json(apiError("db_error", "Could not link driver"));
    return;
  }
}
```

The invite lookup query must also `select` `driver_id` (add it to the existing `.select("id, org_id, role, status")`).

**Result:** `auth_driver_id()` and `GET /api/me/driver` immediately resolve the linked row. No RLS change needed. Generic (non-driver) invites are unaffected (`driver_id` null → block skipped).

### 3.3 Immediate unblock (one-off, independent of the build)

So the app works for Miki today: link the existing driver row for user `b84ce951-2ea3-4ba2-b86f-9fbeb198f36d` in org `86d6b3ea-4361-4f71-877f-e8373615769b`:

```sql
update drivers set user_id = 'b84ce951-2ea3-4ba2-b86f-9fbeb198f36d', app_access_enabled = true
where org_id = '86d6b3ea-4361-4f71-877f-e8373615769b'
  and user_id is null and full_name ilike '%<Miki's driver name>%';   -- confirm the target row first
```

(Run `select id, full_name, user_id from drivers where org_id='86d6b3ea-...';` first to pick the right row.)

---

## 4. Telematics enrichment provenance (exact change — "enrich, never clobber")

Today `samsaraDriverSync` overwrites `full_name`/`phone` on match. New rule keyed on `identity_source`:

- **On admin create/edit** of a driver/tractor/trailer via the CRUD API (§6): set `identity_source='manual'`.
- **In each sync's UPDATE-on-match path**, split the write:
  - Always write **sync-owned** fields: `samsara_driver_id`/`samsara_vehicle_id`/`samsara_asset_id`, odometer, fuel level, idle metrics, pairing.
  - Write **identity** fields (`full_name`/`phone` for drivers; `make/model/year/plate/vin` for tractors; `make/model/year/plate` for trailers) **only when `identity_source <> 'manual'`**. Implementation: add `identity_source` to the `select` of existing rows, and guard the identity portion of the update: if `match.identity_source === 'manual'`, update only sync-owned columns.
- **Auto-INSERT paths keep `identity_source='samsara'` (the column default)** — unchanged behavior for brand-new telematics entities.

This is a surgical change to three files (`samsaraDriverSync.ts`, `samsaraVehicleSync.ts`, `samsaraTrailerSync.ts`) plus the two EFS provisioners (which only insert; leave as-is, they already never overwrite). Covered by service unit tests (§9).

---

## 5. Compliance / expiry engine (exact)

- **Source of truth**: the typed expiry columns (`drivers.cdl_expires_at`, `drivers.medical_card_expires_at`, `driver_endorsements` where `code in ('H','X')` for `hazmat_training` — plus its own `expires_at`, `vehicles.registration_expires_at/insurance_expires_at/dot_annual_inspection_expires_at`, same on `trailers`).
- **Job**: new queue kind **`compliance_scan`**. Register in `services/jobs.ts` `JobKind` and `services/queue/handlers/index.ts` (`registerHandler("compliance_scan", complianceScanHandler)`); handler in `services/queue/handlers/compliance.ts` calling a pure `computeCompliance(org)` in `services/compliance.ts`. Scheduler: add `startComplianceScheduler(env)` to `startAllSchedulers` (daily; enqueue per org in queue mode, run inline otherwise) — mirror `startNightlyReconcileScheduler`.
- **Compute rule** (per org): for each required item per active entity, upsert one `compliance_items` row: `expires_at` mirrored from the source column; `status` = `expired` if `expires_at < today`, `expiring_soon` if `<= today+30d`, `missing` if the source column is null, else `valid`; set `computed_at=now()`. Upsert on `(org_id, entity_type, entity_id, item_type)`. Delete rows for entities that no longer exist/are inactive.
- **Alerts**: after compute, for newly `expired`/`expiring_soon` items, emit notifications via the existing notifications table (0089) to `rolesThatManage('safety')` + admin. Reuse the notify service pattern.
- **Surface**: web Compliance dashboard (list filtered by status) + per-entity badges (§8). HazmatGuard reads the `hazmat_training` + `H`/`X` endorsement items as its driver-qualification gate.

---

## 6. API surface (exact)

New routers (each: factory + `router.use(requireAuth)`; mount one-line in `app.ts`; auto-covered by `routeAuth.test.ts`). Write gate = `requireRole("admin","fleet_manager","safety_manager")` (= `rolesThatManage('fleet')`); read gate = `requireRole("admin","fleet_manager","safety_manager","dispatcher","auditor")` (= `rolesThatCanView('fleet')`). All queries `.eq("org_id", req.auth!.orgId!)`; mutations `writeAudit`.

- **`routes/roster/drivers.ts`** → mount `app.use("/api/roster/drivers", rosterDriversRouter());`
  - `GET /` list; `GET /:id` detail (driver + endorsements + assigned equipment + compliance_items); `POST /` create (`identity_source:'manual'`, derive `full_name` from names if given); `PATCH /:id` update (set `identity_source:'manual'`); `POST /:id/endorsements` upsert; `DELETE /:id/endorsements/:code`; `POST /:id/invite` (§3.1); `POST /:id/deactivate` (`status:'inactive'`).
- **`routes/roster/tractors.ts`** → `app.use("/api/roster/tractors", rosterTractorsRouter());` — CRUD + `PATCH /:id/assign` (`assigned_driver_id`).
- **`routes/roster/trailers.ts`** → `app.use("/api/roster/trailers", rosterTrailersRouter());` — CRUD + `PATCH /:id/assign` (`assigned_vehicle_id`).
- **`routes/compliance.ts`** → `app.use("/api/compliance", complianceRouter());` — `GET /` list/filter compliance_items; `POST /scan` (admin) enqueue `compliance_scan`; `GET/POST /documents` for `master_documents`.

Audit actions to use: `driver.created|driver.updated|driver.invited|driver.deactivated|driver.endorsement_changed`, `tractor.created|tractor.updated|tractor.assigned`, `trailer.created|trailer.updated|trailer.assigned`, `compliance.scanned`.

---

## 7. Shared contracts (exact — `packages/shared/src/apiContract.ts`, or a new `rosterContract.ts` barrel-exported via `index.ts`)

Add Zod schemas + inferred types (mirroring `orgMemberSchema`/`memberListResponseSchema`):

- `driverProfileSchema` (all columns in §2.2 that the UI reads), `driverEndorsementSchema`, `driverListItemSchema`, `driverListResponseSchema`, `driverDetailResponseSchema`, `driverCreateSchema`, `driverUpdateSchema`, `driverInviteSchema` (`{email}`).
- `tractorSchema`/`tractorListResponseSchema`/`tractorCreateSchema`/`tractorUpdateSchema`; same for `trailer*`.
- `complianceItemSchema`/`complianceListResponseSchema`; `masterDocumentSchema`.
- `terminalSchema`/`terminalListResponseSchema`.
  Also **extend `meDriverResponseSchema` / `meDriverSchema`** (`driverContract.ts`) if the driver "My profile" screen (M6) needs more fields — additively, keeping existing fields.

Rule: numeric DB columns → `z.coerce.number().nullable()`; dates → `z.string().nullable()`; enums → `z.enum([...]).nullable()`. Match the existing `meAssignedVehicleSchema` style.

---

## 8. Web + driver UI (exact)

**Web** (mirror `SettingsUsersPage.vue` + `DataTable` + `apiFetch` + toasts; types from `@silvicom/shared`; register in `router/index.ts`):

- `pages/RosterDriversPage.vue` (list) + `pages/RosterDriverDetailPage.vue` (tabbed: Profile · Compliance · Endorsements · Assignments · Documents). Route meta `{requiresAuth:true, requiresManage:true, title:"Drivers", parent:"/fleet"}` (managers, not admin-only — use `requiresManage`).
- `pages/RosterTractorsPage.vue` + detail; `pages/RosterTrailersPage.vue` + detail.
- `pages/CompliancePage.vue` (fleet-wide expiring/expired dashboard).
- "Invite to app" action on the driver detail page → `POST /api/roster/drivers/:id/invite`.
- Feature composables in `features/roster/useDrivers.ts` etc.

**Driver app** (M6): `apps/driver/app/profile.tsx` (read-only), registered in `app/_layout.tsx` `<Stack>` as a modal, reached from the More tab; data via `useDriverContext()` (extend the contract if needed).

---

## 9. Tests (exact, per milestone)

- **Route/auth (mirror `middleware/auth.test.ts`)**: for each new router, a `*.test.ts` that builds `createApp`, injects `app.locals.verifyToken` for `admin`/`fleet_manager`/`dispatcher`/`driver`/`pending`, and asserts: unauth→401; driver→403 on write; dispatcher→403 on write but 200 on read; manager→200. (The `routeAuth.test.ts` fitness test already asserts 401-unauth automatically once mounted.)
- **Service unit tests (mirror `hazmatProducts.test.ts`, no DB mock)**: `computeCompliance` status logic (valid/expiring_soon/expired/missing at boundary dates); the enrichment provenance guard (given `identity_source='manual'`, identity fields are excluded from the update payload — test the pure payload-builder, so extract it); `full_name` derivation from first/last.
- **Contract tests**: parse a representative API response with each new Zod schema (round-trip), as the driver contract tests already do.
- **Identity**: an accept-flow test asserting that with `invite.driver_id` set, acceptance sets `drivers.user_id` (validate via the pure handler logic or an integration check where the suite allows).

---

## 10. Milestones (build order · Definition of Done)

Each milestone is independently shippable via the existing bundle→device flow. Run `pnpm -r typecheck`, `pnpm -r test`, `pnpm lint`, `pnpm lint:boundaries` green before delivering each.

- **M1 — Schema.** Migrations `0097`–`0102` (§2). **DoD:** migrations apply cleanly on a fresh DB and on the existing DB (idempotent); `schemaCheck` passes; RLS policies present for new tables; no app code depends on them yet.
- **M2 — Identity linking (unblocks the app).** `invites.driver_id` consumed on `/accept` (§3.2) + `POST /api/roster/drivers/:id/invite` (§3.1) + the one-off link (§3.3) for Miki. **DoD:** a driver invited from the roster, on accept, has `drivers.user_id` set; `GET /api/me/driver` returns 200; the driver app reaches Home with data; auth/gating tests green.
- **M3 — Master-data CRUD API + contracts.** Routers in §6, schemas in §7. **DoD:** full CRUD for drivers/tractors/trailers/terminals/endorsements behind correct gates; `routeAuth` + per-router auth tests green; `identity_source` set to `'manual'` on create/edit.
- **M4 — Web master-data screens.** Pages in §8 (list + detail + assign + invite). **DoD:** managers can create/edit/assign all three entity types and invite a driver to the app from the UI; matches `SettingsUsersPage` conventions.
- **M5 — Compliance engine + dashboard.** §5 job + `routes/compliance.ts` + `CompliancePage.vue` + alerts + HazmatGuard gate wiring. **DoD:** nightly scan populates `compliance_items`; expiring/expired items notify safety managers; dashboard renders; hazmat gate reads the `H`/`X` + `hazmat_training` items.
- **M6 — Enrichment provenance + driver profile + (optional) review queue.** §4 provenance guard shipped in the three sync files; `apps/driver/app/profile.tsx`; optionally `0103` review queue (Decision #3). **DoD:** admin-edited identity fields survive a sync; driver can view their profile read-only.

**Enrichment note:** §4's "never clobber" guard is grouped into M6, but it can be pulled forward to ship alongside M3 if admins start editing identity before M6 — it's a self-contained change to three files.

---

## 11. Migration numbering & apply

- Next free numbers are `0097+` (last existing is `0096_messages.sql`). Use the exact filenames in §2.
- All statements are idempotent; safe to re-run and safe on the existing single-tenant DB.
- Apply via the project's standard migration path (Supabase). `runSchemaCheck` on API boot warns if a migration is unapplied — watch its log after applying.
- No destructive changes anywhere in v1: no dropped columns, no type changes to existing columns, no data backfills required (existing synced rows simply gain nullable columns and `identity_source='samsara'`).

---

## Appendix A — evidence map (file:line, verified 2026-08-03)

- Invite create/accept never touch drivers: `apps/api/src/routes/invites.ts` (create ~L120, accept ~L274–285).
- `drivers.user_id` only ever cleared: `apps/api/src/routes/me.ts:358`, `apps/api/src/routes/members.ts:109`.
- Driver bootstrap 404: `apps/api/src/routes/me.ts:57–85`.
- Link consumed by RLS: `auth_driver_id()` in `supabase/migrations/0083_driver_rls_matrix.sql:31`.
- Auth hook: `supabase/migrations/0006_auth_hook.sql`. Claims mapping: `packages/shared/src/auth.ts:97`.
- Role matrix: `packages/shared/src/auth.ts:57` (`SECTION_ACCESS`), `rolesThatManage`/`rolesThatCanView`.
- Sync clobber points: `samsaraDriverSync.ts:58–64`, `samsaraVehicleSync.ts:125–133`, `samsaraTrailerSync.ts:57–67`.
- Queue kinds/handlers: `services/jobs.ts:9–27`, `services/queue/handlers/index.ts:41–48`.
- Router/test/web conventions: `routes/members.ts`, `routes/transactions.ts`, `lib/http.ts`, `lib/audit.ts`, `middleware/auth.test.ts`, `routeAuth.test.ts`, `apps/web/src/pages/SettingsUsersPage.vue`, `apps/web/src/lib/api.ts`, `apps/web/src/router/index.ts`.
- Current schema: `supabase/migrations/0003_core_tables.sql`, `0015`, `0030`, `0077`, `0079`, `0086`, `0087`, `0088`.
