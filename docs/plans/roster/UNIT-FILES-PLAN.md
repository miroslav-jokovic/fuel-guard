# Driver, truck and trailer files: one Files column, bulk upload, QR, digital binder. Plan (2026-10-19), **RULED, ready to build**

The owner's brief (2026-10-19) asked for:

- three separate files, **Driver files, Truck files and Trailer files**, each tied to its driver, truck or trailer;
- a **QR system**;
- a **digital binder**;
- **bulk upload** of documents;
- **no duplicated list pages**. The existing Drivers, Vehicles and Trailers tables each gain one column, on the
  model of monday.com's Files column: preview and open a file from a single cell.

The DQ file's own page UX is acknowledged as weak and gets its own later plan. This plan must not make that
fix harder.

The owner ruled the same day: *"proceed with recommended solutions for open questions and let's plan this
properly"*. Every Q-UF below is therefore answered (§7), and the rest of this document is the build.

Prefixes: decisions are **D-UF**, steps are **UF**, questions are **Q-UF**. Every fact cited was read on
`origin/main` at `6a64713` on 2026-10-19. A file:line reference means *verify it again at the call site
before building on it*.

---

## 1. What exists, measured

The storage is done. D-AVI17 already ruled that "the truck file adds a page, never a store", and this plan
keeps to it. Everything above the storage is missing, or is driver-only.

### 1.1 Stores

**`documents` (0146, kind check last rewritten by 0484).**
- Columns: `subject_type` (driver / tractor / trailer / load / organization / roadside_inspection),
  `subject_id` (polymorphic, no FK), `kind`, `content_type`, `sha256`, `page`, `variant` (original /
  normalized / thumb).
- It is append-only.
- Bucket `compliance-docs` takes up to 25 MB per file, under the path `org/subject_type/subject_id/{id}.ext`.
- Uploads go through `POST /api/compliance/documents` (`documentRegisterSchema`,
  `complianceContract.ts:307`). The client generates the id, gets a signed upload URL back, and PUTs the
  bytes directly. That route is gated `requireSection("roster")` (`routes/compliance.ts:60-61`).

**`certifications` (0127).**
- It is temporal: one current row per (org, subject_type, subject_id, kind, qualifier), and `superseded_by`
  forms the chain.
- `document_id` points at the paper the row stands on.
- The subject check is organization / driver / tractor / trailer.
- The 15 kinds are listed in `CERTIFICATION_KINDS` (`complianceContract.ts:22-30`). The equipment ones are
  registration, annual_inspection, insurance, ifta and irp.
- **title, lease and permit are kinds of neither table.**

**Derivatives.** `document_derive` makes a 320 px thumb and a 2000 px normalized WebP, for images only.
PDFs are excluded by `DERIVABLE_CONTENT_TYPES` (`documentDerivatives.ts:74-90`). The reason given there,
"a rasteriser in the API container for a thumbnail", **has been obsolete since 2026-10-09**:
`document-reading/pages/pdf.ts` rasterises PDFs in the API with pdf.js and `@napi-rs/canvas` (D-DR3).

### 1.2 The driver engine

**Catalogue: `dqCatalogue.ts` (411 lines).**
- `DqItemSpec` fields: `key`, `label`, `citation`, `source` (certification | record), `evidenceKinds`,
  `qualifiers`, `trainingType`, `recurrence` (expiry / annual / triennial / one_time), `group`, `scope`
  (always / hazmat), `retention`, `advisory`, `appliesWhen`.
- 20 items. `DQ_KIND_LABELS` already labels the equipment kinds.

**Evaluator: `dqFile.ts` (466 lines, within 34 of the budget).**
- `buildDqFile` → `DqFileSummary`, plus `dqAttention`, `dqRosterCells`, `dqDocumentCount` and `dqGroups`.
- State logic, `stateFor` at `:393`:
  - no evidence → `missing`;
  - end date before today → `expired`;
  - end date on or before today + 30 → `expiring`;
  - otherwise → `current`.
  - The end date comes from `goodUntilFor` at `:376`.
- A `documentId` counts only if that id is in the documents input (`:446`).
- Driver-specific parts: `hasCdl`, return-to-duty, hazmat qualifiers, `qualification_records`, and the
  `driver_*` field names.

**Rollup: `getComplianceOverview` (`evidence/complianceOverview.ts`, 248 lines).**
- Four org-filtered paged reads plus one RPC.
- Serves `GET /api/compliance/overview`.
- `expectOrgScoped` is asserted at `complianceOverview.test.ts:53,184`.

**Alerts: `dqAlertScheduler.ts`.**
- Runs every 6 h from `schedulers.ts` behind `DQ_ALERTS_ENABLED`.
- Categories `dq_expiring` and `dq_expired`; the category check was last rewritten by 0483.
- Thresholds 90/60/30/14/0. Dedupe key `dq:{driverId}:{item}:{goodUntil}:{threshold}` in the 0432 ledger.
- Recipients: `usersWhoManage("roster")`.
- `planDqAlerts` is typed on `DriverOverviewRow`.

**Components: `features/compliance/`.**
- `RequirementTable` (162 lines) is nearly generic.
- `RequirementDrawer` (352), `DocumentDropCard` (93) and `CertificationHistory` (118) all hard-code
  `subjectType: "driver"`.
- `lint:boundaries` forbids importing a feature from another feature. Its rule is *promote, don't
  allow-list* (`check-feature-boundaries.mjs:75-79`).

**Viewer: `components/DocumentPreview.vue` (234 lines).**
- One document at a time.
- Already promoted to a shared component "for tractor/trailer reuse" (R5a).
- `components/DocumentsModal.vue` (108 lines) lists the documents.

### 1.3 The three list pages

**Drivers (`DriversPage.vue` 474 lines, `DriverRosterTable.vue` 281).**
- Uses `useTableColumns` and `ColumnPicker`.
- **Already has two file columns.**
  - `qualification`: a state badge from the rollup.
  - `documents`, labelled **"File"** (`driverRosterColumns.ts:60`): an `onFile/of` button that opens
    `DocumentsModal`.

**Vehicles (`VehiclesPage.vue` 338) and Trailers (`TrailersPage.vue` 343).**
- Inline `columns` arrays. No column picker.
- Read straight from PostgREST (`useVehiclesQuery`, `useTrailersQuery`). There is no API list route.
- Vehicles filters `?check=` with `matchesVehicleCheck` (`fleetChecks.ts`) over McLeod's
  `registration_expires_at` / `dot_annual_inspection_expires_at`. That is the same predicate the fleet
  manager's *Truck paperwork* card counts with.

**Detail pages.**
- `VehicleDetailPage.vue` (254 lines) is a stack of cards with no sections.
- **There is no trailer detail page.**
- `DriverDetailPage` uses `?section=` as a scroll anchor: `driverSections.ts` plus AppTabs as a jump nav at
  `:114-130`, `:363-368`.

**Table kit.**
- `DataTable` (`@silvicom/ui`) renders `#cell-<key>="{ row, value }"`.
- Below `md` it becomes `DataTableCards`, which forwards every slot. A cell built once works on phones too.

### 1.4 Permissions

- The matrix is `SECTION_ACCESS` in `packages/shared/src/auth.ts`.
- **Vehicles and trailers belong to `equipment`**: manage = admin, fleet_manager; view = dispatcher,
  safety_manager, auditor, technician.
