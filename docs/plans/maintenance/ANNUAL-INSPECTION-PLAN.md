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

**Status: A0 shipped 2026-08-31 (PR #410). A1 is next.** D-AVI7 was **amended the same day**
(owner ruling, §3) — the stored report is the Keller template with our values stamped onto it, not
a layout of our own. §2.1 carries the argument that was overturned and what the ruling costs. §1's measurements are the pre-A0 baseline, taken
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
| **D-AVI12** | Trailers are in scope from day one. | §396.17 applies to them, and the subject type, the expiry column and the document kind already exist. Excluding them would guarantee a second half-feature later. |

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

### A1 — The catalogue and the contract (`packages/shared`; no DB, no API)

- `packages/shared/src/annualInspectionCatalogue.ts` — `INSPECTION_CATALOGUE_VERSION` and the 15
  Appendix A groups with their sub-items, each `{ key, group, label, cfr, appliesTo, defaultNa }`.
  Item keys are stable and never reused (`brake.service_brakes`, `rear_impact_guard.present`, …).
- `packages/shared/src/annualInspectionContract.ts` — zod schemas for the draft, patch and finalize
  requests and the response DTOs, plus the **pure** `deriveInspectionOutcome(items, catalogue)`
  (D-AVI3) and `nextDueDate(inspectedOn)`.
- Export both from `packages/shared/src/index.ts`.

**Done when:** `deriveInspectionOutcome` is unit-tested without a clock or a database; an item with
no result is an **error**, not a default; the catalogue test proves no duplicate keys and a CFR
citation on every item; `lint:shared-contracts` passes.

### A2 — The `technician` role (migration + matrix, one PR)

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
  cascade, item_key, result check ('ok','needs_repair','na'), repaired_at date, note`. Unique
  `(inspection_id, item_key)`.
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
- **Provenance.** A footer line carrying the catalogue version, the template revision, the renderer
  version and the **source payload digest** — the `applicationPdf/render.ts` precedent, since a
  document cannot contain its own hash. Place it in the form's own margin, never over the artwork.

**Done when:** a golden test renders a fixture in both `background` modes and asserts every
§396.21(a)(1)–(6) element and every failing item's label is present in the extracted text; a
**bijection test** asserts the map and the catalogue cover each other exactly — every applicable
catalogue item has a coordinate and every coordinate has an item, so a Keller revision fails the
build instead of silently printing a blank cell; rendering is deterministic (same payload + same
versions → byte-identical output across two renders, asserted as a hash equality); `lint:filesize`
and `lint:funcsize` pass with no grandfather entry added.

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
- The form uses the `DriverForm.vue` idiom. Per item a three-state OK / Repair / N/A control; the
  repaired-date field appears only on `needs_repair`. A sticky summary ("48 of 61 set · 2 open
  defects") and a **derived, non-editable** pass/fail banner reading the same shared function the
  API uses. Draft autosave; finalize behind a confirm dialog that states in words what is being
  certified.
- Print opens `GET …/report.pdf?mode=full`. **Not** print-CSS: the app's only `@media print` block
  (`style.css:258`) exists for modals and is the wrong tool for a filed document.

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

**Q2 — Overlay mark convention: `✔` / `X` / `NA` per the form's own instruction line, or the literal
`Ok` / `N/A` typed today?** *(blocks A8)*
**Recommendation:** the form's instruction line, with the convention as a field on the layout file so
it is a one-line change either way.

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

---

## 7. What shipped

*(Nothing yet. One dated subsection per PR, as steps land.)*
