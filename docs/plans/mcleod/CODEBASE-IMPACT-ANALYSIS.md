# What McLeod must not break — field ownership and risk register

**Written:** 2026-08-24, before M3. Companion to `MCLEOD-ROSTER-SYNC-PLAN.md`.
**Method:** every writer to `drivers` / `vehicles` / `trailers` in `apps/api/src` was enumerated and its
column set read, then cross-referenced against the McLeod coverage measured on 2026-08-24. Consumers of
`identity_source`, `status`, and the `samsara_*_id` keys were traced from their call sites.

**Why this exists:** the roster is not a standalone table. Twelve services write to it, several own
columns that are *learned* rather than *recorded*, and two of them (`driverCredentials`, `reeferPairing`)
own state that has no McLeod equivalent at all. A sync that writes the whole row would quietly undo
work the product spent months learning.

---

## 0. The sandbox is the point

`lme_analytics` is a **sandbox the carrier stood up for this work** — a restore taken 2026-08-21 09:46,
deliberately isolated so an implementation can be got wrong repeatedly without touching production
LoadMaster. That is exactly the right shape for M3–M6, and its staleness is a property, not a defect: a
fixed dataset makes the match numbers in the plan's §7 reproducible as a regression check.

`MCLEOD-ROSTER-SYNC-PLAN.md` §0 and §6 Q1 previously called it "cannot back the product" and "the single
biggest blocker". The freshness facts were right and the framing was wrong. It blocks the **production
cutover** (M7), not the implementation. Corrected there.

---

## 1. Field ownership — `drivers`

Ten writers. The column groups McLeod may claim, and the ones it must not touch:

