# Annual vehicle inspection — §396.17 in the maintenance section (2026-08-31)

The ask: the maintenance inspector fills a form, clicks print, and the annual inspection comes out
correctly — and the finished report files itself onto the truck's record, so the truck & trailer
files being built later already have content. Truck-file *pages* are explicitly out of scope; only
the storage they will read is built here.

Today the record is made by opening a J.J. Keller form 14834 (Rev. 1/22) PDF in a PDF editor,
typing values on top of it as free annotations, and printing onto the pre-printed carbonless stock.
There is no validation, no stored record, no expiry, no audit trail and no digital copy — for a
document §396.21 requires the carrier to keep for **fourteen months** and produce on demand to a
federal, state or local official.

**This plan takes the ask and adds one thing to it:** the form does not merely capture what the
inspector typed, it *derives* what may lawfully be certified. Pass/fail, item applicability and the
§396.19 inspector box are all computed from data the platform holds, never typed by the person
signing. That is the difference between a faster PDF editor and a compliance record.

**Status: COMPLETE 2026-08-31, after a second pass.** A0–A7 shipped via PRs #410–#419 (migrations 0279–0282). The owner then used the page and found four things — §8 records them and the B1–B5 steps that answered them, including **A8, which was ruled against and then reversed**: the truck copy IS printed onto the pre-printed pads, so the calibration was built after all (PR #423, migration 0283). §6 carries what remains open, and §7 is the register.**

D-AVI7 was **amended on the first day**
(owner ruling, §3) — the stored report is the Keller template with our values stamped onto it, not
a layout of our own. §2.1 carries the argument that was overturned and what the ruling costs, and
§2.5 carries the stamping spike that measured whether it can be done precisely. D-AVI13 and D-AVI14
were added the same day: the form opens pre-filled, the PDF does not exist until finalize, and the
inspector can preview the page before signing it. §1's measurements are the pre-A0 baseline, taken
against production and `origin/main` at `ace8f80`. §7 is the register.

Decision IDs are `D-AVI*`. Steps are `A0`–`A8`.

---

## 1. Measured reality (2026-08-31, `origin/main` at `ace8f80`)

Counted, not estimated. Anything below that turns out to be wrong should be corrected **in place**
in this document, with the date.

| Fact | Value | Where |
| --- | --- | --- |
| Real AcroForm fields on the Keller PDF Miki fills | **3** — Motor Carrier Operator, Address, City/State/Zip | `pdfinfo` + field-name dump of `654  6-26  - uploaded.pdf`, 2026-08-31 |
| Everything else on that page | free annotations, authored by **two** different people | same dump: `/T` titles are `Mike Valnev` ×2, `georg` ×21 |
| Keller page geometry | **612 × 846 pt** (8.5″ × 11.75″), not Letter | `pdfinfo` |
| Mark-column x-coordinates (three groups) | OK `19.7 / 211.7 / 403.7`; Needs-repair `34.3 / 226.3 / 418.3`; Repaired-date `50.8 / 242.8 / 434.8` | `pdftotext -bbox-layout`, 2026-08-31 |
| Marks placed on the sample report | **57** (`Ok` / `N/A`), all in the leftmost column of their group | same |
| Appendix A item groups vs Keller's numbered groups | **15 = 15**; Keller's 16 "OTHER" is a free-text catch-all with no Appendix A counterpart | 49 CFR 396 App. A vs the sample |
| Vehicles in production | **195** | `supabase db query --linked`, 2026-08-31 |
| Trailers in production | **211** | same |
| Equipment rows with `dot_annual_inspection_expires_at` set | **0 of 406** | same — **the column is entirely unpopulated in production** |
| Equipment rows with `identity_source = 'manual'` | **0 of 406**; all 406 read `samsara` | same — exactly the hole 0241's header describes |
| `documents` rows with `subject_type in ('tractor','trailer')` | **0** | same |
| `certifications` rows with `kind = 'annual_inspection'` | **0** | same |
| Source references to `annual_inspection` outside migrations | **12**, of which **0** write a document or a certification | `apps/api/src`, `apps/web/src`, `packages/*/src` sweep |
| The `maintenance` API module | **81 lines**, one route, **zero owned tables** | `apps/api/src/modules/maintenance/` |
| The `maintenance` web feature | **1 file** (`useMaintenanceSpend.ts`) | `apps/web/src/features/maintenance/` |
| Highest migration | **0278** | `supabase/migrations/` |

### 1.1 The measurement that corrects a premise

The plan was drafted expecting a live fight over `dot_annual_inspection_expires_at`: the McLeod
collector derives it on every sweep (`mcleod/rosterFields.ts:88-96` for tractors, `:127-134` for
trailers) and migration 0242's header records *"trailer.inspection_date 228/235, all past"* on the
McLeod side.

**Production says the column is null on all 406 rows.** So the collision is a *latent* code path,
not an observed conflict — the derivation exists but has never landed a value here. Two consequences,
and they point the same way:

1. This feature will be the **first** writer of that column in production. There is nothing to
   reconcile and no back-fill to argue about.
2. The claim is still mandatory. `claim_identity_for_office()` exempts the service role
   (`auth_role() is null → return new`, 0241:57-60), and our finalize runs as the service role — so
   without an explicit `identity_source = 'manual'` the *first* McLeod sweep that does carry an
   inspection date would silently overwrite an office-entered one. We are fixing it before it can
   happen rather than after, which is the only difference from the CDL/medical dual-source finding
   D-ARC3 was written about.

### 1.2 What already exists and must not be rebuilt

| Thing | Where | Use it for |
| --- | --- | --- |
| `maintenance` module, RBAC section, nav group, `/shop` route | `apps/api/src/modules/maintenance/`, `packages/shared/src/auth.ts:56`, `apps/web/src/lib/nav.ts:220`, `apps/web/src/router/routes/finance.ts` | The home. No new module, no new section. ⚠ `/maintenance` is the downtime page (D-SEP9). |
| `documents` + `compliance-docs` bucket + `registerDocument` / `listDocuments` | `apps/api/src/modules/evidence/compliance.ts`, migration 0146 | `subject_type` already accepts `tractor`/`trailer`; `kind` already accepts `annual_inspection`. Never had a caller. |
| `certifications` + the `insert_certification` supersede RPC | migration 0127, `evidence/compliance.ts:32` | Where the expiry fact lives. |
| Server-side PDF filing (bytes → storage → `documents` row) | `apps/api/src/modules/recruiting/applicationPdf/file.ts:200-225` | Generalise into `evidence`, do not copy. |
| `lib/pdfDraw.ts` — the house style for documents this product **files** | `apps/api/src/lib/pdfDraw.ts` | The report renderer. Read its header: this palette is deliberately not the web palette. |
| `claim_identity_for_office()` | migration 0241 | ⚠ service-role writes are exempt; see §1.1. |
| Form idiom: `reactive` + `schema.safeParse` + `errors` map + `AppFormField` | `apps/web/src/features/roster/DriverForm.vue` | Copy it. `vee-validate` is installed and deliberately unused by the shipped roster forms. |
| `supabaseRecorder` / `expectOrgScoped`; door-gate tests; PGlite matrices | `apps/api/src/testing/`, `modules/roster/routes/archive.test.ts`, `supabase/tests/equipment-section-split.test.mjs` | The three test shapes every step below is held to. |

---

## 2. The findings that decide the shape

### 2.1 There is no required form — and the owner chose Keller's anyway

§396.21 fixes the **contents** of the report, never its layout. FMCSA's own guidance is explicit:
*"no specific form is required to be used to record the periodic inspection mandated by §396.17."*
FMCSA even publishes an example report, which is public-domain federal work. So a layout of our own
would be legally sufficient, free of any third-party dependency, and immune to a Keller reissue.

**The owner ruled against it on 2026-08-31 (D-AVI7).** The stored report is the Keller template with
our values stamped onto it. The reasoning is not technical and this document should not pretend
otherwise: the binder has looked like that page for years, an auditor and an office both recognise
it, and a file where 2026 looks nothing like 2025 is a change with no upside for the person holding
it. That is a legitimate reason and it outranks the tidier engineering answer.

**What the ruling costs, recorded so nobody rediscovers it:**

1. **Copyright.** The page carries `Copyright 2022 J. J. Keller & Associates, Inc.` Filling pads the
   carrier bought is the pads' intended use; embedding the artwork in software that generates
   unlimited copies is a different act. This is a commercial risk the owner accepted knowingly, not
   an oversight — and it is the reason the alternative is kept alive as a flag rather than deleted
   (see the `background` switch in A5).
2. **A revision breaks the map, not the record.** The coordinate map is pinned to revision 1/22. If
   Keller reissues, the map must be re-measured — but every report already filed keeps its **stored
   bytes**, so no past filing changes. This is why A6 files the rendered PDF rather than
   re-rendering on demand.
3. **We need a blank.** The file this plan was measured from is a *filled* copy. See §6 Q5.

The item catalogue is still authored from **Appendix A to Part 396** — public-domain federal text —
rather than transcribed from Keller's phrasing. The catalogue is what the product reasons about;
the template is where it prints. Keeping those two separate is what makes the `background` flag a
one-line change rather than a rewrite.

### 2.2 §396.21(a) is a schema, not a checklist

The regulation lists six things the report must carry: the individual performing the inspection;
the motor carrier; the date; the vehicle; **the components inspected and the results, including
those not meeting Appendix A**; and a certification of accuracy and completeness.

Every one of those becomes a NOT NULL column or a finalize precondition. (5) in particular is why
D-AVI5 forbids an implicit blank: a blank cell is not a result, and a report with blanks does not
say what §396.21(a)(5) requires it to say.

### 2.3 The two assertions on the form are not the inspector's to type

The Keller page carries two pre-printed claims that the person filling it merely ticks:

- *"THIS INSPECTOR MEETS THE QUALIFICATION REQUIREMENTS IN SECTION 396.19."*
- *"THIS VEHICLE HAS PASSED ALL THE INSPECTION ITEMS … IN ACCORDANCE WITH 49 CFR PART 396."*

Both are falsifiable statements about data the platform can hold. The first is true iff a current
qualification record exists for that inspector (§396.19, plus §396.25 where brakes are involved);
the second is true iff every applicable item passed or was repaired. Making either of them a free
checkbox is the "value copied instead of derived" workaround the root `CLAUDE.md` names — with the
aggravating feature that the copy is a legal certification. So both are derived (D-AVI3, D-AVI6).

### 2.4 Three rows, three different jobs — not duplication

Finalizing writes into three tables, and the temptation to collapse them should be resisted with the
reason written down:

| Row | Owner | The question it answers |
| --- | --- | --- |
| `vehicle_inspections` + items | `maintenance` | *What was inspected, by whom, with what result per component?* §396.21(a)(5) lives here and nowhere else can hold it. |
| `certifications` (`kind='annual_inspection'`) | `evidence` | *Is this unit currently inspected, and until when?* Append-only, auto-superseding, already the mechanism §391 uses. |
| `vehicles`/`trailers.dot_annual_inspection_expires_at` | `roster` | *A list column, fast to read.* A **projection**, per D-ARC3's ruling that `certifications` is the source and the denormalised column is the copy. |

### 2.5 Precision, measured — the stamping spike (2026-08-31)

D-AVI7 makes the render a registration problem, so it was measured rather than assumed. The spike
loaded the sample with **pdf-lib 1.17.1** (already a dependency), stamped values at converted
coordinates, and rendered the result at 400 dpi against the original marks. Everything below is an
observation, not a plan.

