# McLeod roster sync — drivers, tractors, trailers

**Scope:** McLeod becomes the master for the three master-data lists — drivers, tractors, trailers — with
changes reflected in FuelGuard continuously. Nothing else. Movements, loads, fuel, settlement, and CPM are
out of scope and are addressed in `../MCLEOD-SQL-SOURCE-OF-TRUTH.md` §5.

**Written:** 2026-08-23. **Verified against the live sandbox 2026-08-24** — §1, §4, §5 and §6 now record
measured facts, not inferences. Where the first draft guessed wrong, the correction is marked **⚠ CORRECTED**
so the reasoning stays auditable.
**Prerequisite reading:** `../MCLEOD-SQL-SOURCE-OF-TRUTH.md`, `docs/McLeod-Testing/`, root `CLAUDE.md`.

---

## 0. What we are connected to

| Fact | Value |
|---|---|
| Server | `APPNEW`, SQL Server 2019 Enterprise (15.0.2120.1) |
| Our database | `lme_analytics` — **created 2026-08-21 09:46:06**, SIMPLE recovery |
| **Production database** | **`lme`** — created 2022-11-28, FULL recovery, on the same instance. `HAS_DBACCESS('lme') = 0` — we cannot read it |
| Also present | `lme_dev`, `silvicom_dashboard`, `FleetpalData` (created 2026-08-19) |
| Our login | `NikiAnalytics`, member of **`db_datareader` only** |

**`lme_analytics` is a SANDBOX the carrier stood up for this work** — a restore taken 2026-08-21 09:46,
deliberately isolated so an implementation can be got wrong repeatedly without touching production
LoadMaster. Its staleness is a property, not a defect: a fixed dataset makes §7's match numbers
reproducible as a regression check.

It is the right target for M3–M6 and the wrong one for M7. Production freshness needs `lme`, on the same
instance, which this login cannot read — that gates the **cutover**, not the implementation.

**The `db_datareader` grant is the PII problem, confirmed.** This login can `SELECT social_security_no`
today, and 1,461 of 1,463 driver rows have one populated. §2.3 of the parent document is not a theoretical
concern.

---

## 1. Change detection — three mechanisms measured, one clear winner

### 1.1 What exists

**Change Tracking is already enabled**, on both `lme` and `lme_analytics`, 10-day retention, auto-cleanup on,
**91 tables tracked — including `driver`, `tractor`, and `trailer`, all three with
`is_track_columns_updated_on = 1`** (column-level masks). McLeod evidently uses it for its own integrations.
Because CT configuration is part of the database and survives backup/restore, its presence here is direct
evidence that **production `lme` has it too**.

We cannot use it yet: `CHANGETABLE(CHANGES dbo.driver, …)` returns
*"The VIEW CHANGE TRACKING permission was denied."* That is **one GRANT per table**, not an infrastructure
project — by far the cheapest ask in this plan.

**`audit_log` is real and well-indexed** — 45.5M rows, with `idx_al_purge_assist (table_name,
change_date_time)` and `x_aud_table_date (company_id, table_name, change_date_time)`. My earlier worry about
table scans was wrong: querying it by table and date is cheap. `audit_log_exclude` excludes only dispatch
telemetry (`avl_*`, `currenteqpgrpid`, `last_home_date`, `pta_date` on driver; `current_hub`, `fuel_level` on
tractor) — none of the fields we import.

### 1.2 The measurement that decides it

Change volume for the three tables, from `audit_log`:

| Table | Changes/day | What is actually changing |
|---|---:|---|
| `driver` | **~228,000** | **`event_date`, and essentially nothing else** — written by the `loadmaster` system user (application 52) about 7× per driver per hour |
| `trailer` | ~200 | `currenteqpgrpid` and the `empty` Y/N flag — dispatch state |
| `tractor` | ~15 | `tractor_status` A↔V, `dispatcher`, `fleet_id`, `assign_date` — dispatch state |

Real identity changes — a licence expiry, a new hire, an inspection date — are **tens per month**, not
thousands per day. The 228,000 is one system heartbeat column, and `event_date` is *not* in
`audit_log_exclude`.

### 1.3 What that rules out, with evidence

- **`audit_log` polling for drivers is unusable.** 228k rows/day of `event_date` noise to find perhaps two
  real changes. We would be reading ~158 rows/second to learn nothing.
