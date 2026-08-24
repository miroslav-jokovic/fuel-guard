# McLeod field gap — finishing drivers, tractors and trailers

**Scope:** widen the roster field set from the 12/11/9 columns the pipeline carries today to everything
McLeod holds that FuelGuard has a home for. The pipeline itself is done and deployed; this is about
*what flows through it*. Movements, loads, settlement, accounting and CPM stay out of scope.

**Written:** 2026-08-24, after M2–M6 shipped (migrations 0239–0241 deployed to production).
**Prerequisite reading:** `MCLEOD-ROSTER-SYNC-PLAN.md` §4 (the verified field mapping — this document
extends it and does not restate it), `CODEBASE-IMPACT-ANALYSIS.md`, root `CLAUDE.md`.

---

## 1. The rule this plan is written under

> **D-FG1: a column nobody has counted is not mapped.** Every row in §3 carries either a measured
> coverage number or a named question in §7 that blocks it. The roster plan's §4 exists because three
> first-draft assumptions were wrong on a compliance surface — `name` was not "LAST, FIRST",
> `license_date` was not ambiguous, `inspection_date` ran the opposite way to every other date. The
> cost of guessing is not a bug, it is a wrong licence expiry on a DQ file.
>
> Where a question is unanswered the fallback is written next to it, and **the fallback is always
> "do not map"** — never "assume the common case".

---

## 2. What §4 already settled, so it is not re-litigated

Recorded here because two of these look like open questions and are not:

| Question | Answer | Consequence |
|---|---|---|
| Which tractor insurance date is the expiry? | **None.** `insurance_date`, `liability_end_dt` and `insurance_name` are **0 populated** at this carrier | `vehicles.insurance_carrier` / `_policy` / `_expires_at` get **no McLeod source**. Closed, not deferred. |
| Does McLeod have driver contact data? | **No.** `email`, `cell_phone`, `phone` are 0 of 1,463 | Samsara stays the only phone source (D-MR5). Closed. |
| Is `trailer.serial_number` usable as a VIN? | Yes, 232 of 240 | **Already mapped and shipping.** FuelGuard held zero trailer VINs before this. |
| Reefer determination? | `trailer_type = 'R'` (V=187, R=45, blank=8) | Already mapped. `reefer_id`/`min_temp`/`max_temp`/`heater_code` are all 0 populated. |
| `tractor.inspection_date` direction? | **Performed**, 175/175 in the past | Already mapped, expiry derived at +1 year in `vehiclePatch`. |

---

## 3. The gap

Coverage numbers are McLeod-side and come from §4 where present. "blocked" names the §7 question.

### 3.1 Trailers — the largest gap, and the only entity behind its sibling

`vehicles` already receives registration and inspection dates; `trailers` does not, from the same
columns on a structurally identical table. That asymmetry is not a decision anybody made.

| FuelGuard | McLeod | Status |
|---|---|---|
| `trailer_type` | `trailer_type` | blocked C3/D2 — **⚠ this row said "ready" in the first draft and that was wrong.** The plumbing is trivial (the agent already SELECTs the column and discards it after deriving `is_reefer`) but the destination is **constrained**: `CHECK (trailer_type in ('dry_van','reefer','flatbed','tanker','hopper','other'))`, verified in production 2026-08-24, currently `reefer:46, dry_van:13, null:152`. McLeod's codes are single letters — `V`=187, `R`=45. `R → reefer` is verified (§4.3). **`V → dry_van` is not.** "V is obviously Van" is exactly the kind of inference D-FG1 forbids. |
| `registration_expires_at` | `tag_expire_date` | blocked C1 (coverage + direction) |
| `dot_annual_inspection_expires_at` | `inspection_date` | blocked C1 — and if it is a *performed* date like the tractor's, it needs the same +1y derivation |
| `purchased_at` | `purchase_date` | blocked C1 |
| `length_ft` | `length_of` + `length_of_um` | blocked C2 (units) |
| `capacity_cube_ft` | `volume` + `volume_um` | blocked C2 |
| `capacity_weight_lb` | `gross_veh_weight` + `_um` | blocked C2 |
| `tare_weight_lb` | `weight` + `weight_um` | blocked C2 |
| `door_type` | `door_type_code` | blocked C4 (vocabulary) |
| `ownership_type` | `ownership` | blocked C6 (vocabulary) |
| **`axle_count`** *(new column)* | `axles` | blocked C5 |
| **`height_in`, `width_in`** *(new columns)* | `height`+`_um`, `width`+`_um` | blocked C2 |

