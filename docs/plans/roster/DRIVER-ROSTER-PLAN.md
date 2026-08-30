# Drivers — the roster grid and the driver record (2026-08-30)

The ask: one drivers page that answers most of the day's questions without leaving it, with the
§391.51 file, its documents and every editable field reachable from the row — and the same shape
later for vehicles and trailers. The concrete proposal was a monday.com-style grid where **every
cell opens a modal that both displays and edits**, and where `/drivers/:id` and every other
driver-related page is deleted.

**This plan takes half of that and rejects the other half, for a reason that is in the codebase
rather than in taste.** It also fixes the thing that made the ask reasonable in the first place:
the web has no per-section capability model, so recruiting UI got glued onto the driver page as a
workaround, and that workaround is what makes the product feel like it has too many pages.

Nothing here has shipped. Every step is unstarted.

---

## 1. Measured reality (2026-08-30, `main` at 704c64e)

Counted, not estimated. Anything below that turns out to be wrong should be corrected **in place**
in this document, with the date.

| Fact | Value | Where |
| --- | --- | --- |
| Distinct columns on `drivers` | **43** | migrations sweep |
| Fields `driverDetailSchema` adds beyond the list row | **25** | `rosterContract.ts:218-256` |
| Fields the McLeod sweep writes to a driver row it owns | **15** | `mcleod/rosterFields.ts:29-73` |
| Section UI currently mounted on the driver page | **~2,700 lines** across 5 tabs | `features/compliance`, `features/recruitment`, `features/roster` |
| Driver-related pages | **9** | `pages/*.vue` |
| Files using the one `DataTable` | **58** | web sweep |
| Files still on a raw `<table>` | **2** (Dashboard, DesignSystemLab) | web sweep |
| `DriversPage.vue` against the 500-line budget | **493** | `lint:filesize` (warns at 450) |
| `session.canManage` call sites | **50**, across **20** `.vue` files (**72** `canManage` references web-wide) | web sweep |
| API mounts with hand-listed roles vs derived | **98** hand-listed / **40** derived | `apps/api/src` sweep |
| Inbound deep links into `?section=` / `/compliance/:id` | **6 code sites + notifications** | see §2.3 |

### 1.1 What is already built, and must not be rebuilt

The DQF module is not half-finished; it is finished and **under-surfaced**. `documents` + the
private `compliance-docs` bucket (0146), register → signed upload → batch signed read, sha256
integrity for §390.32(c), `DocumentDropCard` (drop-then-classify), `DocumentPreview` (the sanctioned
viewer, `size="xl"`, `printable`, per-file server-signed download), `RequirementDrawer` (scoped
per-requirement forms that write a certification with a supersede chain), the audit binder, and a
20-item §391.51 catalogue in `dqCatalogue.ts` that already contains `employment_application`,
`road_test`, `psp_report` and `endorsement_hazmat`.

`/compliance/:id` is already a redirect into `/drivers/:id?section=qualification` (D1/D2). The
"one driver, one page" move happened. What never happened is the roster showing any of it.

---

## 2. The three findings that decide the shape

### 2.1 An edit is not a write — it changes what the row *means* (this settles grid-vs-page)

`resolveDriverUpdate` (`rosterContract.ts:359-390`) is pure, tested, and encodes rules that a cell
editor cannot honestly present:

- **Editing `full_name`, `first_name`, `middle_name`, `last_name` or `phone` claims the row from the
  sync, permanently.** `identity_source` flips to `'manual'`, and `rosterFields.ts:52-55` states the
  consequence from the McLeod side: *"editing an identity field claims the row to 'manual', after
  which nothing here runs."* The row stops receiving McLeod's CDL number, CDL expiry, medical card
  expiry, hire date, address — silently, forever.
- **Setting `status: 'terminated'` stamps `termination_date`** when the row has none, which starts
  the §391.51(c) three-year retention clock and ends the person's driver-app access on their next
  request (`auth_driver_id()` resolves only `active` drivers).

The API already returns `claimedFromTelematics` and `stampedTerminationDate` **so the UI can tell
the user what their edit just did**. A cell editor has nowhere to put that sentence and no moment
at which to show it. A form with a Save button has both.