- **Drivers and the DQ file belong to `roster`.**
- **This is the gap: truck papers are gated on `roster` today**, because the documents API is. The effects:
  - a technician (equipment view) cannot see them;
  - a recruiter (equipment none) can;
  - a safety manager (equipment view only) can upload them.

### 1.5 Bulk intake, AI, binder, QR

**Bulk intake (`document-reading`).**
- Upload is generic: `document_sources`, sha256 dedupe, signed PUT into `document-intake`.
- Pages are generic and assemblies hold up to 20 pages.
- The read loop is profile-driven: Zod schema → structured output, with a cache key on sha256 plus
  versions, and a monthly token budget.
- The router is gated **hazmatguard + hazmat** (`routes/documents.ts:66-68`).
- These parts are hand-written per profile: `PAGE_CLASSES` (BOL words only), the classifier prompt
  (`classifyPage.ts:33-45`, not data-driven), `READ_PROMPTS`, `EVIDENCE_FOR`, `gatesFor`, and
  `REVIEW_CONSUMERS`.
- Every read runs **two** readers in parallel (`executeRead.ts:297`).
- The profile check is in 0478.
- **No column ties a source to a subject, and there is no batch table.**

**Binder (`evidence/dqBinder/`: gather 314, render 420, merge 151, index 256 lines).**
- Request `{driverIds 1..25, asAt}` → a `dq_exports` row (0152, `driver_ids uuid[]`) → `dq_binder` job →
  bucket `compliance-exports`, purged after 7 days.
- `merge.ts` (pdf-lib append, footers) and the separator/unreadable pages are generic.
- Gather and the driver front/back pages are driver-only.

**QR (`@silvicom/qr`).**
- Encoder and label sheets, presets avery-22805/22816/5160/5520 and roll-single.
- **`TAG_KINDS = ["AST", "BIN"]`** (`tagContract.ts:54`). `SIL1:VEH:…` today parses as nothing and ends
  as `malformed`. The `VEH` in `inventoryContract.test.ts` is an invented example, not a real kind.
- Resolvers: `(ctx) → ScanResult | null` in `apps/api/src/tags/`.
- `GET /api/tags/resolve` is gated `maintenance:view`. Its own comment (`tags/routes.ts:29-36`) says the
  gate must become per-resolver when a non-maintenance kind arrives.
- **`vehicles` and `trailers` have no `tag_code`.** `inventory_assets.tag_code` (0333, immutable once set,
  issued by `issueTagCode`) is the pattern to follow.

**Unit fields.**
- **`ownership_type` (0099/0100) is never written.** It is not in the `Vehicle`/`Trailer` types or the
  selects. Only a McLeod probe (`tools/mcleod-agent/inspect.mjs:102-133`) mentions it.

**Driver app.**
- `RigCard` shows the truck and trailer units from `useDuty` (`/api/me/shift`, `/api/me/equipment`).
- No documents, and no offline document cache. `expo-file-system` is already a native dependency
  (`data/fileStaging.ts`).

---

## 2. What the market does (research 2026-10-19)

- **Two views over one store.** Motive, Whip Around, Fleetio and J.J. Keller all pair a per-unit tab with a
  fleet-wide list. In this plan the fleet-wide list is the existing list pages, filtered.
- **Required papers as rules per class.** Samsara's qualification *sets* use Current / Expiring / Expired /
  Missing, which is our catalogue's shape.
- **AI bulk upload behind a Needs Review gate.**
  - Motive matches on VIN, plate or unit number and reads the expiry.
  - Samsara holds every AI-made record until a person approves it.
  - Nobody files silently.
- **One paper, many units:** fleet insurance, IFTA, a cab card listing a fleet.
- **Completeness is shown as a list, not a score:** "Unit 207 · annual · 9 days".
- **monday.com Files column.**
  - The cell shows small thumbnails or type icons, a "+" to add, and accepts drag-drop of many files.
  - Hover shows a card with a download link.
  - Click opens a full-screen preview with a Versions sidebar.
  - PDFs get no thumbnail, which is monday's best-known complaint. The gallery arrows and the "+N" chip are
    additions made by its clones.
- **QR.**
  - Whip Around and Fleetio: an opaque id scanned *inside their app*.
  - truckqr.com: a sticker opening a passcode folder that the driver shows the officer.
  - No vendor gives officers a rotating-token page.
- **Regulation.**
  - IRP: every jurisdiction must accept an electronic cab card since 2019-01-01. PDF, readable offline.
  - §396.17(c): proof of annual inspection must be **on the unit**, for each unit of a combination.
  - Retention: §396.21 reports 14 months; §396.3 maintenance records 1 year + 6 months after the unit
    leaves; §396.9 roadside reports 12 months.
  - Electronic records are allowed if legible, reproducible and protected (2018 rule).
  - DQ files must be produced within 48 h of an audit notice.

---

## 3. Decisions

**D-UF1: three files, one engine.**
- Driver, Truck and Trailer file are three **catalogues**, read by one pure evaluator.
- `dqFile.ts`'s subject-free core (`stateFor`, `goodUntilFor`, the item fold, attention, counts) moves to
  `packages/shared/src/fileEngine.ts`.
- `dqFile.ts` keeps only the driver wrapper: `hasCdl`, return-to-duty, hazmat scope, records.
- `unitFile.ts` is the equipment wrapper.
- This is a lift, not a copy. A second evaluator would be a workaround with a delay fuse. It also takes
  `dqFile.ts` off the edge of its line budget.
- The UI and the vocabulary are separate; the code is shared.

**D-UF2: relations are read, never stored twice.**
- A truck file shows its seated driver (`vehicles.assigned_driver_id`) and that driver's file state.
- It shows its trailer as the current load's trailer (D-TL1: planning questions read McLeod), with that
  trailer's file state.
- A trailer shows the truck on its current load.
- A driver shows their truck.
- Nothing copies a paper from one subject to another.

**D-UF3: a typed date and a paper are two facts, shown as two.**
- An item reads its certification.
- When there is none, but McLeod's row carries the date (`registration_expires_at`,
  `dot_annual_inspection_expires_at`), the item shows the date with the state **"Date only, no paper"**.
  It counts as *missing* in the file total and as its date's state in the date filter.
- No certification is ever seeded from McLeod (Q-UF2).
- In the same step that adds the column, the *Truck paperwork* card and `?check=` move onto the rollup.
  Otherwise the column and the card would disagree about the same truck.

**D-UF4: no new list page, no document library.**
- The fleet view is each existing table filtered with `?file=missing|expiring|expired|date_only`, as
  Drivers already does with *File status*.

**D-UF5: a paper's section follows the file it belongs to.**
- `DOCUMENT_SUBJECT_SECTION` in `complianceContract.ts`: driver → `roster`; tractor and trailer →
  `equipment`.
- A fleet-wide paper (subject `organization`) takes the section its kind belongs to. Insurance, IFTA and
  IRP → `equipment`; the existing org kinds keep `roster`, as today.
- `/api/compliance/documents` and `/certifications` stop using one router-wide gate. Each request is
  checked against the section of its subject, with `requireSection` resolved per request.
- This fixes the §1.4 gap by **reading the matrix** (Q-UF6). Owners who want safety managers to upload
  truck papers raise `equipment` for that role in *Settings → Permissions* (the editable matrix). No role
  is hand-listed anywhere.