- **Change Tracking is a weaker delta than it looks.** CT records a row version per *row*, and `event_date`
  touches every driver row several times an hour — so `CHANGETABLE` would return all ~1,463 rows on every
  poll. The column mask lets us discard them client-side, but the "delta" is the whole table either way.

### 1.4 The decision

> **D-MR1 (confirmed, now on evidence):** change detection is a **full-table hash diff over the allowlisted
> columns only**. It is *immune to the churn by construction* — `event_date` is not in the allowlist, so it
> is not in the hash, so the noisiest column in the database is silently free. It needs no permission grant,
> no DDL, and no watermark a restore can corrupt.
>
> At 164 + 190 + 235 = **589 active rows** (2,610 including inactive), a sweep is a few hundred kilobytes.
>
> **Adopt Change Tracking later only as a bandwidth optimisation** — it can tell us *which rows* to re-read
> without reading all of them — and only after `VIEW CHANGE TRACKING` is granted. Ask for the grant now
> (it is nearly free and it future-proofs the design), but do not build on it.

### 1.5 What "real time" can honestly mean

Unchanged from the first draft, and now with a hard number under it: **`lme_analytics` is three days stale
and will never be fresher**, by design — it is an isolated sandbox, not a feed. Production freshness
depends entirely on getting a login on `lme`.

> **D-MR2 (confirmed):** target a **2-minute sweep**, described in the UI as "as of HH:MM" from
> `org_integrations.last_synced_at`. Given the measured change rate — tens of real changes per month — a
> 2-minute interval is far faster than the business needs and is chosen for simplicity, not necessity.

---

## 2. Architecture — one pipeline, three entities

Unchanged from the first draft and validated by the field work: the three entities are structurally
identical, so this is **one parameterised pipeline instantiated three times**, not three sync services.

```
McLeod SQL Server (their network)
        │  read-only, column allowlist, company_id bound
        ▼
tools/mcleod-agent  ── SOURCE=sqlserver ─────────────────────┐
  queries.mjs   one named, parameterised, column-explicit     │  the ONLY place that
                SELECT per entity                             │  knows McLeod's schema
  hash.mjs      stable row hash over the allowlist + state.json
  map.mjs       McLeod row → neutral roster contract          │
        │  HTTPS outbound, Bearer fgtms_…, ≤1000-row batches  │
        ▼                                                     ┘
POST /api/tms/roster/{drivers|vehicles|trailers}
        ▼
apps/api/src/tms/     rosterIngest.ts + entities/{driver,vehicle,trailer}.ts
        ▼
drivers / vehicles / trailers   (+ mcleod_* link columns)
```

> **D-MR3 / D-MR4 (unchanged):** the agent is the only component that speaks SQL Server or knows a McLeod
> column name; `apps/api/src/tms/` is the module home, following `src/efs/` and `src/psp/`. Split
> `rosterIngest.ts` into match / resolve / apply from the first commit (`lint:filesize`, warn at 450).

Per-entity parameters, now with **measured** match precedence:

| Parameter | driver | vehicle | trailer |
|---|---|---|---|
| Source | `dbo.driver` | `dbo.tractor` | `dbo.trailer` |
| Target | `drivers` | `vehicles` | `trailers` |
| Link column | `mcleod_driver_id` | `mcleod_tractor_id` | `mcleod_trailer_id` |
| Match precedence | link → **CDL** → name | link → **VIN** → unit | link → **normalised unit** |
| Active predicate | `is_active='Y'` | `service_status='A' and outservice_date is null` | `is_active='A' and outservice_date is null` |
| Active rows | **164** | **190** | **235** |

---

## 3. The trap at the centre: Samsara is a join key

Unchanged and still the most important structural point. `samsara_driver_id` / `samsara_vehicle_id` are the
join keys for `hosSync.ts` (17 sites), `idleSync.ts`, `idleRollup.ts`, `idleDutyEvidenceSync.ts`,
`driverScoreSync.ts`, `driverReconcile.ts`. A McLeod-created driver with a null Samsara link silently has no
HOS, no idle evidence, and no score, and nothing errors.