This is the entire argument against cell-as-editor, and it gets *worse* as McLeod lands, because
McLeod is what makes the claim consequential.

### 2.2 McLeod's driver dates will not reach the table the gate reads — **this is a live defect**

`mcleod/rosterFields.ts:56-57` writes `cdl_expires_at` and `medical_card_expires_at` onto `drivers`
on every sweep. `certifications` is the single source of truth for qualification (D-DQ6) and the
only table the hazmat enforcement gate reads (`qualification.ts:64-72`) — and **nothing bridges the
two.** `grep certifications apps/api/src/modules/mcleod/` returns nothing; the only writer of
`certifications` from expiry dates is `complianceSeed.ts`, which is a human filling in a grid.

So on the day McLeod roster sync is enabled for an org, the roster will show a current medical
expiry from McLeod while that driver's DQ file says the medical card is `missing` — two numbers on
two screens, both sourced honestly, disagreeing. Worse in the other direction: a fleet could believe
McLeod's dates are protecting them while the hazmat gate still fail-closes.

**This must be resolved before or with the roster expiry columns**, because those columns are
exactly where the disagreement becomes visible. It is R1, and it is the highest-priority step in
this plan regardless of what happens to the UI.

### 2.3 The web has no per-section capability model — this is the workaround to kill

`session.canManage` is **one global boolean** used **50 times across 20 components** (72 `canManage`
references web-wide once the store, nav and router guard are counted), and it is
`canManageFleet`, which is hand-written as `role === "admin" || role === "fleet_manager"`
(`auth.ts:133-134`) rather than derived from the matrix. Measured:

| role | `canManageFleet` | `canManageSection(role, "fleet")` |
| --- | --- | --- |
| admin | true | true |
| fleet_manager | true | true |
| **safety_manager** | **false** | **true** |
| dispatcher / auditor / recruiter / driver / accountant | false | false |

Consequences that are all live today:

- A **safety_manager** holds `fleet: manage` in the matrix and is treated as read-only by the whole
  web app, including every `requiresManage` route (`router/index.ts:84`), which redirects them to
  the dashboard.
- A **recruiter** holds `recruitment: manage` and gets `canManage === false`, so
  `router/routes/recruitment.ts:4` carries a ⚠ comment explaining that recruiting routes must never
  use `requiresManage` "which is `canManageFleet`". That is a documented workaround.
- An **accountant** holds `accounting: manage` and `billing: manage` and gets `canManage === false`.
- `PspRecordsSection.vue:34` and `DriverDetailPage.vue:224` both record that PSP sits on the driver
  page *because* Qualification's write affordances gate on `canManageFleet`, "which a recruiter is
  not". **That is the layout workaround the whole redesign ask is a reaction to.**

The sections themselves are complete and enforced. `SECTION_ACCESS` (`auth.ts:86-109`) carries all
sections × eight roles; migration 0266 landed the `accountant` enum value (P4.1, 2026-08-27); route
gates are derived and walked by `routeGates.test.ts` (P4.2, same day). **The API and the database
got this right. The web never received it.**

One of them was also *wrong*, which is the deeper half of the same finding: `fleet` named two
different things — the people and the equipment — so no matrix row could grant a safety manager the
§391.51 file without also handing them the truck list. That is why the previous fix was a hand-
written helper rather than a matrix row, and a hand-written helper is exactly what drifts.
**Ruled 2026-08-30: the section splits (D-ROS12, built as R0a).** Everything in §2.3 above describes
the state R0a and R0 remove, and is kept as the measurement, not as a description of the target.

Inbound deep links that constrain any page deletion: `InviteApplicantDrawer.vue:149`,
`InquiryQueuePage.vue:147`, `ScreeningReadinessPage.vue:172`, `QualificationFleetTable.vue` (×4),
`DriversPage.vue` (×2), and `notificationRoute.ts:18`, which routes every `dq_*` expiry
notification to `/compliance/:driverId` — the path by which "medical card expires in 14 days"
reaches the person who fixes it.

---

