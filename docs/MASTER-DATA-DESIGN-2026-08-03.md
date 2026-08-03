# FuelGuard — Master Data & Identity Design (Drivers, Tractors, Trailers)

**Date:** 2026-08-03
**Status:** Design — for review before implementation
**Author:** Engineering (PM-authority working session)
**Decision inputs (Miki):** design full master-data as one cohesive whole first · admin-managed with telematics enrichment · build drivers + tractors + trailers in parallel · DOT/FMCSA compliance tracking in scope
**Reference model:** McLeod LoadMaster/PowerBroker master files (driver qualification, tractor, trailer)

---

## 1. Why this exists — the current state, verified in code

Two independent problems, both confirmed by reading the code, not assumed.

### 1.1 Driver identity is disconnected from the driver roster

There are two separate notions of "driver" and nothing joins them:

- **Roster record** — the `drivers` table (`full_name`, `employee_id`, `phone`, `samsara_driver_id`, `efs_driver_id`). Rows are created by `samsaraDriverSync` / `efsIngest`, keyed by telematics IDs. `drivers.user_id` — the column that links a driver to a login — is `NULL` on every synced row.
- **Login** — created by the invite flow, which is **email + role only**. On `/accept` (`routes/invites.ts`), the only write is a `memberships` upsert (`org_id`, `user_id`, `role`). The auth hook (`0006`) reads that membership to stamp `user_role` into the JWT.

**Nothing ever sets `drivers.user_id` to a real user.** Every write to that column in the codebase only _clears_ it to `null` (offboarding in `me.ts` / `members.ts`). Result: an invited driver is a login with a `driver` claim and **no linked profile**.

This is already breaking the driver app. `GET /api/me/driver` does:

```sql
select ... from drivers where org_id = :org and user_id = :auth_uid   -- → 0 rows → 404
```

So even after the router fix, a signed-in driver reaches Home, calls `/api/me/driver`, and gets `404 no_driver_record`. The RLS helper `auth_driver_id()` (0083) already resolves `drivers.user_id = auth_user_id()` — **the whole system is built to consume a link that is never created.**

### 1.2 The profile modules are telematics stubs, not master data

| Module                  | Has today                                                                     | Missing for fleet operations                                                                                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **drivers**             | `full_name, employee_id, phone, status`, `samsara_driver_id`, `efs_driver_id` | CDL #/class/state/expiry, endorsements (hazmat/tanker/doubles), medical-card (DOT physical) expiry, DOB, hire/term dates, address, emergency contact, pay, home terminal, default equipment, MVR/drug-test/clearinghouse compliance |
| **vehicles (tractors)** | VIN, plate, make/model/year, fuel, tank, odometer, idle/APU, dims, tare       | registration/IRP expiry, insurance, ownership type (owned/leased/owner-op), DOT annual inspection, engine/transmission specs, IFTA, ELD device, maintenance/PM                                                                      |
| **trailers**            | `unit_number, make, model, year, plate`, reefer capacity, pairing             | trailer type/length class, VIN, registration/inspection expiry, insurance, ownership, capacity (cube/weight), suspension/doors                                                                                                      |

There is **no admin CRUD path** for any of the three — they can only be born from Samsara/EFS sync. There is no screen where a fleet admin owns the master record. That is the core gap versus McLeod, whose backbone is deep driver/tractor/trailer master files with qualification and expiry tracking.

---

## 2. The organizing principle

> **Separate the master record (a person or asset that exists whether or not it ever logs in) from the access grant (a login + role).**

Most drivers never open the app; they still need complete profiles. A subset get app access — and _that_ is all an invite should grant, starting **from the roster** and **binding** login → driver on accept. The same separation applies to assets: a tractor is a master record; telematics is an enrichment feed, not the owner.

This is exactly McLeod's model and it resolves both problems at once.

---

## 3. Identity & invite redesign

The plumbing already exists (`auth_driver_id`, `me.ts`, auth hook). We only need to **populate the link** and let admins **invite from the roster**.

### 3.1 Schema

```sql
-- invites gains an optional binding to a specific roster driver.
alter table invites add column if not exists driver_id uuid references drivers(id) on delete cascade;
-- App-access convenience flags on the master record (denormalized for list views).
alter table drivers add column if not exists app_access_enabled boolean not null default false;
```

`drivers.user_id` stays the source of truth for the link (already read by `auth_driver_id()`).

### 3.2 Flow

1. **Enroll for app access** (new admin action): admin opens a driver in the roster → "Invite to app" → enters/confirms the driver's email → creates an `invites` row with `driver_id = <that driver>`, `role = 'driver'`. Generic org invites (admin/dispatcher/safety_manager/…) are unchanged and carry no `driver_id`.
2. **Accept** (`/accept`, extended): after the existing `memberships` upsert, if `invite.driver_id` is present:
   - verify the driver belongs to `invite.org_id` and is not already linked to a different user;
   - `update drivers set user_id = :accepting_user, app_access_enabled = true where id = invite.driver_id`.