**D-UF6: one paper, many units, without a link table (Q-UF1).**
- `certifications.document_id` already lets **many certification rows cite one document**.
- A fleet insurance policy is stored once, under subject `organization`, plus:
  - one `organization` certification when the catalogue item says `fleetWide: true` (insurance, IFTA);
  - **or** one certification per named unit when the paper lists units (a cab card for 30 trucks). Each row
    cites the same `document_id`.
- The evaluator's "document must be in the input" rule (`dqFile.ts:446`) widens to *documents of the
  subject ∪ documents its certifications cite*. The rollup fetches the cited ids. No new table, nothing
  duplicated.

**D-UF7: the Files cell is the one place a file is summarised (Q-UF7).**
- On Drivers it **replaces** both `qualification` and `documents`.
- On Vehicles and Trailers it is new.
- One component, `components/files/FileCell.vue`, reads one rollup row shape.

**D-UF8: the AI proposes, a person files (Q-UF4).**
- Nothing from bulk intake reaches `documents` or `certifications` without a decision by a named user.
- This holds for the first month regardless of confidence.
- After that, the "how often did review change nothing" measurement (§5 UF7, the `changed` column) decides
  whether any auto-filing is offered. That needs a new owner ruling, not this one.

**D-UF9: no public page (Q-UF5).**
- The roadside answer is the driver app's **Truck papers**: the seated truck's and trailer's roadside set,
  saved on the phone for use without signal.
- The cab QR is the opaque `SIL1:VEH`/`SIL1:TRL` tag. A phone camera reads it as plain text and nothing is
  exposed.
- A rotating-token officer page stays a later step, to be considered only if officers ask for it.
- A static public URL on a sticker is refused.

**D-UF10: PDF thumbnails exist.**
- D-DQ9's premise (no rasteriser in the API) no longer holds.
- `document_derive` makes a page-1 **thumb only** for PDFs, through a rasterise function exported from
  `document-reading`'s module index. That is a public API, not internals.
- PDFs still preview in the browser's own viewer, so the normalized variant is not made for them.

**D-UF11: ownership decides title and lease, and unknown is not missing (Q-UF8).**
- Title applies to `owned`.
- Lease applies to `leased` and `owner_operator`.
- While `ownership_type` is null, both items show **"Set ownership to check"**, are not counted, and offer
  the setting inline.
- The office sets ownership on the vehicle and trailer forms. McLeod as the source is a later
  collector change, to be asked of Alex. The D-ROS rule applies: McLeod wins only where it actually
  holds the fact.

---

## 4. The catalogue (`packages/shared/src/equipmentFileCatalogue.ts`)

| key | label | tractor | trailer | applies | evidence (cert kind / doc kind) | recurrence | fleetWide | roadside | citation |
|---|---|---|---|---|---|---|---|---|---|
| `registration` | Registration / IRP cab card | ✓ | ✓ | always | `registration` or `irp` | expiry | — | ✓ | state law; IRP Art. IV |
| `annual_inspection` | Annual inspection | ✓ | ✓ | always | `annual_inspection` (written by finalize) | annual | — | ✓ | §396.17, §396.21 |
| `insurance` | Insurance | ✓ | ✓ | always | `insurance` | expiry | ✓ | ✓ | §387.7 |
| `ifta` | IFTA licence | ✓ | — | always | `ifta` | expiry | ✓ | ✓ | IFTA R1310 |
| `title` | Title | ✓ | ✓ | owned | doc `title` | one_time | — | — | — |
| `lease` | Lease agreement | ✓ | ✓ | leased, owner_operator | `lease` | expiry | — | ✓ | §376.11–12 |
| `permit` | Permits | ✓ | ✓ | when issued (advisory) | `permit` + qualifier (state / oversize / hazmat) | expiry | — | ✓ | — |

Groups are **Registration & permits**, **Ownership**, **Insurance** and **Inspections**.

Maintenance (§396.3) and roadside inspections are **linked lists on the unit's page, not file items**:
- maintenance stays FleetPal's (D-INV10);
- roadside reports have their own subject (0476).

New kinds, one migration (UF1):
- `certifications.kind`: `lease`, `permit`.
- `documents.kind`: `title`, `lease`, `permit`.
- The same kinds go into `CERTIFICATION_KINDS` / `DOCUMENT_KINDS`.

---

## 5. Steps

Each step is one PR into `main`. A reader never lands in the same merge as the column it reads
(`lint:migration-ordering`; see `hold-a-function-reader-behind-its-migration`). Migration numbers are
taken at merge time: the next free one on 2026-10-19 is **0489**. Re-check the number before merging,
because a parallel chat may take it.

### UF0: lift the engine and the components (no behaviour change)

- **Shared.**
  - New `fileEngine.ts`: generic `FileItemSpec<Ctx>`, `buildFile`, `fileAttention`, `fileCounts`.
  - `dqFile.ts` re-expressed on top of it. Its exports and types are unchanged, so every caller and every
    test in `dqFile.test.ts` stays as is.
  - New `fileEngine.test.ts` covering the state boundaries (today, today + 30, no end date) without a driver
    in sight.
- **Web.** Move `RequirementTable`, `RequirementDrawer`, `DocumentDropCard` and `CertificationHistory` from
  `features/compliance/` to `components/files/`.
  - They take `subject: { type, id }` and the item specs as props in place of `driverId` / `DQ_ITEMS`.
  - `useCertificationHistoryQuery(subjectType, subjectId)` drops the hard-coded `subjectType=driver` at
    `useCompliance.ts:61`.
  - Only the import paths in `DriverDetailPage`, `CompliancePage` and `dashboardWidgets` change.
- **Gate.** All existing web tests pass with their imports updated, and nothing else.
- Styling is untouched: the DQ redesign owns how these look.

### UF1: migration, kinds (evidence tables)

- One migration, `NNNN_unit_file_document_kinds.sql`, on the evidence module's tables only
  (`lint:table-writers`):
  - rewrite `certifications_kind_check` and `documents_kind_check` with the new kinds, following 0484's
    drop-and-re-add pattern;
  - nothing else.
- Contracts updated in the same PR. A kind list is not a column, so the deploy-window rule does not bite;
  old code never writes the new kinds.
- **PGlite matrix:** a lease certification and a title document insert; an unknown kind is refused.

### UF2: equipment rollup and per-subject permissions (API)

**Shared.**
- `equipmentFileCatalogue.ts` (§4).
- `unitFile.ts`, with `buildUnitFile({ subjectType, ownership, today, certs, documents, dateOnly })`.
- `unitFileContract.ts`:
  - `UnitFileRow { subject_type, subject_id, unit_number, status, ownership, state, counts, attention,
    items: UnitFileCell[], papers: PaperThumb[] }`;
  - `PaperThumb { documentId, kind, contentType, thumbUrl | null }`, the newest three current papers.

**API, module `evidence`.**
- `unitFiles/overview.ts` serves `GET /api/compliance/unit-files?subjectType=tractor|trailer`, gated
  `requireSection("equipment","view")`.
- Reads, each `.eq("org_id")` and **paged** past PostgREST's 1,000-row cap:
  - active units;
  - current certifications for the subject type, plus `organization` certifications of fleetWide kinds;
  - originals for the subject type;
  - the cited `document_id`s, **chunked** (`.in()` URL overflow).
- Thumbnails are signed in one `createSignedUrls` call, through `signDocumentRows`.

**`getComplianceOverview`.**
- Gains an opt-in `withPapers`, so Drivers gets the same `papers` field.
- The alert scheduler does not pass it, so it signs nothing.