| Finding | Value | Why it matters |
| --- | --- | --- |
| MediaBox = CropBox, rotation 0 | `(0, 0, 612, 846)` both | No box offset and no rotation to unwind. The conversion is the clean case. |
| Origin conversion | pdftotext measures **top-down**, pdf-lib draws **bottom-up** | `y_pdf = 846 − y_top`. Getting this backwards is the whole class of "everything is mirrored" bug. |
| Baseline conversion | `y_baseline = H − yMax + 0.207 × size` | `H − yMax` alone lands the text one descender **too low** — verified visually, then corrected. `0.207` is Helvetica's AFM descender. With it, the stamped mark sits exactly on the original. |
| The sample's own typeface | **Helvetica ≈ 8 pt** | Mean width delta between poppler's boxes and `widthOfTextAtSize(…, 8)` across all 57 marks: **−0.014 pt**. Our output is indistinguishable from what the office produces today. |
| ✔ / ✓ / ✗ | **pdf-lib throws**: `WinAnsi cannot encode "✔" (0x2714)` | The standard fonts are WinAnsi — see `lib/pdfDraw.ts`'s `winAnsi()` header for the same compromise. Marks are the literal text `Ok` / `X` / `N/A`, which is what the office types anyway. **Resolves Q2.** |
| Repaired-date cell | ~35.2 pt wide; `06/16/2026` at 8 pt is **40.03 pt** | A four-digit year **overflows into the item text**. `06/16/26` is 31.14 pt and fits. Every mapped field carries a `maxWidth`; the renderer shrinks to fit down to a floor and a test asserts no overflow. |
| Template internals | 3 AcroForm text fields, 9 annotations, 57 marks | The carrier/address/city fields are real form fields — fill them then `form.flatten()`, or a viewer can edit the carrier name on a filed report. And 57 marks against 24 annotation objects means most values are flattened into the content stream: **Q5 stands, we need a genuine blank.** |

The consequence for A5 is that the coordinate map is expressed as **cells with a `maxWidth`**, not as
bare points, and the renderer computes the baseline from the cell rather than from where anyone
happened to type. That is what makes the placement test a measurement instead of an eyeball.

---