| Columns | Owned today by | McLeod coverage | Verdict |
|---|---|---|---|
| `full_name`, `first_name`, `middle_name`, `last_name` | `samsaraDriverSync` (enrich), roster PATCH (claims to `manual`) | `first_name` + surname in `name`, 164/164 | **McLeod takes over** (compose, don't parse) |
| `cdl_number`, `cdl_state` | `samsaraDriverSync`, **enrich-only** (D6) | 164/164, all distinct | **McLeod takes over** — D-MR6 inverts D6 |
| `cdl_expires_at` | roster PATCH | `license_date`, 164/164 | **McLeod takes over** |
| `medical_card_expires_at` | roster PATCH | `medical_cert_expire`, 164/164 | **McLeod takes over** |
| `hire_date` | roster PATCH | 164/164 | **McLeod takes over** |
| `status`, `termination_date` | `samsaraDriverSync` deactivation pass, roster PATCH | `is_active` + `termination_date` | **McLeod takes over — with the R2 guard below** |
| `address_line1`, `city`, `state`, `postal_code`, `date_of_birth` | roster PATCH | 1,461–1,462 of 1,463 | **McLeod takes over** |
| **`phone`, `phone_alt`** | **`samsaraDriverSync` — the only writer** | **0 of 1,463. Empty.** | **⛔ Samsara MUST keep writing this** (R4) |
| `samsara_driver_id`, `samsara_username` | `samsaraDriverSync` | n/a | ⛔ Samsara only — the telematics join key |
| `current_hos_status`, `current_hos_vehicle`, `current_hos_at` | `hosSync` | n/a | ⛔ Never touch |
| `app_username`, `app_access_enabled`, `app_credential_created_at`, `app_credential_reset_at`, `user_id` | `driverCredentials`, `invites` | n/a | ⛔ Never touch (but see R1) |
| `efs_driver_id` | `efsIngest` | n/a | ⛔ Never touch |
| `return_to_duty_required` | recruiting (0237) | n/a | ⛔ Never touch |
| `archived_at` | API only — trigger `DR011` refuses anyone else | n/a | ⛔ Never touch |
| `employee_id` | roster PATCH | no clean equivalent | Leave alone |

## 2. Field ownership — `vehicles`

| Columns | Owned today by | McLeod | Verdict |
|---|---|---|---|
| `vin`, `make`, `model`, `year`, `plate`, `plate_state` | `samsaraVehicleSync` | `serial_number`, `make`, `model`, `model_year`, `tag`, `tag_state` | **McLeod takes over** |
| `registration_expires_at` | — | `tag_expire_date` (expiry, 175/175 future) | **McLeod takes over** |
| `dot_annual_inspection_expires_at` | — | `inspection_date` — **PERFORMED, not expiry** | ⚠ Derive, don't write raw (plan §4.2) |
| `status` | `samsaraVehicleSync` | `service_status` + `outservice_date` | **McLeod takes over** |
| **`tank_capacity_gal`, `tank_capacity_source`, `observed_max_fill_gal`, `sensor_capacity_gal`, `sensor_capacity_samples`, `tank_fill_ratio`, `tank_residual_sigma`, `tank_sensor_reliable`** | **`scoring/learnVehicle`, `scoring/persist` — LEARNED from fill history** | `fuel_capacity` | **⛔ NEVER WRITE** (R5) |
| `idle_*` (20+ columns: capability, evidence, learned envelope, observed mode) | `idleCapabilitySync`, idle evidence sync | n/a | ⛔ Never touch |
| `odometer_offset`, `odometer_offset_source` | `scoring` | n/a | ⛔ Never touch |
| `samsara_vehicle_id`, `samsara_missing_since` | `samsaraVehicleSync` | n/a | ⛔ Samsara only (R7) |
| `assigned_driver_id`, `owner_driver_id` | dispatch / duty | `driver1_id` — **empty in McLeod** | ⛔ Never touch (D43) |

## 3. Field ownership — `trailers`

| Columns | Owned today by | McLeod | Verdict |
|---|---|---|---|
| `unit_number` | `samsaraTrailerSync` | `id` | Keep FuelGuard's `R` convention; normalise for MATCHING only (D-MR11) |
| `is_reefer` | — | `trailer_type = 'R'` (45 of 240) | **McLeod takes over** |
| `make`, `year`, `plate`, `plate_state`, `vin` | `samsaraTrailerSync` | `make`, `model_year`, `license_no`, `license_state`, `serial_number` | **McLeod takes over** — note FuelGuard holds **zero** trailer VINs today, so this is new data |
| `status` | `samsaraTrailerSync` | `is_active` + `outservice_date` | **McLeod takes over** |
| **`assigned_vehicle_id`, `pairing_source`, `pairing_confidence`** | **`reeferPairing` — INFERRED from telemetry** | `tractor_id`, `is_hooked` | **⛔ NEVER WRITE.** Ours is inferred from what actually happened; McLeod's is dispatch's plan |
| `reefer_tank_capacity_gal` | user / default 50 | — | ⛔ Never touch |
| `samsara_asset_id` | `samsaraTrailerSync` | n/a | ⛔ Samsara only |

---

## 4. Risk register

### R1 — A terminated driver can still log into the driver app ⚠ pre-existing, amplified

`POST /api/auth` resolves a driver login by `app_username` and checks **`app_access_enabled` only — not
`status`** (`apps/api/src/routes/auth.ts:96`). Nothing anywhere revokes app access when a driver is
deactivated; `app_access_enabled` moves only on explicit admin action in `driverCredentials` or `invites`.

Partially contained: `auth_driver_id()` (0083) requires `d.status = 'active'`, so a terminated driver's
session scopes to no driver and the RLS-protected surfaces return nothing. So this is a bad experience
and a loose end, not a data leak.

**Why McLeod changes it:** today terminations are manual and an admin disabling access is part of the
same human act. M6 automates termination for a roster of 164 with 1,227 historical leavers. The gap
stops being theoretical.

> **Decision needed before M6:** does an automated termination disable app access? I would say yes and
> pin it, but it is a product call — it logs a driver out of their phone.

### R2 — `status = 'applicant'` belongs to recruiting, and nothing at the DB level protects it ⚠

`DRIVER_STATUSES` is `applicant | active | inactive | on_leave | terminated` — the recruiting pipeline
and the employed roster share one table. `guard_driver_lifecycle` (0213) **exempts `auth_role() is null`**,
which is precisely the service role the sync runs as. There is no database guard.

A McLeod row matching an applicant on CDL and writing `status`/`termination_date` would corrupt an
in-flight hire. `merge_driver` already refuses to touch drivers carrying `driver_applications`,
`esign_consents` or `sms_consents` rows (MD010) — the same population needs the same respect here.

> **Guard, in sync code, non-negotiable:** never write `status`, `termination_date` or identity fields to
> a row whose `status = 'applicant'`, or which has a `driver_applications` / `esign_consents` /
> `sms_consents` row. Report it as an exception instead.

### R3 — the DQ queue population moves

`complianceOverview` scopes to `status in ('active','on_leave')` **and `identity_source <> 'efs'**
(`apps/api/src/services/complianceOverview.ts:106`). `'mcleod'` rows are *included*, correctly — they are
real employees. With 162 of 164 already matching, the net change is small, but it is not zero: the 2
McLeod-only drivers appear as new "not started" files, and any of the 7 FuelGuard-only actives that
McLeod later terminates leave the queue.

> Expected, not a bug. Worth measuring in M3's link-only report so nobody is surprised by the count moving.

### R4 — demoting the Samsara sync would delete every phone number

Measured: McLeod holds **no** `email`, `cell_phone` or `phone` — 0 of 1,463 rows. FuelGuard has a phone
for 164 of 166 active drivers, and `samsaraDriverSync` is the only writer.

SMS consent, driver-app invitations and messaging all depend on it. D-MR5 already says the Samsara sync
stays link-only rather than being turned off; this measurement is *why* that clause cannot be dropped as
a simplification later.

### R5 — tank capacity is learned, and overwriting it corrupts fuel detection

`tank_capacity_gal` is NOT NULL with no default, and `scoring/learnVehicle` + `scoring/persist` refine it,
`observed_max_fill_gal`, and the sensor-reliability estimates from real fill history. McLeod's
`tractor.fuel_capacity` is a static spec field.

`samsaraVehicleSync` already handles this correctly — new trucks are created with capacity 0 and reported
in `needsCompletion` so an admin finishes them before they drive fuel detection. **The McLeod sync must do
exactly the same and never write `fuel_capacity`.**

### R6 — `uq_vehicles_org_unit_active` permits one active row per unit number

McLeod's 15 new tractors are units **789–803**; none exists in FuelGuard, so no collision today
(verified 2026-08-24). But the index is real and the sync must handle `23505` by linking rather than
failing — `samsaraVehicleSync` already has that recovery path and it should be reused, not reinvented.

### R7 — two independent "this vehicle is gone" signals

`samsara_missing_since` records that a truck vanished from Samsara's roster; McLeod's `outservice_date`
records that the carrier retired it. They will often agree and sometimes will not — a truck sold and
removed from Samsara but not yet marked out of service, or the reverse.

> Keep both. `samsara_missing_since` stays Samsara's; McLeod drives `status`. Where they disagree, that is
> a finding worth surfacing, not a conflict to resolve silently in whichever sync ran last.

### R8 — trailer pairing is inferred and ours is better

`reeferPairing` derives `assigned_vehicle_id` from telemetry with an explicit `pairing_confidence`.
McLeod's `trailer.tractor_id` / `is_hooked` are dispatch's intent, and `is_hooked` is one of the
high-churn columns. Importing it would replace a measured answer with a planned one. Do not.

### R9 — `drivers.status` is unconstrained `text`

No CHECK constraint (verified against production). The vocabulary lives only in
`packages/shared/src/constants.ts`. A mapping bug in the sync would write a novel status and nothing would
stop it; every `status = 'active'` query in the product would then quietly exclude those drivers.

> The sync must map through `DRIVER_STATUSES` and refuse anything else. Adding a database CHECK would be
> better still, but it needs a survey of historical values first and is a separate change.

### R10 — `merge_driver` still does not carry `samsara_driver_id`

Raised in the 0239 PR and deliberately not fixed there. A merge where only the source holds the telematics
link loses it, and the canonical driver silently stops receiving hours, idle evidence and scores. It gets
more likely once EFS stubs are reconciled against a real roster.

---

## 5. The rule this all reduces to

> **The McLeod sync writes a fixed allowlist of columns, never a row.**

Everything in the ⛔ rows above is either learned from telemetry, owned by an explicit human act, or a
join key to another system. None of it has a McLeod equivalent worth having, and several have a McLeod
equivalent that is actively worse than what the product already computes.

`rosterIngest.ts` should therefore take the writable column set as **per-entity configuration**, and the
tests should assert the negative — that a sync run leaves the ⛔ columns byte-identical — rather than only
asserting the positive. A column added to `drivers` in six months is safe by default that way; the
opposite arrangement fails open.
