# Driver, truck and trailer files — one Files column, QR access, digital binder — plan (2026-10-19) — **PROPOSED**

The owner's brief (2026-10-19): three separate files — **Driver files, Truck files, Trailer files** —
each tied to its driver, truck or trailer; a **QR system**; a **digital binder**; bulk upload of
documents; and **no duplicated list pages** — the existing Drivers, Vehicles and Trailers tables each
gain one column, in the manner of monday.com's Files column (preview and open a file from a single
cell). The DQ file's own page UX is acknowledged as weak and is fixed later, in its own plan; this one
must not make that fix harder.

Decision prefix **D-UF**, questions **Q-UF**. Status: research done, nothing built.

---

## 1. What already exists (measured on `origin/main`, 2026-10-19)

The storage is done. What is missing is every page, rule and job above it — D-AVI17 already ruled
"the truck file adds a page, never a store", and this plan holds to it.

| Piece | Where | State for trucks/trailers |
|---|---|---|
| File store | `documents` (0146): `subject_type` driver/tractor/trailer/load/organization/roadside_inspection, `kind`, `sha256`, append-only | Accepts equipment; kinds have `registration`, `annual_inspection`, `insurance`, `ifta`, `irp`, `other`. **No** title, lease, cab card, permit |
| Expiry store | `certifications` (0127): temporal, one current row per subject+kind, `document_id` | Accepts tractor/trailer; only annual-inspection finalize writes one today |
| Requirement rules | `packages/shared/src/dqCatalogue.ts` + pure evaluator `dqFile.ts` | Driver only |
| Fleet rollup | `GET /api/compliance/overview` (`complianceOverview.ts`) → Drivers table's Qualification column | Driver only |
| Expiry alerts | `evidence/dqAlertScheduler.ts` + `dqAlerts.ts` (90/60/30/14/0) | Driver only — the annual-inspection plan names "no equipment producer yet" |
| Binder | `evidence/dqBinder/*` (gather → render → merge with `pdf-lib`), `dq_exports` | Driver only; the mechanism is subject-agnostic |
| Viewer | `components/DocumentPreview.vue` (images at 2000 px, PDFs in the browser viewer, hash in footer) | Already moved out of compliance "for tractor/trailer reuse" (R5a) |
| Upload primitive | `components/ui/FileDropzone.vue` (mandated) | Reusable as is |
| Bulk intake + AI | `document-reading/`: sources → assemblies → per-page Haiku classify (`classifyPage.ts`) → `document_page_classes` ledger with reviewer override | Closed class set `PAGE_CLASSES` = BOL papers only |
| QR | `@silvicom/qr` (encoder + label sheets), tag vocabulary `SIL1:<kind>:<id>`, `GET /api/tags/resolve` registry (D-INV7, D-INV16), `/shop/scan` | Inventory plan §2.10 reserves `vehicle`/`trailer`/`document` kinds "for the digital truck file" |
| List pages | `/drivers` (Qualification column exists), `/vehicles` + `/vehicles/:id` (cards, no tabs), `/trailers` (**no detail page**) | — |
| Dates on the unit row | `vehicles/trailers.registration_expires_at`, `dot_annual_inspection_expires_at` — written by the McLeod roster sweep (`mcleod/rosterFields.ts`) and by inspection finalize (`roster/equipmentInspection.ts` decides who owns it) | Read by `fleetChecks.ts` → Truck paperwork card + `?check=` filter. A date with no paper behind it |

---

## 2. What the market does (research 2026-10-19)