## 3. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| **D-AVI1** | The item catalogue is authored from **49 CFR Part 396 Appendix A**, lives in `packages/shared/src/annualInspectionCatalogue.ts`, and is **versioned** (`INSPECTION_CATALOGUE_VERSION`). Every report stores the version it was taken under. | Appendix A is public domain; Keller's phrasing is not (§2.1). Versioning means a 2026 report renders as inspected after the catalogue changes — the `DERIVER_VERSION` / hazmat-data precedent. |
| **D-AVI2** | ~~Item applicability LOCKS the answer.~~ **AMENDED 2026-08-31 (owner): it DEFAULTS the answer and locks nothing.** `appliesTo` decides what a row opens on; every row stays markable on every kind of equipment. | The original argument — certifying an absent part is a statement nobody has standing to make — is sound and was overruled on how the paper works: **truck and trailer use the same form and the same decal, and the only difference is the unit number and which boxes are marked.** Refusing a mark the form permits invents a rule the office does not have, and the edge cases are real (a converter dolly carries a fifth wheel; a straight truck carries a body *and* a rear guard). The printed page is unchanged for an ordinary inspection, because the default already puts `N/A` in the box — what changes is that an inspector can disagree with it. |
| **D-AVI3** | **Pass is derived, never typed.** `outcome = 'pass'` iff every applicable item is `ok`, `na`, or `needs_repair` **with** a `repaired_at`. Otherwise `fail`. | §2.3. A human typing "pass" beside an open defect is a false certification, and the form's own certification line asserts the opposite. |
| **D-AVI4** | **Finalize is one-way; the row then becomes immutable.** No UPDATE/DELETE once `status='final'`; a correction is a **new** report carrying `supersedes_id`. | The evidence discipline of `certifications`/`documents` (`RETENTION_FORBIDDEN`): corrections are new rows. |
| **D-AVI5** | Every applicable catalogue item must carry an explicit result before finalize. **No implicit blanks.** | §396.21(a)(5) — §2.2. |
| **D-AVI6** | The §396.19 box is **derived from a current inspector qualification record** (`maintenance_inspectors`), which holds the basis under §396.19(b)(1)/(2), brake qualification under §396.25, and the evidence document. | §2.3. Regulation also requires that evidence be retained for employment + 1 year, which needs a row to hang on. |
| **D-AVI7** | ~~Two renderers over one payload: `full` (our layout — the stored evidence) and `overlay` (values only). No Keller artwork is reproduced or committed.~~ **AMENDED 2026-08-31 (owner ruling): one renderer, one coordinate map, a `background` switch.** A blank Keller 14834 Rev. 1/22 is committed as a versioned asset; `background='template'` stamps the values onto it (the stored evidence, prints on plain paper), `background='none'` emits values only for printing onto pre-printed stock. | §2.1. The binder has looked like that page for years and an auditor recognises it. The costs — copyright, revision-pinning, needing a blank — are enumerated in §2.1 and were accepted, not missed. |
| **D-AVI8** | Calibration applies **only to `background='none'`** — printing onto pre-printed stock. A stored profile (org-scoped, per printer: x/y offset in points) is set by printing a registration sheet and measuring it. `background='template'` needs no calibration: the artwork and the values are on the same page and drift together. | Printer margin and scaling drift is the entire precision risk of registering ink against paper someone else printed. A `localStorage` offset would give two people two different results. Under the amended D-AVI7 this is now an **optional** step — see A8. |
| **D-AVI9** | The `certifications` row is the **source of truth** for the expiry; the `vehicles`/`trailers` column is a projection roster maintains, and finalize claims the row to `identity_source='manual'`. | §1.1 and §2.4. D-ARC3's CDL/medical ruling, applied before the dual source exists rather than after. |
| **D-AVI10** | Maintenance **never writes** `documents`, `certifications`, `vehicles` or `trailers` directly. `evidence` and `roster` each gain one exported owner-interface function. | D-ARC3, machine-enforced by `check-table-writers.mjs` and `check-table-access.mjs`. |
| **D-AVI11** | New role **`technician`**: `maintenance: manage`, `equipment: view`, everything else `none`. | The recruiter and accountant lesson applied on day one — minimal irreversible surface. ⚠ One-way door: Postgres has no `ALTER TYPE … DROP VALUE` (0266's header). |
| **D-AVI15** | **Visible copy names the thing; the CFR reference lives in a comment.** Measured 2026-08-31: on every non-hazmat page in this product the citations are in comments, and hazmat is the exception because there the regulation IS the subject. | A person filling in a form is inspecting a truck, not reading Part 396. The citation is why the field exists, not what they are doing — and it still travels on the catalogue for the renderer and any audit export. |
| **D-AVI16** | **One shared `inspectionExpiry()` and a 30-day warning**, read by the vehicles page, the trailers page and anything added later. No date reads as `unknown`, never as expired. | "Expiring" meaning two things on two screens is the failure a shared function prevents. And a truck with no inspection recorded has not failed one — missing and lapsed are different facts, and colouring the first red reports a compliance problem nobody established. |
| **D-AVI17** | **The truck & trailer file adds a page, never a store.** Inspection history, the report PDF and the current expiry are all already written by finalize and queryable today. | Recorded because the connection is invisible: a future step that creates a table for inspection history, a second copy of the PDF, or its own expiry column has missed four rows that already exist. |
| **D-AVI12** | Trailers are in scope from day one, on the **same 14834 template** with the `TRAILER` box stamped instead of `TRACTOR` (owner confirmed 2026-08-31). One asset, one coordinate map; the item sets and the list views are what separate. | §396.17 applies to them; the subject type, the expiry column and the document kind already exist; and the form's own `VEHICLE TYPE` row carries TRACTOR / TRAILER / TRUCK / BUS. Separating trucks from trailers is a catalogue and a view concern (D-AVI2), not a second template. |
| **D-AVI13** | **The form is pre-filled; the PDF is not.** The web form opens with every item pre-set to the template default for that vehicle type, and the inspector checks or unchecks as they work. No PDF exists until finalize. Each item stores a `source` of `default` or `inspector`. | The owner's ruling, restated 2026-08-31 after the audit exposure was named: the defaults are a convenience for the person doing the work, and nothing is certified until they confirm. The `source` column costs nothing, changes no screen, and is the difference between a record that can answer "was this item actually looked at" and one that cannot. |
| **D-AVI14** | **Print preview before finalize.** The same renderer, the same coordinate map, marked `DRAFT — NOT A CERTIFIED INSPECTION`, rendered on demand and **never stored**. | The inspector should see the page they are signing before they sign it. It must be the same code path as the final render, or the preview is a second implementation that can disagree with the thing it previews. |

---

## 4. Execution protocol

**Resume ritual (a fresh chat starts here):**

1. Read this document top to bottom, then the root `CLAUDE.md`, `apps/web/CLAUDE.md`,
   `docs/ARCHITECTURE.md` (§3 D-ARC3 ownership, §6 gates), `docs/MIGRATION-DISCIPLINE.md`,
   `docs/DESIGN-SYSTEM-CONTRACT.md`, and `docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md`
   §P5.3 + D-SEP8 (this module's charter).
2. Establish reality, never assume it: `git log --oneline -15`, `git branch --show-current`,
   `pnpm verify:live`. Parallel chats share one working tree — branch from `origin/main`.
3. Find the first §5 step not marked **DONE**. Check its prerequisites. A missing prerequisite means
   stop and record it in §6; it never means work around it.
4. One step per branch (`claude/<topic>`), PR to `main`, merge after CI. `main` is branch-protected;
   there is no other path.
5. When a step ships, mark it **— DONE \<date\> (PR #NNN)** in place with a "What shipped" list and
   a "Verified by:" line naming the gates actually run. **This document is the memory between
   sessions; the chat is not.**

**Rules every step is held to** (gate names verified against root `package.json`):

- Schema changes are next-numbered migrations only, never edits to an applied one
  (`lint:migrations`); every new table gets RLS (`check-rls.mjs`); every table needs an owner in
  `scripts/table-modules.json`, a declared writer in `scripts/table-writers.json` and a producer
  (`check-table-producers.mjs`).
- Any `auth_role() in (...)` list in a migration above 0260 must **equal**
  `rolesThatManage('maintenance')` or `rolesThatCanView('maintenance')` exactly, or carry a
  `-- section-policy-waiver:` line (`check-section-policies.mjs`). Hand-picking the list is the
  failure that gate exists for.
- Modules may not reach into a sibling's internals (`lint:boundaries`, armed for
  `apps/api/src/modules`). Cross-module calls go through the owner's barrel export.
- Contracts live only in `packages/shared` (`lint:shared-contracts`).
- 500-line file budget / 200-line function budget (`lint:filesize`, `lint:funcsize`).
- A comment claiming test coverage must quote a real test title (`lint:comment-claims`).
- Raw `<button>` in `pages/` or `features/` is a red gate with zero tolerance (`lint:ui-adoption`).
- **No step may ship a workaround.** A blocker goes into §6 with candidate answers and a
  recommendation; it is never routed around.

---

## 5. Steps

### A0 — Governance and this document — **DONE 2026-08-31 (PR #410, no migration)**

Annual inspections are not in `docs/SILVICOM-360.md` §3, and that document says a feature not listed
there "needs a D-S360 decision before its plan starts".

- Add **D-S360-6** to `docs/SILVICOM-360.md` §3 under *Committed, being built or unblocked next*.
- Update `docs/ARCHITECTURE.md` §4's `maintenance` row to name the tables the module will own.
- This document.

**Done when:** SILVICOM-360 §3 carries the feature with a D-S360 id; ARCHITECTURE §4's maintenance
row names the tables; a fresh session can execute §4's resume ritual from this file alone.

### A1 — The catalogue and the contract — **DONE 2026-08-31 (PR #411, no migration)**

- `packages/shared/src/annualInspectionCatalogue.ts` — `INSPECTION_CATALOGUE_VERSION` and the 15
  Appendix A groups with their sub-items, each
  `{ key, group, label, cfr, appliesTo, defaultResult }`. Item keys are stable and never reused
  (`brake.service_brakes`, `rear_impact_guard.present`, …).
- `defaultResult` per vehicle type is what D-AVI13 opens the form with, transcribed from the
  sample: on a tractor, `na` for electric/hydraulic/vacuum brakes, pintle hooks, drawbar tongue,
  saddle-mounts, bus exhaust, intermodal securement, adjustable axle, speed-restricted tires, lock
  rings, welds, motorcoach seats and rear impact guard; `ok` for the rest. Trailers invert the
  coupling/steering groups against the rear-impact-guard one. **This is form state, never report
  state** — nothing reaches a PDF until finalize.
- `packages/shared/src/annualInspectionContract.ts` — zod schemas for the draft, patch and finalize
  requests and the response DTOs, plus the **pure** `deriveInspectionOutcome(items, catalogue)`
  (D-AVI3) and `nextDueDate(inspectedOn)`.
- Export both from `packages/shared/src/index.ts`.

**Done when:** `deriveInspectionOutcome` is unit-tested without a clock or a database; an item with
no result is an **error**, not a default; the catalogue test proves no duplicate keys and a CFR
citation on every item; `lint:shared-contracts` passes.

**What shipped:** `annualInspectionCatalogue.ts` (56 components, 15 Appendix A groups,
`INSPECTION_CATALOGUE_VERSION` 1.0.0) and `annualInspectionContract.ts`
(`deriveInspectionOutcome`, `nextInspectionDueDate`, the request/response schemas), with 39 tests.

**One deviation from the step as written.** The planned item shape was
`{ key, group, label, cfr, appliesTo, defaultResult }`. Authoring it against the sample showed that
`na` has **two different meanings** on this page and one field cannot hold both:

- *A tractor has no rear impact guard.* A fact about the regulation. The form must **lock** it —
  certifying that a part which does not exist is in place is a statement no one has standing to
  make. Carried by `appliesTo`.
- *This fleet's tractors run air brakes, so hydraulic brakes are `na`.* A fact about what Silvicom
  bought. Editable, and a different unit would answer differently. Carried by `fleetDefault`.

So the shape is `{ key, group, label, cfr, appliesTo, fleetDefault? }` with
`defaultInspectionResult(item, subjectType)` deriving the opening answer. Collapsing them would have
made the first kind editable, which is the failure `inapplicable_not_na` now rejects.

**Verified by:** `pnpm typecheck` clean; `pnpm lint` clean (2 pre-existing warnings in
`useSpendFilters.test.ts`); `lint:shared-contracts`, `lint:filesize`, `lint:comment-claims` pass;
`pnpm test` — all suites and all 26 PGlite matrices pass. **Mutation-tested rather than assumed:**
forcing `outcome` to `"pass"` fails 2 tests, and treating a missing answer as `na` fails 3 — so the
two rules that carry the compliance weight are provably covered, not merely asserted to be.

### A2 — The `technician` role — **DONE 2026-08-31 (PR #412, migration 0279)**

Prerequisite: none. Follow `supabase/migrations/0266_accountant_role.sql` exactly — the migration is
the enum value and **nothing else**, because Postgres will not let a newly added enum value be used
in the transaction that adds it.

- `supabase/migrations/0279_technician_role.sql` (take the next free number) —
  `alter type user_role add value if not exists 'technician';`, with a header recording D-AVI11 and
  the one-way-door warning.
- `packages/shared/src/auth.ts` + `constants.ts` — add to `USER_ROLES` and add the `SECTION_ACCESS`
  row, in the same PR.
- Fix every `Record<UserRole, …>` the compiler flags; nav and any role picker.

**Done when:** `rolesThatManage('maintenance')` is `['admin','fleet_manager','technician']`,
`rolesThatCanView('equipment')` includes it, `packages/shared/src/auth.test.ts` pins both, and
`pnpm typecheck` is clean **with no `as` cast added to silence a role record**.

**What shipped:** migration `0279_technician_role.sql` (the enum value and nothing else, per the
0077/0210/0266 convention), the `USER_ROLES` entry and picker label, and the `SECTION_ACCESS` row —
`maintenance: manage`, `equipment: view`, `none` in the other ten sections.

**A measurement worth keeping: the role list is enumerated in exactly two files.** `constants.ts`
holds the vocabulary and its labels, `auth.ts` holds the matrix, and every other consumer derives
through `rolesThatManage` / `rolesThatCanView` / `sectionAccess`. Adding a ninth role broke **zero**
`Record<UserRole, …>` sites and needed no cast anywhere. That is D-ROS12's design being paid back:
before the split, a hand-written `canManageFleet` sat beside the matrix and disagreed with it.

**The existing suite caught the one thing that changed by implication.**
`rolesThatCanView('equipment')` failed on the new member — correctly, because that assertion exists
to make a section widening visible. It was updated with the reason rather than just the value, and
`rolesThatManage('equipment')` is pinned unchanged beside it so a read cannot quietly become a write
later.

**Verified by:** `pnpm typecheck` clean; `pnpm lint` clean (2 pre-existing warnings);
`lint:migrations`, `lint:rls`, `lint:section-policies` pass — the last now reporting a **9 × 12**
matrix parsed from `auth.ts`, which is the gate confirming it read the new role rather than skipping
it; `pnpm test` — all suites and all 26 PGlite matrices pass, `rls` at 449.

### A3 — Schema — **DONE 2026-08-31 (PR #413, migration 0280)**

Prerequisite: A2 (the policies name the role).

`supabase/migrations/0280_annual_inspections.sql`:

- **`maintenance_inspectors`** — `id, org_id, full_name, address, user_id → auth.users (nullable),
  qualification_basis check ('state_federal_program','training_and_experience'), brake_qualified
  boolean, evidence_document_id → documents (null on delete), effective_from, effective_to, notes,
  created_at/by`.
- **`vehicle_inspections`** — `id` (client-generated, for idempotent replay), `org_id, subject_type
  check ('tractor','trailer'), subject_id, inspector_id → maintenance_inspectors, inspected_on date,
  catalogue_version text, vehicle_identification_method check ('vin','plate','other') + value,
  inspection_agency_location, decal_serial (named `stock_serial` here until 0281 — §6 Q1),
  other_conditions, status check ('draft','final'),
  outcome check ('pass','fail') null while draft, next_due_on date, supersedes_id →
  vehicle_inspections, certification_id → certifications, document_id → documents, finalized_at/by,
  created_at/by`. Partial unique index on `(org_id, decal_serial) where decal_serial is not null` —
  one §396.17(c)(2) decal cannot be recorded against two reports.
- **`vehicle_inspection_items`** — `id, org_id, inspection_id → vehicle_inspections on delete
  cascade, item_key, result check ('ok','needs_repair','na'), source check ('default','inspector')
  not null default 'default', repaired_at date, note`. Unique `(inspection_id, item_key)`.
  `source` is D-AVI13's one-column cost: the form opens pre-filled, and this is what lets the record
  distinguish an item the inspector touched from one that carried its default through.
- RLS on all three, role lists **derived** from the maintenance section (see §4's gate note).
- D-AVI4 immutability: a `before update` trigger rejecting any change to a row whose `status` is
  already `final`, other than the `supersedes_id` back-reference.
- Manifests: `scripts/table-modules.json` (module `maintenance`, layer `core`),
  `scripts/table-writers.json`, and a producer for each table.
- `supabase/tests/annual-inspections.test.mjs` — applies **all** migrations from `readdirSync`
  (never a hand-picked list), shims storage/auth, seeds an org + a vehicle + a trailer, and asserts
  per role via `as(role, sql)`.

**Done when:** the matrix prints a `RESULT:` line; it proves a `technician` can write and a
`dispatcher` cannot read; it proves an UPDATE against a `final` row is **rejected**; it proves a
cross-org read returns zero rows; and `lint:rls`, `lint:migrations`, `lint:section-policies`,
`lint:table-modules`, `lint:table-producers`, `lint:table-writers` all pass.

**What shipped:** `0280_annual_inspections.sql` — `maintenance_inspectors`, `vehicle_inspections`,
`vehicle_inspection_items`, their RLS derived from the maintenance section, the D-AVI4 immutability
triggers and the draft/final shape constraint. Plus the manifest entries, a `RETENTION_FORBIDDEN`
pin, and `supabase/tests/annual-inspections.test.mjs` at **36 assertions**.

**Two things the matrix caught that nothing else would have.**

1. **The migration was un-installable.** Postgres rejects a subquery in a trigger `WHEN` clause
   outright, and the per-component immutability trigger used one. Well-formed SQL that simply
   cannot be applied — no linter sees it, and CI would have found it only by running the same
   matrix. The parent lookup moved into the function body, with the reason written above it.
2. **A refused INSERT raises; a refused UPDATE affects zero rows.** The first draft asserted both
   the same way and reported six failures against policies that were working perfectly. Conflating
   the two signals is how a matrix "proves" a refusal that never happened, so `affected` and
   `blocked` are now separate helpers with that written between them.

**Mutation-tested, not asserted:** dropping the immutability trigger fails 2 assertions; widening
the write policy to every org member fails 10.

**One waiver added, deliberately, with its removal pinned.** `check-table-producers.mjs` requires a
writer in the same PR as the migration — and A3/A4 are separate steps, so the three tables land one
PR ahead of the service that writes them. Three waivers name step A4 and this file. **A4's Done-when
now requires deleting all three**; if A4 has shipped and they are still there, that is the bug. The
alternative was folding A4 into this PR, which the gate's own message prefers; it was not taken
because a schema review and a route review are different readings, and the gate explicitly sanctions
a waiver that names the plan that owes the producer (ARCHITECTURE.md §6 records six others).

**Verified by:** the full CI gate list run locally (21 gates, extracted from `ci.yml` rather than
guessed — the omission that turned #412 red once); `pnpm test` with all 27 matrices green.

### A4 — API: inspectors and the draft lifecycle — **DONE 2026-08-31 (PR #414, no migration)**

Prerequisites: A1, A3.

Routes hang off the existing `maintenanceRouter()`. ⚠ Keep the literal
`app.use("/api/maintenance", maintenanceRouter())` in `app.ts` — `routeAuth.test.ts` and
`routeGates.test.ts` regex-scan that line, and a conditional mount hides the router from both.

```
GET  /api/maintenance/inspectors          POST  /api/maintenance/inspectors
GET  /api/maintenance/inspections         POST  /api/maintenance/inspections      (client uuid)
GET  /api/maintenance/inspections/:id     PATCH /api/maintenance/inspections/:id  (draft only)
```

A5 adds `GET /api/maintenance/inspections/:id/preview.pdf` (D-AVI14, draft-only, never stored) and
A6 adds `POST /api/maintenance/inspections/:id/finalize` plus `GET …/report.pdf`.

Idioms from `maintenance/routes/index.ts`: `requireAuth` on the router, `requireOrg`,
`requireRole(...rolesThatManage('maintenance'))` on writes and `...rolesThatCanView` on reads,
`validateBody(schema)` for bodies, `schema.safeParse(req.query)` for queries, `apiError`,
`asyncHandler`, `writeAudit` on every write. Org id comes from the JWT, never the body.

Creating a draft seeds one `vehicle_inspection_items` row per **applicable** catalogue item,
pre-set to `na` where `defaultNa` — so D-AVI5 is satisfiable and the form has nothing to invent.

**Done when:** a `supabaseRecorder` test runs `expectOrgScoped` over every query with no exemptions;
a door-gate test tables every role and asserts `technician` passes while `dispatcher`, `recruiter`
and `driver` do not; a PATCH against a final row is refused by the API **and** independently by the
trigger (both asserted); **and the three A3 waivers are deleted from `scripts/check-table-producers.mjs`
— this step is not done while they are still there.**

**What shipped:** `modules/maintenance/inspections/{inspectors,inspections}.ts` and
`routes/{inspectors,inspections}.ts`, mounted on the existing `maintenanceRouter()`. Six endpoints,
55 tests. **The three waivers are gone** — `lint:table-producers` is back to the single pre-existing
`import_rows` entry, and the three write sites are declared in `scripts/table-writers.json` under
their owning module.

**§396.19 is checked at the door, not discovered at finalize.** Creating a draft refuses an
inspector who is not on the register, or whose qualification does not cover the day of the
inspection — with their name and the date in the message. Finding that out at finalize would mean
telling somebody the report they just filled in cannot be signed.

**Two decisions inside the patch endpoint worth a reader's time.**

- *Grouped UPDATEs, never an upsert.* The draft is seeded complete, so a patch is an UPDATE — which
  is also what `lint:upserts` requires, since Postgres checks NOT NULL before conflict arbitration.
  Components sharing an answer collapse into one statement, so "these three failed" is one round
  trip rather than three. Pinned by a test asserting **two** statements for three components across
  two answers.
- *Every patch answers with the whole report as the database now holds it.* The groups are separate
  statements, so a mid-way failure would leave some components moved and some not. Rather than
  pretend otherwise, the client's state becomes DB truth on every save — a lost write shows up
  immediately instead of living on in a form that believes it saved.

**Mutation-tested:** gating the create on `canView` instead of `canManage` fails 2 door assertions;
dropping the `org_id` filter from the list query fails the `expectOrgScoped` assertion.

**Verified by:** the full 21-gate CI list run locally; `pnpm test` all suites and 27 matrices green.
`lint:table-writers` initially rejected the three new write sites, correctly — the write-site freeze
means a new writer is a deliberate manifest edit, and these are the owner's own.

### A5 — The renderer: stamp the template — **DONE 2026-08-31 (PR #416, no migration)**

Prerequisites: A1, A4, and §6 **Q5** answered (we need a blank template).

One renderer, one coordinate map, a `background` switch (D-AVI7 as amended).

- **The asset.** `render/assets/keller-14834-rev0122.pdf` — a **blank** template, committed with a
  `SOURCE.md` beside it naming the revision, where it came from and the date. House precedent for a
  committed PDF exists (`packages/hazmat-data/datasets/*.pdf`), but those are public-domain federal
  documents and this one is not; §2.1 records the ruling that put it here.
- **The map.** `render/layouts/keller14834Rev0122.ts` — every catalogue item key and every header
  field to an `(x, y)` on the 612 × 846 page. From §1's measurements: OK columns at
  `19.7 / 211.7 / 403.7`, needs-repair at `34.3 / 226.3 / 418.3`, repaired-date at
  `50.8 / 242.8 / 434.8`; report number `(389, 101)`, fleet unit `(520, 101)`, date `(447, 129)`,
  inspector `(441, 151)`, VIN `(324, 210)`, carrier block `(24, 163 / 187 / 211)`.
- **The renderer.** `render/report.ts`, using **pdf-lib** — `PDFDocument.load` the template,
  `drawText` at the mapped coordinates, flatten, save. This is the same library and the same
  load-and-stamp shape `modules/evidence/dqBinder/merge.ts` already uses; do not reach for pdfkit
  here, which cannot open an existing page.
  - `background: 'template'` → the stored evidence, and what prints on plain paper.
  - `background: 'none'` → an empty 612 × 846 page with the same values at the same coordinates,
    for printing onto pre-printed stock (A8).
  - `draft: true` → the preview of D-AVI14: identical placement, plus a `DRAFT — NOT A CERTIFIED
    INSPECTION` mark. Rendered on demand, never stored, never filed.
- **The measured constants** (§2.5), which belong in the map's header and not in anyone's memory:
  baseline is `y = 846 − yTop + 0.207 × size`; the body face is Helvetica at 8 pt; marks are the
  literal `Ok` / `X` / `N/A` because WinAnsi cannot encode a tick; repair dates render `MM/DD/YY`
  because a four-digit year overflows its cell by 4.8 pt.
- **The three AcroForm fields** (carrier, address, city/state/zip) are filled from the organisation
  record and then `form.flatten()`ed, so a filed report cannot be edited in a viewer.
- **The `VEHICLE TYPE` row** is stamped from the subject: `TRACTOR` or `TRAILER` (D-AVI12).
- **Provenance.** A footer line carrying the catalogue version, the template revision, the renderer
  version and the **source payload digest** — the `applicationPdf/render.ts` precedent, since a
  document cannot contain its own hash. Place it in the form's own margin, never over the artwork.

**Done when — four machine-checked properties, none of them an eyeball:**

1. **Bijection.** The map and the catalogue cover each other exactly: every applicable catalogue item
   has a cell, every cell has an item. A Keller revision then fails the build instead of silently
   printing a blank cell.
2. **Fit.** For every field, `font.widthOfTextAtSize(value, size) <= cell.maxWidth` across a fixture
   set that includes the longest realistic value of each kind — the longest inspector name, a
   repair date, a full VIN. This is the test that would have caught the 4.8 pt date overflow §2.5
   found by measuring rather than by looking.
3. **No collision.** No two cells in the map overlap, asserted over the rectangles.
4. **Determinism.** The same payload and the same catalogue/template/renderer versions produce
   byte-identical output across two renders, asserted as a hash equality.

Plus: a golden test asserting every §396.21(a)(1)–(6) element and every failing item's label appears
in the rendered text; `draft: true` differs from the final **only** by the draft mark, asserted by
rendering both and diffing the extracted text; `lint:filesize` and `lint:funcsize` pass with no
grandfather entry added.


**What shipped:** the blank template as a committed asset with a `SOURCE.md`, the coordinate map
(`layouts/keller14834Rev0122.ts`), the renderer (`report.ts`) with its `background` and `draft`
modes, and 24 tests across the four properties.

**§6 Q5 is closed.** The owner rebuilt the form in Illustrator and exported a blank. Verified before
using it: **612 × 846 pt, rotation 0, max drift 0.009 pt across 26 artwork anchors** against the
original filled sample — so every coordinate measured in §2.5 transferred unchanged. The Illustrator
round trip dropped the three AcroForm fields (`Form: none`), which turned out to be a simplification:
the carrier block is stamped as text like everything else, and the fill-then-flatten step §2.5
anticipated is not needed.

**Two placement defects the first render exposed, both from inferring geometry instead of measuring
it.** The map's column widths had been derived from where the item TEXT begins; scanning the blank at
300 dpi for actual ruled lines found them at 18.1 / 32.9 / 47.9 / 71.9 (repeating at +191.8 and
+383.8):

1. **REPAIRED DATE is 24 pt wide, not the 39 pt inferred.** No date fits at the body size — not even
   `6/16/26` — so `shortDate` drops leading zeros and `fit()` shrinks. The worst case (`12/31/26`)
   lands at **5.75 pt**, which sounds alarming until you measure the form: Keller's own
   "NEEDS REPAIR / REPAIRED DATE" column headers are **4.5 pt** type. The column was drawn for a
   cramped hand-written date and we print into it larger than the label above it. The test asserts
   no date in the calendar is ever clipped, rather than asserting a size.
2. **The free-text note printed straight through the printed label.** The eighteen write-lines run
   501.7 → 767.6 at a 15.65 pt pitch; the map had started at 460, inside "List any other
   condition(s)…". Wrapping is now by measured width rather than character count — `WWW` and `iii`
   are the same length and nowhere near the same width in a 116 pt column.

**Verified by:** the full 21-gate CI list; `pnpm test` all suites and 27 matrices; and a rendered
page inspected at 200 dpi — header block, tick boxes, all 56 marks, a repaired defect with its date,
an open defect, the wrapped note, and the DRAFT preview.

### A6 — Finalize: derive, render, file, project — **DONE 2026-08-31 (PR #417, migration 0282)**

Prerequisites: A3, A5.

One server-side sequence in `finalize.ts`:

1. `deriveInspectionOutcome` (D-AVI3). Refuse on any unset item (D-AVI5) and on an inspector with no
   current qualification (D-AVI6) — each a `400` naming the specific reason, never a silent default.
2. Render the `full` PDF.
3. `evidence` gains **`fileGeneratedDocument(admin, orgId, meta, bytes)`**, exported from
   `modules/evidence/index.ts` and generalised from `recruiting/applicationPdf/file.ts:200-225`
   (upload to `compliance-docs`, sha256, insert the `documents` row). Filed as
   `subject_type: 'tractor'|'trailer'`, `kind: 'annual_inspection'` — the first ever caller of the
   equipment side of that table.
4. `evidence` exports **`insertCertification`** from its barrel. The function already exists at
   `compliance.ts:32`; it is simply not in `index.ts`. Insert `kind='annual_inspection'`, the
   equipment as subject, `issuedAt = inspected_on`, `expiresAt = +12 months`, `documentId` from (3).
   Supersession is the RPC's job.
5. `roster` gains **`recordEquipmentInspectionExpiry(admin, orgId, subjectType, subjectId,
   expiresAt)`**, exported from `modules/roster/index.ts`. It sets
   `dot_annual_inspection_expires_at` **and `identity_source='manual'` explicitly** — see §1.1.
6. Stamp `status='final'`, `outcome`, `next_due_on` and the three foreign keys; `writeAudit`.

Register both new writer paths in `scripts/table-writers.json` and the module edges
(`maintenance -> evidence`, `maintenance -> roster`) in the boundary manifest.

**Done when:** a test proves finalizing leaves the equipment row at `identity_source = 'manual'`, and
a **simulated McLeod sweep run afterwards leaves the expiry unchanged** — §1.1's ruling asserted, not
assumed. Finalizing twice is idempotent and does not produce a second document.
`lint:table-writers` and `lint:boundaries` pass with the edges **declared, not waived**.


**What shipped:** `finalize.ts` and `reportDelivery.ts` in `maintenance`, the three owner interfaces
it needed, and `POST /:id/finalize`, `GET /:id/report.pdf`, `GET /:id/preview.pdf`. 119 tests across
the module.

**A missing capability, found by rendering a compliant report.** `organizations` carried `name` and
`dot_number` and nothing else — no address. On paper the MOTOR CARRIER OPERATOR block was three
AcroForm fields the office typed once and saved into the PDF, so the carrier's address lived in a
FILE rather than in the product, and the Illustrator round trip that produced our blank dropped
them. But §396.21(a)(2) requires the report to identify the carrier and §396.17(c)(2) requires the
decal to name the address **where the report is maintained** — the officer's route from a sticker to
a filing cabinet. So migration **0282** adds it (0152's precedent: it added `dot_number` to the same
table for the DQ binder's cover) and **finalize refuses a report whose carrier block is
incomplete, naming the missing fields.**

**⚠ A6 shipped a second writer, corrected the same day.** It also added `setCarrierIdentity` and a
`PATCH /api/org/carrier` route so the address could be entered — without checking whether the
product already had somewhere to edit the carrier. It did: `/settings/org` has written `name` and
`dot_number` for a year through `useOrgSettings` and `orgSettingsFormSchema`, and the address is
`dot_number`'s exact sibling. Two endpoints writing the same columns is a second source of truth,
and a form saving half its fields one way and half the other is worse than either consistent
option. The route and the setter were deleted, the four columns joined their siblings on the
existing path, and `org` kept only `getCarrierIdentity` — the read `maintenance` genuinely needs
and cannot get another way.
incomplete, naming the missing fields.** Not scope creep: a report without it does not say what
§396.21(a) requires.

**The order is the design.** Everything that can refuse runs before anything that writes — a
finalize failing halfway would leave a certification with no document, or a claimed equipment row
behind a report still marked draft. Every refusal is asserted to write **nothing**, storage included.

**Three owner interfaces, no reaching (D-AVI10).** `evidence` gained `fileGeneratedDocument`
(generalised from recruiting's application PDF at its second caller — `registerDocument` hands back
a signed UPLOAD url, which is useless to a caller that already holds the bytes) and now exports
`insertCertification`; `roster` gained `getEquipmentIdentity` and `recordEquipmentInspectionExpiry`;
`org` gained the carrier read. The three edges are **declared** in the boundary manifest with their
reasons, not waived.

**`check-table-access` caught a dynamic `.from()`.** The roster interface indexed a table name from
a map — shorter, and invisible to every gate this repo has for ownership, layering and write sites.
Rewritten as two literal branches: duplication a gate can read beats indirection it cannot.

**The claim is proven from both ends.** Finalize writes `identity_source: 'manual'` alongside the
expiry, and — new in this step — `rosterIngest.test.ts` now asserts the sweep stands off a claimed
**vehicle**. That case was untested; only the driver equivalent existed, and a truck is what an
inspection is about. Mutation-tested: dropping the claim fails the finalize assertion, and without
it nothing would error — the column would take its date and the next nightly sweep would quietly
replace it.

**Deliberately NOT refused: a PASS with no decal serial.** That is §6 Q7 and turns on a fact nobody
has established. Guessing "refuse" hands the office a rule it may not be able to satisfy, and a
blocked finalize the office cannot satisfy is how a workaround gets invented.

**Verified by:** the full 21-gate CI list; `pnpm test` all suites and 27 matrices.

### A7 — Web: the list and the form — **DONE 2026-08-31 (PR #418, no migration)**

Prerequisites: A4, A5, A6.

- `apps/web/src/router/routes/finance.ts` — `/shop/inspections` and `/shop/inspections/:id`.
- `apps/web/src/lib/nav.ts` — a second item in the existing "Maintenance" group.
- `apps/web/src/features/maintenance/` — `useAnnualInspections.ts` (vue-query, `keepPreviousData`,
  mutations invalidating the list key), `InspectionItemRow.vue`, `InspectionGroup.vue`,
  `InspectorPicker.vue`. Pages `AnnualInspectionsPage.vue` (the `MaintenanceSpendPage.vue` shape:
  `PageHeader` + `FilterBar` + `DataTable` + `TablePagination`) and `AnnualInspectionFormPage.vue`.
- The form uses the `DriverForm.vue` idiom. Per item a three-state OK / Repair / N/A control,
  **opening on the catalogue's `defaultResult` for that vehicle type** (D-AVI13); the repaired-date
  field appears only on `needs_repair`. A sticky summary ("2 open defects · 9 items still on their
  default") and a **derived, non-editable** pass/fail banner reading the same shared function the
  API uses. Draft autosave; finalize behind a confirm dialog that states in words what is being
  certified.
- **Trucks and trailers are separated in the view, not just in the data** (D-AVI12): the list has a
  tractor tab and a trailer tab, and the form renders only the items that apply to the subject —
  a tractor's form never shows a rear impact guard, a trailer's never shows a fifth wheel.
- **Print preview** (D-AVI14): a Preview action opens `…/preview.pdf` — the real page, the real
  coordinates, marked DRAFT — so the inspector sees what they are signing before they sign it.
- Print opens `GET …/report.pdf`, which serves the **stored** bytes for a finalized report rather
  than re-rendering — a filed document is not regenerated on the way to a printer. **Not**
  print-CSS: the app's only `@media print` block (`style.css:258`) exists for modals and is the
  wrong tool here.

**Done when:** an inspector can complete a report end to end using the keyboard alone; the pass/fail
banner provably calls the shared `deriveInspectionOutcome` with no second implementation;
`lint:ui-adoption` and `lint:filesize` pass; verified in a real browser via
`pnpm --filter web build && pnpm --filter web preview` — the vite **dev** server crashes in this
repo and must not be used for the check.


**What shipped:** the vue-query layer, `InspectionItemRow.vue`, `AnnualInspectionsPage.vue` (tractor
and trailer tabs), `AnnualInspectionFormPage.vue`, the two routes, the nav item, and a
`ChecklistIcon` added to the shared inventory. 22 component tests.

**The verdict is provably the shared function.** The tests do not assert "shows PASS" against a
hand-written expectation — they compute the expectation with `deriveInspectionOutcome` and assert
the page agrees, so the test fails the day the page grows its own opinion. Mutation-tested: forcing
the banner to `"pass"` fails the unrepaired-defect case. A separate assertion walks every button on
the page and refuses any label outside the answer controls, the preview and certify — there is no
control anywhere that SETS the verdict, and the day one appears that test goes red.

**Three UI facts found the hard way, recorded so the next surface does not rediscover them.**

1. **Raw `<button>`, `<input>` AND `<select>` are all banned** in pages and features
   (`lint:ui-adoption`). So the three-state control is `AppButton`s with `aria-pressed` inside a
   `role="group"` rather than `AppRadioGroup` — the radio group stacks vertically and 56 components
   would have become 168 rows, which stops being a form somebody can work down.
2. **The PDF routes sit behind `requireAuth`, so `window.open` on them 401s.** `lib/api.ts` gained
   `fetchObjectUrl`, which fetches with the session token and hands back a blob URL. The repo's other
   pattern — an endpoint returning a signed storage URL (`statementSourceUrl`, the DQ export
   download) — is right when the bytes are already an object in a bucket and cannot serve a DRAFT
   preview that is deliberately never stored.
3. **There is no `text-ink-primary` token.** The roles are `ink`, `ink-secondary`, `ink-tertiary`,
   `ink-muted`, `ink-subtle`, and radii are `rounded-detail/control/surface/overlay/dialog`.

**Two existing tests caught real mistakes**, which is the whole reason they exist: `meta.parent` is a
PATH and I had written route names, and the route-table snapshot required the two new URLs be added
to its probe list as a deliberate act. The snapshot diff is exactly the two routes, with
`/shop/inspections` still beating `/shop/inspections/:id` on specificity.

**Verified by:** the full 21-gate CI list; `pnpm test` all suites and 27 matrices; `pnpm --filter
./apps/web build` clean; and a real browser against `vite preview` — the app boots, `/shop/inspections`
resolves, and the auth guard redirects with no console error but the expected API-not-running one.

**⚠ What the browser pass did NOT cover, stated rather than implied:** the logged-in view. That needs
a Supabase session this session does not hold, so the form's rendering is covered by jsdom mounts of
the real components against real catalogue data rather than by eye. The first person with a login
should open a draft and look at it before the shop is told to use it.

### A8 — Printing onto pre-printed stock — **OPTIONAL, build only if asked**

Prerequisites: A5, A7, and §6 Q1 + Q2 answered.

A5 already emits `background: 'none'`. This step is only the **calibration** that makes registering
that ink against paper somebody else printed reliable — and under the amended D-AVI7 the office can
print the stamped template on plain paper instead, which needs none of it. **Do not build this step
speculatively.** It earns its place only if the office decides it still wants the carbonless set
(most likely for the copy that rides in the truck under §396.17(c)).

- `supabase/migrations/NNNN_inspection_print_profiles.sql` — `maintenance_print_profiles`
  (org-scoped: name, layout key, `offset_x_pt`, `offset_y_pt`), RLS derived from the maintenance
  section, manifests updated.
- A **registration-sheet** endpoint printing crosshairs at four known points, so the offset is
  measured with a ruler instead of guessed.

**Done when:** a physical print onto real stock at the stored offset lands every mark inside its
cell — recorded in §7 with the printer named, because an offset is a fact about one printer.

### Deliberately out of scope — named, not silently dropped

- **Truck and trailer file pages.** A6 makes the content exist; the page belongs to the truck-file
  plan (`docs/SILVICOM-360.md` §3, "Digital truck & trailer files").
- **Expiry alerting / "due in 60 days".** The driver-side machinery exists (`dqAlertScheduler`); the
  equipment side has no producer yet. It belongs with the truck-file pages, recorded here so it is
  not mistaken for a gap in this plan.
- **DVIR (§396.11), work orders, PM schedules, FleetPal ingest.** `vehicles.next_pm_due_*` exist
  with zero code references; leave them alone. FleetPal remains gated on the D-SEP8 dedup contract.

---

## 6. Open questions — answer before the step that needs them

~~**Q1 — Is `610641628` pre-printed on the Keller stock, or typed?**~~
**ANSWERED 2026-08-31 (owner), in two parts — and the first part alone was misleading.**

> "They type it on a PDF editor, it is blank by default."
> "That number we are getting from the **sticker** that comes with the form."

So it IS pre-printed, just not where A3 looked. It is the serial of the **§396.17(c)(2) decal** that
ships with the report set, goes on the vehicle, and is transcribed onto the report so the two can be
matched. A3 shipped the column as `stock_serial`; **migration 0281 renames it to `decal_serial`**,
as a rename rather than an add-and-deprecate because production measured **0 rows**, twice.

**This is the most operationally important field on the form, and A3 nearly modelled it as an index
number.** §396.17(c) lets a carrier put either a copy of the report or a compliant decal on the
vehicle. Silvicom uses the decal — so that sticker is often the ONLY on-vehicle proof a §396.17
inspection ever happened, and this column is what turns the number an officer reads at a roadside
into the report §396.21(b) obliges the carrier to produce.

That makes the uniqueness an integrity rule rather than tidiness: one decal is one inspection, and
the same serial on two reports is either a transcription error or **a decal reused on a second
truck** — which would put a vehicle on the road wearing proof of an inspection it never had.

It stays NULLABLE: a failed inspection gets no decal, and §396.21(a)'s six contents do not include
one. Whether a PASS should require it is **Q7**, deliberately not decided by the migration.

**The lesson, since this field has now been wrong twice:** the first answer ("they type it") was
true and still produced the wrong model, because it answered *who enters it* when the question that
mattered was *what it identifies*. Ask what a number points at before naming a column for it.

~~**Q2 — Overlay mark convention: `✔` / `X` / `NA`, or the literal `Ok` / `N/A` typed today?**~~
**ANSWERED 2026-08-31 by measurement (§2.5), not by preference.** pdf-lib's standard fonts are
WinAnsi and **throw** on `✔` (0x2714), `✓` (0x2713) and `✗` (0x2717) — the same constraint
`lib/pdfDraw.ts`'s `winAnsi()` header documents. A tick mark would need either an embedded Unicode
font (a font binary and its licence in the repo, for three glyphs) or a hand-drawn vector path. The
office already types `Ok` / `N/A`, so the convention is the literal text `Ok` / `X` / `N/A`, which
costs nothing and matches every previous year's page. The convention stays a field on the layout
file in case a future template needs a drawn glyph.

**Q3 — Capture odometer and engine hours at inspection?** *(blocks A3 if yes)*
Not required by §396.21 and not on the form, so it is scope widening — but it is the natural join to
PM scheduling, and it costs two nullable columns now against a migration later.
**Recommendation:** add the two nullable columns in A3 and leave them off the printed report.

**Q4 — Does an outside shop ever perform the inspection for Silvicom?** *(blocks A4's inspector model)*
The 2026-08-31 ruling chose the in-house technician. `maintenance_inspectors.user_id` is nullable,
which already covers a name-only outside inspector.
**Recommendation:** keep it nullable — it costs nothing, and the alternative is a migration the first
time a truck is inspected at a dealer.

~~**Q5 — Where does the blank template come from?**~~
**ANSWERED and CLOSED 2026-08-31 (owner).** Rebuilt in Adobe Illustrator 30.7 from the carrier's own
form with every filled value removed, and committed at
`apps/api/src/modules/maintenance/inspections/render/assets/keller-14834-rev0122.pdf` with a
`SOURCE.md` recording its provenance. Verified before use: 612 × 846 pt, rotation 0, **max drift
0.009 pt across 26 artwork anchors** against the original — so §2.5's coordinates transferred
unchanged. The round trip dropped the three AcroForm fields, which simplified A5 rather than
complicating it.

~~**Q6 — The trailer default set is reasoned, not measured.**~~
**ANSWERED and CLOSED 2026-08-31 — the owner had provided the second form at the start and I had
not looked.** `535968 8-26 - uploaded.pdf` is a filled TRAILER report, sitting beside the tractor
one in the same folder the whole time.

Both default columns are now transcribed from real filled forms — tractor 654 (2026-06-16) and
trailer 535968 (2026-08) — mapped onto catalogue keys by script rather than by eye. They differ on
exactly **eighteen** components, pinned by a test.

**The reasoning was wrong on seven of them, and in the same direction.** This is a REEFER fleet: a
trailer has an engine and a fuel tank, so the office marks `exhaust.no_leaks_at_cab`,
`exhaust.no_burn_risk`, all three `fuel.*`, `brake.air_compressor` and
`brake.tractor_protection_valve` as **Ok**. Inferring from "which parts does a trailer have" said
`N/A` for every one. Coupling went the other way — `drawbar_eye` and `safety_devices` are `N/A` on
this trailer where reasoning said `Ok`.

So `appliesTo` and `fleetDefault` are gone, replaced by a measured `defaults: { tractor, trailer }`.
The lesson is not that the inference was careless — it is that **the evidence was already in the
folder** and the question should have been "is there another form?" before it was "what would a
trailer have?".


**Q10 — The dry-van default column is DERIVED, not measured.** *(affects 165 of 211 trailers)*
The trailer sample is a **reefer** — it marks exhaust and fuel `Ok`, which only a reefer has. The
owner's rule is 46 reefers and everything else a dry van, and the roster says exactly that:
`trailers.is_reefer` measured 2026-08-31 is 46 true, 165 false, **never null**. So the column a
trailer reads is a fact the product already holds, and the seed reads it.

What is NOT measured is the dry-van column itself. It is derived from the reefer one by setting the
five engine-and-fuel components to `N/A`, and that is labelled rather than hidden because the last
inferred column was wrong on seven items (Q6). The derivation is a much smaller claim than that one
was — a dry van has no engine and no fuel tank, which is what "dry van" means — but it is still a
claim.
**Recommendation:** one filled DRY VAN report settles it in a minute, the same way the trailer form
settled Q6. Until then this is the only part of either checklist that did not come off paper.

**Q7 — Should a PASS require a decal serial, and should decals be tracked as stock?** *(blocks A6's finalize rule and A7's field; from Q1)*
Now that the number is known to be a §396.17(c)(2) decal, two things follow that the plan has not
decided.

*The finalize rule.* If Silvicom's on-vehicle documentation is the decal, a passing inspection whose
report carries no decal serial describes a truck with no proof aboard — and requiring the serial on
a PASS would catch that while it is still fixable. Requiring it is wrong, though, if the office
sometimes applies the decal later or keeps a report copy in the cab instead.
**Recommendation:** ask whether the decal always goes on before the truck moves. If yes, refuse a
PASS without a serial and say why. If not, warn on the report list rather than blocking — a blocked
finalize the office cannot satisfy is a workaround waiting to be invented.

*The stock question, out of scope but named.* Decals arrive as serialised consumables, so "which
decals do we hold, which truck is wearing which, which were voided" is a real future surface — FMCSA
cares that a decal on a vehicle corresponds to a real inspection. **Not in this plan**, recorded here
only so nobody mistakes `decal_serial` for the whole idea.

---

## 8. Second pass — what the first one got wrong (B1–B5, opened 2026-08-31)

The owner used A7's page and found four things. None is a polish item; the first makes the page
unusable, and the second is a house convention I did not check for before writing copy.

| # | Finding | Why it happened |
| --- | --- | --- |
| 1 | **No way to create an inspection.** The list and the form exist; nothing opens a new one. | A7's plan text described a list and a form and I built exactly that. A page whose only content is a list of things you cannot create is not a feature. |
| 2 | **CFR citations in visible copy, and no filters.** | Measured after the fact: on every non-hazmat page in this product the § references live in HTML comments, never on screen — hazmat is the exception because the regulation IS its subject. And `FilterBar` was rendered with a count and no filters, which is the shell of the convention without the content. |
| 3 | **The connection to vehicle documents is real but unplanned.** | A6 files into `documents` with `subject_type` tractor/trailer, so the content exists — but nothing says how the future truck-file page reads it, which is how a connection becomes a rediscovery. |
| 4 | **No expiry visible where the fleet is read.** History exists (append-only, `supersedes_id`); nobody can see it per vehicle, and the roster pages show no expiry and no warning. | A6 projects `dot_annual_inspection_expires_at` onto the equipment row for exactly this and then nothing read it. A projection nothing reads is the same as no projection. |

**D-AVI15 — the office's language, not the regulation's.** Visible copy names the thing an inspector
would call it; the CFR reference lives in a comment beside the code that implements it. The
regulation is why the field exists, not what the reader is doing. Hazmat is the standing exception
and stays one.

**D-AVI16 — a warning at 30 days.** `DQ_ALERT_THRESHOLDS` is `[90, 60, 30, 14, 0]` for driver
credentials; equipment gets the single 30-day mark the owner asked for, computed by one shared
function so the vehicles page, the trailers page and any later surface cannot disagree about what
"expiring" means.

### Steps

- **B1 — the list can answer the questions a list is asked — DONE 2026-08-31 (PR #421).** Unit
  number and inspector name on every row, plus search over unit / decal / inspector and filters for
  status and result. The equipment is read in ONE batch through `roster`'s new
  `getEquipmentIdentities` — the subject is polymorphic across two tables so PostgREST has no join
  to offer, and 50 rows must not become 50 queries (pinned by a test). Search is applied in
  TypeScript over the resolved page, because searching a column in another module's table is not
  something one query can reach from here without a raw read the gates forbid; if that ever needs to
  be a database concern it becomes an RPC `roster` owns.
- **B2 — the page follows the conventions — DONE 2026-08-31 (PR #421).** Create action in
  `PageHeader`'s `#actions` behind `session.can("maintenance")`, a `NewInspectionModal` asking only
  which machine / who / what date, real `FilterSelect`s in `FilterBar`, and **no § in anything a
  person reads** (D-AVI15) — the citations moved into comments beside the code that implements them,
  and a test asserts the item row renders no `§` and no `App. A`. The form's copy went with it:
  "certify" became "complete", "component" became "part".
- **B3 — the inspector register gets a surface** (closes §6 Q8). Without it B2's create cannot pick
  an inspector, so this is not optional.
- **B4 — expiry on the vehicles and trailers pages — DONE 2026-08-31 (PR #421).** One
  `InspectionExpiryCell` on both pages over `inspectionExpiry()` in `@silvicom/shared`, so the two
  screens cannot disagree about what "expiring" means. Reads the column A6 was already projecting
  and nothing had read. **No date reads as "Not recorded", never as overdue** — a truck that arrived
  last week has no inspection on file, and colouring that red reports a compliance failure nobody
  established.

  ⚠ **A real bug, caught by writing the test rather than by review.** `daysBetween` spread a parsed
  date straight into `Date.UTC`, which takes a ZERO-indexed month — so June read as July. Both ends
  shifted, so most differences stayed correct and only boundaries between months of unequal length
  went wrong: 2026-01-31 → 2026-02-28 came out as **25 days instead of 28**. It is pinned now, along
  with the 30-day boundary itself and both leap-year cases.
- **B3 — the inspector register gets a surface — DONE 2026-08-31 (PR #422)** (closes §6 Q8).
  `/shop/inspectors`: who may inspect, how they qualify, whether that extends to brakes, and the
  period they are active for. Retiring somebody sets `effective_to` and is **never a delete** —
  0280's `on delete restrict` already forbids removing anybody who has signed a report, because the
  report must name who performed it and the qualification evidence outlives the employment by a
  year. Closing the period only stops them being offered for a NEW inspection.

  This page is the reason the derived §396.19 assertion is trustworthy: the printed report says the
  inspector meets the standard, the product decides that from a row rather than a tick box, and
  until now the row was invisible to everybody relying on it.

### B6 — the components were wrong too — DONE 2026-08-31 (PR #424)

The owner's second look found that B2/B3/B5 used the wrong overlay and the wrong page shell. Four
violations, all of them knowable from call sites before a line was written — which is the same
mistake as the CFR citations, made again in the same week.

| What shipped | What the repo does | Why it matters |
| --- | --- | --- |
| Three `BaseModal`s for forms | **`SlideOver`** — used by ten pages, including the `VehiclesPage` "New vehicle" drawer this is a direct analogue of. `BaseModal` was used by essentially nothing but my files | The contract states the boundary outright: *a drawer keeps the list visible beside a form; a modal takes the middle of the screen for content that needs WIDTH*. A three-field form needs no width |
| Form markup inside the overlay | An extracted `*Form.vue` emitting `submit`/`cancel`, with the PAGE owning the drawer — `VehicleForm`, `DriverForm`, `TrailerForm` | The form is testable and reusable on its own; the overlay is the page's concern |
| A bespoke confirm dialog | **`window.confirm`** — five call sites, including "Retire vehicle" and "Delete cost schedule" | *"Never build a bespoke overlay in a feature folder."* What is being certified stays on the page, where it can be read |
| `FilterBar` + `DataTable` as separate cards | **`DataWorkspace`** wrapping both `embedded` — eleven pages | Two cards where the repo draws one workspace |

Also: the item groups were a hand-rolled `rounded-surface ring-1` panel with an `h2`; they are
`BaseCard as="section" padding="none"` with an `h3` at `text-base` — the card-section size, not the
drawer's `text-sm`.

**The lesson, since this is twice.** Both times the answer was in call sites and both times I wrote
first and checked after. A new surface in this repo starts by reading the two or three pages that
already do the same job — the contract is the explanation, the call sites are the answer, and
`gates-outrank-the-design-contract` says which wins when they disagree.

### B7 — the production-readiness audit — DONE 2026-08-31 (PR #424)

The owner asked for the feature to be inspected for gaps, assumptions and blockers rather than
declared finished. Six findings; four fixed here, two are questions only they can answer.

**Fixed.**

1. **`supersedes_id` was never written by anything — D-AVI4's escape hatch did not exist.** The rule
   freezing a completed report is justified by *"a correction is a NEW report carrying
   `supersedes_id`"*. The column shipped in 0280 and nothing wrote it, so for a week an inspector
   who spotted a mistake could start an unrelated inspection and nothing tied it to the one it
   replaced. **An immutability rule whose escape hatch does not exist is a dead end, not
   immutability.** `POST /:id/correct` now starts the superseding draft, seeded from the superseded
   answers — one wrong mark is one edit, not fifty-six — and each seeded row keeps its original
   `source` so a component a person actually set does not become a default again.
2. **A draft could never be abandoned.** No route, no policy, so a mis-started inspection sat in the
   list as "In progress" for ever. `DELETE /:id` discards a draft. It refuses a completed one **by
   name**, and that guard is load-bearing: there is no DELETE policy, but the API reads with the
   service role and bypasses RLS, so this function is the only thing between a mis-typed id and a
   deleted §396.21 record. A trigger is deliberately NOT added — `org_id` cascades from
   `organizations`, so a raising BEFORE DELETE would make deleting an organisation impossible.
3. **`finalize` restamped `catalogue_version`.** A report could claim a checklist it was never
   worked down, which is the one thing D-AVI1's versioning exists to prevent. It is pinned at draft
   creation; a draft whose version has moved is now refused by name rather than derived against
   today's list, which would report "no result" for a row the form never showed.
4. **Every service swallowed the database's error.** Eighteen call sites answered a failed query
   with a sentence naming the operation and threw the cause away — which is why "adding an inspector
   does not work" left no row, no audit entry and no log line. `lib/http.ts`'s `dbErrorResponse`
   already had the shape; these services now use it, so a failure carries a reference somebody can
   grep for.

**Still open, and both are the owner's to answer** — §6 Q6 (the trailer defaults are reasoned, not
measured) and §6 Q7 (whether a PASS should require a decal serial).

**What could not be reproduced.** The reported "adding an inspector is not working" was chased with
evidence rather than guesses and none of the obvious causes hold: all five routes answer 401
unauthenticated so they exist; the four tables are live with 0283 applied; `verify:live` puts
Railway on the current `main`; the deployed JS bundle contains the register page and both drawers;
the exact insert payload succeeds against a real PGlite database with the full schema and the
`created_by` FK; and the form's submit path is covered by four passing tests. What remains needs a
session, so the tracing above exists to make the next attempt legible.

### B8 — the drawers, the row actions, and one dropdown control — DONE 2026-08-31 (PR #TBD)

The owner's third look at the same surface. Five findings, and the honest summary is that **B6's own
lesson did not take**: B6 said *"a new surface starts by reading the two or three pages that already
do the same job"*, corrected the overlay and the page shell, and left the INSIDE of those overlays
un-checked against the same call sites. Everything below was knowable from `apps/web/CLAUDE.md`,
which states four of the five rules outright.

| What shipped | The rule | Where the rule is written |
| --- | --- | --- |
| Cancel/Save as the last element of a scrolling drawer body | Actions belong in `SlideOver`'s `#footer` | `apps/web/CLAUDE.md` "Non-negotiables"; contract §6.2; checklist #9 |
| Drawers at the default `size="md"` | `size="lg"` when the drawer holds a real form | contract §6.2 |
| Failures rendered as an inline `AppCallout` under the fields | *"Mutation feedback is a toast, never an inline banner"* | `apps/web/CLAUDE.md`; contract §5.8; checklist #10 |
| An `actions` COLUMN on the register with an inline ghost button; no row actions at all on the list | `#actions` slot → `KebabMenu` with `.kebab-item`, destructive last | contract §5.6; checklist #6 |
| `AppSelect` beside `ComboSelect` in one three-field drawer | *"`FilterSelect` (toolbars) vs `ComboSelect` (forms)"* | `apps/web/CLAUDE.md` "Non-negotiables" |

**D-AVI18 — one dropdown control per surface, chosen by SURFACE and not by list length.** The
project's rule splits on where the control lives — `FilterSelect` in a toolbar, `ComboSelect` in a
form — and the reasoning behind it is visible in `NewInspectionDrawer`, which was the one place in
the product where you could see both answers at once: `AppSelect` is a bare native `<select>`, so
its panel is drawn by the operating system, in the OS's type at the OS's metrics with the OS's focus
ring, directly above two tokened popovers. Equipment type has two options and Unit has two hundred;
the list length is why one of them searches, not why they should look like different products.

The three drawers are now self-contained (`InspectorDrawer`, `NewInspectionDrawer`,
`PrintInspectionDrawer` — renamed from `*Form.vue` because they own their `SlideOver` now, the shape
`RequirementDrawer` / `HireDrawer` / `InquiryResponseDrawer` use), the footer submits the body's form
by `form="…"` association, and every mutation reports through `useToastStore`.

**The one deliberate exception to the toast rule**, commented at its site: `finalize`'s refusal on
`AnnualInspectionFormPage` stays an `AppCallout`. §5.8 is about mutation feedback — a sentence that
expires — and that refusal is a worklist naming the components still needing an answer. It has to
stay on screen beside the rows it is about, and it must outlive the four seconds a toast gets.

**Continuing and discarding an inspection.** Both already existed — the route, and the `DELETE` B7
added — and neither was reachable without opening the report first, so the list showed the state and
offered nothing to do about it. They are row actions now: *Continue inspection* on a draft, *Open
report* once filed, and *Discard* for a draft only (D-AVI4 — a filed report is superseded, never
deleted; the API refuses it by name and the menu does not offer it).

**Removing an inspector (D-AVI19).** B3 ruled that retirement is a date and never a deletion, and
that ruling stands for the case it was written about: somebody who has inspected trucks has reports
naming them, and §396.19 wants the evidence for a year past the employment. It was answering the
wrong question for the OTHER case — a name typed wrongly and caught before it was used. Retiring
that row leaves a person on the register who never existed, and the register's whole purpose (B3) is
that the derived §396.19 assertion be checkable against something real.

So `DELETE /api/maintenance/inspectors/:id` exists, and **the page does not decide which case it is
looking at**. The delete is attempted; 0280's `on delete restrict` decides; a violation (SQLSTATE
23503) comes back as a 409 whose message names Retire as the answer, and that message is what the
reader is shown. Counting reports first to grey the action out would be the same question answered
twice, and the second answer can be stale by the time it is acted on — which is the race a foreign
key exists to not have.

**Open, and not fixed here — `AppSelect` renders a native panel.** Contract §1.2 describes the form
select as *"trigger matches the input metrics, panel matches the KebabMenu recipe"*, and the
component is a bare `<select>`; the 2026-08-11 UI audit §6.2 recorded the same drift from the other
side, when it still opened a custom listbox with no keyboard model. Fifteen files use it. Options:
rebuild it on the tokened popover the description promises, or retire it in favour of `AppCombobox`
and migrate the fifteen. **Recommendation: retire it** — `AppCombobox` already carries the keyboard
contract, the teleport at `z-popover` and the async path (HAZMAT-UX-PLAN §2.1), and two controls for
one job is what D-AVI18 is about. Out of scope for this surface, which uses `ComboSelect` throughout.

### B9 — the header the form has and the product could not fill — DONE 2026-08-31 (PR #TBD)

The owner: *"in drawer for annual inspection we are missing options to select company and address and
to put sticker number."* Three values the printed page carries, none of which had any UI:
`decal_serial`, `inspection_agency_location`, and the choice between the two.

**What the form actually asks, read off the artefacts rather than assumed.** `pdftotext -layout` on
the blank template and on both filed samples:

| Box on the form | Filed value (trailer 535968, 08/2026) | Where it comes from |
| --- | --- | --- |
| REPORT NUMBER | `610685784` | the §396.17(c)(2) decal — **no UI existed** |
| FLEET UNIT NUMBER | `535968` | derived from the roster |
| MOTOR CARRIER OPERATOR / ADDRESS / CITY, STATE, ZIP | `SILVICOM INC` / `1301 ARMITAGE AVE` / `MELROSE PARK IL , 60160` | `organizations`, edited at `/settings/org`; finalize refuses without it |
| INSPECTOR'S NAME | `GEORGE GACEV` | the register |
| VEHICLE IDENTIFICATION ✓ VIN | `1JJV532B4HL005968` | derived from the roster |
| INSPECTION AGENCY/LOCATION (OPTIONAL) | *blank* | **no UI existed** |

Two things that settles, before any design:

1. **There is nothing to "select" for the carrier.** `select … from organizations` in production
   returns one real carrier (Silvicom Inc, complete) and one QA org. The MOTOR CARRIER block is
   derived and already enforced. So the ask is the AGENCY line — the shop that did the work.
2. **The agency line is optional on the form and the office leaves it blank**, correctly: their own
   technician does the inspection and the carrier block above it already names the company. So
   "our own technician" is the default and prints nothing; the company/location fields appear only
   for the case Q4 kept open — a dealer or shop doing one.

**D-AVI20 — the decal serial is asked for at the start AND editable on the report.** It is on CREATE
because that is when it is legible: the inspector is holding the report set the sticker came in. It
is on the report page because a decal often goes on once the truck is back together. One component
(`InspectionHeaderFields`) mounted twice, not two editors — the failure mode `lint:capabilities` was
written for is a field acquiring a second editor with a different amount of honesty.

**D-AVI21 — a duplicate decal serial is a 409 that names the mistake, not a 500.** 0280 has
`unique (org_id, decal_serial) where decal_serial is not null` and nothing translated it, so the
first mistyped digit would have been a bare server error — the reading under which somebody decides
the field is broken and stops filling it. It now says: *"That decal serial is already on another
inspection. One decal belongs to one inspection, so check the sticker against the report that
already carries the number."* That is the integrity rule 0281 describes, said to the person holding
the sticker: a repeat is either a transcription slip or a decal peeled onto a second truck, and the
second puts a vehicle on the road wearing proof of an inspection it never had.

**The agency cell was measured before the fields were designed.** 158 pt wide, stamped at 8 pt, the
renderer shrinking to a 5.5 pt floor. Against pdf-lib's Helvetica:

| Value | Chars | Settles at | Result |
| --- | --- | --- | --- |
| `PETERBILT OF CHICAGO, MELROSE PARK IL` | 37 | 7.25 pt | fits |
| `PETERBILT OF CHICAGO, 1301 ARMITAGE AVE MELROSE PARK IL 60160` | 61 | 5.50 pt (floor) | **189 pt — overflows** |

About **47 characters** is the ceiling. So the second field is labelled *Location* and asks for a
city and state — which is what a form saying AGENCY/**LOCATION** wants anyway — and the hint carries
a live count once the line is over budget. A hint and not an `error`: the renderer shrinks rather
than refusing, so red would claim a refusal that never comes. Both boundaries are pinned in
`render/layout.test.ts`, which had never asserted this cell because nothing could write it.

**One stored line, two boxes.** The column is one field because the form is one cell; the office
asked for company and address separately. The split is a presentation — joined with `", "`, split
back on the first comma — and the round trip is what the component's test is mostly about, because
a split that cannot rebuild what it wrote loses an office's typing on reload.

**Q7 is still the owner's**, and this ships only the half that does not decide it: a passing draft
with no sticker number says so on the page, where the sticker is still to hand. It does not block
finalize. The question remains whether the decal always goes on before the truck moves — if it does,
a PASS should be refused without one and this warning becomes a refusal.

### B10 — the print itself: headings, ink, type and alignment — DONE 2026-08-31 (PR #TBD)

Four reports from the owner against a rendered page (`183-sold.pdf`), plus one correction to a
premise this plan has leaned on since A5: *"this original I have provided was broken from start and
i didnt noticed."*

**D-AVI22 — the section headings are Keller's knockout, and we have to draw them ourselves.**

The first read was that the Illustrator round trip dropped them. It did not, and the difference
matters. In BOTH our blank and the carrier's own untouched report, all sixteen headings are painted
at `0 0 0 0 scn` — zero ink — over a **0.48 pt** red hairline. Measured at 300 dpi: fifteen
hairlines, one per printed column-section, each with its heading knocked out of it.

**That is a design for pre-printed stock.** The pad Keller ships already carries the coloured heading
bands; the PDF is meant to be filled and printed ONTO it, so the ink is deliberately never laid
down. Print it on plain paper — which is what "Plain paper — the whole form" does — and the office
gets a table of items with nothing naming the sections. The carrier's own good report behaves
identically, so this was never a template defect.

So the renderer draws all sixteen, in black, knocked into the hairline, **only when
`background: "template"`**. The overlay path lands on a real pad that already has them, and drawing
them there would print every heading twice (D-AVI8). They come from `INSPECTION_GROUPS`, not from a
list of strings, so a heading cannot go missing or disagree with the items under it.

`1. BRAKE SYSTEM` *was* additionally absent from the `654` export — genuinely, not knocked out —
which is what made the fault look like a template problem. That is now moot and is recorded in
`assets/SOURCE.md`, along with the missing `OK` column header (cosmetic, not restored).

**D-AVI23 — the header prints at the sizes and weight the office's own reports carry.** Everything
was one regular 10 pt, which is why the top of the page read thin next to Keller's artwork. Measured
off `535968 8-26`:

| Field | Measured | Now |
| --- | --- | --- |
| carrier name / address / city-state-zip | `/HeBo 12.085 Tf` — **Helvetica-Bold 12**, read out of the AcroForm appearance stream | 12, bold |
| decal serial, fleet unit number | 9.00 pt of advance per digit ÷ Helvetica's 0.556 em = **16.2 pt** | 16, bold |
| inspector name | "GEORGE" 72.74 pt over 4.39 em = **16.6 pt** | 16, bold |
| date | 39.01 pt over 3.614 em = **10.8 pt** | 11, bold |
| VIN | 75.32 pt over 9.788 em = **7.7 pt** — the one value the office prints small, because seventeen characters must fit the box | 9, bold |

Bold is not a preference: the carrier block's own appearance stream names Helvetica-Bold.

**D-AVI24 — the draft preview stamps in black, like the filing.** It stamped
`rgb(0.72, 0.11, 0.11)`, and the office reasonably read that as the product printing in red. It was
a second signal nobody needed — the page already carries `DRAFT - NOT A CERTIFIED INSPECTION` across
the middle of it, which says the thing in words. What the red cost was the preview's whole job:
D-AVI14 exists so the office can see what will print before certifying, and a preview whose ink is a
different colour from the filing is not showing them that. The ink is also now pure black rather
than the 0.1 grey it was — this is a record that gets photocopied at a roadside.

**Alignment: four cells moved, and the reason is which sample they came from.** The map was measured
against the damaged `654`. The carrier block matched the office's filled report to two decimals
(24.29/174.07, 24.29/198.55, 23.29/222.53) — but four cells had been inferred from artwork rather
than read off a filled page:

| cell | was | is | drift |
| --- | --- | --- | --- |
| decalSerial | 389.2, 125.8 | 385.7, 125.1 | 3.5 pt right, 0.7 low |
| fleetUnitNumber | 519.7, 125.8 | 515.5, 125.7 | 4.2 pt right |
| inspectedOn | 447.2, 144.7 | 448.2, 146.0 | 1.0 left, 1.3 high |
| vehicleIdentificationValue | 324.0, 221.9 | 331.6, 222.5 | 7.6 pt left |

The two files were confirmed to share a coordinate system before anything moved: the "VEHICLE
COMPONENTS INSPECTED" bar renders at exactly y 252.96–264.72, x 18.00–593.76 in both at 300 dpi.

**The item marks were measured and deliberately left alone.** Ours sit at x 18.8 / 210.6 / 402.6
against the office's 19.2 / 211.2 / 403.7 — 0.4 to 1.1 pt — and the baselines match exactly
(299.56 = 299.56). Ours were derived from the ruled boxes scanned at 300 dpi, which is a better
origin than where a person happened to click in a form field. Moving them would be churn.

**How this was found, since it is a lesson about the tests.** Nothing here was visible to any
existing test: `report.test.ts` asserted the PDF was over 100 kB and deterministic, which a page of
white-on-white headings satisfies perfectly. The new assertions read what was PAINTED — inflating
pdf-lib's deflated content streams and decoding its hex strings — so "the heading is on the page",
"it is not on the overlay" and "the draft ink is black" are now properties rather than intentions.

### B11 — the template audit: what the export lost, and what a preview is allowed to differ from — DONE 2026-09-01

Reported by the owner against a filled sample of the office's own good form: *"when we print we
don't have this section names, also section names are not correct as on original… when i try to edit
it in PDF it is removing this sections."*

**D-AVI25 — B10's diagnosis was wrong, and the way it was wrong is the finding.**

D-AVI22 said the sixteen headings are knocked out at `0 0 0 0 scn` over a 0.48 pt red hairline
because Keller's pad is pre-printed. Read at the operator level on 2026-09-01, the blank contains:

- **no `scn` operator at all**, and no CMYK — the page paints in `rg`/`RG` only, in four colours;
- **no red rule at any heading row** — the only red strokes left are the four legend blanks;
- fifteen heading strings painted `1 1 1 rg`: white on nothing.

The 300 dpi scan that "measured fifteen hairlines" had measured the **bands' vertical centres** and
called them hairlines. Every `rule` value in `GROUP_HEADINGS` was within 0.16 pt of a band centre —
the numbers were right and the story around them was not.

So the export **dropped artwork**. Four things, all of them ink the office's filed reports carry:

| lost | what survives, and how the replacement is measured |
| --- | --- |
| the sixteen coloured section bands | each band's own pair of full-group-width rules, exactly **12.00 pt** apart, sixteen pairs. Independently corroborated: the surviving "VEHICLE COMPONENTS INSPECTED" bar is drawn as a **12 pt stroked line** in the same red |
| `1. BRAKE SYSTEM`, absent from the file entirely | nothing — which is why all sixteen now come from `INSPECTION_GROUPS` rather than from the page |
| the `OK` column heading, all three groups | ink measures **10.50 pt** wide on the filed report, which is Helvetica-**Bold** at exactly 7 pt (regular is 10.12 and does not fit), on `ITEM`'s own baseline |
| the ✓ in `VEHICLE IDENTIFICATION (✓ AND COMPLETE)`, and the ✓ / X / NA on the INSTRUCTIONS legend | the sentence and the four red blanks. The legend marks are centred on their own rule to within 0.2 pt; the fourth blank carries no mark on the original and gets none here |

Band geometry is derived rather than restated: `y = bandCentre + 3.26` reproduces all sixteen of
Keller's own baselines to within 0.06 pt, so band and type are provably concentric. The number-to-
title tab is Keller's own operator — `1.389 0 Td` for a one-digit number, `1.735 0 Td` for two, at
8.64 pt — which is why `1.  BRAKE SYSTEM` carries a wide gap and `16. OTHER` does not. A band is
also **framed**, not just filled: its two horizontal rules and the group's two boundary verticals
survive across it on the original while the internal column rules stop at it, so the fill redraws
that frame.

**What stops the next wrong belief.** `TEMPLATE_SUPPLIES` declares what the asset carries and
`render/assets.test.ts` reads the PDF to prove the declaration. A clean export flips five flags and
the renderer stops drawing what the page already has, instead of double-printing it. The old
diagnosis survived a fortnight because nothing could contradict it.

**D-AVI26 — three tick boxes were printing on top of the labels they were meant to tick.**

`layout.test.ts` asserted only that no two tick boxes shared a position, which every wrong answer
also satisfies. The page draws its nine boxes as plain `re` operators, so they can simply be read:

| box | artwork | was | drift |
| --- | --- | --- | --- |
| LIC. PLATE NO. | 451.75, 638.302 | 470.0 | **18.3 pt right — struck out "LIC."** |
| OTHER | 552.75, 638.302 | 574.0 | **21.3 pt right — struck out "OTHER"** |
| TRAILER | 123.25, 614.302 | 128.0 | **4.8 pt right — struck out "TRAILER"** |
| §396.19 YES, VIN, TRACTOR | — | — | within a point, but all 1.5 pt low |

So a plate- or other-identified report printed its only vehicle-ID mark across a printed label with
all three boxes left empty, and **every trailer report** struck out the word TRAILER. All 46 trailers
in the fleet inspect on this form (D-AVI12). The 1.5 pt drop was `baselineOf`'s descender correction,
which is right for text cells measured with `pdftotext` and wrong for artwork read off `re` operators
— so tick boxes no longer go through it, and the X is centred in the box's own rectangle.

**D-AVI27 — a filing and a preview may differ, and the row now says which drawing made it.**

This is what the owner actually met. A final report serves its **stored bytes** and is never
re-rendered (§390.32(c), `documents.sha256`) — that rule is right and stays. What was missing is that
nothing recorded which renderer drew them, and `RENDERER_VERSION` was not bumped when B10 changed the
drawing. So `renderDigest` went on asserting that a report filed before the change and a preview
drawn after it came from "the same renderer". They did not look alike.

The single report filed in production (2026-09-01 04:01 UTC) predates B10's merge by thirty minutes.
It is the page the owner printed.

- `RENDERER_VERSION` → **2.0.0**, and the rule is written next to it: bump when the drawing moves.
- Migration **0284** records `renderer_version` and `template_revision` on the report row at
  finalize. NULL is left as NULL rather than backfilled with a guess — it means "filed before we
  wrote this down", which is older than any version we could name.
- The detail route answers with `currentRendererVersion`, and the form shows a caution on a report
  whose filing predates it: the filed copy is the evidence and is served as certified; putting the
  current form on paper means recording a correction. The version rides on the response rather than
  being copied into the client, so there is no second source of truth to go stale.

**Not done, deliberately:** the one stale filing was not re-filed. Superseding it is the office's
call under A9's correction path, not a migration's.

### The vehicle-file connection, written down (D-AVI17)

The owner asked that this be planned rather than left implicit. It is already **built** — what was
missing is the sentence saying so, which is how a connection becomes a rediscovery.

A completed inspection writes three rows, and the future truck & trailer file needs no new storage
to show any of them:

| What the page wants to show | Where it already is | How it reads it |
| --- | --- | --- |
| Every inspection this unit has had | `vehicle_inspections`, append-only, newest first | `GET /api/maintenance/inspections?subjectId=<uuid>&subjectType=tractor` — the filter exists |
| The report PDF for any of them | `documents`, `subject_type` `tractor`/`trailer`, `kind='annual_inspection'`, with its sha256 | `listDocuments` through `evidence`'s interface, the same call the driver file makes |
| Whether the unit is currently inspected, and until when | `certifications`, auto-superseding, `kind='annual_inspection'` | `listCertifications` — current rows by default, the supersede chain with `includeHistory` |
| The at-a-glance state on a list | `vehicles`/`trailers.dot_annual_inspection_expires_at` | `inspectionExpiry()` — already on both roster pages (B4) |

**D-AVI17: the truck file adds a page, never a store.** If a future step finds itself creating a
table to hold inspection history, or a second copy of the PDF, or its own expiry column, the
connection has been missed — all four rows above are already written by finalize and are queryable
today. The one thing genuinely absent is a per-unit VIEW, and that belongs to the truck-file plan
rather than here: it is the same list this section already renders, filtered to one `subject_id`.

- **B5 — A8, built — DONE 2026-08-31 (PR #423, migration 0283).** The owner reversed the earlier
  ruling: the truck copy is printed onto the pre-printed pads, so the calibration exists.

  `maintenance_print_profiles` stores an offset **per printer** — registration is a property of the
  machine, not of a person or a session, so two people printing the same report get the same page
  and a second printer can exist without making the first one's numbers wrong. Deliberately NOT on
  `vehicle_inspections`: the offset describes the machine the paper went through, and putting it on
  the report would make a re-print from another printer either wrong or a reason to edit a finalized
  row (D-AVI4 forbids the second).

  **The registration sheet is the point.** The alternative is asking somebody to print a report,
  look at it and guess — which produces a second guess, and an office nudging a number until it
  looks right has a calibration nobody can reproduce. The sheet prints crosshairs at four REAL cells
  from the coordinate map, each labelled with the box it should sit in; lay it over a blank form and
  the offset is a ruler measurement. **Four marks and not one**, because a single point cannot tell
  a shift from a scale error — if the four differences disagree, the printer is scaling and no
  offset will fix it, which the sheet says on its face.

  Two things the tests caught. The arms were 9 pt and the leftmost target sits 25.5 pt from the
  paper edge, inside the 4–6 mm most lasers cannot print — a clipped crosshair still looks like a
  crosshair, so somebody would have measured a wrong number carefully. And the sheet's own
  instructions pointed at a settings screen that did not exist; printer setup now lives on the print
  menu, which is where somebody discovers they need it — nobody goes looking for a calibration
  screen, they find a page printed two millimetres low.

---

## 7. What shipped

*(Nothing yet. One dated subsection per PR, as steps land.)*

**Q6 — The trailer `fleetDefault` set is reasoned, not measured.** *(blocks A7's pre-fill, not A1)*
A1's tractor defaults are transcribed from a real filled report and are pinned by a test naming unit
654 and 2026-06-16. **There was no trailer sample**, so the trailer column was derived from
applicability plus the tractor pattern — defensible, and still a different kind of fact from the
tractor column beside it. The exposure is narrow by construction: `appliesTo` is regulation-derived
and unaffected, so a wrong `fleetDefault` opens the form on the wrong answer rather than certifying
one — the inspector still has to leave it there.
**Recommendation:** get one filled trailer report from Miki and pin the trailer column the same way,
before A7 puts those defaults in front of an inspector.

**Q7 — Should a PASS require a decal serial, and should decals be tracked as stock?** *(blocks A6's finalize rule and A7's field; from Q1)*
Now that the number is known to be a §396.17(c)(2) decal, two things follow that the plan has not
decided.

*The finalize rule.* If Silvicom's on-vehicle documentation is the decal, a passing inspection whose
report carries no decal serial describes a truck with no proof aboard — and requiring the serial on
a PASS would catch that while it is still fixable. Requiring it is wrong, though, if the office
sometimes applies the decal later or keeps a report copy in the cab instead.
**Recommendation:** ask whether the decal always goes on before the truck moves. If yes, refuse a
PASS without a serial and say why. If not, warn on the report list rather than blocking — a blocked
finalize the office cannot satisfy is a workaround waiting to be invented.

*The stock question, out of scope but named.* Decals arrive as serialised consumables, so "which
decals do we hold, which truck is wearing which, which were voided" is a real future surface — FMCSA
cares that a decal on a vehicle corresponds to a real inspection. **Not in this plan**, recorded here
only so nobody mistakes `decal_serial` for the whole idea.

---

## 7. What shipped

*(Nothing yet. One dated subsection per PR, as steps land.)*