3. **Offboard** (unchanged): already clears `drivers.user_id` and deletes the membership.

### 3.3 Guards & edge cases

- **Already-linked driver** → reject enroll with a clear message (unlink first).
- **Email mismatch** — accept binds on the invite's `driver_id`, not on matching email to a driver field, so a driver's personal vs work email is a non-issue.
- **Non-driver invites** — no `driver_id`, no driver write. No behavior change.
- **RLS** — no change needed for the happy path; `auth_driver_id()` starts returning a row the moment the link is set.

This alone makes the driver app work end to end. It is small and low-risk, and it is a strict subset of the master-data build below.

---

## 4. Master-data schema (McLeod-modeled)

Design intent: **additive, admin-owned columns** on the existing tables, plus small satellite tables for repeating/normalized data (endorsements, compliance items, assignment history, documents). Existing telematics columns (`samsara_*`, `efs_*`, idle/APU/fuel) are retained and become **sync-owned** (see §5).

### 4.1 Driver master (qualification file)

Core additions to `drivers`:

| Group             | Fields                                                                                                                                                                                                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity          | `driver_code` (org-unique human ID), `first_name`, `middle_name`, `last_name` (keep `full_name` generated/synced), `date_of_birth`, `photo_path`, `driver_type` (`company` \| `owner_operator` \| `lease`), `hire_date`, `termination_date`, `home_terminal_id`, `status` (`active`\|`inactive`\|`on_leave`\|`terminated`) |
| Contact           | `email`, `phone_mobile`, `phone_alt`, `address_*`, `emergency_contact_name`, `emergency_contact_phone`, `emergency_contact_relation`                                                                                                                                                                                       |
| CDL               | `cdl_number`, `cdl_state`, `cdl_class` (`A`\|`B`\|`C`), `cdl_issued_at`, `cdl_expires_at`, `cdl_restrictions`                                                                                                                                                                                                              |
| Medical           | `medical_card_expires_at`, `medical_examiner_name`, `medical_registry_number`                                                                                                                                                                                                                                              |
| Pay               | `pay_type` (`mileage`\|`hourly`\|`percentage`\|`salary`), `pay_rate`, `per_diem`, `settlement_company`                                                                                                                                                                                                                     |
| Access/telematics | `user_id` (login link), `app_access_enabled`, `samsara_driver_id`, `efs_driver_id`, `eld_id`                                                                                                                                                                                                                               |

Satellite tables:

```sql
-- Endorsements as rows (H, N, X, T, P, S) so we can filter "who can pull hazmat" cleanly and
-- track per-endorsement expiry where states issue them separately.
create table driver_endorsements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  driver_id uuid not null references drivers(id) on delete cascade,
  code text not null,                 -- H | N | X | T | P | S
  expires_at date,
  unique (driver_id, code)
);

-- Default + historical equipment assignment (who drives what, since when).
create table driver_assignments_master (   -- distinct from telematics-derived 0051 driver_assignments
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  driver_id uuid not null references drivers(id) on delete cascade,
  tractor_id uuid references vehicles(id) on delete set null,
  trailer_id uuid references trailers(id) on delete set null,
  is_default boolean not null default false,
  effective_from date, effective_to date
);
```

> **Hazmat tie-in:** the `H`/`X` endorsement + `hazmat training expiry` are exactly the driver-qualification gates HazmatGuard (0092–0094) needs. The compliance engine (§6) should be the single source those gates read.

### 4.2 Tractor (power unit) master — additions to `vehicles`

| Group        | Fields                                                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ownership    | `ownership_type` (`owned`\|`leased`\|`owner_operator`), `owner_driver_id` (for owner-ops), `purchased_at`, `purchase_cost`, `lienholder`, `title_number` |
| Registration | `plate_state`, `registration_expires_at`, `irp_account`, `ifta_account`                                                                                  |
| Insurance    | `insurance_carrier`, `insurance_policy`, `insurance_expires_at`                                                                                          |
| Inspection   | `dot_annual_inspection_expires_at`, `next_pm_due_odometer`, `next_pm_due_at`                                                                             |
| Specs        | `engine_make`, `engine_model`, `horsepower`, `transmission`, `gvwr_lb`, `sleeper` (bool) _(fuel/tank/dims/APU already present)_                          |
| Assignment   | `home_terminal_id`, `assigned_driver_id` _(present)_                                                                                                     |
| Telematics   | `samsara_vehicle_id` _(present)_, `eld_id`                                                                                                               |

### 4.3 Trailer master — additions to `trailers`