- **Two views over one store** — every vendor (Motive Documents Hub, Whip Around Wallet, Fleetio,
  J.J. Keller Encompass) has a per-unit tab AND a fleet-wide list. Ours is the existing list pages,
  filtered — no new library page (owner's brief).
- **Required documents as rules per class** — Samsara Qualifications Management: admin-defined types
  plus "sets" saying which types a group of assets must hold, each Current / Expiring / Expired /
  Missing. Exactly our DQ catalogue's shape.
- **AI bulk upload with a Needs Review queue** — Motive matches a file to a unit by VIN / plate /
  unit number and reads its expiry; Samsara's "Create records with AI" holds every AI-made record in
  Needs Review. Nobody files silently.
- **One paper, many units** — fleet insurance, an IRP cab card per apportioned account (Motive:
  unit / group / fleet; Whip Around: one policy shared across assets).
- **Completeness is a list, not a score** — Fleetworthy, FileReady: "Unit 207 · annual · 9 days".
- **monday.com Files column** — in the cell: a row of small thumbnails (images) or type icons (PDF,
  which monday notoriously does not thumbnail), "+" to add, drag-drop onto the cell (many files);
  hover → preview card with download; click → full-screen preview with a Versions sidebar and pinned
  comments; item page has a Files tab gathering everything. The gallery-with-arrows and "+N"
  overflow chip are clones' additions, not monday's — but they are the right additions.
- **QR** — Whip Around / Fleetio QR codes carry an opaque asset id scanned *inside their app*;
  truckqr.com sells a per-unit sticker opening a passcode-protected folder the *driver* shows the
  officer. No vendor gives the officer a rotating-token read-only page — open design space, and the
  riskiest part of this plan.
- **Regulation** — every IRP jurisdiction must accept an electronic cab card since 2019-01-01 (PDF,
  readable offline); §396.17(c) proof of annual inspection must be ON the unit (report or decal), per
  unit of a combination; §396.21 report kept 14 months; §396.3 maintenance records 1 year + 6 months
  after the unit leaves; §396.9 roadside reports 12 months; electronic records allowed (2018 rule) if
  legible, reproducible and protected; DQ files produced within 48 h of an audit notice.

---

## 3. The shape: three files, one mechanism

- **D-UF1 — Three files, one engine.** Driver file, Truck file and Trailer file are three
  *catalogues* (what each must hold) read by one pure evaluator. The DQ catalogue already is the
  driver file; `equipmentFileCatalogue.ts` beside it holds tractor and trailer items. The evaluator is
  generalised from `dqFile.ts` (subject in, `FileSummary` out), not copied — a second evaluator is a
  workaround with a delay fuse. Separate in the UI and the vocabulary; one in code.
- **D-UF2 — Relations are read, never stored a second time.** A truck file shows "Driver: J. Smith
  (file current)" and "Trailer: 5302 (annual expired)" by reading the seated driver
  (`vehicles.assigned_driver_id`) and the load's trailer (D-TL1: dispatch questions read McLeod's
  load). A driver file shows their truck's file state the same way. Nothing copies a document from
  one subject to another.
- **D-UF3 — The unit row's date and the paper are two facts, shown as two.** McLeod's
  `registration_expires_at` is a date somebody typed; the file item is a document on file. The
  column reads the certification when one exists and falls back to McLeod's date marked "date only —
  no paper". This keeps the Truck paperwork card's counts honest and gives the office a reason to
  upload. (Whether the McLeod date may *seed* a certification is Q-UF2.)
- **D-UF4 — No new list page, no fleet document library.** The fleet-wide view is the existing table
  filtered (`?file=missing|expiring|expired`), as the Drivers table already does with "File status".

### 3.1 Catalogue (draft — Q-UF3 confirms)

| Item | Tractor | Trailer | Expires | Source | Roadside? |
|---|---|---|---|---|---|
| Registration / IRP cab card | ✓ | ✓ (state plate) | yes | certification + document | yes |
| Annual inspection §396.17/§396.21 | ✓ | ✓ | 12 mo | already written by finalize | yes |
| Insurance (unit or fleet policy) | ✓ | ✓ | yes | certification + document | yes |
| IFTA licence + decal | ✓ | — | yearly | certification (fleet-wide) | yes |
| Title | owned only | owned only | no | document | no |
| Lease / owner-operator agreement | leased / O-O | leased | yes | document + certification | yes (§376.11 copy in cab) |
| Permits (oversize, state, hazmat) | if issued | if issued | yes | certification | yes |
| Maintenance records §396.3 | ✓ | ✓ | — | FleetPal/work orders (link, not copy) | no |
| Roadside inspection reports | ✓ | ✓ | — | `roadside_inspection` subject (0476), linked | no |

`ownership_type` (owned / leased / owner_operator, from 0099/0100) picks the scope, the way
`scope: hazmat` picks DQ items. Missing kinds (title, lease, cab_card, permit) are one migration.

---

## 4. UI

