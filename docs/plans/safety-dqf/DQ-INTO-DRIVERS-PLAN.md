# Driver Qualification folds into Drivers — plan (2026-11-05)

**Status: PLANNED.** Owner ruling 2026-11-05: *"proceed as proposed and suggested"*. Every
recommendation in §3 and both questions put that day (Q-DD1, Q-DD2) are accepted.

## 1. Why

The owner's words, 2026-11-05: the Drivers page and its table already upload and preview a driver's
papers and already carry the expiry columns, so the Driver Qualification page is unnecessary, and
other pages that need a driver's file should land on Drivers.

That is correct, and most of it has already happened, one step at a time, without anyone retiring
the page it made redundant:

| What `/compliance` (`CompliancePage`) does | Already on Drivers? |
| --- | --- |
| One driver's §391.51 file | **Yes.** `/compliance/:id` has redirected into `/drivers/:id?section=qualification` since D1/D2 |
| File column, `FileGallery`, `FileUploadDialog` (7ce0e89, 2026-11-03) | **Yes.** Same components on both lists |
| CDL / Medical / Hazmat expiry columns | **Yes.** Only on Drivers |
| File and Due filters | **Yes.** Same shared predicate (`matchesDqFilters`, `fileFilterOptions`) |
| Dashboard "Driver files" widget | Already opens `/drivers?file=…` |
| Hiring's "hired" artifact, a unit's driver link (`UnitRelationStrip`) | Already open `/drivers/:id?section=qualification` |
| Five attention tiles | No |
| Worst-file-first order; a row expanding to its outstanding items | No. The expiry columns are not sortable |
| **Fleet binder** (select up to `DQ_EXPORT_MAX_DRIVERS` = 25) | **No.** Only the one-driver binder on the driver page |
| **Exports ledger** (`ExportHistory`) | **No** |
| **Set up files** (`QualificationSeedPanel`) | No |
| **Carrier records** (`CertManager` on the organization) | **No** |

The roster programme already asked this question. On 2026-08-31, R8 (`roster/DRIVER-ROSTER-PLAN.md`,
"What shipped") kept the page for exactly five things the roster could not do: the seed panel, the
exports ledger, carrier `CertManager`, the attention counts, and multi-driver binder selection. That
list is this plan's scope: DD1 to DD3 give each of the five a home (or, for the seed panel, show it is
no longer needed), and DD4 is R8's retirement on R8's own terms.

Two lists answering "which drivers are behind on their file" is the drift D-DQ6 was written to
forbid: today they agree only because both import the same predicate, and the 11/03 work had to be
built twice (once per list) to stay that way.

## 2. Measurements (production, 2026-11-05)

- **A1 — permission overrides on the two surfaces.** One row in `org_role_surface_access`: Silvicom
  Inc, `dispatcher`, `safety.driver-qualification`, `allowed = false`, set 2026-10-15. No rows on
  `fleet.drivers`, none in `user_surface_access`. So that company's dispatchers already see the
  Drivers list, its File column and its expiry columns; the override hid a page, not the data. The
  binder and the exports ledger are refused to a dispatcher by the API (`roster: manage` and
  `safety: view`; a dispatcher holds `roster: view`, `safety: none`), so moving them onto Drivers
  hands a dispatcher nothing new. → Q-DD3.
- **A2 — drivers whose file is empty** (`state = not_started`: no live certification and no
  qualification record, active/on-leave, non-EFS). Silvicom Inc: **0 of 183**. The 3-driver test org: 2.
  "Set up files" has nothing left to set up; the synced CDL and medical credentials seed every file.
  **But 183 of 183 drivers have no scanned paper at all.** The work the safety manager
  actually has is papers, not seeding. → §6.
- **Binders ever built** (`dq_exports`): **0**. Nothing in the ledger to keep findable.
- **Carrier records** (`certifications` / `documents` where `subject_type = 'organization'`): **0**.
  Insurance and IFTA count toward every tractor's file (worst state wins), so every truck
  reads "missing" on those two until the carrier files them — and the only screen that files them
  is the one this plan retires.

## 3. Decisions

**D-DQ16 · Drivers is the one driver-file list.** `/compliance` stops being a page. It redirects to
DD1's built-in view (`/drivers?file=attention&sort=soonest`). That is not identical to the old
default, which listed every driver; it is the drivers someone came to `/compliance` to act on, with
"Clear filters" one click from the rest. `/compliance/:id` keeps its
redirect. It is load-bearing: notifications already sent and the PDFs of binders (none yet, but every
future one) cite it.

