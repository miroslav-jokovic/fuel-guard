# McLeod roster sync — drivers, tractors, trailers

**Scope:** McLeod becomes the master for the three master-data lists — drivers, tractors, trailers — with
changes reflected in FuelGuard continuously. Nothing else. Movements, loads, fuel, settlement, and CPM are
explicitly out of scope and are addressed in `../MCLEOD-SQL-SOURCE-OF-TRUTH.md` §5.

**Written:** 2026-08-23.
**Supersedes for these three entities:** the driver section of `../MCLEOD-SQL-SOURCE-OF-TRUTH.md` §4, which
this document expands and generalises.
**Prerequisite reading:** `../MCLEOD-SQL-SOURCE-OF-TRUTH.md` (why the DB and not the `ws` API; the credential
and network posture), `docs/McLeod-Testing/data-segments-and-extraction-guide.md` §3 (the extraction rules
this plan treats as binding), root `CLAUDE.md`.

---

## 1. The finding that shapes everything: how change is detected

The requirement is "real time up to date lists, and any change in McLeod reflected in our system". Before
choosing a mechanism I inspected what McLeod actually offers for change detection. Four facts:

**1. There is no row-version column anywhere.** Zero `rowversion` / `timestamp` columns across all 1,459
tables and 34,852 columns. The standard cheap watermark does not exist.

**2. The three master tables carry no row-modified timestamp.** `dbo.driver` (159 columns), `dbo.tractor`
(108), and `dbo.trailer` (80) have plenty of *business* dates — `hire_date`, `termination_date`,
`inservice_date`, `outservice_date`, `tag_expire_date` — but not one "this row was last written at" column.
Database-wide there are only 15 `modified_date` columns, on other tables. So there is no
`where modified > @watermark` query to write.

**3. The three tables are tiny.** 1,491 + 660 + 459 = **2,610 rows total.** With a ~40-column allowlist that
is a few hundred kilobytes. Reading *all of it* is cheaper than most systems' incremental queries.

**4. McLeod keeps a field-level audit trail.** `dbo.audit_log` — **45,546,200 rows** — with `table_name`,
`primary_key_values`, `changed_values`, `change_date_time`, `user_id`, `application_id`. If the three tables
are audited, this is a true change feed including *who* made the change.

### The design these facts imply

**Full-table hash diff, on a short interval, is the primary mechanism.** Not a fallback — the primary. At
2,610 rows it is correct by construction: it cannot miss a change, cannot miss a delete, cannot drift, needs
no DDL on McLeod's side, needs no watermark that a snapshot restore can corrupt, and is trivially resumable
after any failure because it holds no incremental state that matters.

`audit_log` is an **optimisation to evaluate later**, not the foundation, for four reasons:

- It is only correct if these tables are audited *and* their fields are not in `audit_log_exclude` (34 rows,
  contents unknown to us). Unverifiable until we can query.
- It captures changes made through the *application*. Bulk loads, EDI, and direct SQL may bypass it.
- Querying 45.5M rows by `change_date_time` is a table scan unless an index exists. On the carrier's
  production box that is a cost we would be imposing on them, and we do not know the index situation.
- A snapshot restore can move the watermark backwards, replaying or skipping. The hash diff is immune
  because its state is *content*, not *position*.

> **D-MR1:** primary change detection is a full-table hash diff of the three master tables on a short
> interval. `audit_log` is evaluated during M1 and adopted only as a latency optimisation on top, never as
> the sole source. **A missed change is worse than a slow change**, and the hash diff is the one that cannot
> miss.

### What "real time" can honestly mean

Two ceilings sit above any polling interval we choose, and both are outside our control:

1. **The snapshot ceiling.** `lme_analytics` is described as "the SQL snapshot taken today at 0930". If
   production is a scheduled restore, freshness is bounded by the restore cadence and **no poll interval
   matters.** Continuous sync against a daily snapshot delivers daily data, quickly. This is the single most
   important unanswered question in this plan (§6 Q1). For the *sandbox* it is irrelevant — static test data
   is ideal for building against.
2. **The agent ceiling.** McLeod is behind their firewall; FuelGuard cannot pull. The agent on their network
   polls and pushes, so end-to-end latency is `agent interval + push + apply`.