### 4.1 The Files column (Drivers, Vehicles, Trailers — one shared cell)

One `FileCell` component in `@silvicom/ui` (the table kit lives there since US7), used by all three
tables, reading the same rollup the subject's page reads — one calculation, three readers (the R4
rule the Drivers table already follows).

```
┌─ File ───────────────────────────────┐
│ ● 2 expiring   [📄][📄][🖼] +5   ⬆   │
└──────────────────────────────────────┘
```

- **Status first**: one chip — Complete / 2 expiring / 1 expired / 3 missing — worst wins. This is
  what the office scans a column for; thumbnails alone (monday) don't say "Unit 207 is illegal".
- **Then the papers**: up to three thumbnails (images: the 40 KB thumb we already store; PDFs: a
  first-page thumbnail rendered at upload — fixing monday's best-known gap), then `+N`.
- **Hover a thumbnail** → card: kind, expiry, uploaded by/when, Download.
- **Click** → `DocumentPreview` opened as a **gallery over that unit's file**: ←/→ between papers,
  a side list of every item with its state, Download, "Replace with newer" (a new row — evidence is
  append-only; the old one shows under History, which is monday's Versions done our way).
- **Drop files onto the cell** → they go to bulk intake (§4.3) *pre-scoped to that unit*, so the
  only question left is which item each paper is.
- **Below 768 px** the cell becomes the card's status line (DataTableCards).

### 4.2 The unit's own page

- **Vehicle detail** gains the driver page's `?section=` pattern: Overview · **File** · Maintenance ·
  Fuel. The existing cards move under Overview unchanged.
- **Trailer detail `/trailers/:id`** is new: Overview · **File** · Maintenance. (Trailers having no
  detail page is a gap in its own right.)
- **File section** = items grouped (Registration & permits · Ownership · Insurance · Inspections ·
  Maintenance & roadside), each row: state chip, expiry, the paper's thumbnail, drop zone, history.
  Plus the relation strip (D-UF2) and the two actions: **Print QR label** and **Build binder**.
- It reuses `RequirementTable`/`RequirementDrawer` *only after* they are lifted out of
  `features/compliance` into a shared home — `lint:boundaries` forbids importing them from `roster`,
  and a copy is the workaround this repo refuses. The lift is step UF1's first commit; the DQ
  redesign later inherits the same components.

### 4.3 Bulk upload ("Upload documents" on all three lists)

1. Drop many files (or one PDF holding many papers).
2. Each page is classified by the existing Haiku classifier, extended with file classes
   (registration, cab card, annual inspection, insurance, title, lease, permit, medical card, MVR, …);
   multi-page papers are assembled (0454's assemblies).
3. A reader pulls **unit number / VIN / plate / driver name + CDL**, and the expiry date.
4. Match: VIN or plate exact → unit; unit number → unit; filename (`654-registration.pdf`) as a
   tie-breaker; drivers by CDL number, then name.
5. **Review table**: one row per paper — thumbnail, proposed subject, item, expiry, confidence,
   with inline correction. "File all confident" + per-row file. Nothing is filed without a person
   (every vendor that does this has the same gate; our evidence tables are append-only, so a wrong
   auto-file is a correction row forever).

The engine stays in `document-reading` (it is not a roster feature); the review table is a page of
its own under the roster carve-out reached from the three lists' button.

### 4.4 QR

Two different things share the word, and must not share the sticker until Q-UF5 is answered:

- **Office/shop QR (low risk)** — the reserved vehicle / trailer tag kinds (`SIL1:VEH:<id>` is already in the contract tests; the trailer kind is named in UF7), printed with
  the existing label sheets, resolved by `/api/tags/resolve` behind login. Scanning opens the unit
  (and its File section). This is the inventory scanner's fabric with two resolver lines.
- **Roadside QR (high risk)** — a sticker in the cab that the driver (or officer) scans to see the
  roadside set: cab card, registration, annual inspection, insurance, lease. D-INV's rule is that a
  QR is an opaque id, never a URL; a phone camera with no app needs a URL. Candidates in Q-UF5.
  Whatever the answer, the driver app gets a **"Truck papers" card** (the seated truck's roadside
  set, cached offline as PDFs — what IRP advises), which needs no public page at all.

### 4.5 Digital binder

Generalise `dqBinder` (gather → render → merge) by subject:

- **Truck / trailer binder** — cover + contents in catalogue order + each current paper + annual
  inspection report + the last 12 months' maintenance/roadside index.
- **Audit binder** — pick N drivers and/or units → one PDF (the DQ binder already does drivers).
- **Roadside packet** — the roadside set only, one PDF, also what the driver app caches.
- Each binder is a `dq_exports`-style row (append-only, hashed) and its cover carries a
  `SIL1:DOC:<id>` QR so a printed binder resolves back to the record it was built from.

---

## 5. Steps

| Step | What | Depends on |
|---|---|---|
| **UF0** | Lift `RequirementTable`/`RequirementDrawer`/evaluator to a shared home; generalise `dqFile.ts` by subject; no behaviour change (driver tests stay green) | — |
| **UF1** | Migration: missing kinds; `equipmentFileCatalogue.ts`; equipment rollup endpoint (org-scoped, `expectOrgScoped`) | UF0 |
| **UF2** | `FileCell` in `@silvicom/ui` + Files column on Vehicles, Trailers, Drivers (Drivers swaps its Qualification cell for it) + `?file=` filter | UF1 (reader ships a merge after its migration) |
| **UF3** | Vehicle detail sections; new trailer detail page; File section; gallery viewer; replace-with-newer | UF2 |
| **UF4** | Equipment alerts: extend the DQ alert scheduler (it already runs; no new scheduler — `docs/WORKER-DEPLOYMENT.md`) | UF1 |
| **UF5** | Bulk upload: file classes, reader, matcher, review table | UF1 |
| **UF6** | Binders: subject-generic binder, truck/trailer + audit + roadside packet | UF1 |
| **UF7** | QR: office tags (VEH/TRL/DOC resolvers + labels); driver-app Truck papers card; roadside QR per Q-UF5 | UF6 |

UF2+UF3 is the first thing an office user sees; UF5 is the biggest time saver; UF7's roadside half
ships last because it is the only part that publishes anything outside a login.

---

## 6. Open questions

- **Q-UF1 — One paper covering many units** (fleet insurance, IFTA licence, one cab card listing
  several units). (a) a link table `document_subjects` (document ↔ many subjects); (b) file it on the
  organization and let catalogue items say "satisfied by the fleet's"; (c) duplicate per unit.
  *Recommend (b) for fleet-wide papers (insurance, IFTA) and (a) for papers naming a list of units;
  never (c).*
- **Q-UF2 — McLeod's dates.** (a) shown as "date only — no paper", never a certification (D-UF3);
  (b) seed a certification from McLeod's date, marked source McLeod. *Recommend (a)*: a date with no
  paper is what an auditor writes up, and (b) would turn every typed date into a "complete" item with nothing behind it.
- **Q-UF3 — The catalogue in §3.1.** Owner confirms the items, which are required vs optional for
  owned / leased / owner-operator units, and whether reefer units need anything extra.
- **Q-UF4 — Filename-only matches.** (a) always through review; (b) auto-file when the filename
  names exactly one unit AND the classifier agrees on the kind. *Recommend (a) for the first month,
  then measure how often review changed nothing.*
- **Q-UF5 — Roadside QR.** (a) no public page: the QR opens the driver app's Truck papers card, the
  driver hands the phone over (truckqr.com's model, zero exposure); (b) a URL QR to a public page
  showing the roadside set, gated by a rotating short-lived token the driver app displays, never a
  static sticker; (c) a static sticker URL with a PIN. *Recommend (a) now, (b) as a later step if
  officers ask for it; refuse (c)* — a static URL on a truck publishes the carrier's insurance and
  lease to anyone who photographs the door, and D-INV's "id, never URL" rule exists because a URL
  bakes the hostname into a sticker for years.
- **Q-UF6 — Who may see and upload.** The section × role matrix needs a roster-files row: does a
  dispatcher see the truck file? does a fleet manager upload? *Recommend reading it from the matrix
  (`settings-permissions`), adding rows there — never a hand-written list in the page.*
- **Q-UF7 — The Drivers table.** (a) the Files cell replaces the Qualification cell; (b) both. *Recommend
  (a)* — two cells answering one question is the duplication the brief forbids.