**D-UF5.**
- A `subjectSection(subjectType, kind)` helper replaces the router-wide `canView`/`canManage` on
  `/documents`, `/documents/:id/download` and `/certifications`. The download looks up the document's
  subject first.

**Tests.**
- `expectOrgScoped` on every read.
- A technician GETs a tractor paper (200) and is refused a driver's (403).
- A recruiter is refused a tractor paper.
- A fleet manager may POST a trailer certification.
- A cab card cited by two tractors satisfies both.
- Mutation check (`prove-tests-fail-by-mutating`): swap one subject's section and watch a test fail.

### UF3: PDF thumbnails

- `document-reading/index.ts` exports `rasteriseFirstPage(bytes, longEdgePx)`, built on `pages/pdf.ts`.
- `documentDerivatives.ts` gains a PDF rule (thumb only), and its header now cites D-UF10.
- **Backfill:** a one-off `pnpm doc:thumbs` script queues `document_derive` for every PDF original without
  a thumb. Production count first; the result is reported in the PR.
- **Test:** a two-page PDF yields one 320 px WebP whose sha differs from the source. An encrypted PDF fails
  loudly, as intake's `PasswordException` path does.

### UF4: the Files column (web)

**`components/files/FileCell.vue`.** Props `{ state, counts, papers, subjectLabel }`; emits
`open(documentId?)` and `drop(files)`.

```
┌─ File ───────────────────────────────────┐
│ [2 expiring]  ▣ ▣ ▣  +4                   │
└──────────────────────────────────────────┘
```

- **The state chip comes first** (worst state wins): *Complete · 2 expiring · 1 expired · 3 missing ·
  Date only*. On click it applies the matching `?file=` filter.
- **Thumbnails.** Up to 3; a PDF thumb comes from UF3; the HEIC/unknown fallback is a type icon; then `+N`.
  - Hover or focus shows a card: kind label, expiry, uploaded by and when, *Download*.
  - Click opens the gallery.
- **Drop target.** Files dropped on the cell open bulk intake (UF7) **scoped to that subject**. Until UF7
  ships, the drop opens the unit's File section.
- Keyboard: one tab stop per thumb; Enter opens.

**`components/files/FileGallery.vue`.**
- Wraps `DocumentPreview` and does not fork it.
- ← / → between that subject's papers.
- A side list of every item with its chip.
- *Replace with newer* opens `RequirementDrawer` on that item. This writes a new row, never an edit; the
  old paper shows in `CertificationHistory`, which is monday's *Versions*, append-only.

**Pages.**
- **Vehicles / Trailers:**
  - a `file` column after the unit number;
  - `useUnitFilesQuery(subjectType)`, joined by id;
  - a `?file=` FilterSelect;
  - the Trailers unit number becomes a link (UF5).
- **Drivers (D-UF7):**
  - `qualification` and `documents` are replaced by `file` in `DRIVER_ROSTER_COLUMNS`;
  - `DriverRosterTable` loses two cells and gains one, so the line count goes down;
  - a stored `?hide=` naming a removed key is ignored by `useTableColumns` (verify; if not, map old keys
    to `file`).

**D-UF3 in the same PR.**
- `matchesVehicleCheck`'s registration and inspection checks are re-expressed over the rollup's items.
- `TruckPapersWidget` counts from the same place.
- The card's *no date recorded* line becomes *no paper and no date*, plus *date only*.

**Tests.**
- FileCell renders each state, and overflow at 4+.
- The chip click sets `?file=`.
- The Drivers table has exactly one file column.
- The Truck paperwork count equals the Vehicles `?file=` count on one fixture. One function, two readers:
  quote the title in the comment (`lint:comment-claims`).

### UF5: the unit pages (web)

**Vehicle detail.**
- `pages/vehicleSections.ts` (Overview · File · Maintenance · Fuel), on `driverSections.ts`'s model:
  scroll anchors and AppTabs as the jump nav.
- The existing cards move under Overview unchanged.
- Fuel stays behind `canView("fuel")`.

**Trailer detail, new.**
- Route `/trailers/:id`, named `trailer-detail`.
- Surface `fleet.trailers.detail` with `parent: "fleet.trailers"` in `surfaceCatalogue.ts`.
- The route snapshot is updated (`lint:surfaces`).
- Sections: Overview (summary, `UnitKitCard kind="trailer"`) · File · Maintenance.

**`components/files/UnitFileSection.vue`, used by both pages.**
- The relation strip (D-UF2): *Driver: J. Smith, file current*; *Trailer 5302, annual expired*. Each one
  links to the other file.
- The grouped `RequirementTable` (§4 groups).
- Two actions: **Print QR label** (UF9) and **Build binder** (UF8). They are hidden until those steps ship,
  not disabled.

**Maintenance section.** A read-only list of the unit's FleetPal work orders and roadside inspections, from
existing reads, each linking out.

**Ownership.** `VehicleForm` and `TrailerForm` gain an `ownership_type` select. The column is added to
`VEHICLE_COLS`/`COLS` and the `Vehicle`/`Trailer` types. It already exists (0099/0100), so this is a reader
of an old column, with no migration.

**Writes.** Equipment manage only, through D-UF5. View-only roles see the section with no drop zones.

### UF6: equipment alerts (API, migration, then reader)

- **UF6a migration:** add `unit_file_expiring` and `unit_file_expired` to the notification category check,
  following 0483's rewrite. Update `notificationsContract.ts` in the same PR, since nothing writes them yet.
- **UF6b:**
  - `planDqAlerts` → `planFileAlerts(rows: FileAlertRow[])`. `FileAlertRow` is the subject-generic slice
    of `DriverOverviewRow`/`UnitFileRow`.
  - Driver keys stay byte-for-byte (`dq:{driverId}:…`), so nothing re-sends.
  - Unit keys: `unit:{subjectType}:{id}:{item}:{goodUntil}:{threshold}`.
  - Recipients: `usersWhoManage("equipment")`.
  - It runs inside the **existing** DQ alert timer, not a new scheduler (`docs/WORKER-DEPLOYMENT.md`), and
    reuses `DQ_ALERTS_ENABLED`.
  - The email says *Truck file* / *Trailer file*.
  - Bell entity `tractor`/`trailer` opens the unit's File section.
- **Tests:**
  - a driver key fixture is unchanged (golden string);
  - a unit at 30 days alerts once and not again on the next run;
  - an inactive unit does not alert.

### UF7: bulk upload (API, migrations, web)