> **D-MR2:** the target is **near-real-time: a 2-minute agent interval**, giving a p95 end-to-end of under
> three minutes against a live source. We should describe it that way to the carrier and in the UI —
> "as of HH:MM", driven by `org_integrations.last_synced_at`, which already exists and is already stamped.
> A roster is not a telemetry stream; a driver hired this morning matters within minutes, not seconds, and
> claiming "real time" over a link with a restore cadence we do not control is a promise we cannot keep.

At 2,610 rows a 2-minute sweep is roughly 30 reads/hour of a few hundred KB. That is negligible for SQL
Server and comfortably inside the `/api/tms` rate limit (300 requests / 15 min, and a sweep with no changes
posts *nothing*).

---

## 2. Architecture — one pipeline, three entities

The user requirement is modularity, and the entities are structurally identical: a small master table in
McLeod, keyed `char(8)` per `company_id`, mapping onto a FuelGuard table that already has an
`identity_source` provenance column and a partial unique index per external id. So this builds as **one
parameterised pipeline instantiated three times**, not three sync services.

```
McLeod SQL Server (their network)
        │  read-only, column allowlist, company_id bound
        ▼
tools/mcleod-agent  ── SOURCE=sqlserver ─────────────────────┐
  queries.mjs      one named, parameterised, column-explicit  │  the ONLY place that
                   SELECT per entity                          │  knows McLeod's schema
  hash.mjs         stable row hash + local state.json          │
  map.mjs          McLeod row → neutral roster contract        │
        │  HTTPS outbound, Bearer fgtms_…, ≤1000-row batches   │
        ▼                                                      ┘
POST /api/tms/roster/{drivers|vehicles|trailers}
        │  token → org by hash, enabled-only  (already built + tested)
        ▼
apps/api/src/tms/                       ← new module, mirrors src/efs/ and src/psp/
  rosterIngest.ts     generic: match → resolve → apply → report
  entities/driver.ts  } per-entity config: match precedence, owned fields,
  entities/vehicle.ts } deactivation rule, contract
  entities/trailer.ts }
        ▼
drivers / vehicles / trailers   (+ mcleod_* link columns)
```

**Why the mapping lives in the agent.** `packages/shared/src/tms.ts` already states the rule and the reason:
the agent owns the vendor field mapping so FuelGuard never learns a vendor schema. That seam matters *more*
against a database than it did against the `ws` API, because a database schema is a **private** interface —
159 columns McLeod may reshape in any release with no compatibility promise. If `apps/api` learns that
`driver.id` is `char(8)` and space-padded, we are coupled to that forever and every carrier upgrade is our
problem. Keep it in one file on their side of the seam.

> **D-MR3:** the agent is the only component that speaks SQL Server or knows a McLeod column name.
> `apps/api` gains no database client. The wire contract stays provider-neutral, so a second TMS is a new
> agent mapping and zero backend change.

> **D-MR4:** `apps/api/src/tms/` is the module home, following the `src/efs/` and `src/psp/` precedent.
> Watch the 500-line file budget (`lint:filesize`, warn at 450) — `rosterIngest.ts` should be split into
> match / resolve / apply from the first commit rather than grown and split later.

### The generic pipeline

Per entity, five parameters:

| Parameter | driver | vehicle | trailer |
|---|---|---|---|
| McLeod source | `dbo.driver` | `dbo.tractor` | `dbo.trailer` |
| FuelGuard table | `drivers` | `vehicles` | `trailers` |
| Link column | `mcleod_driver_id` | `mcleod_tractor_id` | `mcleod_trailer_id` |
| Match precedence | link → `driverMatchKey(name)` → phone | link → VIN → `unit_number` | link → VIN → `unit_number` |
| Active predicate | §4.1 | §4.2 | §4.3 |

Everything else — the enrich-never-clobber rule, the `manual` claim, the mass-deactivation guard, the org
scoping, the unmatched report — is shared code written once.

---

## 3. The trap at the centre: Samsara is a join key, not just a roster

`samsara_driver_id` and `samsara_vehicle_id` are not merely identity fields. They are the join keys for every
telematics feature in the product: `hosSync.ts` (17 sites), `idleSync.ts`, `idleRollup.ts`,
`idleDutyEvidenceSync.ts`, `driverScoreSync.ts`, `driverReconcile.ts`, `efsImport/reconcile.ts`.

Switching the roster source without care produces the worst failure mode available: McLeod creates a driver,
the row has a null `samsara_driver_id`, and that person silently has no HOS, no idle evidence, and no score.
Nothing errors. Nobody notices until an audit.