**D-DQ17 · Nothing moves until its new home exists.** The retirement is the last step, and it deletes
only what the earlier steps have already re-homed. A page removed before its binder, ledger and
carrier records have somewhere to live strands them. The order in §4 is that rule.

**D-DQ18 · Counts live in the File filter, not in tiles** (Q-DD2 (a)). Each option reads "Expired (4)",
counted with the same `matchesFileFilter(fileChip(row), f)` the filter applies, so a count and the
rows it reveals cannot disagree. No tiles on Drivers: the dashboard's "Driver files" widget already
shows the counts and opens the filtered list, and a third rendering of the same five numbers is a copy.

**D-DQ19 · The fleet binder moves to the Drivers table.** Row checkboxes and a "Build audit binder" bar,
shown only to a reader with `roster: manage` (the API's own gate, read from the matrix, not restated).
The restricted-pages opt-in keeps D-DQ15's rule (`session.restrictedAccess`). The exports ledger opens
from an "Audit binders" header button into a `SlideOver`, shown only with `safety: view`. Both come
out of `QualificationFleetTable` into components the Drivers page composes. `DriversPage.vue` is at
399/500 lines, so none of it is written inline.

**D-DQ20 · Carrier records become their own Settings screen** (Q-DD1 (a), with the shape corrected
below). New surface `safety.carrier-records`, path `/settings/carrier-records`, `gate: section("roster")`,
`reachedFrom: "admin.settings"`. That is the pattern "Who can inspect" and "Printers & scanners"
already use for a Settings card owned by a department.
- **Deviation from what the owner approved, and why:** the proposal said "a section of Settings ›
  Organization opened to the roster role". `/settings/org` is ONE surface with ONE gate,
  `manage("settings")`, and a safety manager holds `settings: none`. One section of a page cannot
  carry a different permission than the page, so "a section open to roster" would mean opening the
  whole Organization screen to every roster manager. A separate card beside it delivers what the
  owner asked for (the safety manager keeps filing these) without that side effect.
- **Q-SET2 tension, decided here:** Q-SET2 (2026-09-30) makes every grantable Settings screen
  admin-only by default (`startsOnFor: []`). Applied literally, the safety manager loses carrier
  records, which is exactly what Q-DD1 rules against. The owner's 2026-11-05 ruling is the later and
  more specific of the two, so this surface carries `startsOnFor: ["fleet_manager", "safety_manager"]`,
  the two roles that hold `roster: manage` and file these today. The surface's catalogue comment cites
  both rulings.

**D-DQ21 · "Set up files" is deleted, not moved** (A2: 0 of 183 drivers need it). `QualificationSeedPanel`
is removed with the page. That leaves the API's bulk-seed route (`routes/compliance.ts`, H-CS) and
shared `complianceSeed.ts` with no caller; DD4 removes them too, since an endpoint nothing calls is
surface nobody watches. A future bulk import (§6) is a paper upload, not this form.

**D-DQ22 · The expanding row is not rebuilt.** A driver's outstanding items appear in the File cell's
hover card (it already lists papers) and in `FileUploadDialog`'s `outstanding` list. An expander would
make the Drivers table a second qualification table, the thing this plan removes.

**D-DQ23 · The carrier is a file subject, with its own catalogue** (DD5, Q-DD4 (a); decided 2026-11-06
from the four blockers the DD4 handoff named). Measured first: the API needs nothing. `documents` has
admitted `organization` since 0146 (`COMPLIANCE_DOCUMENT_SUBJECT_TYPES`), both write routes ask
`mayFile(req, "manage", "organization", kind)` per kind, and the unit rollup already reads the scan an
organization insurance/IFTA certification cites (`unitFiles.ts`, `readCitedDocuments`). So the second
half of DD5's "done when" follows from the first; DD5 is a shared catalogue and the web.

1. **`FileSubject` admits `organization`; no wrapper.** Its comment excluded the carrier because
   "an org paper is always SHOWN inside a unit's file, never as a file of its own" (D-UF6). Q-DD4 (a)
   made that untrue: Settings › Carrier records IS the carrier's file. The drawer's only subject uses
   are the upload and the certification write, both of which the API accepts on the organization;
   its record branch already refuses any subject but a driver. A wrapper would be a second form.
2. **`carrierFileCatalogue.ts` in `@silvicom/shared`, `CARRIER_ITEMS`.** One spec per
   `CARRIER_ONLY_CERT_KINDS` kind (label, citation, recurrence, group, scope), the same `FileItemSpecBase`
   both other catalogues extend, built by `fileEngine.buildFile`. The fleet papers are NOT restated:
   their items are `EQUIPMENT_ITEMS.filter(fleetWide)`, so a change to insurance on the truck file
   is a change here. A test pins catalogue kinds == `ORGANIZATION_CERT_KINDS`, each exactly once.
   Recurrence: `expiry` for everything `qualifyOrg` reads (it reads `expires_at` and reports a record
   without one, so the security plan's yearly review (§172.802(c)) is typed as its expiry, not computed);
   operating authority `one_time` (it does not lapse, it is revoked, and no gate reads it).
3. **Permission per row, from the matrix.** `RequirementTable`'s `canManage` is one boolean for the
   table, right for a driver's or a truck's file, wrong here: `fileSectionFor("organization", kind)` puts
   insurance/IFTA in `equipment` and the rest in `roster`. The prop also takes a per-row answer, and the
   page passes `session.can(fileSectionFor("organization", key), "manage")` — the question the route asks.
   DD3's behaviour (a safety manager is not offered the fleet papers) holds row by row.
4. **Hazmat kinds follow the driver catalogue's `scope: "hazmat"`** — shown only when `hazmatguard` is
   on (`moduleEnabled`, as `QualificationSection` and `useDriverDropItems` already do). Within it, the
   split is `qualifyOrg`'s (qualificationGate.ts §10.5), not a new one: PHMSA registration and financial
   responsibility it checks on every hazmat load, so they are required; the security plan and the safety
   permit it checks only when a load trips §172.800(b) / §385.403(b), so they are `advisory` (never
   "missing"; filed first through the page's drop zone, as ELDT is on a driver's file, then a row).
   Production 2026-11-06: Silvicom Inc has `hazmatguard` on, so its page will open with five rows
   missing (operating authority, PHMSA registration, financial responsibility, insurance, IFTA) — the
   truth, since it has no organization record of any kind (§2).
5. **`CertManager` is deleted.** Its one field the drawer lacks is `effectiveFrom` (the binder and
   `CertificationHistory` print it; a policy has a start). The drawer gains it for specs that carry
   `effectiveFrom: true` (fleet insurance, financial responsibility), rather than the page keeping a
   second form for one date. Carrier records was its last caller (DD4).

## 4. Steps — each one PR, in this order

### DD1 — Drivers answers "who is behind, soonest first"

- CDL / Medical / Hazmat expiry columns sortable. The value lives on the overview row, not on
  `Driver`, so the sort reads a derived key (`dqSoonest` / the per-requirement date), not a new
  field on the driver query.
- A "Soonest due" sort, worst state first then nearest date: `QualificationFleetTable`'s
  `worst`/`soonest` rank moved to `@silvicom/shared` so the two lists rank identically until DD4
  deletes the old one.
- File filter options carry counts (D-DQ18).
- File cell hover card lists outstanding items (D-DQ22).
- A built-in saved view "Qualification: needs attention" (`file=attention&sort=soonest`).

**Done when:** a safety manager can open Drivers, choose the view, and see the same drivers in the
same order `/compliance` shows, with counts beside every File option. Tests pin the shared rank and
the count = filtered-rows equality.

### DD2 — Binder and exports on Drivers

- Selection column + binder bar (D-DQ19), cap and toast copy carried over from `QualificationFleetTable`.
- "Audit binders" header button → `SlideOver` with `ExportHistory`.
- After a build, the panel opens on the new job instead of switching tabs.

**Done when:** a binder is built from Drivers on staging, appears in the panel and downloads; a
dispatcher login sees neither control (`staging-test-members`).

### DD3 — Carrier records screen

- Surface `safety.carrier-records` (D-DQ20), route, Settings directory card, `CertManager
  subject-type="organization"` as the screen's body.
- A callout on the screen while insurance or IFTA is missing: those two hold every truck's file at
  "missing" (§2).

**Done when:** a safety manager reaches it from Settings on staging, files an insurance record, and a
tractor's File cell on Vehicles stops counting insurance as missing.

### DD4 — Retire the page

- Delete `CompliancePage.vue`, `QualificationFleetTable.vue` (+ test), `attentionStrip.ts` (+ test),
  `QualificationSeedPanel.vue`, `compliancePageTilesInUrl.test.ts`; `/compliance` → redirect (D-DQ16).
- `surfaceCatalogue`: remove `safety.driver-qualification` and its `.detail` child; `navIcons.ts` entry.
  An org's stored `surface_key` for a removed key grants and denies nothing (0296's header), so the
  Silvicom dispatcher row is inert and is left alone.
- `notificationRoute.ts`: `dq_*` → `/drivers/:id?section=qualification` directly.
- `DriverRosterTable` kebab: drop "Open qualification file…" (duplicates opening the driver).
- `HazmatLoadDetailPage`: "Fix the record in Compliance" → a link to the driver's qualification section.
- `DESIGN-SYSTEM-CONTRACT.md` cites `CompliancePage.vue` as an example (§ in-cell link, kebab note);
  repoint those to live files in the same PR.
- `FEATURE-INVENTORY.md` F11: page line updated.

**Done when:** `/compliance` and `/compliance/:id` both land on Drivers; `routeReachability`,
`routeTable` and `complianceRedirect` tests updated, not deleted; no file imports a removed component;
`lint:surfaces` / `lint:capabilities` green.

## 5. Open questions

- **Q-DD1 — where do carrier records live?** ANSWERED 2026-11-05: (a) Settings, open to the roster role.
  Shape corrected to its own Settings screen, see D-DQ20.
- **Q-DD2 — tiles or counts?** ANSWERED 2026-11-05: (a) counts inside the File filter (D-DQ18).
- **Q-DD3 — should Silvicom's dispatchers keep seeing File and expiry columns on Drivers?** OPEN, not
  blocking. Their 2026-10-15 override hid the qualification *page*; the same facts have been on Drivers
  for them throughout. Candidates: (a) leave as is: a dispatcher legitimately needs "is this driver's
  medical expired" before dispatching, and the API already withholds restricted papers from them;
  (b) hide the File column and the three expiry columns for roles without `safety: view`.
  **Recommendation: (a).** Ask the owner before DD4 ships, since DD4 is when the override stops
  having anything to hide.
- **Q-DD5 — is operating authority required of every carrier?** ANSWERED 2026-11-06: (a), owner: *"implement best solutions for open questions"*. Nothing
  reads `operating_authority` today (no gate, no binder line), so D-DQ23 has no derivation to lean on.
  Candidates: (a) required (`scope: "always"`): a for-hire carrier's MC authority is the first paper
  an auditor or broker asks for, and Silvicom is for-hire; (b) advisory: a private carrier holds none,
  and a future tenant that is one would read "missing" forever. **Recommendation: (a)** — every tenant
  today is for-hire; a private carrier is a carrier-type setting the product does not have yet, and
  inventing it here would be a workaround.
- **Q-DD6 — one scan for insurance and financial responsibility, or two rows?** ANSWERED 2026-11-06: (a),
  same ruling. The fleet policy (§387.7, every truck counts it) and the hazmat financial-responsibility
  proof (§387.9 minimums, `qualifyOrg` reads its own kind) may be the same document with an MCS-90
  endorsement. Candidates: (a) two rows, two certifications; the office files the same PDF to both if
  it is one paper; (b) the insurance row satisfies both, which changes what the hazmat gate accepts.
  **Recommendation: (a)** — §387.9's hazmat minimum ($1M–$5M by commodity) is a separate fact from
  "the fleet is insured", and (b) would silently clear a hazmat load on a policy below the minimum.

## 6. Found while planning, not in this plan's scope

**183 of 183 drivers have no scanned paper.** The file states are carried entirely by synced
credentials (Samsara/McLeod CDL and medical dates). That is Q6 of `roster/DRIVER-ROSTER-PLAN.md` §6 ("a synced
credential reads `current` with no scan on file"), now measured fleet-wide. The bulk upload that
already files truck and trailer papers (UNIT-FILES-PLAN UF7) is the tool for it. Whether driver papers
come from McLeod's imaging the way unit papers did (1,359 filed on 2026-10-20) is the first thing to
check. Recorded here so it is not lost; it is its own plan.

## 7. Progress log

- 2026-11-05: plan written; A1, A2, binder and carrier-record counts measured on production (§2).
  Owner accepted §3 and Q-DD1/Q-DD2. Next: DD1.
- 2026-11-05: DD1 built. Shared `dqWorstRank` / `compareDqUrgency` (dqFleetFilter.ts), now also the old
  qualification table's default order, so the two lists rank identically until DD4. Drivers: File, CDL,
  Medical and Hazmat columns sortable; File filter options carry counts computed with the other controls
  as set (`features/roster/rosterRows.ts`); built-in view "Qualification: needs attention" first in the
  menu. Three deviations from the text above, each smaller than what it replaces:
  (1) the sort key is `file`, the File column's own header, not a separate `soonest`: the order is
  reachable by clicking the column, and D-DQ16's redirect target becomes `/drivers?file=attention&sort=file`;
  (2) outstanding items are a small control at the end of the File cell with its own hover card, not a
  line on the thumbnails' cards, because with no driver papers on production there is no thumbnail to
  hover. Clicking it opens the upload panel for a reader who files, and the driver's qualification
  section for one who cannot;
  (3) the browser pass found the card clipped by the table's scroller and its line unwrapped
  (`whitespace-nowrap` inherited from the cell). It now opens leftward and wraps. Next: DD2.
- 2026-11-05: DD2 built. Drivers: row checkboxes and `DriverBinderBar` for `roster: manage`, an
  "Audit binders" header button opening `ExportHistory` in a `SlideOver` for `safety: view` (an auditor
  reads it and builds nothing; a dispatcher sees neither), the cap read from `DQ_EXPORT_MAX_DRIVERS`
  (`binderSelection.ts`), and a build opens the ledger. Three things found on the way:
  (1) the driver page's "Export this file" toast and the ledger's empty state both pointed at the old
  page's Exports tab; both now name Audit binders on Drivers;
  (2) the shared `DataTable` named every row checkbox "Select row <key>", which on the roster is a
  database id; it now reads the first column ("Select Marcus Reyes"), as the narrow card layout already
  did, and falls back to the key;
  (3) the browser pass showed the six-column ledger clipped in an 896 px panel. It is four columns now:
  "As at" joins the detail line under each binder, and "By" stacks under "Requested".
  `QualificationFleetTable` keeps its own copy of the cap until DD4 deletes it (a feature may not import
  another's internals). Next: DD3.
- 2026-11-05: DD3 built. `/settings/carrier-records` (surface `safety.carrier-records`, `section("roster")`,
  `startsOnFor` fleet_manager and safety_manager), a Settings card, `CertManager` on the organization, and a
  callout while the fleet's insurance or IFTA is not on file. Found on the way, each changing what DD3 does:
  (1) **IFTA could never be filed on the organization.** The certification contract kept its own list of
  organization kinds without `ifta`, while the unit rollup read an organization IFTA (`FLEET_WIDE_UNIT_KINDS`),
  so every tractor read "missing" on IFTA with no way to clear it. The database never refused it (0490).
  Now one shared `ORGANIZATION_CERT_KINDS`, derived from the equipment catalogue's `fleetWide` items, feeds
  both the contract and the form.
  (2) **A safety manager cannot file the fleet's insurance or IFTA, and that is the matrix working.** Those two
  are the equipment section's papers (`fileSectionFor`, D-UF5), where a safety manager holds `view`. The form
  now offers each kind only to whoever manages its section, so it never shows a choice the API refuses; the
  callout says filing them needs permission to manage vehicles. DD3's "Done when" text (a safety manager files
  insurance) was wrong on this point; a fleet manager or admin files it, or the owner raises the safety
  manager's `equipment` access in Settings › Permissions. Not changed here.
  (3) **The Settings entry reappears in the sidebar for fleet and safety managers**, with this one card behind
  it, because the directory opens when any screen behind it does. That is Q-DD1 (a) as approved; seven tests
  that used those roles as "nothing behind Settings" now switch the screen off explicitly, and new ones pin
  the exception.
  (4) `surfaceCatalogue.ts` was exactly at 500 lines. The entry is one line, its reasoning lives in
  CarrierRecordsSettingsPage.vue, and `check-file-size.mjs` pins the file at 501 until **DD4, which must
  delete that pin** when it removes the old page's two entries.
  Still open, not built: `CertManager` records a date with no scan attached (Q-DD4 below).
- **Q-DD4 — should a carrier record carry its scan?** OPEN, not blocking. `CertManager` writes a certification
  with no document, so "PHMSA registration, good until 06/30/2027" can be on file with nothing an auditor can
  open (the same concern as roster Q6). The driver and unit files use `RequirementDrawer`, which uploads the
  scan first. Candidates: (a) give the carrier records a `RequirementDrawer` per kind, as the unit file has;
  (b) leave it, since these papers live with the carrier's own filing. **Recommendation: (a)**, as its own step
  after DD4.
- 2026-11-06: owner: *"proceed as recommended and proposed"*. **Q-DD3 ANSWERED (a)**: dispatchers keep the
  File and expiry columns on Drivers. **Q-DD4 ANSWERED (a)**: carrier records will carry their scan through a
  `RequirementDrawer` per kind, as its own step after DD4 (DD5 below).
- 2026-11-06: DD4 built. Deleted `CompliancePage.vue`, `QualificationFleetTable.vue` (+ test), `attentionStrip.ts`
  (+ test), `QualificationSeedPanel.vue` (+ test), `compliancePageTilesInUrl.test.ts`, shared `complianceSeed.ts`
  (+ test) and the API's `POST /certifications/seed` (D-DQ21; nothing else called either). `/compliance`
  redirects to `QUALIFICATION_ATTENTION_VIEW`'s query, read from that built-in view rather than restated, so
  the two cannot drift; `/compliance/:id` keeps its redirect. Surfaces `safety.driver-qualification` and its
  `.detail` gone, with their nav icon; the Silvicom dispatcher override row is inert (0296) and left alone.
  The `surfaceCatalogue.ts` 501 pin DD3 added is deleted (the file is 494). `dq_*` notifications open
  `/drivers/:id?section=qualification` directly. The roster's "Open qualification file…" item is gone. The
  hazmat load's "Fix the record in Compliance" now links the driver's qualification section (the load's
  `driver_id`) and, for a carrier finding, Settings › Carrier records, each where it opens for the reader.
  Found on the way:
  (1) **Q7 of the roster plan dissolved.** It recorded the attention tile counting "Due in 30 days" without
  overdue drivers while the filter included them. The tile went with the page, so one rule remains (an
  overdue item is inside every horizon); whether that is right is still the owner's to rule, and
  dqFleetFilter.ts now says so instead of citing the deleted test.
  (2) Six sidebar cases lose an otherwise empty Safety group: dispatcher and recruiter, whose only Safety
  entry was Driver qualification. Both keep Fleet › Drivers.
  (3) `DESIGN-SYSTEM-CONTRACT.md`'s "In-cell link" row named `text-brand-600`, which no file used; 46 use the
  `link` token. The row now says so and cites live files.
- **DD5 — carrier records carry their scan (Q-DD4 (a)). NEXT.** Settings › Carrier records lists each
  organization kind as a requirement row with its state, using `RequirementTable` + `RequirementDrawer` (the
  scan uploads before the record is written, as on the driver and unit files), and keeps `CertManager` only
  if a kind needs fields the drawer lacks. Done when a PHMSA registration filed there cites a document an
  auditor can open, and the unit rollup's organization insurance/IFTA show their paper on a truck's file.
- 2026-11-06: DD4 confirmed merged (#2083). DD5's four blockers resolved as D-DQ23 (§3): the API already
  files and reads organization scans, so DD5 is a shared `CARRIER_ITEMS` catalogue + the web. Two
  choices left for the owner before building, recorded as Q-DD5 and Q-DD6 (§5).
- 2026-11-06: owner: *"implement best solutions for open questions"* — **Q-DD5 (a)**, **Q-DD6 (a)**. DD5 built.
  `carrierFileCatalogue.ts` (shared): `CARRIER_ITEMS`, `carrierFileSpecs`, `buildCarrierFile` on `fileEngine`;
  the fleet papers are the equipment catalogue's `fleetWide` items re-shaped, and a test pins its kinds to
  `ORGANIZATION_CERT_KINDS`. Settings › Carrier records is now `RequirementTable` + `RequirementDrawer` +
  `DocumentDropCard` + `CertificationHistory` on the organization; `CertManager.vue` is deleted.
  `FileSubject` admits `organization`; `RequirementTable.canManage` also takes a per-row answer; the drawer
  asks "Effective from" for specs that carry `effectiveFrom` (fleet insurance, financial responsibility).
  Found on the way: (1) financial responsibility sits in the Insurance group beside the fleet policy, not
  under Hazmat, since it is so often the same paper (Q-DD6); (2) the security plan stays `expiry`, not
  `annual` as D-DQ23 first said, because the hazmat gate reads its `expires_at`; D-DQ23 corrected.
- 2026-11-06: owner: *"implement best solution for open questions … we will upload documents for drivers
  later"*. The two the roster plan still held, both answered there (§6): **Q7** — an overdue item is due;
  the Due options now read "Overdue or due in N days" and the built-in views "expired or expiring in 30
  days" (they always listed lapsed drivers, the names said otherwise). **Q6** — a requirement dated with no
  scan keeps its state and the driver file says "Date on file, no scan" (D-UF3's rule, now on both files).
  Driver paper intake (§6 of this plan) stays the owner's, scheduled for later.