| Group                   | Fields                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Identity                | `vin`, `trailer_type` (`dry_van`\|`reefer`\|`flatbed`\|`tanker`\|`hopper`\|`other`), `length_ft`, `plate_state`   |
| Ownership               | `ownership_type`, `purchased_at`, `lienholder`                                                                    |
| Registration/inspection | `registration_expires_at`, `dot_annual_inspection_expires_at`, `insurance_expires_at`                             |
| Specs                   | `capacity_cube_ft`, `capacity_weight_lb`, `door_type`, `suspension`, `tare_weight_lb` _(reefer capacity present)_ |
| Assignment              | `home_terminal_id`, `assigned_vehicle_id` _(present)_                                                             |
| Telematics              | `samsara_asset_id` _(present)_                                                                                    |

### 4.4 Shared satellites

```sql
-- Terminals / domiciles (referenced by drivers + assets).
create table terminals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  code text not null, name text not null, timezone text,
  unique (org_id, code)
);

-- Documents for any master entity (CDL scan, medical card, registration, insurance cert…).
create table master_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  entity_type text not null,          -- driver | tractor | trailer
  entity_id uuid not null,
  doc_type text not null,             -- cdl | medical | registration | insurance | inspection | other
  storage_path text not null,
  expires_at date,
  uploaded_by uuid, created_at timestamptz not null default now()
);
```

---

## 5. Telematics enrichment model (admin-owned, sync enriches)

Today `samsaraDriverSync` / `samsaraVehicleSync` **auto-insert** rows and upsert identity by telematics ID. Under the new model the admin record is authoritative, so the rule becomes **match, don't overwrite; propose, don't auto-create.**

1. **Column ownership.** Sync writes ONLY sync-owned columns (`samsara_*`, `efs_*`, odometer, idle/telematics-derived). It never writes admin-owned columns (name, CDL, ownership, insurance…). This is the simplest, safest provenance rule and needs no per-field flag.
2. **Matching.** On sync, match the telematics entity to an existing master record:
   - drivers → by `samsara_driver_id`/`efs_driver_id` if already linked, else propose by name + `employee_id`;
   - tractors → by `samsara_vehicle_id`, else by VIN, else by unit number;
   - trailers → by `samsara_asset_id`, else by VIN/unit.
3. **Review queue.** No confident match → create a `telematics_match_candidates` row (not a live master record). Admin resolves: link to an existing record or promote to a new master record. This kills the duplicate-driver problem and keeps the roster clean.

```sql
create table telematics_match_candidates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  source text not null,               -- samsara | efs
  entity_type text not null,          -- driver | tractor | trailer
  external_id text not null,
  payload jsonb not null,             -- raw identity fields for the admin to inspect
  suggested_match_id uuid,            -- best guess, if any
  status text not null default 'pending',  -- pending | linked | promoted | ignored
  created_at timestamptz not null default now(),
  unique (org_id, source, entity_type, external_id)
);
```

**Behavior change to flag:** `samsaraDriverSync`'s current auto-insert becomes "auto-insert only if no admin roster exists yet (bootstrap), otherwise route to the review queue." We should gate this on an org setting so existing single-tenant behavior doesn't surprise you.

---

## 6. Compliance / expiry engine (DOT/FMCSA)

One generic mechanism serves all three modules and HazmatGuard.