So this is **not a replacement — it is a split of two responsibilities Samsara currently holds together.**

| Responsibility | Today | After |
|---|---|---|
| Who is on the list (create / deactivate) | Samsara sync | **McLeod sync** |
| Identity fields (name, CDL, medical, plate, VIN, dates) | Samsara sync | **McLeod sync** |
| The telematics link (`samsara_*_id`) | Samsara sync | **Samsara sync, link-only** |
| Office corrections | `resolveDriverUpdate` → claims to `manual` | unchanged |

> **D-MR5:** when McLeod roster sync is enabled for an org, the Samsara syncs run in **link-only mode**:
> they match against existing rows using their current precedence and write `samsara_*_id` and nothing
> else. They do **not** insert, and they do **not** run the deactivation pass — McLeod's `termination_date`
> / `outservice_date` is better evidence than absence from a telematics roster, and two systems both
> deactivating will fight each other on every tick.
>
> An unmatched Samsara driver is **reported, not created**. It means somebody is driving who is not on the
> HR roster. That is a finding worth a human looking at it, not a row to invent.

The mode is read from the existing `org_integrations` row (provider `mcleod`, `enabled`, plus a
`config.roster_master` flag), so an org without McLeod is bit-for-bit unaffected. This is the same opt-in
posture 0068 established and must be preserved — the module is selectable, not global.

> **D-MR12 (2026-08-24): for VEHICLES and TRAILERS, link-only mode writes no identity at all** — the link
> and the gateway's own measurements (odometer, fuel level, pairing), and nothing else. The driver rule
> keeps `phone` because McLeod has none; there is no asset analogue, and this is a measurement rather than
> a symmetry argument. Counted across production and the carrier's sandbox on 2026-08-24:
>
> | column | McLeod | Samsara |
> |---|---|---|
> | `vehicles.vin` | 197/198 distinct among active tractors | 186/194 |
> | `vehicles.make` / `model` / `year` | every active tractor | 188/194 |
> | `vehicles.plate` | 175/190 | **21/194** |
> | `vehicles.plate_state` | 175/190 | **0/194 — the API has no such field** |
> | `trailers.make` / `year` | every active trailer | **0/211** |
> | `trailers.model` | **no such column on `dbo.trailer`** | **0/211** |
> | `trailers.plate` | `license_no` | 9/211 |
> | `trailers.vin` | `serial_number` | never written (the parser reads `serial`; the sync drops it) |
>
> There is no asset column where Samsara is the better or the only source, so an exception would have been
> invented rather than found.
>
> **The bug this closes was an eraser, not a tie.** Both syncs build their identity patch
> unconditionally, and the Samsara parser returns `null` for a field the response omits — so a matched
> row is written `plate: null, make: null, …` on every tick. Harmless while Samsara is the only writer of
> those columns; destructive the moment McLeod is the other one. Left alone, McLeod would have set 175
> tractor plates and Samsara nulled them minutes later, with nothing raising. The trailer sync is doing
> this to 202 of 211 rows today.
>
> Unmatched assets are **reported, never created** — the vehicle insert has to invent `tank_capacity_gal`
> (it writes 0, which `learnVehicle` then unlearns) and the trailer insert invents
> `reefer_tank_capacity_gal: 50`, a constant. `applyReplacementLifecycle` keeps running in both modes: it
> stamps `samsara_missing_since` and changes no status, so it is not the deactivation pass this decision
> switches off, and under TMS mastery it is the only signal that a truck McLeod calls in-service has gone
> dark.

> **D-MR13 (2026-08-24): one flag, both sides.** `roster_master` now also gates the INGEST: `identity`,
> `create` and `retire` are refused with `409 roster_master_not_declared` unless the org has declared
> mastery. Until this gate existed the answer to "who owns the roster" was recorded in two places that
> could disagree — the Samsara syncs read the flag, while the ingest mode came from a query parameter the
> on-prem agent chose for itself. An agent started with `ROSTER_MODE=identity` against an org that had
> never declared mastery put both systems on the same columns. **A client on the carrier's network cannot
> be the one to decide a data-ownership question.** `link` mode stays ungated on purpose: it writes only
> the external link and produces the match report, which is the measurement the mastery decision is made
> from, so gating it would make the decision impossible to inform.

---

## 4. Field mapping and the active predicate