## 3. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| **D-ROS1** | **The grid reads and navigates; the record page writes.** A driver cell may open a *viewer* or *navigate*; it may not be a general-purpose editor. | §2.1. An edit can detach the row from its sync or start a retention clock, and the two flags the API returns to say so need somewhere to be read. |
| **D-ROS2** | Inline editing is permitted **only** on a named allowlist of fields with no sync owner and no legal consequence, defined once in `@silvicom/shared` as `DRIVER_INLINE_EDITABLE`. Everything else routes to the record page or a scoped drawer. | Gives the speed the ask is really about without making the dangerous writes cheap. A list in shared can be gated; a convention cannot. |
| **D-ROS3** | **Take monday.com's grid, not its editor.** Column picker + saved views + horizontal scroll land in `DataTable`. | This is the half that gets better as McLeod widens the row, and the half we do not have. 43 columns today, more after McLeod: a fixed 11-column table is the actual usability problem. |
| **D-ROS4** | **Provenance is rendered, per field group.** Every editable group states who wrote it (`identity_source`, McLeod last-sweep time) and what an edit would mean, and a claim-triggering edit says so **before** Save, using `claimedFromTelematics`. | Three writers (Samsara, McLeod, the office) with per-field, per-row coverage. `rosterFields.ts:18-22` refuses to null over a good value precisely because coverage is uneven; the UI has to be as honest as the sync. |
| **D-ROS5** | **`/drivers/:id` stays, and `?section=` stays a public surface.** Tabs become sections on one scroll. | `driverSections.ts:1-8` already declares the query string public; notifications, the binder and the applicant board all depend on it. Deleting the page means hand-rebuilding routing in query params, worse than the router. Six tabs was always the complaint; the URL never was. |
| **D-ROS6** | **Recruiting sections leave the driver page** for the recruitment surface. | `recruitment` is already its own capability, its own nav group and its own set of pages. Their presence on the driver page is D-ROS7's workaround, not a design. |
| **D-ROS7** | **`session.canManage` is deleted.** The web gains `session.can(section)` / `session.canView(section)` derived from `canManageSection` / `canViewSection`, and `requiresManage` route meta becomes `requiresManage: <section>`. Lands on top of D-ROS12's sections, never on `fleet`. | §2.3. One boolean cannot express a whole section × role matrix (eleven sections × eight roles after D-ROS12), and the attempt is what produced every workaround this plan removes. |
| **D-ROS8** | **The file cell opens one modal, never a stack.** A per-driver documents modal lists every scan with a per-file download; opening a scan **replaces** the modal body rather than layering a second dialog. | Design contract §6.2 forbids stacked modals, and `DocumentPreview`'s `@media print` rules target a single `.print-target` panel — a stack breaks the audit print path, not just the aesthetics. |
| **D-ROS9** | **The expiry columns read from the qualification rollup, never from `drivers.*_expires_at` as truth**, and editing one opens the existing `RequirementDrawer`, which writes a certification. | D-DQ6 stands: two sources of truth for a legal gate is the defect. The `drivers.*` columns are display fields, including when McLeod is the one writing them. |
| **D-ROS10** | **Vehicles and trailers reuse these components with their own catalogue, and are out of scope here.** | `documents.subject_type` and `certifications.subject_type` already accept `tractor` and `trailer` (`complianceContract.ts:17,65`), so the storage path generalises for free. What is missing is a §396.17 / registration / insurance catalogue — a separate plan, after the driver shape is proven. |
| **D-ROS11** | **No step in this plan may ship a workaround.** If a step is blocked by a missing capability, the capability is built or the step stops and the blocker is written into §6 — it is never routed around. | This plan exists because three previous workarounds compounded into "the product has too many pages". See the root `CLAUDE.md` rule added with this document. |
| **D-ROS12** | **The `fleet` section splits into `roster` (the people) and `equipment` (the trucks and trailers).** `APP_SECTIONS` loses `fleet` and gains both; every derived gate re-derives; `vehicles_write` / `trailers_write` are re-issued to the narrower list. Owner ruling, 2026-08-30 (§6 Q1). | `fleet` answered two different questions with one word, and every workaround in §2.3 is downstream of that. A safety manager must maintain the §391.51 file (`roster: manage`) without gaining the truck list (`equipment: view`); a recruiter must read the roster without seeing equipment at all. Neither is expressible while the two live under one section — which is why the previous fix was a hand-written helper that disagreed with the matrix. |

---

## 4. Execution protocol