The field work adds a second, independent reason the split is mandatory: **McLeod holds no contact data at
all** (§4.1). Samsara is the *only* source of driver phone numbers — 164 of 166 FuelGuard active drivers have
one, and all of them came from Samsara. Demoting the Samsara sync to link-only preserves that; replacing it
would destroy it.

> **D-MR5 (confirmed, now with a second reason):** when McLeod roster sync is enabled, the Samsara syncs run
> **link-only** — match on their existing precedence, write `samsara_*_id` **and `phone`**, nothing else. No
> inserts, no deactivation pass. An unmatched Samsara driver is **reported, not created**.

> **D-MR12 (2026-08-24): for VEHICLES and TRAILERS, link-only mode writes NO identity at all** — the link and
> the gateway's own measurements (odometer, fuel level, pairing), and nothing else. The `phone` carve-out
> above is a driver-only fact and has no asset analogue; that is a measurement, not a symmetry argument:
>
> | column | McLeod | Samsara |
> |---|---|---|
> | `vehicles.plate` | 175/190 | **21/194** |
> | `vehicles.plate_state` | 175/190 | **0/194 — the API has no such field** |
> | `vehicles.make` / `model` / `year` | every active tractor | 188/194 |
> | `vehicles.vin` | 197/198 distinct | 186/194 |
> | `trailers.make` / `year` | every active trailer | **0/211** |
> | `trailers.model` | **no such column on `dbo.trailer`** | **0/211** |
> | `trailers.plate` | `license_no` | 9/211 |
> | `trailers.vin` | `serial_number` | never written — the parser reads `serial` and the sync drops it |
>
> **The bug this closes was an eraser, not a tie.** Both syncs build their identity patch unconditionally and
> the Samsara parser returns `null` for an absent field, so a matched row is written `plate: null, make: null,
> …` on every tick. Harmless while Samsara is the only writer of those columns; destructive the moment McLeod
> is the other one. The trailer sync is doing this to 202 of 211 rows today.
>
> Unmatched assets are **reported, never created** — the vehicle insert invents `tank_capacity_gal: 0` (which
> `learnVehicle` then unlearns) and the trailer insert invents `reefer_tank_capacity_gal: 50`.
> `applyReplacementLifecycle` keeps running in both modes: it stamps `samsara_missing_since` and changes no
> status, so it is not the deactivation pass this decision switches off, and under TMS mastery it is the only
> signal that a truck McLeod calls in-service has gone dark.

> **D-MR13 (2026-08-24): one flag, both sides.** `roster_master` also gates the INGEST — `identity`, `create`
> and `retire` are refused with `409 roster_master_not_declared` unless the org has declared mastery. The
> ingest mode previously came from a query parameter the on-prem agent chose for itself, so an agent started
> with `ROSTER_MODE=identity` against an undeclared org put both systems on the same columns. **A client on
> the carrier's network cannot decide a data-ownership question.** `link` stays ungated: it writes only the
> external link and produces the §7 match report, which is the measurement the mastery decision is made from.
>
> The flag itself is now settable. It had gated the demotion since M5 with no route touching it — the only
> path was an `UPDATE` in the SQL editor — so `POST /api/integrations/mcleod/roster-master` (admin, audited)
> exists, refusing to hand the roster to a TMS with no live ingest token. Withdrawal is never refused.

> **D-MR14 (2026-08-24): D-MR6's escape hatch had to be built before it could be relied on.** `identity_source`
> defaulted to `'samsara'`, so every hand-created row claimed telematics provenance (production: 194 vehicles
> and 211 trailers, all `'samsara'`, not one `'manual'`); vehicles and trailers had no claim path at all
> because `apps/web` writes them straight through PostgREST; and `DriversPage.vue` bypassed
> `resolveDriverUpdate` the same way. Migration 0241 moves the rule to a `BEFORE INSERT OR UPDATE` trigger,
> service-role exempt, with the claimable columns passed per table and held against `rosterFields.ts` by a
> test. `status` is excluded from all three lists: retiring a truck is a lifecycle act and must not be why
> McLeod stops refreshing its plate forever.

---

## 4. Field mapping — verified against real data

Every `char(n)` value is space-padded; trim at the agent boundary and treat all-space as `null`.

### 4.1 `dbo.driver` → `drivers` — measured coverage over 1,463 TMS rows

**⚠ CORRECTED — the three assumptions that were wrong:**