### 3.2 Vehicles

| FuelGuard | McLeod | Status |
|---|---|---|
| `gvwr_lb` | `gross_veh_weight` + `_um` | blocked B3 (units) |
| `tare_weight_lb` | `weight` + `weight_um` | blocked B3 |
| `purchased_at` | `purchase_date` | blocked B1 |
| `irp_account` | `irp_code` | blocked B2 (coverage) |
| `ownership_type` | `owner` / `pay_owner` | blocked B4/B5 (vocabulary) |
| `fuel_type` *(a Postgres enum)* | `fuel_type_code` | blocked B7 — needs a mapping onto the enum, not a passthrough |
| `axle_count` | `axle_number_code` | blocked B8 — it is a **code**, not a number |
| `insurance_carrier` / `_policy` / `_expires_at` | — | **closed**, §2 |
| `tank_capacity_gal` | `fuel_capacity` | **create-only seed**, see D-FG5; blocked B9 |

### 3.3 Drivers — nearly complete already

| FuelGuard | McLeod | Status |
|---|---|---|
| `driver_type` | `type_of` | blocked A1 — company vs owner-operator gates settlement and CPM later |
| `cdl_class` | `drvr_class` | blocked A2 |
| `home_terminal_id` | `home_location_id` | blocked A3 **and** on terminals existing — see D-FG6 |
| `cdl_issued_at`, `cdl_restrictions`, `medical_examiner_name`, `medical_registry_number`, `emergency_contact_*` | — | **no McLeod source.** Closed. |
| `phone`, `phone_alt`, `employee_id` | — | see §4 — `employee_id` is not a mapping question |

---

## 4. Two defects this analysis surfaced that are not field mapping

Both are measured, both are silent, and both break the *next* phase rather than this one. They are
cheap now and expensive after loads ingest goes live.

### F0a — nothing downstream can resolve a McLeod driver

`ingestLoads` resolves a driver **only** by `drivers.employee_id`; `ingestDriverTimeOff` by
`employee_id` or `samsara_driver_id`. Measured in production 2026-08-24:

```
drivers: 271 total · employee_id populated on 0 · mcleod_driver_id populated on 0
```

So the roster link the whole integration is built on **is read by nothing outside the roster module**.
A McLeod load carrying a McLeod driver id would resolve to nobody, be reported as unmatched, and land
with `driver_id = null`. The fix is a choice — populate `employee_id` from `dbo.driver.id`, or teach
the two ingests the `mcleod_driver_id` key — and it is a decision, not a mapping:

> **D-FG7:** the two ingests learn `mcleod_driver_id` as an additional match key. `employee_id` is
> **not** overwritten: it is an office-owned field with its own meaning at carriers that use it, and
> quietly filling it with a vendor's surrogate key would make it unusable for the thing it is for.

### F0b — the trailer prefix is normalised in exactly one place

`trailerUnitMatchKey` strips FuelGuard's `R` prefix so `R532159` matches McLeod's `532159`. The roster
ingest uses it. **`tmsLoadIngest` and `tmsIngest` (movements) both match trailers by exact
`unit_number` and do not.** Measured effect of normalisation on the roster: matches went from 157 of
235 to 201. So roughly 44 reefers would silently fail to attach to their loads and movements — and
reefers are exactly the trailers the movement feed exists to identify.

> **D-FG8:** both ingests use `trailerUnitMatchKey`. It already lives in `packages/shared`; the roster
> module is simply the only caller.

---

## 5. A contradiction to settle before anything else

`MCLEOD-ROSTER-SYNC-PLAN.md` §4.1 lists `name_of_spouse` under **"never — not in the allowlist, not in
the SELECT, not in a log line"**, alongside `social_security_no`, `race` and `sex`.