Column names below are verified against `docs/McLeod-Testing/database-schema-table-catalog.md`. Every
`char(n)` value is space-padded and must be trimmed at the agent boundary; an all-space value is `null`, not
`""`.

### 4.1 `dbo.driver` → `drivers`

| McLeod | FuelGuard | Note |
|---|---|---|
| `id` char(8) | `mcleod_driver_id` | The key. |
| `company_id` char(4) | `mcleod_company_id` | Also the mandatory query filter (§6 Q2). |
| `name` char(28), `first_name`, `name_mid_initial` | `full_name`, `first_name`, `middle_name`, `last_name` | `name` is probably "LAST, FIRST". **Confirm against real rows** — `driverMatchKey` is order-independent so matching survives a wrong guess, but the displayed name does not. |
| `cell_phone`, `phone` | `phone`, `phone_alt` | Confirm which reaches drivers. |
| `email` char(30) | `email` | 30 chars truncates real addresses. **Treat a value at exactly 30 chars as suspect and do not write it** — a truncated address is worse than none (the driver app sends to it). |
| `license_no`, `license_state` | `cdl_number`, `cdl_state` | See §4.4. |
| `license_date` | `cdl_expires_at` **or** `cdl_issued_at` | **Ambiguous and consequential** (§6 Q3). Backwards puts every driver permanently expired or permanently valid, on a compliance surface. Do not write it until confirmed. |
| `medical_cert_expire`, `medical_cert_exempt` | `medical_card_expires_at` | Feeds the DQ file. |
| `hire_date`, `termination_date` | `hire_date`, `termination_date` | See §5.3 — retention consequences. |
| `address`, `city`, `state`, `zip` | `address_line1`, `city`, `state`, `postal_code` | |
| `birth_date` | `date_of_birth` | PII. Pull deliberately because DQ needs it, not incidentally. |
| `is_active`, `status_code`, `termination_date` | `status` | The active predicate (§6 Q4). |
| `mvr_date`, `physical_date`, `fmcsa_clearinghouse_date`, `last_review_date`, `hazmat_date` | *(not now)* | These are qualification *evidence*, belonging to `qualification_records`, not to `drivers`. A strong later phase; out of scope here. |
| `tractor_id` | **do not import** | Dispatch's plan. `driver_equipment_timeline` (0150, decision D43) is authoritative for what a driver was *actually* in. Importing this creates a second, conflicting answer to a question we already answer correctly. |
| `payee_id`, `dri_uid`, `mc_login`, `tenstreet_id` | *(hold)* | Useful for later settlement / ATS linkage. |
| `social_security_no`, `race`, `sex`, `name_of_spouse`, `enginedata_pwd`, `mc_unit_password` | **never** | Not in the allowlist, not in the SELECT, not in a log line. |

### 4.2 `dbo.tractor` → `vehicles`

| McLeod | FuelGuard | Note |
|---|---|---|
| `id` char(8) | `mcleod_tractor_id` + `unit_number` | McLeod's tractor id *is* the unit number at most carriers. Confirm; if it is a surrogate, `unit_number` needs another source. |
| `serial_number` varchar(17) | `vin` | 17 chars — this is the VIN. Second match key, and `uq_vehicles_org_vin` already enforces one row per VIN. |
| `make`, `model`, `model_year` | `make`, `model`, `year` | |
| `tag`, `tag_state`, `tag_expire_date` | `plate`, `plate_state`, `registration_expires_at` | |
| `insurance_name`, `insurance_date`, `insurance_account` | `insurance_carrier`, `insurance_expires_at`, `insurance_policy` | Confirm `insurance_date` is expiry not effective. |
| `inspection_date` | `dot_annual_inspection_expires_at` | Confirm expiry vs. performed. Same class of error as `license_date`. |
| `fuel_capacity` | `tank_capacity_source`-governed | **Do not blind-write.** Tank capacity is user-owned and drives fuel detection; `samsaraVehicleSync` deliberately never clobbers it and reports new trucks in `needsCompletion` instead. Same rule here. |
| `gross_veh_weight`, `weight` | `gvwr_lb`, `tare_weight_lb` | Watch `*_um` unit columns — McLeod stores the unit separately and `company.distance_um`/`weight_um` set the context. Convert, do not assume pounds. |
| `owner`, `pay_owner`, `fleet_id` | `ownership_type` | Needs the code vocabulary. |
| `inservice_date`, `outservice_date`, `status` char(2), `service_status`, `tractor_status` | `status` | Four status-ish columns. The predicate needs their vocabulary (§6 Q4). |
| `driver1_id`, `driver2_id` | **do not import** | Same reason as `driver.tractor_id` — D43. |
| `dispatcher`, `pnn_*`, `daily_*_goal`, `*_hub` | *(ignore)* | Dispatch/planning internals. |