| Column | First draft assumed | **Measured reality** |
|---|---|---|
| `name` | `char(28)`, "LAST, FIRST" | **The SURNAME only.** 0 of 164 contain a comma; `name` never contains `first_name`; lengths 3–20. Full name = `first_name` + `name_mid_initial` + `name`. |
| `license_date` | ambiguous, issue or expiry | **CDL EXPIRY.** 164/164 in the future, out to 2034-02-12. |
| `email`, `cell_phone`, `phone` | map to `email`, `phone`, `phone_alt` | **100% EMPTY — 0 of 1,463 rows.** McLeod holds no contact data. |

| McLeod | FuelGuard | Coverage | Note |
|---|---|---|---|
| `id` char(8) | `mcleod_driver_id` | 100% | The link key. |
| `company_id` char(4) | `mcleod_company_id` | 100% | **⚠ references `company.id` (`TMS`), not `company.company_id`** — see §4.4. |
| `first_name` + `name_mid_initial` + `name` | `first_name`, `middle_name`, `last_name`, `full_name` | 164/164 | Compose; do not parse. |
| `license_no`, `license_state` | `cdl_number`, `cdl_state` | **164/164, all distinct** | 8–13 chars, alphanumeric, no punctuation. **The match key.** |
| `license_date` | `cdl_expires_at` | 164/164 | Expiry, confirmed. |
| `medical_cert_expire` | `medical_card_expires_at` | 164/164 | Expiry, confirmed (the control). |
| `physical_date` | **do not map** | 164/164 | **Byte-identical to `medical_cert_expire` in all 164 rows.** A duplicate column. |
| `mvr_date` | *(qualification evidence, later)* | 164/164 | **⚠ Not "last MVR pulled" — it is the NEXT MVR DUE date.** All future, in a tight 2027 band. |
| `hire_date` | `hire_date` | 164/164 actives | Latest 2026-08-18 — actively hiring. |
| `termination_date` | `termination_date` | 1,227 rows | See §5.3. |
| `is_active` `Y`/`N` | `status` | 100% | **The active predicate.** `status_code` is NULL for every row — unused, no vocabulary needed. |
| `address`, `city`, `state`, `zip` | `address_line1`, `city`, `state`, `postal_code` | 1,461 / 1,462 | Populated. |
| `birth_date` | `date_of_birth` | 1,461 | PII; DQ needs it. |
| `email`, `cell_phone`, `phone` | **do not map** | **0** | Empty. Samsara stays the phone source. |
| `tractor_id` | **do not import** | **0 populated** | Empty anyway — and D43 makes `driver_equipment_timeline` authoritative. |
| `event_date` | **never** | — | The 228k/day churn column. Excluding it is what makes the hash diff work. |
| `social_security_no` (1,461 populated), `race`, `sex`, `name_of_spouse` | **never** | — | Not in the allowlist, not in the SELECT, not in a log line. |

### 4.2 `dbo.tractor` → `vehicles`

| McLeod | FuelGuard | Coverage | Note |
|---|---|---|---|
| `id` char(8) | `mcleod_tractor_id`, `unit_number` | 100% | Confirmed to be the real unit number (`789`, `790`, …). |
| `serial_number` | `vin` | 197 of 198 active | 17 chars. **Unique among ACTIVE tractors; NOT unique overall** — 72+ VINs repeat across retired rows, one 5×. See §5.2. |
| `make`, `model`, `model_year` | `make`, `model`, `year` | good | |
| `tag`, `tag_state`, `tag_expire_date` | `plate`, `plate_state`, `registration_expires_at` | 175 | `tag_expire_date` is an expiry (175/175 future). |
| `inspection_date` | `dot_annual_inspection_expires_at` | 175 | **⚠ CORRECTED — it is the date the inspection was PERFORMED** (175/175 in the *past*, 2025-07 → 2026-08), the opposite of every driver date. Store as performed and derive expiry = +1 year, or add a `_performed_at` column. Do not write it into an `_expires_at` column raw. |
| `insurance_date`, `liability_end_dt`, `insurance_name` | **do not map** | **0 populated** | Unused at this carrier. |
| `service_status` `A`/`I` | `status` | 100% | The predicate, with `outservice_date`. |
| `fuel_capacity` | **do not blind-write** | | User-owned; drives fuel detection. Report new trucks via `needsCompletion` as the Samsara path does. |
| `driver1_id`, `driver2_id`, `dispatcher`, `fleet_id`, `current_hub` | **do not import** | | Dispatch state; `fleet_id` and `dispatcher` are among the churning columns. |