`tools/mcleod-agent/queries.mjs` **reads it**, because this carrier stores the driver's email address
there — all 164 active drivers have an `@` in it while `driver.email` is empty on all 1,463 rows. The
code documents the finding and validates the value before sending it.

Both statements shipped to `main` and only one can be true. The code's reasoning is evidence-based and
almost certainly right, but the doc is what the next person reads, and a PII list that is wrong in
either direction is dangerous: it either invites someone to rip out a working mapping, or it under-states
which sensitive columns are actually being read.

> **D-FG9:** the doc is corrected to record the local convention and the validation, and the "never"
> list keeps `social_security_no`, `race` and `sex` only. **The PII allowlist has one home**, and it is
> `queries.mjs`; the plan document describes it and never contradicts it.

---

## 6. Decisions

> **D-FG2 — units are read, never assumed.** Every dimension and weight column has a sibling `*_um`.
> `gvwr_lb` and `tare_weight_lb` are pounds and `length_ft` is feet; McLeod stores the unit separately
> and `company.distance_um` / `weight_um` set the default. A single unexpected value makes a blind
> conversion wrong on every row. The conversion table is built from the counted `*_um` values (§7 B3,
> C2) and an unrecognised unit **skips the row's dimension fields** rather than guessing.

> **D-FG3 — code columns map through an explicit vocabulary, in the agent.** `owner`, `pay_owner`,
> `type_of`, `fuel_type_code`, `axle_number_code`, `door_type_code` and `ownership` are `char(n)` codes
> whose meanings live in `dbo.code`. D-MR3 puts vendor knowledge in the agent, so the code→value
> mapping goes there and FuelGuard is handed a value from its own vocabulary. An unmapped code sends
> **nothing** for that field and is reported, so a new code at the carrier degrades to a null rather
> than writing a string no FuelGuard query recognises. `vehicles.fuel_type` is a Postgres enum and a
> passthrough would simply fail the insert.

> **D-FG5 — `fuel_capacity` seeds a NEW truck only, never an existing one.** Today `create` mode writes
> `tank_capacity_gal = 0` and reports the unit in `needsCompletion`, which means the truck drives no
> fuel detection until a human types a number. McLeod's spec figure is a better *starting* value than
> zero. It must never touch an existing row: `learnVehicle` refines that column from observed fills and
> a static spec number would silently degrade every fuel anomaly on that truck. Conditional on B9
> showing credible values; if the column is sparse or implausible, the zero stays.

> **D-FG6 — `home_terminal_id` is blocked on terminals, not on McLeod.** It is a uuid FK to `terminals`,
> which is keyed by `code`. Mapping `home_location_id` requires the carrier's locations to exist as
> FuelGuard terminals first. That is a separate import with its own decisions; this plan stops at
> reporting the distinct values (A3) so the size of that job is known.

---

## 7. Blocking questions — the inspection pack

> **D-FG10: the recon is a COMMAND, not a query somebody pastes into an editor.**
> `tools/mcleod-agent/inspect.mjs` holds the questions; `node agent.mjs --inspect` runs them and prints
> JSON. The reason is not tidiness. **The answers that decide the cutover can only ever be measured by
> somebody else:** `lme_analytics` is a one-off restore taken 2026-08-21 09:46, and production is `lme`
> on the same instance, which our login cannot read (`HAS_DBACCESS('lme') = 0`). A recon that depends
> on one person's shell access is the wrong shape for a question only the carrier's IT can answer.
>
> `pnpm lint:mcleod-recon` enforces what makes it safe to hand over, so its reviewer does not have to
> read 22 SQL statements closely: every
> statement is a single `SELECT`; `social_security_no` and seven siblings appear **nowhere at all**;
> names, licences, addresses and contacts may be **counted but never returned**; and anything reading
> `driver` / `tractor` / `trailer` binds `@companyId`, because `dbo.company` holds four legal entities
> in the same tables. Each violation class is verified to fail the gate.
>
> **⚠ The CI step is NOT wired yet** and the gate is therefore advisory until it is. The push that
> would have added it was rejected — the token this work runs under has no `workflow` scope, so
> `.github/workflows/ci.yml` cannot be edited from here. The one-line step is prepared and needs a
> commit from an account that can write workflows; until then `lint:mcleod-recon` only runs when
> somebody types it. Saying otherwise in this document would be exactly the kind of unverified claim
> D-FG1 exists to prevent.