**Resume ritual (a fresh chat starts here):**

1. Read this document top to bottom, then the root `CLAUDE.md`, `apps/web/CLAUDE.md`,
   `docs/DESIGN-SYSTEM-CONTRACT.md` §5 (tables) and §6 (drawers), and
   `docs/plans/safety-dqf/DQ-REDESIGN-PLAN.md` (D-DQ6 through D-DQ11 are still binding).
2. Establish reality, never assume it: `git log --oneline -15`, `git branch --show-current`,
   `pnpm verify:live`. Parallel chats share one working tree — branch from `origin/main`.
3. Find the first §5 step not marked **DONE**. Check its prerequisites. A missing prerequisite
   means stop and record it in §6; it never means work around it (D-ROS11).
4. One step per branch (`claude/<topic>`), PR to `main`, merge after CI. `main` is
   branch-protected; there is no other path.
5. When a step ships, mark it **— DONE \<date\> (PR #NNN)** in place with a "What shipped" list and
   a "Verified by:" line naming the gates actually run. **This document is the memory between
   sessions; the chat is not.**

**Rules every step is held to** (gate names verified against root `package.json`):

- 500-line file budget, 450 warn (`lint:filesize`). `DriversPage.vue` is at 493 — R2 exists because
  of this and must land before any column work.
- Features may not import another feature's internals (`lint:boundaries`). A documents modal on the
  roster is `roster` reaching into `compliance`: it needs a sanctioned placement, not an import.
- Raw `<button>` in `pages/` or `features/` is a red gate with zero tolerance (`lint:ui-adoption`),
  and the check is a regex over file text — naming the element in a comment trips it.
- Design tokens, radius, elevation, text size, stacking tier and column width are all linted
  (`lint:tokens`, D-DS4a/5/6/7a). No arbitrary values.
- A comment claiming test coverage must quote a real test title (`lint:comment-claims`).
- Schema changes are next-numbered migrations only, never edits to an applied one
  (`lint:migrations`); every new table gets RLS (`check-rls.mjs`); a new `drivers(id)` FK must be
  accounted for in `mergeDriver.ts` (`check-driver-references.mjs`).

---

## 5. Steps

### R0a — Split the `fleet` section into `roster` and `equipment` (D-ROS12; prerequisite for R0)

The whole change is **16 real call sites**, one migration and one gate edit. Measured 2026-08-30 —
the word "fleet" appears more often than that, but as a plain English noun (`HazmatCalculatorForm`'s
"From my fleet", `CpmReportPage`'s "Company total" tab, `IdleCostCard`), which must not be touched.

**The matrix.** `APP_SECTIONS` drops `fleet`, gains `roster` and `equipment`:

| role | roster | equipment | was (`fleet`) | note |
| --- | --- | --- | --- | --- |
| admin | manage | manage | manage | unchanged |
| fleet_manager | manage | manage | manage | unchanged |
| **safety_manager** | **manage** | **view** | manage | **the ruling.** Owns the §391.51 file; has no business editing trucks |
| dispatcher | view | view | view | unchanged in effect |
| auditor | view | view | view | unchanged in effect |
| **recruiter** | **view** | **none** | view | tightened — a recruiter never needed the equipment list |
| driver | none | none | none | unchanged |
| accountant | none | none | none | unchanged; accounting reads trucks through the API, which is service-role |

**Shared** (`packages/shared/src/auth.ts`): `APP_SECTIONS`, the eight `SECTION_ACCESS` rows,
`canWriteDriverLifecycle` → `canManageSection(role, "roster")`, `canArchiveDriver`'s first clause
likewise.

⚠ **`canManageFleet` is left EXACTLY as it is — not deleted, not re-pointed.** An earlier draft of
this step said "deleted here"; that was wrong and would have forced R0's 50-site web migration into
this PR. It is also not re-pointed at `canManageSection(role, "roster")`, which looks tidier and is
worse: that would flip `session.canManage` to true for a safety_manager across the whole web
*including the Vehicles and Trailers pages*, handing them edit buttons that the migration below is
simultaneously teaching the database to refuse. Leaving the helper frozen keeps the intermediate
state **bit-for-bit identical to today's web** and hands the divergence to R0, which is the step
scoped to fix it. This is a deliberately deferred removal, not a workaround (D-ROS11): the comment
above it names R0 as the remover, and R9's `lint:capabilities` fails the build if R0 does not.

**API — 9 call sites, all already derived**, so each is a one-word change:
`evidence/dqAlertScheduler.ts:25`, `evidence/routes/compliance.ts:59,60`,
`evidence/routes/complianceExports.ts:38`, `roster/routes/drivers.ts:76,89`,
`roster/routes/archive.ts:46`, `roster/routes/sevenDay.ts:40`,
`driver-app/routes/driverAppSettings.ts:46,47` — **all to `roster`**; none of them is about
equipment. Two comments also say "fleet" and must be corrected, not left to rot:
`psp/pspImport.ts:24` and `recruiting/employerInquiry.ts:309`.

While here (same PR, because they are the same decision): `roster/routes/credentials.ts:48` and
`roster/routes/drivers.ts:280,372,396` hand-list `requireRole("admin", "fleet_manager")`. Derive
them. They are four of the 98 hand-listed mounts in §1 and they sit in the file this step edits.

**Web — 5 nav entries** (`lib/nav.ts`): Driver Qualification `:145` and Drivers `:199` → `roster`;
Vehicles `:197`, Trailers `:198` and Odometer `:200` → `equipment`.

**SQL — one next-numbered migration.** There is **no `app_section` type in Postgres** (verified:
`grep app_section supabase/migrations/*.sql` is empty) — sections live only in TypeScript and are
mirrored into policies as role lists. So the migration is exactly the re-issue of the two policies
whose derived list actually changes:

- `vehicles_write` and `trailers_write` — currently `('admin','fleet_manager','safety_manager')`
  from `0078_role_department_rls.sql:29-31,39-41`, derived from `rolesThatManage("fleet")`. They
  become `rolesThatManage("equipment")` = `('admin','fleet_manager')`. **This is a deliberate
  revocation and the migration header must say so**: a safety_manager loses PostgREST write on
  vehicles and trailers. Risk is low and should be stated as measured — no product path reaches it
  today, because the web hides every write affordance from that role (`canManageFleet` is false),
  which is the same divergence this plan is closing.
- `drivers_write` needs **no change**: `0212_recruiter_grants.sql:25-26` set it to
  `('admin','fleet_manager','safety_manager','recruiter')`, which is exactly
  `rolesThatManage("roster")` plus 0212's deliberate by-name recruiter carve-out. Its comment should
  be updated to name the new section so the next reader can re-derive it.

**The gate — and the one genuine collision.** `scripts/check-section-policies.mjs` maps **module →
section**, and the `roster` *module* owns `drivers`, `vehicles`, `trailers`, `driver_time_off` and
`driver_vehicle_assignments` (`scripts/table-modules.json`). After the split that one module spans
**two** sections, which the map cannot express. Fix the map, not the module: module ownership is
about which code may write a table (`lint:boundaries`, `check-table-modules.mjs`) and is correct as
it stands; splitting the module to satisfy a permissions rename would be the workaround D-ROS11
forbids. Add a per-table override consulted before the module default, and put `vehicles` and
`trailers` in it. `--self-test` must still prove the detector fires.

**Two tables needed an explicit ruling rather than a default. ANSWERED 2026-08-30 (owner): both
`roster`.** `driver_vehicle_assignments` and `driver_time_off` are facts about a person — the truck
is the object of the sentence, not the subject. `driver_vehicle_assignments` is the closer call
because the assignment is *performed* from the Vehicles page, and the reasoning is recorded in the
migration header so the next reader can disagree with the argument rather than guess at it.

**Done when:** `grep -rn '"fleet"' packages/shared/src apps/api/src apps/web/src` returns only the
plain-English uses listed above; `rolesThatManage("equipment")` is `['admin','fleet_manager']` and
`rolesThatManage("roster")` is `['admin','fleet_manager','safety_manager']`, both asserted by a
test; a PGlite matrix proves a `safety_manager` JWT can still write `drivers` and can no longer
write `vehicles` or `trailers`, printing a `RESULT` line; `check-section-policies.mjs --self-test`
passes with the per-table override in place; `pnpm lint` and `pnpm test` green.

### R0 — Per-section capability in the web (prerequisite for R6, R7, R9)

Delete `session.canManage`. Add `session.can(section)` and `session.canView(section)` derived from
`canManageSection` / `canViewSection`. Change `requiresManage: true` route meta to name a section,
and `router/index.ts:84` to resolve it. Migrate all 50 call sites to the section they actually mean
— which requires reading each one, because today they all say "fleet" by accident, and R0a has just
made "roster" and "equipment" two different answers.

Prerequisite: R0a.

**Done when:** `canManageFleet` has no callers in `apps/web`; `session.canManage` does not exist; a
recruiter sees recruiting write affordances without a hand-rolled check; `routes/recruitment.ts:4`'s
⚠ comment is deleted because it is no longer true.

### R1 — McLeod driver dates reach `certifications` (highest priority; independent of all UI work)

Resolve §2.2 in whichever direction §6 Q2 is answered, and land it before any org turns on roster
sync. Whatever the direction, the surfaces must not be able to disagree: one function, two readers.

**Done when:** a PGlite matrix asserts that a McLeod-sourced CDL/medical expiry and the DQ file's
view of the same requirement cannot diverge, printing a `RESULT` line; the hazmat gate's behaviour
on a McLeod-mastered org is pinned by a test.

### R2 — Extract `DriverRosterTable.vue` from `DriversPage.vue`

Mechanical, no behaviour change. `DriversPage` is at 493 of 500; nothing else in this plan can be
added to it. The extracted table is also what Vehicles and Trailers reuse under D-ROS10.

While extracting: `qualBadge()` does an O(n) `.find()` per row per render over the overview array.
Build the lookup once as a `Map` — three more columns off the same array would make it quadratic on
a 200-driver roster.

**Done when:** `DriversPage.vue` is under 450; `pnpm test` and `lint:filesize` green; the rendered
table is byte-identical in a snapshot test.

### R3 — Column management in `DataTable` (D-ROS3)

Column picker, per-user column visibility, saved views, and horizontal scroll that keeps the primary
column pinned. This is the monday.com half worth taking, and it is what makes a 40-column roster
usable rather than merely wide.

Blocked on §6 Q3 (where a saved view is stored).

**Done when:** column choice survives a reload; a saved view is shareable or explicitly not, per
Q3's answer; the pinned primary column is keyboard-reachable; `DataTable`'s doc comment documents
the new API the way it documents the existing one.

### R4 — The four roster columns (D-ROS9)

CDL expiry, medical expiry, hazmat endorsement expiry, and the file column. All four read from the
existing `GET /api/compliance/overview` rollup — no new query and no second computation. Date cells
show urgency tone from `lib/badges.ts` and open `RequirementDrawer` scoped to that requirement.

Prerequisites: R1 (or the columns will render the disagreement), R2, R3.

**Done when:** the three dates and the qualification badge cannot disagree, because they derive from
one rollup; a `lint:comment-claims`-valid comment on the column definition says so and names the
test that proves it.

### R5 — The documents modal (D-ROS8) — the "DQF folder" the ask asked for

One driver, every scan, per-file download, `n/20` filed on the cell. Needs a `documentCount` on the
overview response — not a per-row fetch, or the roster costs 200 signed-URL round trips on load.
Opening a scan replaces the modal body; it never stacks.

Prerequisites: R4, and a placement that satisfies `lint:boundaries`.

**Done when:** the audit print path still works from the preview; no two dialogs are ever open at
once; a 200-driver roster issues one document-count query, asserted by `supabaseRecorder`.

### R6 — The driver record page: tabs → sections, read → editable (D-ROS4, D-ROS5)

Six tabs become one scrolling page of `SettingsSection` blocks: Identity & contact, Licence &
medical, Employment & pay, Qualification file, Files, Fuel. Each section is editable in place with
its own Save, and each states its provenance. An edit that would set `identity_source: 'manual'`
says so before Save, not after.

`?section=` keeps every existing value and keeps resolving — an anchor scroll, not a tab switch, so
no bookmark and no notification breaks.

Prerequisites: R0.

**Done when:** `driverSections.test.ts` still passes unchanged for every existing value; a
telematics-owned row shows the claim warning before it is claimed; `resolveDriverUpdate`'s two flags
are both surfaced to the user.

### R7 — Recruiting leaves the driver page (D-ROS6)

`ApplicationInviteCard`, `DispositionSection`, `EmploymentHistorySection`, `EmployerInquirySection`,
`PspRecordsSection` move to the recruitment surface. `SevenDayStatementSection` stays — it is a
§395.8(j)(2) record about employment, not about hiring.

Prerequisites: R0 (without it, the same workaround reappears in a new place).

**Done when:** `PspRecordsSection.vue:34`'s workaround comment is deleted because the reason is
gone; `?section=application`, `?section=employment`, `?section=screening` still resolve, redirecting
to their new homes; the three inbound links point at the new destinations.

### R8 — Retire what is now redundant

With R4–R7 landed, re-examine `CompliancePage`, `ScreeningReadinessPage` and `InquiryQueuePage`
against the roster grid + saved views. Some are genuinely fleet-wide queues that a per-driver page
cannot replace; some are a saved view wearing a page. Decide **per page, with the inbound links
enumerated**, and redirect rather than delete.

**Done when:** every retired path 301s to its replacement; `notificationRoute.ts` still resolves
every category it claims to; no bookmark 404s.

### R9 — Gate the decisions (D-ROS2, D-ROS7, D-ROS11)

A `lint:capabilities` script that fails on: `canManageFleet` used anywhere in `apps/web`; a
`requiresManage` that does not name a section; a driver field edited inline that is not in
`DRIVER_INLINE_EDITABLE`. `--self-test` proves the detector fires, per house convention.

**Done when:** the gate is in CI's list and its `"//lint:capabilities"` sibling comment in root
`package.json` explains it, per the documented convention.

---

## 6. Open questions — answer before the step that needs them

~~**Q1 — `safety_manager` and `fleet: manage`: which side is wrong?** (blocks R0)~~
**ANSWERED 2026-08-30 (owner):** neither — **`fleet` splits into `roster` and `equipment`.** The
section was too coarse; it conflated the people with the trucks, and every workaround downstream of
it inherited that. Specified as **D-ROS12** and built as **R0a**, which now precedes R0.

**Q2 — When McLeod is roster master, who owns CDL and medical expiry?** (blocks R1)
Three candidate answers, and they are not equivalent:
- (a) McLeod's sweep also writes a `certifications` row through `insert_certification`, so the
  carrier's system of record feeds the gate. Truthful, and the supersede chain records each sweep.
  Risk: a chatty sync writing evidence rows.
- (b) `drivers.*_expires_at` stays display-only and the office still files the certification, with
  the roster surfacing the mismatch as a data-gap. Safest, most manual.
- (c) `buildDqFile` treats a McLeod-sourced column as evidence of a *stated* date but not a
  *documented* one — a distinct state, since §391.51(b)(6) wants the artifact, not the date.
- **My reading:** (c) is the most honest to the regulation and (a) is the most useful day to day;
  (b) is the safe interim. Owner ruling needed, and it is worth writing down before McLeod goes on
  for a second org.

**Q3 — Saved views: per user, per org, or both?** (blocks R3) Storage, sharing, and whether a view
is a URL. A view that cannot be linked to is half a feature; a view stored per org needs a policy.

**Q4 — What exactly is in `DRIVER_INLINE_EDITABLE`?** (blocks R2's cell affordances)
Candidates with no sync owner and no legal consequence: `employee_id`, `phone_alt`,
`emergency_contact_*`, `eld_id`. Explicitly **not**: any `DRIVER_IDENTITY_FIELDS` member, `status`,
`termination_date`, `hire_date`, `date_of_birth`, `pay_*`, anything McLeod writes.

**Q5 — Does the ask survive this plan?** The original request was to delete `/drivers/:id`. This
plan keeps it and instead deletes six tabs, one global boolean and (at R8) probably two pages. If
the owner still wants zero detail page after reading §2.1 and §2.3, then §6 Q6 is: where does a
`dq_*` notification land, where does the auditor print from, and what happens to the six inbound
deep links. Those are answerable — but they must be answered, not assumed.

---

## 7. What shipped

Nothing yet. This section is the register; each step writes its own entry here when it merges.