```sql
create table compliance_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  entity_type text not null,          -- driver | tractor | trailer
  entity_id uuid not null,
  item_type text not null,            -- cdl | medical | hazmat_training | mvr | drug_test |
                                      -- clearinghouse | registration | insurance | dot_inspection | ifta
  expires_at date,
  last_verified_at date,
  status text generated,              -- valid | expiring_soon | expired | missing (computed by view/job)
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

- **Status** = `expired` if past due, `expiring_soon` within a configurable lead time (default 30 days, per-item override), `missing` if required and absent, else `valid`.
- **Job.** A nightly kind on the durable queue (P0 infra we already built) recomputes statuses and emits notifications (0089) to `safety_manager`/`admin`. Fits the existing scheduler pattern (`startAllSchedulers`).
- **Enforcement hooks (optional, later).** Dispatch can warn/block assigning a driver whose CDL/medical is expired, or a hazmat load to a driver without a valid `H`/`X` + hazmat training — reusing HazmatGuard's gate path.
- **Surfacing.** A "Compliance" dashboard (expiring/expired across the fleet) and per-entity badges on each master screen.

Typed expiry columns in §4 stay as the human-entered fields; `compliance_items` is the **derived, alertable index** over them (populated by trigger or the nightly job). This keeps data entry natural and alerting uniform.

---

## 7. Roles, RLS, and access

- Roles today: `driver`, `admin`, `fleet_manager`, `dispatcher`, `auditor`, `safety_manager` (enum, 0077). **`safety_manager`** is the natural owner of compliance; **`admin`/`fleet_manager`** own master data; **`dispatcher`** reads it. No new roles needed.
- RLS: master tables already carry `org_id` and the PERMISSIVE manager / RESTRICTIVE driver-scope pattern (0083–0087). New satellite tables follow the same pattern: manager PERMISSIVE `org_id = auth_org_id()`; drivers get read only to their **own** rows (`driver_id = auth_driver_id()`), no write (writes go through the API, like today).
- PII note (open decision): `date_of_birth`, license numbers, and any SSN are sensitive. Recommend: no SSN in v1 (or last-4 only, tokenized), and keep DOB/license behind manager roles only.

---

## 8. API & UI surface

**API (new admin routers, mirroring existing `routes/` style):**

- `routes/roster/drivers.ts` — CRUD + `POST /:id/invite` (enroll for app access) + `POST /:id/endorsements`.
- `routes/roster/tractors.ts`, `routes/roster/trailers.ts` — CRUD + assignment.
- `routes/compliance.ts` — list/filter compliance items, upload documents, override lead times.
- `routes/telematics-matches.ts` — review queue: link / promote / ignore.
- Extend `routes/invites.ts` `/accept` for the `driver_id` bind (§3.2).

**Web (admin app):** three master-data list+detail screens (Drivers, Tractors, Trailers), a Compliance dashboard, and the telematics review queue. Detail pages are tabbed (Profile · Compliance · Assignments · Documents · Telematics).

**Driver app:** `/api/me/driver` starts returning the real linked record; add a read-only "My profile" surface (license/medical expiry visible to the driver, edits admin-only). This also gives drivers a reason the compliance data is accurate.

---

## 9. Migration & backfill

- All schema changes are **additive** (`add column if not exists`, new tables) — no destructive changes, safe to replay.
- Existing `drivers`/`vehicles`/`trailers` rows (Samsara-born) become editable master records in place; their `samsara_*` IDs already link them to the feed.
- No `user_id` backfill — admins enroll drivers for app access as needed (§3).
- Dedup: if Samsara previously created duplicate drivers, the review queue + a later merge tool clean them; not a blocker for v1.
- New migrations continue the numbering after `0096` (next free: `0097`).

---

## 10. Sequenced build plan (after design sign-off)

Because you chose "design the whole thing first," this is one coherent design — but it still ships in dependency order:

- **M1 — Schema.** All additive migrations (drivers/tractors/trailers columns, satellites, `compliance_items`, `telematics_match_candidates`, `invites.driver_id`). One reviewable batch.
- **M2 — Identity linking.** Invite-from-roster + link-on-accept (§3). _Unblocks the driver app._ Smallest, highest-urgency slice.
- **M3 — Admin CRUD API + web screens** for the three master modules (§8).
- **M4 — Enrichment reconciliation.** Convert sync to match-don't-overwrite + review queue (§5).
- **M5 — Compliance engine.** `compliance_items` population, nightly job, alerts, dashboard (§6).
- **M6 — Driver app profile surface** + optional dispatch enforcement hooks.

Each M is independently shippable and testable; M2 can land the day after M1 to get your app working while the rest proceeds.

---

## 11. Open decisions for you

1. **PII scope** — carry SSN at all (last-4 only?), or omit in v1? (Recommend omit.)
2. **Owner-operator settlements** — full pay/settlement module now, or just the `driver_type`/pay fields as attributes and settlements later? (Recommend attributes now, module later.)
3. **Maintenance/PM** — track PM schedules on tractors now, or defer to a dedicated maintenance module? (Recommend the two expiry/PM-due fields now, full module later.)
4. **Sync auto-create switch** — keep Samsara auto-creating master rows for your current single org (bootstrap), and turn on the review-queue gate later? (Recommend yes.)

---

### Appendix A — evidence map (where each finding lives)

- Invite `/accept` writes only `memberships`: `apps/api/src/routes/invites.ts` (~L274).
- `drivers.user_id` never set to a real user: grep of `from("drivers")` writes — only `user_id = null` clears (`me.ts` L358, `members.ts` L109).
- `/api/me/driver` 404s without a link: `apps/api/src/routes/me.ts` (~L66).
- Link already consumed by RLS: `auth_driver_id()` in `supabase/migrations/0083_driver_rls_matrix.sql`.
- Auth hook reads memberships for claims: `supabase/migrations/0006_auth_hook.sql`.
- Thin schemas: `0003_core_tables.sql` (drivers, vehicles), `0030_trailers.sql`; role enum `0077`.
- Telematics auto-insert: `apps/api/src/services/samsaraDriverSync.ts`, `samsaraVehicleSync.ts`.