Each question's fallback is **do not map**.

| # | Question | Blocks |
|---|---|---|
| A1 | `driver.type_of` distribution — is it the company/owner-operator split? | `driver_type` |
| A2 | `driver.drvr_class` distribution | `cdl_class` |
| A3 | `driver.home_location_id` distinct values | sizing D-FG6 |
| B1 | `tractor.purchase_date` coverage | `purchased_at` |
| B2 | `tractor.irp_code`, `dot_number` coverage | `irp_account` |
| B3 | `tractor` `gross_veh_weight_um` / `weight_um` distinct values + ranges | `gvwr_lb`, `tare_weight_lb` |
| B4–B8 | `owner`, `pay_owner`, `type_of`, `fuel_type_code`, `axle_number_code` distributions | `ownership_type`, `fuel_type`, `axle_count` |
| B9 | `tractor.fuel_capacity` coverage + range | D-FG5 |
| C1a–C1c | `trailer` `tag_expire_date` / `inspection_date` / `purchase_date` — coverage and past/future | the three trailer dates |
| C2 | `trailer` `length_of_um` / `volume_um` / `weight_um` / `gross_veh_weight_um` distinct values | all trailer dimensions |
| C3 | `trailer.trailer_type` distribution | `trailers.trailer_type` (see §3.1 — the destination has a CHECK) |
| C4–C6 | `door_type_code`, `axles`, `ownership` distributions | `door_type`, `axle_count`, `ownership_type` |
| D1–D2 | `dbo.code` — which columns have a vocabulary, and the values for the ones above | D-FG3 |

---

## 7b. ⚠ F3–F7 are now sequenced BEHIND the first run

Verified 2026-08-24: production carries **zero** McLeod links on all three tables and no
`org_integrations` row for the provider. Nothing has ever moved through this pipeline
(`MCLEOD-ROSTER-SYNC-PLAN.md` §7b), so every field added here would be added to a foundation no run
has exercised.

> **D-FG11: F3–F7 wait for M-R.** Not because they are blocked on the recon — they are, and M-R's first
> step (`--inspect`) supplies it — but because each new field makes the first run harder to diagnose.
> A sweep that writes eight columns and goes wrong has eight suspects; one that writes the current set
> and goes wrong has a short list. The recon and the first run need the same thing anyway: one session
> on a machine with the VPN up.

F1 and F2 are already done and are unaffected: both fixed defects in code paths the first run will
exercise, which is why they went first.

---

## 7c. RECON RESULTS — measured 2026-08-24, 23 questions, 0 errors

Run with `pnpm mcleod:inspect` against `lme_analytics` as company `TMS`. **The gap is far smaller than
this document assumed**, because most of the candidate columns are empty at this carrier. That is the
rule in §1 earning its keep: the plan would otherwise have built unit-conversion machinery for columns
holding nothing.

### Mappable — real data, verified coverage

| Target | Source | Coverage | Note |
|---|---|---|---|
| `vehicles.purchased_at` | `tractor.purchase_date` | **190 / 190** | all past |
| `trailers.purchased_at` | `trailer.purchase_date` | **224 / 235** | all past |
| `trailers.dot_annual_inspection_expires_at` | `trailer.inspection_date` **+1 year** | **228 / 235** | 228/228 in the past — a PERFORMED date, exactly like the tractor's, so it takes the same §396.17 derivation |
| `trailers.axle_count` *(new column)* | `trailer.axles` | **193 / 235** | every populated row is `2` |
| `drivers.driver_type` | `driver.type_of` | **164 / 164** | `C` = 148, `O` = 16 — the shape of a company / owner-operator split, but see below |

### Not McLeod's — a SOURCE-ROUTING answer, not a gap