**UF7a migration (new table, exempt from ordering).**
- `file_intake_items`, RLS enabled, no client policies. Columns:
  - `id`, `org_id`, `batch_id` (client uuid), `source_id → document_sources`, `page_from`, `page_to`;
  - `scope_subject_type` / `scope_subject_id` (set when dropped on a cell);
  - `proposed_subject_type`, `proposed_subject_id`, `proposed_kind`, `proposed_qualifier`;
  - `proposed_issued_on`, `proposed_expires_on`, `read_identifiers jsonb`, `match_basis`, `confidence`;
  - `status` (pending | filed | discarded | duplicate), `decided_by`, `decided_at`, `changed boolean`
    (did the person alter any proposed field: D-UF8's measurement);
  - `filed_document_id`, `filed_certification_ids uuid[]`, `created_at`.
- It is a work queue, not evidence. The filed rows are the evidence.
- The same migration adds `compliance_paper` to the `document_reads.profile` check (0478).

**UF7b: the reader.**
- `DOCUMENT_PROFILES.compliance_paper`, with schema
  `{ papers: [{ pages:[from,to], kind, qualifier?, unitNumbers[], vins[], plates[], driverName?, cdlNumber?, issuedOn?, expiresOn?, insuredUnits[]? }] }`.
- One read over the whole source segments a combined PDF into papers. A source over 20 pages is refused
  with *"split into files of 20 pages or fewer"*.
- **One reader, not two.** A `readers: 1` profile field is honoured by `executeRead`. The person in the
  review table is the second reader (D-UF8). Model `DOC_FILE_READ_MODEL`, default `claude-sonnet-5-5`.
- `readsPageClasses: "all"`: the BOL classifier is not consulted.
- Budget, cache key and replay inputs are inherited.

**Matcher, pure: `packages/shared/src/fileSubjectMatch.ts`.** For each paper, in order:
1. VIN (17 characters, normalised) → unit;
2. plate + state → unit;
3. unit number exact (leading zeros and `mcleod_fleet_code` folded) → unit;
4. filename token (`654-registration.pdf`) as a tie-breaker only;
5. drivers: CDL number → driver, then exact unique full name.
- More than one candidate → **no proposal**. A paper listing several units → one proposal with
  `insuredUnits`.
- A scoped drop fixes the subject. Identifiers that contradict the scope raise a warning on the row.

**API, module `evidence`, `routes/fileIntake.ts`.**
- `POST /api/compliance/intake/sources` and `…/complete` call into document-reading's **exported** intake
  and read functions. This deliberately does not go through the hazmat-gated `/api/documents` router:
  compliance intake is not a hazmat feature.
- `GET /api/compliance/intake/:batchId` returns the rows.
- `POST /api/compliance/intake/:itemId/file` and `/discard`.
- **Filing:**
  - copy the bytes server-side from `document-intake` into `compliance-docs` as a `documents` original,
    then queue derivatives;
  - write a certification for expiring kinds through `insertCertification`, so the supersede chain is
    kept, with one row per unit for a multi-unit paper (D-UF6);
  - the same sha256 already filed for that subject → `duplicate`, nothing written.
- **Gates.** Each file is checked against **its** subject's section (D-UF5). The batch endpoints need
  manage on roster **or** equipment.
- **Record-sourced driver items** (MVR review, road test, annual review: `qualification_records`) are
  never filed from intake. Their row offers *Open in driver file*, with the paper pre-attached.

**Web.**
- **Upload documents** button on all three lists' PageHeader (manage only).
- `pages/FileIntakePage.vue` at `/files/intake?batch=` with a `FileDropzone multiple`.
- `components/files/IntakeReviewTable.vue`, one row per paper:
  - columns: thumbnail · proposed driver / unit (inline picker) · item (select from the catalogue) ·
    expiry (date) · confidence · status;
  - actions: per-row *File*, *Discard*, and **File all reviewed**. The last files only the rows a person
    has opened or edited (D-UF8).
- Upload goes through the `bolReadPipeline.ts` pattern (hash → register → PUT → complete → poll), moved to
  `lib/` if it is shared and not copied.

**Tests.**
- Matcher fixtures: VIN beats unit number; two equal names → no proposal.
- `expectOrgScoped` on every intake query.
- A safety manager cannot file a tractor paper by default.
- Filing writes exactly one document and N certifications.
- A re-upload is `duplicate`.
- A replayed read (0487) reproduces its proposals.

### UF8: binders (API, migration, then reader)

- **UF8a migration (evidence):** `dq_exports` gains `vehicle_ids uuid[] not null default '{}'` and
  `trailer_ids uuid[] not null default '{}'`. The cardinality check becomes *1–25 subjects in total*.
  `kind` gains `roadside_packet`. Still append-only and in `RETENTION_FORBIDDEN`.
- **UF8b:**
  - `dqBinder/gatherUnits.ts`: the unit's file, current papers and annual inspection report, plus a
    12-month index of roadside and maintenance.
  - `renderUnitFront` covers the cover and contents in catalogue order.
  - `merge.ts` is unchanged.
  - `binderRequestSchema` gains `vehicleIds` / `trailerIds`. The **audit binder** takes any mix of drivers
    and units.
  - The **roadside packet** holds only the roadside items, in catalogue order. It is also what UF10 caches.
- **Web:** *Build binder* on the unit's File section, and a multi-select action on Vehicles and Trailers.
  The results appear under the existing Exports list.
- **Tests:**
  - page order matches catalogue order;
  - a missing item renders a gap page, never silence;
  - a 26-subject request is refused.

### UF9: QR tags (shared, API, migration, then reader)

- **UF9a migration (roster tables):** `vehicles.tag_code` and `trailers.tag_code`, `text null`, unique per
  org, made immutable once set by a trigger that copies 0333's.
- **UF9b:**
  - `TAG_KINDS += ["VEH", "TRL"]`.
  - `roster/unitTags.ts`: `issueUnitTagCode`, which issues on the first print.
  - Two resolvers registered in `tags/resolvers.ts`, returning a new `ScanResult` variant
    `{ type: "unit", subjectType, id, unitNumber, fileState }`.
  - **The resolve route becomes per-resolver-gated**, as its own comment requires: each registration
    declares its section (VEH/TRL → `equipment:view`).
  - `ScanResultCard` renders the unit variant, linking to `/vehicles/:id?section=file` or
    `/trailers/:id?section=file`.
- **Labels:** `POST /api/roster/unit-labels`, which reuses `@silvicom/qr`'s `labelSheet` and presets, gated
  equipment manage and audited.
  - It sits in roster, not maintenance's inventory route, because `lint:table-writers` keeps vehicle writes
    in roster.
  - Print from the File section, or in bulk from a list selection.
  - Placement guidance on the sheet: driver's door jamb, tamper-evident stock.
- **Binder covers** (UF8) carry the unit's tag.
- **Tests:**
  - parse/format round trip for VEH/TRL;
  - a technician resolves a VEH tag;
  - a recruiter gets `unknown_tag`, never the unit;
  - a tag code cannot be rewritten (PGlite).

### UF10: Truck papers in the driver app (API, driver)

- **API:** `GET /api/me/truck-papers`. It reads the driver's **current** truck and trailer the same way
  `/api/me/shift` does, and returns for each unit the roadside items (§4 *roadside*):
  `{ kind, label, state, expiresOn, sha256, contentType, url }`, with the url signed for 1 h.
  - A driver with no truck → empty.
  - Driver-scoped, never org-wide.
- **Driver app:**
  - a `TruckPapersCard` under `RigCard`, plus a full-screen list;
  - each paper is saved under `Paths.document/truck-papers/<sha256>.<ext>`, re-downloaded only when the
    sha changes;
  - *Saved for offline use, {time}*;
  - opens with the system viewer.
- **Release.** `expo-file-system` is already native, so this is **JS-only → OTA lane**. The release lanes
  still need the owner's approval (`driver-release-lanes-need-approval`).
- **Tests:**
  - the route returns only the requesting driver's units;
  - an expired paper still shows, marked expired, because hiding it would leave the driver with nothing at
    a stop;
  - the cache keeps a sha it has and fetches a new one.

### Order and what each delivers

| Step | Ships | Office sees |
|---|---|---|
| UF0 | lift | nothing |
| UF1 | kinds | nothing |
| UF2 | rollup + per-subject gates | technicians can open truck papers |
| UF3 | PDF thumbs | thumbnails for PDFs everywhere, including the DQ file |
| **UF4** | Files column | **the column on all three lists** |
| **UF5** | unit pages | **Truck / Trailer file sections, trailer page** |
| UF6 | alerts | expiring truck papers in the bell and email |
| **UF7** | bulk upload | **drop a folder, review, file** |
| UF8 | binders | truck binder, audit binder, roadside packet |
| UF9 | QR | door-jamb labels; scanning opens the file |
| UF10 | driver app | Truck papers on the phone, offline |

UF0 → UF1 → UF2 are strictly in order. After that:
- UF3 runs in parallel;
- UF4 → UF5;
- UF6, UF7 and UF8 each need only UF2;
- UF9 needs UF5;
- UF10 needs UF8's roadside set (its item list, not its PDF).

---

## 6. What this plan does not do

- Redesign the DQ file page. UF0 moves the components without restyling them, so the redesign inherits one
  set.
- Store maintenance records (FleetPal's, D-INV10) or copy roadside reports (their own subject, 0476).
- Seed certifications from McLeod dates (D-UF3), or read ownership from McLeod. Both wait on the collector.
- Publish anything outside a login (D-UF9).

---

## 7. Questions: all answered 2026-10-19 (owner: "proceed with recommended solutions")

- **Q-UF1: one paper, many units.** Answered:
  - fleet-wide papers are filed on the organization;
  - a paper naming units → one certification per unit, all citing one document;
  - never duplicated.
  Built without a link table (D-UF6).
- **Q-UF2: McLeod's dates.** Shown as *Date only, no paper*, never seeded (D-UF3).
- **Q-UF3: the catalogue.** §4 as drafted. Permits are advisory; reefer units need nothing extra in v1.
- **Q-UF4: filename-only matches.** Everything goes through review for the first month; the measurement
  decides after (D-UF8).
- **Q-UF5: roadside QR.** The driver app's Truck papers. No public page now; a rotating token later if asked;
  a static URL never (D-UF9).
- **Q-UF6: who sees and uploads.** Read from the section matrix by the paper's subject (D-UF5).
- **Q-UF7: the Drivers table.** One Files cell replaces Qualification + File (D-UF7).
- **Q-UF8: unknown ownership** (found while planning, answered under the same ruling). Title and lease show
  *Set ownership to check* and are not counted; the office sets it on the form (D-UF11).

New questions found while building go here, with candidates and a recommendation, before anything routes
around them.

- **Q-UF9: two file filters on the Drivers toolbar** (found building UF4b, 2026-10-20). **Answered (b), owner 2026-10-20** — built; see the progress log. The roster
  now carries the chip's `?file=` (`FILE_CHIPS`, the Vehicles and Trailers vocabulary: worst state first)
  beside the older `?dq=` *File status* (`DQ_STATE_FILTERS`: "has ANY item in this state", plus
  *Needs attention*). They overlap on four words and disagree on one — `dq=expiring` admits a driver whose
  chip says *expired*, `file=expiring` does not — so the chip could not be mapped onto `?dq=` without the
  chip and the list disagreeing, which D-UF7 refuses. Both stay for now: `DriverFilesWidget` links here
  with `?dq=`, the built-in views are written in it, and the compliance fleet table shares it. *Due*
  moved behind the Filters button to keep the toolbar at four controls.
  Candidates: (a) keep both, as built; (b) retire `?dq=` into `?file=` plus a *Needs attention* chip word,
  rewriting the widget's links, the built-in views and the compliance fleet table in one PR; (c) retire
  `?file=` on Drivers only, and let the chip set `?dq=` where the words agree and *Needs attention* where
  they do not, accepting the one disagreement. Recommendation: (b), after UF5, when the compliance fleet
  table is next touched — one vocabulary for "what state is this file in" across the four lists.

---

## 8. Progress log

- 2026-10-19: research plan merged (#1625). Owner accepted every recommendation. This execution plan
  written from three code audits on `6a64713`.
- 2026-10-19 — **UF0 built** (`claude/uf0-lift-file-engine`). `packages/shared/src/fileEngine.ts` holds the
  subject-free judgement (dating, states, attention order, groups); `dqFile.ts` is the driver wrapper on
  it (466 → 326 lines) with every export and type unchanged — `dqFile.test.ts` untouched and green, and
  `fileEngine.test.ts` proves the engine with no driver in it (four mutants — horizon edge, attention
  rank, the cited-document check, annual arithmetic — each killed). `RequirementTable`,
  `RequirementDrawer`, `DocumentDropCard`, `CertificationHistory` moved to `apps/web/src/components/files/`
  taking a `FileSubject` (and the drawer its catalogue as `specs`); who may record is the caller's
  `canManage`. `useCertificationHistoryQuery` takes the subject type. No screen changes.
- 2026-10-19 — **UF1 built** (`claude/uf1-unit-file-kinds`). Migration **0490** (0489 was taken by a
  parallel chat): `certifications.kind` + lease, permit; `documents.kind` + lease, permit, title. Title is
  paper-only (`EQUIPMENT_PAPER_ONLY_KINDS`), so a title certification is refused. Matrix
  `unit-file-kinds.test.mjs` (13): both CHECKs equal the shared lists, every kind valid before stays
  valid (read from 0127 and 0484), both lists still closed.
- 2026-10-19 — **UF3 built** (`claude/uf3-pdf-thumbs`). pdf.js configuration and page painting promoted
  from `document-reading/pages/pdf.ts` to `apps/api/src/lib/pdfRaster.ts` (module isolation: evidence may
  not reach into document-reading; promote, don't allow-list). `derivativesFor("application/pdf")` = thumb
  only; `DERIVATIVE_VERSION` 1.1.0 (minor: a variant added for a type, old ones valid). The DQ table shows a
  PDF's thumb once derived, "View" before. B8's never-written backfill is now
  `pnpm --filter @silvicom/api doc:derive-backfill -- --org <uuid> [--apply]` (dry run by default).
  Production 2026-10-19: **96 PDF originals, 0 with a thumb** — the `--apply` run waits on the owner's go.
- 2026-10-19 — **UF2 built** (`claude/uf2-unit-file-rollup`). Shared: `equipmentFileCatalogue.ts` (§4's
  seven items; annual inspection reads the certification's own `expires_at`, since finalize writes a
  fail as expiring that day), `unitFile.ts` (`buildUnitFile`: own paper → fleet paper on the org →
  scan for paper-only items; McLeod's date as `dateOnly` beside a missing item; title/lease held in
  `ownershipUnknown`), `unitFileContract.ts`, `fileSections.ts` (`fileSectionFor`). API:
  `GET /api/compliance/unit-files?subjectType=` (equipment view) in `evidence/unitFiles.ts`, reading
  units through roster's new `listUnitFileFacts` (new declared edge `evidence -> roster`). D-UF5 live on
  `/certifications` and `/documents` (GET, POST, download): a coarse `anyFileSection` door, then
  `mayFile` per paper; the organization's lists are narrowed per row. `withPapers` on the driver
  overview moves to UF4, with its reader. The route judges on the carrier's calendar day (`todayInZone` over the org zone), not
  Railway's UTC date, and on equipment's own 30-day window (`INSPECTION_EXPIRY_WARNING_DAYS`).
- 2026-10-19 — **UF4 split in two.** UF4a (`claude/uf4-files-column`) is the equipment half. UF4b is the
  Drivers half: `qualification` + `documents` → `file`, and `withPapers` on the driver overview. Each
  half is one reviewable PR.
- 2026-10-19 — **UF4a built.**
  - Shared:
    - `fileChip.ts` (`fileChip`, `unitFileChip`, `matchesFileChip`). Worst state wins: expired →
      missing → date only → expiring → complete. "Date only" is a missing item with McLeod's date
      beside it. The chip and `?file=` ask the same function.
    - `fleetChecks.ts`: the paper checks now read the truck's file through `paperStanding` (the paper's
      own state, else `dateOnly`, else none). New `inspection_date_only` and `registration_date_only`
      checks. `*_missing` now means no paper and no date.
    - A fleet with no papers filed counts exactly what it did before, so the Truck paperwork card does
      not jump.
  - Web:
    - `components/files/FileCell.vue` and `FileGallery.vue`. The gallery wraps `DocumentPreview`
      through a new optional `nav` slot (‹ 2 of 5 ›, ← / →).
    - `useUnitFilesQuery`.
    - A File column and `?file=` filter on Vehicles and Trailers.
    - The Annual inspection and Registration columns show the same standing as the checks, marked
      "date only" where it is McLeod's. Sort follows it.
    - The Truck paperwork card counts from the files: eight lines.
    - The Trailers inspection cell now judges on the carrier's day; it used the browser's UTC date
      before.
  - API: `PaperThumb.filedAt`.
  - **Moved out of UF4, with reasons:**
    - The drop target goes to UF5. It opens the unit's File section until UF7, and neither exists yet.
    - The gallery's side list and "Replace with newer" go to UF5's unit page, beside
      `RequirementDrawer` (D-ROS1: no editing out of a grid cell).
    - "Uploaded by" on the hover card goes to UF5 (the rollup does not read `uploaded_by`).
    - The Trailers unit link goes to UF5, with the page it opens.
- 2026-10-20 — **UF4b built** (`claude/uf4b-driver-file-column`): the Drivers half of UF4 (D-UF7).
  - Shared: `DqRosterCell.documentId` (projected for the hover card's join, nothing reads it to decide a
    state — Q6 unchanged); `DriverOverviewRow.papers` and `paper_count`, optional, present only when the
    reader asked.
  - API: `evidence/paperThumbs.ts` — the newest-three-with-signed-thumbs fold, lifted out of
    `unitFiles.ts` so the driver overview and the unit rollup build a cell from one function.
    `getComplianceOverview` gains `opts.withPapers: (kind) => boolean`; `GET /overview` passes the
    reader's own rule (`mayFile` ∧ `canReadRestrictedKind`, as the documents list does), so a
    dispatcher's roster neither draws nor COUNTS a drug test's scan. The scheduler, the digest and the
    dispatch board pass nothing and sign nothing — pinned by "signs nothing and carries no papers when
    nobody asked — the scheduler's and the digest's path" in
    apps/api/src/modules/evidence/complianceOverview.test.ts.
  - Web: `qualification` + `documents` → one `file` column in `driverRosterColumns.ts`; the table loses
    two cells, `GatedLink` and the `documents` emit, and gains `FileCell` (its `items` prop is now the
    two fields it reads, so the truck's cells and the driver's cells both fit). The chip is `fileChip`
    on the row's state and counts — a driver has no date-only item. `useRosterFilters.file` (`?file=`),
    a *File* control on the toolbar, *Due* behind the Filters button (four-control limit). The chip
    click sets `?file=`; the rows match `matchesFileChip` — pinned by "narrows the roster to the chip's
    state when the chip is clicked, and the rows match it" in apps/web/src/pages/DriversPage.test.ts.
    `FileGallery` with subject `{type: "driver"}` replaces `DocumentsModal`, which is deleted with its
    test (no other reader). The row menu keeps its gated "Open qualification file…" (SP5).
  - Q-UF9 recorded above: the toolbar's two file vocabularies.
  - Four mutants killed (reader filter ignored; always signs; chip filter not applied; a second file
    column), each restored from a byte copy.
- 2026-10-20 — **UF5 split in two.** UF5a (`claude/uf5-unit-pages`) is the truck page and everything
  both pages share; UF5b is the trailer page, its route and surface, the Trailers unit link, and the
  cell drop target now that the File section exists. Each half is one reviewable PR.
- 2026-10-20 — **UF5a built.**
  - Shared: `ownership_type` on `Vehicle`/`Trailer` and both input schemas ("" → null; D-UF11);
    `UnitFileCell.evidenceDate` and `expiryUnknown`, which the page's columns needed and a list cell
    did not. The rollup maps both.
  - Web, the forms: an Ownership select (Unknown · Owned · Leased · Owner-operator) on `VehicleForm`
    and `TrailerForm`; `VEHICLE_COLS`/`COLS` read the column. `useSetVehicleOwnership` /
    `useSetTrailerOwnership`: one-column UPDATEs, for answering the question where it is asked.
  - Web, the section: `components/files/UnitFileSection.vue` — the ROLLUP's row for this unit (the
    read the lists draw their cell from, D-UF1), never a second build in the browser; the catalogue's
    labels; `unitGroups` for the tiles; the grouped `RequirementTable` with a `note` line ("Date only,
    no paper — McLeod says 11/01/2026", "Covered by the fleet's paper") and `releasable=false` (D-BD10
    stamps a driver); `DocumentDropCard`, `CertificationHistory`, `RequirementDrawer`, `DocumentPreview`.
    Unknown ownership is a callout naming the items it holds, with the select inline for an
    equipment manager. "Print QR label" and "Build binder" are hidden until UF8/UF9.
    `UnitRelationStrip.vue` (D-UF2): a truck's seated driver (roster `assigned_driver_id`) with the
    driver rollup's chip, and the trailer on its McLeod load; a trailer's truck on load and its GPS
    pairing, both labelled (D-TL1). Each links to the other file through `GatedLink`. The driver
    rollup is read only for a reader with `roster: view` (`useComplianceOverviewQuery(enabled)`).
  - Web, the drawer: `RequirementDrawer.specs` is now the structural `RequirementSpec`, so
    `EQUIPMENT_ITEMS` fits beside `DQ_ITEMS`; a `document` source (the title, 0490) asks for the scan
    alone and writes no dated row.
  - Web, the page: `pages/vehicleSections.ts` (Overview · File · Maintenance · Fuel) on
    `driverSections.ts`'s model; `?section=` is an anchor the `AppTabs` strip scrolls to. Maintenance
    holds the kit card and two read-only windows: `UnitWorkOrdersCard` (the Shop card's open orders,
    narrowed to the unit number; `maintenance: view`) and `UnitInspectionsCard` (the roadside list's
    whole-record read, matched by the company number or plate the officer wrote on a unit of this
    kind; `safety: view`). Neither adds a request its own page does not make.
  - Tests: `vehicleSections.test.ts`; `UnitFileSection.test.ts` (rows and notes, ownership asked and
    set, relations with chips and links, no controls for a non-manager); the drawer's document-only
    item; the two cards; ownership on the form; `evidenceDate` on the rollup. Four mutants killed
    (note dropped, link without section, document path removed, kind ignored — which survived once;
    the fixture gained a trailer numbered like the truck), each restored from a byte copy.
  - **Noted, not built:** the inspections card matches by what the officer wrote, not by the
    projection's own unit match (the list DTO does not carry it); the gallery's side list and
    "Replace with newer" are answered by the section's own table and drawer on the unit's page, so
    nothing more is owed to UF4's moved items on that line. "Uploaded by" still waits for UF5b.
- 2026-10-20 — **UF5b built** (`claude/uf5b-trailer-page`): the second half of UF5, and the last of
  UF4's moved items.
  - Web: `pages/TrailerDetailPage.vue` — summary (type, plate, reefer, cargo capacity, the GPS-paired
    truck with its pairing's age from `gpsPairingNote`), then File and Maintenance on the truck
    page's model; `pages/trailerSections.ts` DERIVES the strip from `VEHICLE_SECTIONS` minus Fuel.
    Route `/trailers/:id` named `trailer-detail` with `parent: "/trailers"`; surface
    `fleet.trailers.detail` under `fleet.trailers`; the route snapshot gained `/trailers/tr_1`. The
    Trailers list's unit number is now a link, as the truck's always was.
  - Web, the cell: `FileCell` is a drop target (counter, as `FileDropzone`); a drop EMITS and the
    list page goes to the unit's `?section=file`, where the drop card files it. The bytes do not
    travel — a navigation cannot carry a `File` — so the reader drops again there; UF7's bulk intake
    scoped to the subject is what takes the bytes from the cell.
  - "Uploaded by" on the hover card: `PaperThumb.uploadedBy` (a name), read by `paperThumbsBySubject`
    off `documents.uploaded_by` through one chunked `user_profiles` read for the papers a cell draws.
    `user_profiles` is keyed by user, not org; the ids come from the org's own documents rows, and the
    test says so in `expectOrgScoped`'s `exempt`. A member with no profile name is null, and the card
    says only when the paper was filed.
  - Tests: `TrailerDetailPage.test.ts` (facts and pairing, three sections and no Fuel),
    `FileCell.test.ts` (drop emits, uploader named only when known), the not-found case for the
    trailer page, the unit link on the Trailers list, the uploader on the rollup. Four mutants killed
    (drop never emitted, uploader never named, trailer keeps Fuel, unit link removed), each restored
    from a byte copy.
  - **UF5 is complete.** Next is UF6 (equipment alerts).
- 2026-10-20 — **UF6a built** (`claude/uf6a-unit-file-alert-categories`): migration `0503` (0502 went
  to finance's GL control) widens the `notification_events` category CHECK with `unit_file_expiring`
  and `unit_file_expired`, on 0499's rewrite; `NOTIFICATION_CATEGORIES` and its labels gain the same
  two in the same PR (`notificationCategoryCheck.test.ts` compares them). Nothing writes them yet —
  the planner is UF6b, one merge later, so a release can never hand the new code a database whose
  CHECK refuses its insert. No `unit_file_missing`: UF6 names only the two date verdicts.
- 2026-10-20 — **UF6a merged** as #1671 (0503; the CI gate that regenerates `schema.generated.sql`
  wanted the snapshot committed in the same PR, the one miss).
- 2026-10-20 — **UF6b built** (`claude/uf6b-unit-file-alerts`): truck and trailer papers alert.
  - Shared: `planDqAlerts` → `planFileAlerts(rows: FileAlertRow[])` in `dqAlerts.ts`, with
    `driverAlertRows` / `unitAlertRows` as the two adapters. A driver's keys, titles and categories are
    byte for byte (a golden-string test holds them); a unit's keys are
    `unit:{tractor|trailer}:{id}:{item}:{goodUntil}:{threshold}`, overdue weekly as a driver's, with no
    legacy twin. In service = `isInServiceVehicleStatus` for both (trailers share the enum).
  - API: `runUnitFileAlertsOnce` in `dqAlertScheduler.ts`, a third pass in `runAllOrgs` with its own
    try, under `DQ_ALERTS_ENABLED` — no new scheduler. It reads `getUnitFiles(…, { withPapers: false })`
    (new switch; `UnitFileRow.papers` / `paper_count` became optional as the driver row's are, the two
    list pages default them), judged on the carrier's day (`todayInZone`, as the route judges). The
    driver pass keeps its UTC day: moving it would change driver verdicts this step promised to leave
    alone. Recipients `usersWhoManage("equipment")`; one email per subject type ("Truck file: …",
    "Trailer file: …"); entity `tractor`/`trailer`. Driver and unit delivery share `deliverFileAlerts`.
  - Web: `notificationRoute` opens `unit_file_*` on `/vehicles/:id?section=file` or
    `/trailers/:id?section=file` by the entity's subject type.
  - What does not alert, by the same rules as a driver's: an item with no `goodUntil` — missing, and
    a missing item carrying McLeod's date only (`dateOnly`, D-UF3). A unit's 90/60 thresholds never
    fire because the rollup judges on equipment's 30-day window.
  - Tests: golden driver keys; a unit at 30 days alerts once and not on the next run; retired and
    ordered units silent, a unit in the shop alerts; truck and driver with one id never share a key;
    the service wiring (equipment recipients, unit key, entity, one email per type, nothing signed,
    `expectOrgScoped`); the bell route. Nine mutants killed, each restored from a byte copy — the
    `withPapers` one first SURVIVED because the fixture had no paper to sign, and the fixture was fixed.
- 2026-10-20 — **UF6b merged** as #1672.
- 2026-10-20 — **Q-UF9 answered (b) by the owner and built** (`claude/drivers-one-file-filter`): one
  file vocabulary on all four lists that show a file.
  - Shared: `FILE_FILTERS` = `attention` + every `FILE_CHIPS` word, with `FILE_FILTER_LABELS`,
    `fileFilterOptions()` and `matchesFileFilter(chip, word)` in fileChip.ts. "Needs attention" is
    derived from the chip (any chip but `complete`), not a second predicate. `DQ_STATE_FILTERS`,
    `DQ_STATE_FILTER_LABELS`, `dqStateFilterOptions` and `matchesDqState` are deleted;
    `matchesDqFilters(row, { file, due, req })` asks the chip. Built-in views say `file=`.
  - Drivers: the File status control is gone; File (now with Needs attention) and Due sit on the
    toolbar within its four controls, so Due left the Filters button. `?dq=` is still READ, as the
    File filter, for saved views and old links — a labelled migration read in `useRosterFilters`;
    `?file=` wins, and any File choice clears `dq`. It can go once no `saved_views` row holds `dq=`.
  - Compliance fleet table + its tiles: `?state=` → `?file=`, same words; the tiles count with the
    filter their click applies. Driver files widget (fleet manager home): rows ask the chip and link
    `/drivers?file=…`. Vehicles and Trailers gain "Needs attention".
  - Two meanings moved, on purpose (D-UF7: the filter is the cell): `expiring` no longer admits a
    driver who also has something lapsed (the cell says "expired"), and `complete` no longer admits a
    complete file with an item due soon (the cell says "1 expiring") — so the "Files complete" tile
    and the widget's "N of M files complete" can read lower than before. The widget's three rows no
    longer overlap. The compliance table's own row chips ("2 blocked · 1 expiring") are unchanged;
    only its filter speaks the chip.
  - Tests: the two moved meanings, Needs attention incl. a file not started, the legacy `?dq=` read
    and its clearing, `?file=` winning, one file control on the Drivers toolbar, the tile counting the
    chip's complete. Seven mutants killed, each restored from a byte copy. An attention-strip fixture
    whose counts contradicted its attention list was made consistent (the chip reads the counts).
