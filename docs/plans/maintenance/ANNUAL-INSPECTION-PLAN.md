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

**Status: A0, A1 and A2 shipped 2026-08-31 (PRs #410, #411, #412). A3 is next.** D-AVI7 was **amended the same day**
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
| **D-AVI2** | Item applicability is **data on the catalogue** (`appliesTo: ('tractor'\|'trailer')[]`, `defaultNa`), never a branch in the form. | Motorcoach seats never apply to this fleet; rear impact guards apply to trailers, fifth wheels to tractors. Deriving beats restating. |
| **D-AVI3** | **Pass is derived, never typed.** `outcome = 'pass'` iff every applicable item is `ok`, `na`, or `needs_repair` **with** a `repaired_at`. Otherwise `fail`. | §2.3. A human typing "pass" beside an open defect is a false certification, and the form's own certification line asserts the opposite. |
| **D-AVI4** | **Finalize is one-way; the row then becomes immutable.** No UPDATE/DELETE once `status='final'`; a correction is a **new** report carrying `supersedes_id`. | The evidence discipline of `certifications`/`documents` (`RETENTION_FORBIDDEN`): corrections are new rows. |
| **D-AVI5** | Every applicable catalogue item must carry an explicit result before finalize. **No implicit blanks.** | §396.21(a)(5) — §2.2. |
| **D-AVI6** | The §396.19 box is **derived from a current inspector qualification record** (`maintenance_inspectors`), which holds the basis under §396.19(b)(1)/(2), brake qualification under §396.25, and the evidence document. | §2.3. Regulation also requires that evidence be retained for employment + 1 year, which needs a row to hang on. |
| **D-AVI7** | ~~Two renderers over one payload: `full` (our layout — the stored evidence) and `overlay` (values only). No Keller artwork is reproduced or committed.~~ **AMENDED 2026-08-31 (owner ruling): one renderer, one coordinate map, a `background` switch.** A blank Keller 14834 Rev. 1/22 is committed as a versioned asset; `background='template'` stamps the values onto it (the stored evidence, prints on plain paper), `background='none'` emits values only for printing onto pre-printed stock. | §2.1. The binder has looked like that page for years and an auditor recognises it. The costs — copyright, revision-pinning, needing a blank — are enumerated in §2.1 and were accepted, not missed. |
| **D-AVI8** | Calibration applies **only to `background='none'`** — printing onto pre-printed stock. A stored profile (org-scoped, per printer: x/y offset in points) is set by printing a registration sheet and measuring it. `background='template'` needs no calibration: the artwork and the values are on the same page and drift together. | Printer margin and scaling drift is the entire precision risk of registering ink against paper someone else printed. A `localStorage` offset would give two people two different results. Under the amended D-AVI7 this is now an **optional** step — see A8. |
| **D-AVI9** | The `certifications` row is the **source of truth** for the expiry; the `vehicles`/`trailers` column is a projection roster maintains, and finalize claims the row to `identity_source='manual'`. | §1.1 and §2.4. D-ARC3's CDL/medical ruling, applied before the dual source exists rather than after. |
| **D-AVI10** | Maintenance **never writes** `documents`, `certifications`, `vehicles` or `trailers` directly. `evidence` and `roster` each gain one exported owner-interface function. | D-ARC3, machine-enforced by `check-table-writers.mjs` and `check-table-access.mjs`. |
| **D-AVI11** | New role **`technician`**: `maintenance: manage`, `equipment: view`, everything else `none`. | The recruiter and accountant lesson applied on day one — minimal irreversible surface. ⚠ One-way door: Postgres has no `ALTER TYPE … DROP VALUE` (0266's header). |
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

### A3 — Schema (migration + PGlite matrix)

Prerequisite: A2 (the policies name the role).

`supabase/migrations/0280_annual_inspections.sql`:

- **`maintenance_inspectors`** — `id, org_id, full_name, address, user_id → auth.users (nullable),
  qualification_basis check ('state_federal_program','training_and_experience'), brake_qualified
  boolean, evidence_document_id → documents (null on delete), effective_from, effective_to, notes,
  created_at/by`.
- **`vehicle_inspections`** — `id` (client-generated, for idempotent replay), `org_id, subject_type
  check ('tractor','trailer'), subject_id, inspector_id → maintenance_inspectors, inspected_on date,
  catalogue_version text, vehicle_identification_method check ('vin','plate','other') + value,
  inspection_agency_location, stock_serial, other_conditions, status check ('draft','final'),
  outcome check ('pass','fail') null while draft, next_due_on date, supersedes_id →
  vehicle_inspections, certification_id → certifications, document_id → documents, finalized_at/by,
  created_at/by`. Partial unique index on `(org_id, stock_serial) where stock_serial is not null` —
  one carbonless set cannot be recorded twice.
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

### A4 — API: inspectors and the draft lifecycle (no PDF, no finalize)

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
and `driver` do not; and a PATCH against a final row is refused by the API **and** independently by
the trigger (both asserted).

### A5 — The renderer: stamp the template

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

### A6 — Finalize: derive, render, file, project

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

### A7 — Web: the list and the form

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

**Q1 — Is `610641628` pre-printed on the Keller stock, or typed?** *(blocks A3's unique index and A8)*
It renders in the same bold serif as the pre-printed rules, and J.J. Keller serialises AVIR sets. If
pre-printed it is a `stock_serial` — captured, unique per org, meaningful only in overlay mode. If
typed, it is a carrier-assigned report number and we should generate it.
**Recommendation:** model it as `stock_serial` (nullable, unique when present) and confirm against a
blank pad before A8.

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

**Q5 — Where does the blank template come from?** *(blocks A5)*
The file this plan was measured against is a **filled** copy — unit 654, George Gacev, 57 marks. A5
needs a clean 14834 Rev. 1/22: either the unfilled PDF Keller supplies with the pads, or a flat scan
of a blank page. Stripping the annotations off the filled copy is not equivalent — `pdftotext` found
57 marks against only 24 annotation objects, so some values are already flattened into the page's
content stream and would print underneath ours.
**Recommendation:** ask Miki for the unfilled PDF. If the pads ship without one, a 600 dpi flat scan
is acceptable — record which it was in the asset's `SOURCE.md`, because a scan will not register
against the pads as precisely as the original.

**Q6 — The trailer `fleetDefault` set is reasoned, not measured.** *(blocks A7's pre-fill, not A1)*
A1's tractor defaults are transcribed from a real filled report and are pinned by a test naming unit
654 and 2026-06-16. **There was no trailer sample**, so the trailer column was derived from
applicability plus the tractor pattern — defensible, and still a different kind of fact from the
tractor column beside it. The exposure is narrow by construction: `appliesTo` is regulation-derived
and unaffected, so a wrong `fleetDefault` opens the form on the wrong answer rather than certifying
one — the inspector still has to leave it there.
**Recommendation:** get one filled trailer report from Miki and pin the trailer column the same way,
before A7 puts those defaults in front of an inspector.

---

## 7. What shipped

*(Nothing yet. One dated subsection per PR, as steps land.)*