### 4.3 `dbo.trailer` → `trailers`

| McLeod | FuelGuard | Coverage | Note |
|---|---|---|---|
| `id` char(8) | `mcleod_trailer_id`, `unit_number` | 100% | **Needs prefix normalisation — see §5.4.** |
| `trailer_type` | **`is_reefer`** | 232 of 240 | **⚠ CORRECTED — this is the reefer signal.** `V`=187, `R`=45, blank=8. `is_reefer := trailer_type='R'`. |
| `reefer_id`, `min_temp`, `max_temp`, `heater_code` | **do not map** | **0 populated** | The first draft proposed these for `is_reefer`. All empty. |
| `serial_number` | `vin` | 232 of 240 | FuelGuard currently stores **no** trailer VINs — this is new data, and a future match key once populated. |
| `is_active` `A`/`I` | `status` | 100% | The predicate. `statuscode` and `disposition_code` are entirely NULL — unused. |
| `make`, `model_year`, `length_of`, `volume`, `weight` | `make`, `year`, `length_ft`, `capacity_cube_ft`, `tare_weight_lb` | | Convert via the `*_um` unit columns. |
| `tractor_id`, `is_hooked`, `currenteqpgrpid`, `empty` | **do not import** | | Dispatch state; `currenteqpgrpid` and `empty` are the churning columns. |

### 4.4 The tenant key is `company.id`, not `company_id` — ⚠ CORRECTED

`dbo.company` has 4 rows and **`company_id` is `'TMS'` on all of them**. The discriminator is `company.id`,
and `driver.company_id` / `tractor.company_id` / `trailer.company_id` reference *that*:

| `company.id` | Legal entity | DOT | drivers / tractors / trailers |
|---|---|---|---|
| **`TMS`** | **Silvicom, Inc.** | 1864495 | **1,463 / 646 / 404 ← the carrier** |
| `TMS2` | Silvicom Logistics, Inc. | 2127913 | 27 / 13 / 54 (0 active drivers) |
| `TMS3` | JVM Freight Group Corporation | 2117026 | 0 / 0 / 0 |
| `TMS4` | VIP Equipment Holding, Inc. | — | 1 / 1 / 1 |

> **D-MR10:** every query binds `company_id = 'TMS'`. The value is configuration
> (`org_integrations.config.mcleod_company`), never a literal in code — TMS2 becomes a second FuelGuard org
> if Silvicom Logistics is ever onboarded.

### 4.5 The CDL rule inverts for McLeod — unchanged, and now better supported

> **D-MR6 (confirmed):** for `identity_source = 'mcleod'` rows the CDL, medical, plate and registration
> fields are **authoritative and refreshed every sweep**, not enrich-only (D6's rule was right for
> telematics, where the licence is a convenience field). The office's escape hatch is unchanged: editing an
> identity field claims the row to `manual` via `resolveDriverUpdate`. Say so plainly in the UI.
>
> The measurement backs this: McLeod carries a complete, unique CDL and a valid medical expiry for
> **164 of 164** active drivers. It is the qualification system of record, in fact and not just in principle.

---

## 5. Schema

Migration numbers **not pinned** — next-numbered at execution. Head is `0238_applicant_dispositions.sql`.

### 5.1 Link columns and provenance

```sql
alter table drivers  add column if not exists mcleod_driver_id  text;
alter table drivers  add column if not exists mcleod_company_id text;
alter table vehicles add column if not exists mcleod_tractor_id text;
alter table vehicles add column if not exists mcleod_company_id text;
alter table trailers add column if not exists mcleod_trailer_id text;
alter table trailers add column if not exists mcleod_company_id text;

create unique index if not exists uq_drivers_org_mcleod
  on drivers  (org_id, mcleod_driver_id)  where mcleod_driver_id  is not null;
create unique index if not exists uq_vehicles_org_mcleod
  on vehicles (org_id, mcleod_tractor_id) where mcleod_tractor_id is not null;
create unique index if not exists uq_trailers_org_mcleod
  on trailers (org_id, mcleod_trailer_id) where mcleod_trailer_id is not null;
```