> **D-FG13: "McLeod holds nothing here" assigns the column to another source; it does not close it.**
> This document's first draft framed the empty columns as losses. That was wrong. **Five systems feed
> this database** — Samsara, McLeod, FleetPal, EFS and PSP/FMCSA — and each owns different columns.
> `tank_capacity_gal` is the clearest case: it is set locally today and **FleetPal owns it next**, so
> `tractor.fuel_capacity` being empty on 190 of 190 costs nothing whatsoever. The same reading applies
> to the tractor weights, the axle and door codes, and the fuel type. The question a measured NULL
> answers is *"which system owns this?"* — and the answer here is simply *"not this one."*

| Target | Source | Measured |
|---|---|---|
| `drivers.cdl_class` | `drvr_class` | NULL on all 164 |
| `vehicles.irp_account` | `irp_code` | 0 of 190 |
| `vehicles.fuel_type` | `fuel_type_code` | NULL on all 190 |
| `vehicles.axle_count` | `axle_number_code` | NULL on all 190 |
| `vehicles.gvwr_lb`, `tare_weight_lb` | `gross_veh_weight`, `weight` | NULL |
| `trailers.registration_expires_at` | `tag_expire_date` | **0 of 235** |
| `trailers.door_type` | `door_type_code` | NULL on all 235 |
| `trailers.capacity_cube_ft`, `capacity_weight_lb`, `tare_weight_lb` | `volume`, `gross_veh_weight`, `weight` | NULL |
| `vehicles`/`trailers` equipment type | `tractor.type_of` = `TR` ×190; `trailer.ownership` = `O` ×235 | a single value is not information |

### Three decisions this overturns

> **D-FG5 is DEAD.** `tractor.fuel_capacity` is populated on **0 of 190** tractors. The idea of seeding a
> new truck's `tank_capacity_gal` from McLeod's spec figure has no data behind it. The zero stays, and
> `needsCompletion` remains the only answer.

> **D-FG6 was wrong about what `home_location_id` IS.** It is not a terminal code. It holds **164
> distinct values, one per driver**, each name-shaped (initials + state). These are per-driver home
> locations, not a small set of company terminals, so `drivers.home_terminal_id` has no source here and
> no terminals import would help. Closed.

> **D-FG2 is nearly moot.** The unit columns were the biggest piece of planned work. `weight_um` reads
> `LB` but every weight column it governs is NULL; `length_of_um` and `volume_um` are NULL outright.
> The one dimension with data is `trailer.length_of`, identical at **53 on all 235 rows** — and with its
> unit column NULL, "53 means feet" is an inference, not a measurement. Per D-FG1 it stays unmapped;
> a column whose every row is the same value was never worth much anyway.

### `ownership_type` and `trailer_type` — populated, but undocumented

`tractor.owner` (SILVMEIL ×174, SCORELIL ×9, six singletons) and `tractor.pay_owner` (`D` ×174, `B` ×9,
`O` ×7) clearly encode ownership, and `trailer.trailer_type` is `V` ×184 / `R` ×44 / null ×7. **None of
these codes appears in `dbo.code`** — checked twice, once by column name (D2) and once by shape across
the equipment and driver aliases (D3). The near-miss is instructive: `TRL.trl_type_code` exists with ten
codes and is a LENGTH vocabulary (`53` = "53 FT DRY VAN", `48F` = "48 FT FLAT BED"), a different column
entirely.

> **D-FG12: `V → dry_van` stays unmapped, and `R → reefer` ships.** `R` is verified (§4.3, and
> `is_reefer` already derives from it). `V` is almost certainly Van and that is exactly why it stays out:
> "almost certainly" is the inference D-FG1 forbids, and `trailers.trailer_type` carries a CHECK that
> would make a wrong guess permanent. The same applies to `pay_owner`'s `B`/`D`/`O` and to
> `driver.type_of`'s `C`/`O` — the distributions are suggestive, the meanings are undocumented.
>
> **These four are a question for the carrier, not for more SQL.** One email answers all of them, and
> until it does they are unmapped rather than guessed.

---

## 7d. Schema now, display later — and the one field class that must never be hidden

The proposal: create the columns even where McLeod has nothing, and simply don't display a field that
has no data, so the structure is ready when another source fills it. Checked against the database
2026-08-24, and it is **already true almost everywhere**:

| Table | Columns from §7c that do NOT exist |
|---|---|
| `vehicles` | **none** — `axle_count`, `fuel_type`, `gvwr_lb`, `tare_weight_lb`, `irp_account`, `ownership_type`, `purchased_at`, `height_in`, `width_in`, `length_in` all exist |
| `drivers` | **none** — `cdl_class`, `driver_type`, `home_terminal_id`, `cdl_issued_at`, `cdl_restrictions` all exist |
| `trailers` | `axle_count` (added by 0242), `height_in`, `width_in` |

> **D-FG14: the columns exist; the display rule is recorded now and built when there is a surface to
> build it on.** `vehicles` has had `height_in`/`length_in`/`width_in` since 0119 and `trailers` had
> only `length_in` — an asymmetry nobody chose. 0242 closes it. Neither new column has a source today
> (McLeod's height and width sit behind NULL `*_um` units, so they cannot be converted) and **nothing
> writes them**; they are reserved for FleetPal, which owns equipment specs next.

### Why the hide-when-empty rule is not built yet

**None of these fields is displayed anywhere.** `gvwr_lb`, `tare_weight_lb`, `capacity_cube_ft`,
`door_type` and `ownership_type` have **zero references in `apps/web/src`**; `VehicleDetailPage` shows
tank, baseline MPG, odometer and open anomalies, and there is no equipment-spec surface at all. A
hide-when-empty mechanism today would be a rule with no caller — the same speculative work that
`F5b` was just cancelled for.

So the rule is written down instead, to be applied by whoever builds that surface:

> **Hide a field when it is empty for EVERY row in the org** — not when it is empty for the row in
> front of you. Per-row hiding makes two trailers show different fields and reads as a bug; org-wide
> emptiness genuinely means "this carrier does not track this", which is worth not showing.

> **⚠ NEVER hide an empty COMPLIANCE field.** An empty `dot_annual_inspection_expires_at`,
> `medical_card_expires_at` or `cdl_expires_at` is not "nothing to display" — it is **an unrecorded
> inspection or an expired qualification**, which is precisely what those surfaces exist to surface.
> Hiding it would turn the absence of evidence into the appearance of compliance, on the one screen
> where that inversion is most expensive. Empty compliance fields render as a gap, loudly.
>
> This matters sooner than it looks: `dot_annual_inspection_expires_at` is written by the McLeod sync
> for 228 trailers and 175 tractors and is currently **read by nothing at all**. The first surface to
> read it inherits this rule.

---

## 8. Execution

One step per branch, PR to `main`, merge after CI. Mark **DONE** in place with the migrations shipped
and the gates run — this document is the memory between sessions.

### F1 — the two resolution defects — **DONE 2026-08-24**
D-FG7 and D-FG8: `mcleod_driver_id` as a match key in `tmsLoadIngest` and `tmsIngest`;
`trailerUnitMatchKey` in both trailer lookups.
**Done when:** a load carrying a McLeod driver id and an unprefixed reefer unit resolves both, pinned by
tests in each ingest; and the org-scoping assertion still holds via `expectOrgScoped`.
**What shipped:** `apps/api/src/tms/entityLookup.ts` — one collision-safe resolver replacing four
hand-rolled `Map.set` loops, which also fixed a third defect those loops had (a key claimed by two rows
kept whichever came last). An unresolvable trailer is now REPORTED; before it produced a null and
appeared in no report. **Verified by:** 18 new cases across `entityLookup.test.ts`,
`tmsLoadIngest.test.ts` and `tmsIngest.test.ts`; `apps/api` 2,094 tests green; `lint:filesize`,
`lint:funcsize`, `lint:comment-claims`, `lint:upserts`, `lint:boundaries`, `lint:tests`, eslint,
`tsc --noEmit`.

### F2 — settle the contradiction — **DONE 2026-08-24**
D-FG9. Doc-only.
**Done when:** §4.1's "never" list and `queries.mjs` agree, and the plan names `queries.mjs` as the one
home of the PII allowlist.
**What shipped:** `name_of_spouse` moved out of the "never" row into its own row recording the local
convention and `usableEmail()`'s truncation test; D-FG9 records that the SELECT is the fact and the
table is what gets fixed when they disagree.

### F3 + F4 — the fields the recon found — **DONE 2026-08-24 (migration 0242)**
Four fields, and only four — §7c is why. `vehicles.purchased_at`, `trailers.purchased_at`,
`trailers.dot_annual_inspection_expires_at` (derived +1 year from a performed date, exactly as the
tractor path does) and `trailers.axle_count`, a new column.

**What shipped:** migration 0242 adds `trailers.axle_count` and re-attaches the two asset claim
triggers with the widened column lists — `rosterFields.claimParity.test.ts` failed the moment the
patch builders learned a field the triggers had not, which is the drift it exists to catch, and it
caught it on the first run.

**Deliberately absent:** `trailers.registration_expires_at`. McLeod's `tag_expire_date` is populated
on **0 of 235** active trailers while the tractor equivalent has 175, so the asymmetry between the two
paths is now a measured decision rather than an oversight — and there is a test asserting the trailer
path never writes it, so nobody "fixes" it later by symmetry.

**Verified by:** `the fields the recon found` (5 cases) and `report mode` (6 cases) in
`rosterIngest.test.ts`; the parity gate; `lint:migrations`, `check-rls`, `lint:mcleod-recon`.
**Done when:** a trailer's registration expiry appears in FuelGuard within one sweep; the inspection date
uses the same derivation as the tractor path if C1 shows it is a performed date; `rosterFields.claimParity`
still passes, which requires 0241's trigger column list to grow with the mapping.

### F5b — dimensions and weights — **CANCELLED 2026-08-24**
The largest single piece of planned work, and it has no data behind it. Measured: `length_of_um`,
`volume_um` and `gross_veh_weight_um` are NULL; `weight_um` reads `LB` but every column it governs is
NULL. The one dimension with values is `trailer.length_of`, identical at **53 on all 235 rows**, whose
unit column is NULL — so "53 means feet" is an inference and D-FG1 forbids it. `trailers.height_in`
and `width_in` are not added: columns with no source are schema debt.

### F5 — the four undocumented codes *(blocked on the CARRIER, not on SQL)*
`trailer_type` `V`/`R`, `pay_owner` `B`/`D`/`O`, `tractor.owner`, and `driver.type_of` `C`/`O`. All are
populated; none appears in `dbo.code`, checked by column name (D2) and again by shape across the
equipment and driver aliases (D3). `fuel_type`, `door_type`, `cdl_class` and `vehicles.axle_count` left
this step entirely — their source columns are empty (§7c).
**Done when:** the carrier confirms the four vocabularies. One email, not more reconnaissance.

### F6 — tank capacity seed — **CANCELLED 2026-08-24**
`tractor.fuel_capacity` is populated on 0 of 190. It was never McLeod's field: capacity is set locally
today and **FleetPal owns it next** (D-FG13). `learnVehicle` keeps refining it from observed fills and
`needsCompletion` keeps reporting the new trucks that need one.

### F7 — home terminals — **CANCELLED 2026-08-24**
`home_location_id` is not a terminal code. It holds **164 distinct values, one per driver**, each
name-shaped — per-driver home locations, not a company's terminals. There is nothing to map and no
terminals import that would help.

---

## 9. What this deliberately does not do

- **Endorsements and qualification evidence.** `hazmat_certified`, `tanks_endorsement`,
  `doubles_certified`, `mvr_date`, `fmcsa_clearinghouse_date`, `last_review_date`. Their home is
  `certifications` / `qualification_records`, which are **append-only and pinned in
  `RETENTION_FORBIDDEN`** — a sync writing there is a materially different thing from refreshing a
  roster column, because corrections become new rows and it needs supersede and dedup rules of its own.
  Deferred to its own phase by decision, 2026-08-24.
- **`driver.tractor_id`, `tractor.driver1_id`, `trailer.tractor_id`.** D43: the duty segment is the truth
  about equipment and dispatch's plan is a plan. `driver_equipment_timeline` already answers this.
- **Odometer, fuel level, position.** Samsara owns these and is fresher.
- **Accounting, settlement, CPM, maintenance.** Documented in `docs/McLeod-Testing/`; a later phase.