### 4.3 `dbo.trailer` → `trailers`

| McLeod | FuelGuard | Note |
|---|---|---|
| `id` char(8) | `mcleod_trailer_id` + `unit_number` | |
| `serial_number` char(17) | `vin` | |
| `make`, `model_year` | `make`, `year` | No `model` column on trailer. |
| `license_no`, `license_state`, `tag_expire_date` | `plate`, `plate_state`, `registration_expires_at` | Note: trailer uses `license_no`, tractor uses `tag`. |
| `min_temp`, `max_temp`, `heater_code`, `reefer_id` | **`is_reefer`** | The reefer determination. `reefer_id` populated or a temp range present ⇒ reefer. This is the column that makes the reefer-diversion rule correct later — worth getting right now. |
| `trailer_type`, `type_of` | `trailer_type` | Code vocabulary needed. |
| `length_of` + `length_of_um` | `length_ft` / `length_in` | Unit conversion, per `*_um`. |
| `volume`, `gross_veh_weight`, `weight` | `capacity_cube_ft`, `capacity_weight_lb`, `tare_weight_lb` | Unit conversion. |
| `door_type_code`, `axles` | `door_type` | Code vocabulary. |
| `is_active`, `statuscode`, `disposition_code`, `inservice_date`, `outservice_date`, `trailer_status` | `status` | Predicate (§6 Q4). |
| `tractor_id`, `is_hooked`, `disconnect_date` | **do not import** | We derive pairing ourselves (`pairing_source`, `pairing_confidence`). |
| `odometer`, `odometer_update_date`, `fuel_level` | *(ignore)* | Telematics; Samsara owns it and is fresher. |

### 4.4 The CDL / identity-field rule inverts for McLeod, and that is an improvement

`samsaraDriverSync` writes `cdl_number` **only when empty** (decision D6), with a documented reason: editing
a licence does not claim a row for the office, so a hand-corrected licence on a telematics row would be
silently reverted every sync. That was correct *for telematics*, where the licence is a convenience field.

McLeod is the carrier's system of record for driver qualification. Its `license_no`, `license_state`, and
`medical_cert_expire` are what the safety department maintains and would defend in an audit.

> **D-MR6:** for rows with `identity_source = 'mcleod'`, the CDL, medical, plate, registration, and
> insurance fields are **authoritative and refreshed every sweep**, not enrich-only. The office's escape
> hatch is unchanged: editing an identity field claims the row to `manual` via `resolveDriverUpdate`, after
> which McLeod stops writing it. This does mean a clerk who corrects a licence in FuelGuard rather than in
> McLeod will see it reverted — the correct outcome, but it must be said plainly in the UI, not discovered.

---

## 5. Schema

Migration numbers are **not pinned here** — next-numbered at execution (`lint:migrations`). Head at time of
writing is `0238_applicant_dispositions.sql`.

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

Plus `'mcleod'` added to the three `identity_source` CHECK constraints (`drivers` currently admits
`samsara | manual | efs`; `vehicles` and `trailers` admit `samsara | manual`).

### 5.2 Two things that are easy to miss and will bite

- **`merge_driver` must learn `mcleod_driver_id`.** `0203_merge_driver_preserves_dqf.sql` handles
  `efs_driver_id` by nulling it on the source row *before* coalescing onto the canonical, precisely so the
  partial unique index does not trip mid-merge. The new column needs identical treatment. **No lint gate
  covers `merge_driver` completeness** — this has to be done deliberately and pinned by a PGlite case.
- **The unique indexes refuse to build over existing duplicates**, by design (0123's posture, after the
  2026-08 fleet-duplication incident). A first sync into a fresh column cannot create duplicates, but a
  re-run after a partial failure can, so the ingest must key on `(org_id, mcleod_*_id)` and never
  blind-insert.

### 5.3 Deactivation and the retention clock