Plus `'mcleod'` in the three `identity_source` CHECK constraints.

### 5.2 Two hazards, one of them now measured

- **`merge_driver` must learn `mcleod_driver_id`.** `0203_merge_driver_preserves_dqf.sql` nulls
  `efs_driver_id` on the source row *before* coalescing onto the canonical, so the partial unique index does
  not trip mid-merge. Identical treatment needed. **No lint gate covers this.**
- **⚠ VIN uniqueness is real but conditional.** `uq_vehicles_org_vin` is org-wide and refuses to build over
  duplicates (0123's posture after the 2026-08 duplication incident). McLeod's `tractor.serial_number` is
  unique among the 198 active rows (197 distinct + 1 blank) but **has 72+ duplicate VINs across retired
  rows** — the same truck re-entered under a new unit number. **Importing retired tractors would break the
  index.** Import active only, and match VIN only against active rows.

### 5.3 Deactivation and the retention clock — unchanged

> **D-MR7 (confirmed):** the sync may **set** `termination_date` / move status to inactive; it may **never
> clear** a termination date and never delete. Re-hire surfaces as a review item, not an auto-reactivation.
> The mass-deactivation guard from `samsaraDriverSync` carries over verbatim.

### 5.4 Trailer unit-number normalisation — new, and it matters a lot

**FuelGuard prefixes reefer trailer units with `R`; McLeod does not.** `R532159` here is `532159` there.
Measured effect on the match:

| Match basis | Matched | McLeod-only | FuelGuard-only |
|---|---:|---:|---:|
| Raw unit number | 157 / 235 | 78 | 50 |
| **Strip leading `R`** | **201 / 235** | **34** | **6** |

The prefix is meaningful, not noise: FuelGuard has **46** `R`-prefixed trailers, McLeod has **45** with
`trailer_type='R'`. It is the same fact recorded two ways.

> **D-MR11 (confirmed 2026-08-24):** the agent normalises trailer unit numbers by stripping a leading
> `R` **for matching only**.
> The stored `unit_number` keeps FuelGuard's existing convention (renaming 200 trailers is a separate,
> user-visible decision), and `is_reefer` comes from `trailer_type`, never from the prefix.

---

## 6. Questions — all answered

1. ~~**Is `lme_analytics` a snapshot?**~~ **Yes, and deliberately so — it is the carrier's purpose-built
   SANDBOX**, a restore taken 2026-08-21 09:46, isolated so this work cannot touch production LoadMaster.
   Correct and sufficient for M3–M6, and its fixed contents make §7's numbers a regression check.
   Production is **`lme`** on the same instance, which this login cannot read — *that gates the M7
   cutover, not the build.*
2. ~~**Which company?**~~ **`company.id = 'TMS'` — Silvicom, Inc., DOT 1864495.** And the key is
   `company.id`, not `company.company_id` (§4.4).
3. ~~**`license_date` — issue or expiry?**~~ **Expiry.** `medical_cert_expire` likewise. But
   **`tractor.inspection_date` is the date PERFORMED**, not an expiry (§4.2), and **`mvr_date` is the next
   due date**, not the last pull.
4. ~~**Status vocabularies?**~~ **`driver.status_code` is NULL for every row — unused.** The predicates are
   `driver.is_active='Y'` (164), `tractor.service_status='A' and outservice_date is null` (190),
   `trailer.is_active='A' and outservice_date is null` (235). Validated: **163 of the 164 active drivers
   have HOS activity in the last 180 days.**
5. **Still open — `fuelguard_ro` login.** Now with a precise spec: on **`lme`**, `SELECT` on the allowlisted
   columns of `driver`/`tractor`/`trailer` (**not** `db_datareader`, which exposes 1,461 SSNs), plus
   `GRANT VIEW CHANGE TRACKING` on those three tables.
6. ~~**Network bridge.**~~ **Answered: the agent runs on the carrier's box**, reaching SQL Server locally
   and POSTing outbound to FuelGuard — no inbound firewall change, the posture `tools/mcleod-agent`'s
   README already documents to their IT.
7. ~~**Is `audit_log` usable?**~~ **Indexed and cheap, but useless for drivers** — 228k rows/day of
   `event_date` noise (§1.2).