`drivers.termination_date` is not an ordinary column: it starts the retention clock, and evidence tables
(`certifications`, `qualification_records`, `documents`, `dq_exports`) are append-only and pinned in
`RETENTION_FORBIDDEN`. An automated writer needs an explicit decision.

> **D-MR7:** the McLeod sync may **set** `termination_date` from `dbo.driver.termination_date` and move
> `status` to `inactive`. It may **never clear** a termination date and never delete a row. A re-hire
> (McLeod clears the date) surfaces as a **review item**, not an automatic reactivation — mirroring the
> existing Samsara rule that reactivation stays an admin decision.
>
> `samsaraDriverSync`'s mass-deactivation guard carries over verbatim and matters more here: never
> deactivate more rows than the incoming active count, and skip the pass entirely on a thin result. A
> mis-scoped `company_id` against a 1,491-row table could otherwise terminate an entire fleet in one sweep,
> with retention consequences a re-run does not undo.

The same shape applies to vehicles and trailers via `outservice_date`, minus the retention clock.

### 5.4 Sync state

`org_integrations.config` (jsonb, already exists) carries the non-secret settings: `company_id`, the resolved
status vocabularies, which entities are enabled, and `roster_master: true`. `last_synced_at` already exists
and is already stamped by `touchLastSynced` — it becomes the "as of HH:MM" the UI shows.

The **row hashes live in the agent's `state.json`**, not in FuelGuard. They are a detail of how the agent
avoids re-posting unchanged rows; FuelGuard's ingest stays stateless and idempotent, which is what makes a
full re-push always safe.

---

## 6. Blocking questions

None of these can be guessed. Q1–Q4 gate correctness; Q5–Q6 gate connecting at all.

1. **Is `lme_analytics` a one-off restore, a scheduled restore, or a readable secondary of live?** At what
   lag? This determines whether "continuously up to date" is achievable at all in production (§1). If it is
   a daily restore, we need a different production target and should say so now rather than after building.
2. **Which of the 4 rows in `dbo.company` is the carrier?** Are any others in scope? 1,491 McLeod driver rows
   against ~248 active FuelGuard drivers — some of that gap is terminated, some is other companies, and we
   cannot write one correct query until we know which.
3. **`driver.license_date` — issue or expiry?** Same question for `tractor.inspection_date` and
   `tractor.insurance_date`. Getting these backwards is a compliance-surface error.
4. **The status vocabularies.** `driver.status_code` char(4) + `reason_for_leaving` char(3);
   `tractor.status` char(2) + `service_status` + `tractor_status`; `trailer.statuscode` char(4) +
   `disposition_code` + `trailer_status`. Which combinations mean *in service / currently employed*? Their
   `dbo.code` and `dbo.reason_code` tables hold the answer.
5. **A dedicated `fuelguard_ro` login with a column allowlist** (see `../MCLEOD-SQL-SOURCE-OF-TRUTH.md`
   §2.2–2.3), and the same for production. `db_datareader` grants SELECT on `social_security_no` and the
   payroll and banking columns.
6. **Network bridge**: agent on their box (recommended) or a tunnel. Unchanged and still open since the
   2026-08-11 plan.

Two more that M1 answers by inspection rather than by asking:

7. Are `driver`, `tractor`, `trailer` covered by `audit_log`, and are their fields in `audit_log_exclude`?
   Is `audit_log.change_date_time` indexed? (Decides whether D-MR1's optimisation is available.)
8. Is `driver.name` "LAST, FIRST"? Is `tractor.id` the unit number the carrier actually uses?

---

## 7. Execution

One step per branch (`claude/<topic>`), PR to `main`, merge after CI. Mark steps **DONE** in place with the
migrations shipped and the gates run — this document is the memory between sessions.

### M0 — Credential hygiene *(not blocked, do first)*
Gitignore `docs/McLeod-Testing/` (it holds a plaintext password and is currently untracked but **not**
ignored — one `git add -A` publishes it; `docs/psp-docs/` is already ignored for this reason at
`.gitignore:80`). Rotate that password. Consider scrubbing the internal host IP from the catalog header
before that document is ever committed.
**Done when:** `git check-ignore docs/McLeod-Testing/setup.md` matches, and the carrier has rotated.

### M1 — Connectivity and reconnaissance *(blocked on Q5, Q6)*
`SOURCE=sqlserver` in `tools/mcleod-agent` + `queries.mjs` with the three column-explicit, `company_id`-bound
SELECTs, run from inside their network. In the same session, answer Q7 and Q8 by inspection, and capture a
**de-identified fixture** of each entity for the test suite.
**Done when:** row counts per `company_id` are reported for all three tables and match the carrier's
expectation; the fixture files exist; Q7/Q8 are answered in §6 in place.

*This is the step that also proves the `company_id` filter, which every later step depends on.*

### M2 — Schema
The migration from §5.1, `merge_driver` updated per §5.2, and a PGlite matrix pinning: the merge case, the
unique indexes, and the `identity_source` constraint.
**Done when:** `pnpm test` green with the new matrix printing its `RESULT` line; `lint:migrations`,
`check-rls.mjs`, `lint:comment-claims` green.

### M3 — Contracts and link-only ingest
`tmsDriverInput` / `tmsVehicleInput` / `tmsTrailerInput` in `packages/shared/src/tms.ts`; the generic
`apps/api/src/tms/rosterIngest.ts` + three entity configs; three routes under `/api/tms/roster/*`.
Run in **link-only mode**: write `mcleod_*_id` onto matched rows and change nothing else.

Then produce **the match report** — how many of each entity match, how many McLeod actives have no FuelGuard
row, how many FuelGuard actives are absent from McLeod.
**Done when:** the report is produced against real sandbox data and reviewed. **This report is the go/no-go
for M4–M6** and is worth having before any further argument about semantics.

Tests: fixture-driven with an injectable row-lister (the `listerOverride` pattern from `samsaraDriverSync`),
so CI never needs SQL Server. `expectOrgScoped` on every query via `supabaseRecorder`.

### M4 — Identity writes
Turn on field writes for matched `identity_source = 'mcleod'` rows only, per §4 and D-MR6. Still no creation,
still no deactivation.
**Done when:** a change made in the McLeod sandbox appears in FuelGuard within one sweep, and an
office-edited field claims to `manual` and stops being overwritten — both pinned by tests.

### M5 — Creation, and the Samsara demotion
McLeod creates rows. `samsaraDriverSync` / `samsaraVehicleSync` / `samsaraTrailerSync` drop to link-only when
`config.roster_master` is set (D-MR5). Unmatched Samsara records are reported, not created.

> **Shipped in two parts.** The first pass demoted `samsaraDriverSync` only; `samsaraVehicleSync` and
> `samsaraTrailerSync` never learned the flag and kept inserting rows and writing identity — see D-MR12
> for what that would have cost and D-MR13 for the second place the same question was being answered.
> Both are now demoted, and the ingest is gated to match.
**Done when:** a driver created in McLeod appears in FuelGuard and subsequently acquires its
`samsara_driver_id` from the next Samsara tick — the sequence that proves §3's split works and that HOS will
attach.

### M6 — Deactivation
`termination_date` / `outservice_date` handling per D-MR7, with the mass-deactivation guard.
**Done when:** the guard is pinned by a test that feeds a thin result and asserts nothing is deactivated.

### M7 — Continuous operation
Agent interval to 2 minutes; `last_synced_at` surfaced in the UI as "as of HH:MM" with a staleness warning;
the unmatched/exception report surfaced somewhere an admin will actually see it.
**Done when:** the freshness indicator is live and a deliberately stopped agent raises the staleness state.

### Out of scope until all of the above ships
Movements, loads, fuel, settlement, qualification evidence, CPM. They are well documented in
`docs/McLeod-Testing/` and they will still be there.

---

## 8. What this deliberately does not do

- **Does not import driver↔tractor assignment** (`driver.tractor_id`, `tractor.driver1_id`,
  `trailer.tractor_id`). D43 makes the duty segment the truth about equipment and dispatch's plan merely a
  plan; `driver_equipment_timeline` (0150) already answers "what were they actually in" correctly. A second
  answer would be a regression dressed as data.
- **Does not import odometer, fuel level, or position.** Samsara owns these and is fresher.
- **Does not touch tank capacity or baseline MPG.** User-owned, drives fuel detection; new vehicles get
  reported in `needsCompletion` exactly as the Samsara path does today.
- **Does not auto-merge the EFS stubs.** 0204 measured 81 of 248 "active" drivers as fuel-card identities
  rather than employees, and a real HR roster is the first thing that can resolve them — but `merge_driver`
  is irreversible and touches DQF evidence, so that ships as a **review queue** in a later step
  (`driverReconcile.ts` is the existing home).