8. ~~**Name format? Is `tractor.id` the unit number?**~~ **`name` is the surname**; `tractor.id` **is** the
   unit number.

---

## 7. The match report — computed 2026-08-24, before any code

Normally M3's deliverable. It was cheap to compute directly, so the go/no-go evidence exists now. Driver
comparison was done on **SHA-256 hashes of the normalised CDL** — no licence number left either system.

### Drivers — match on CDL: **162 of 164 (98.8%)**

| | Count | Meaning |
|---|---:|---|
| Matched | **162** | McLeod active ↔ FuelGuard active |
| McLeod only | 2 | New hires not yet in FuelGuard (37 were hired in the last 90 days, so Samsara is keeping up well) |
| FuelGuard only | 7 | **Entirely unknown to McLeod** — absent from all 1,457 CDLs, not merely terminated. Includes the 3 `manual` rows. Needs a human. |

Both sides carry a complete, unique CDL for every active driver (164/164 and 166/166). **CDL is the match
key** — and it has to be, because McLeod has no phone or email at all.

### Vehicles — match on VIN and on unit number: **175 of 190 (92%)**

Both keys select the same 175, so they corroborate rather than complement.

| | Count | Meaning |
|---|---:|---|
| Matched | **175** | |
| McLeod only | 15 | Units **789–803** — one contiguous block of new tractors. Straightforward creates. |
| FuelGuard only | 15 | **5** are retired `"… — OLD"` rows (0123's rename convention, correctly excluded). **10 are real drift** — see below. |

**The 10 are immediate, concrete value.** Every one is present in McLeod *with an `outservice_date` set* —
units 552, 555, 563, 564, 565, 567, 569, 720, 721, 752, out of service since dates ranging from **2021-08-09**
to 2026-06-25. FuelGuard has been carrying them as active vehicles, one of them for four years. The sync
retires them on day one.

### Trailers — match on normalised unit number: **201 of 235 (86%)**

157 before stripping the `R` prefix (§5.4). The remaining 34 McLeod-only and 6 FuelGuard-only need eyes, but
the bulk is a naming convention, not a data problem.

**Verdict: go.** The rosters agree far more than they disagree, every disagreement is explainable, and the
drift the sync would fix on day one is already visible.

---

## 8. Execution

One step per branch (`claude/<topic>`), PR to `main`, merge after CI. Mark steps **DONE** in place.

### M0 — Credential exposure — **DONE 2026-08-24 (containment only)**, rotation OUTSTANDING

**⚠ This was written as hygiene and turned out to be an incident.** The first draft said the directory
was "untracked but not ignored" and warned that `git add -A` would publish it. On checking the history:
it already had.

What was found:

| | |
|---|---|
| Exposed | `docs/McLeod-Testing/setup.md` — McLeod SQL login (`NikiAnalytics`), host `10.0.1.171`, db `lme_analytics` |
| Since | **2026-08-21 21:05** (commit `a286370`), also `985b698` |
| Where | **`origin/main` and ~45 remote branches** |
| Repository | **PUBLIC** (`github.com/miroslav-jokovic/fuel-guard`) |
| Prior attempt | `41ab398` untracked it; a later merge from main brought it straight back |

Also public for those three days: the other nine files — a 1,459-table, 34,852-column schema map of a
customer's production TMS, naming their internal host.

**Shipped (containment):** `.gitignore` entry + `git rm -r --cached docs/McLeod-Testing/`. A gitignore
entry rather than another `git rm --cached` specifically because the bare untrack already failed once.

**Outstanding — not ours to do, and containment is not mitigation:**

1. **Rotate the password.** The carrier's DBA. This is the only action that neutralises the exposure —
   untracking does not remove a credential from history, and anyone who cloned or forked in the window
   still holds it. Treat as compromised.
2. **Tell the carrier.** It was their credential and their system map. Their call what follows; they
   cannot make it without knowing.
3. **Decide on a history rewrite.** `git filter-repo` over main and ~45 branches, plus a GitHub Support
   request to purge cached commit views (rewritten commits stay reachable by SHA otherwise). Disruptive,
   and largely moot once the password is rotated — but the schema map is a separate disclosure that
   rotation does not address.

**Done when:** ~~gitignore matches~~ (done) **and the carrier confirms rotation**.

### M1 — The production ask *(blocked on the carrier; now fully specified)*
Send their DBA the §6 Q5/Q6 spec. **This is the critical path** — everything below can be built against the
sandbox, but nothing can *ship* without a login on `lme`.
**Done when:** a `fuelguard_ro` login on `lme` authenticates and returns the TMS driver count.

### M2 — Schema
Migration per §5.1, `merge_driver` per §5.2, PGlite matrix pinning the merge case, the unique indexes, and
the `identity_source` constraint.
**Done when:** `pnpm test` green with the new matrix printing `RESULT`; `lint:migrations`, `check-rls.mjs`,
`lint:comment-claims` green.

### M3 — Agent + contracts + link-only ingest
`SOURCE=sqlserver` with `queries.mjs` (three column-explicit, `company_id`-bound SELECTs), `hash.mjs`;
`tmsDriverInput`/`tmsVehicleInput`/`tmsTrailerInput` in `packages/shared/src/tms.ts`; generic
`apps/api/src/tms/rosterIngest.ts` + three entity configs; routes under `/api/tms/roster/*`. Link-only.
Tests fixture-driven with an injectable row-lister (`listerOverride` pattern), so CI never needs SQL Server.
`expectOrgScoped` on every query.
**Done when:** link-only run reproduces §7's numbers (162 / 175 / 201) against the sandbox. *§7 replaces this
step's original discovery purpose — it is now a regression check, which is a better use of it.*

### M4 — Identity writes
Field writes for matched `identity_source='mcleod'` rows per §4 and D-MR6. No creation, no deactivation.
**Done when:** a sandbox change appears within one sweep, and an office-edited field claims to `manual` and
stops being overwritten — both pinned by tests.

### M5 — Creation + Samsara demotion
McLeod creates rows (starting with tractors 789–803). Samsara syncs drop to link-only per D-MR5, **still
writing `phone`**. Unmatched Samsara records reported, not created.

> **Shipped in two parts.** The first pass demoted `samsaraDriverSync` only — `samsaraVehicleSync` and
> `samsaraTrailerSync` never learned the flag and kept inserting rows and writing identity. See D-MR12 for
> what that would have cost, D-MR13 for the second place the same ownership question was being answered, and
> D-MR14 for the escape hatch that turned out not to exist on any path.
**Done when:** a McLeod-created driver later acquires its `samsara_driver_id` and phone from the next Samsara
tick — the sequence that proves §3's split works.

### M6 — Deactivation
D-MR7, with the mass-deactivation guard. The 10 stale vehicles from §7 are the acceptance case.
**Done when:** the guard is pinned by a test feeding a thin result and asserting nothing is deactivated; the
10 vehicles retire in a dry run.

### M7 — Continuous operation
2-minute interval; `last_synced_at` surfaced as "as of HH:MM" with a staleness warning; the exception report
(§7's 7 unknown drivers, 34 unmatched trailers) surfaced where an admin will see it.
**Done when:** the freshness indicator is live and a stopped agent raises the staleness state.

---

## 9. What this deliberately does not do

The full field-ownership map and risk register — every writer to the three tables, which columns are
*learned* rather than recorded, and the ten risks a roster swap creates — is in
**`CODEBASE-IMPACT-ANALYSIS.md`**, written before M3. Two of its findings need a product decision rather
than an implementation (R1: does an automated termination log a driver out of their phone; R2: the
applicant-status guard), and both are called out there.

The rule it reduces to, which M3 must build to from the first commit:
**the sync writes a fixed allowlist of columns, never a row.**

- **Does not import driver↔equipment assignment.** D43; `driver_equipment_timeline` (0150) already answers
  it. `driver.tractor_id` is empty in McLeod anyway.
- **Does not import odometer, fuel level, or position.** Samsara owns these and is fresher.
- **Does not import contact data.** There is none.
- **Does not touch tank capacity or baseline MPG.** User-owned; new vehicles go to `needsCompletion`.
- **Does not auto-merge the EFS stubs.** 36 active EFS-sourced drivers remain, none with a CDL — so they
  cannot be matched to McLeod on the one reliable key, and name matching alone is not enough to justify an
  irreversible `merge_driver`. Ships later as a review queue in `driverReconcile.ts`.
