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

**Status: R0a, R1 and R0 all shipped 2026-08-30 (PRs #392, #393, #394; migration 0277 applied to
production). R2 is next.** Everything else is unstarted; §7 is the register, §1's measurements are
the pre-R0a baseline kept as measured, and `HANDOFF-2026-08-30.md` beside this file carries the
traps a fresh session would otherwise rediscover.

---

## 1. Measured reality (2026-08-30, `main` at 704c64e)

Counted, not estimated. Anything below that turns out to be wrong should be corrected **in place**
in this document, with the date.

| Fact | Value | Where |
| --- | --- | --- |
| Distinct columns on `drivers` | ~~43~~ → **58** | ~~migrations sweep~~ → **corrected 2026-08-30** against production `information_schema.columns`. The migrations sweep undercounted by 15; the live table is the authority. |
| Drivers on the production roster | **287 live** (288 total, 185 with a Samsara id, **1** with an app login) | production, 2026-08-30 |
| Office accounts that exist at all | **6 memberships in 2 orgs** — 5 `admin`, 1 `driver` | production, 2026-08-30 |
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
| **D-ROS13** | **`settings` is a section**, holding the sites that mean "may configure the product". Membership is exactly the deleted `canManageFleet` set. | Backfilled into this table 2026-08-30 — it was ruled and shipped in R0 but recorded only in §7, and a decision that lives only in a shipped-note is one the next reader re-litigates. |
| **D-ROS14** | **A saved view IS a named URL.** The query string is the only description of what is on screen; a view record holds a name and that query string and nothing else. Applying a view is a navigation; sharing one is a link. | The alternative is a second description of the same state, which then has to be kept in step with the first. `useSpendFilters.ts:10-20` already made this ruling for the fuel-spend page and wrote down why ("state that dies on refresh cannot be linked"), and `?section=` is already a public surface under D-ROS5. A second mechanism would be a copy, and a copy is a workaround with a delay fuse (D-ROS11). |
| **D-ROS15** | **A preference is device-local; an artefact the user authored is a row.** Column choice, sort and page live in the URL and fall back to `localStorage` per table. A *named* view is a row, because losing it loses work. | Derived from the two precedents rather than invented: `useColorScheme` and `useSidebarSections` are `localStorage` because only the browser ever asks and losing them costs one click; `notification_preferences` is a table because the API reads it. A named view is neither — it is content, and it has to survive a new laptop. |
| **D-ROS16** | **The carrier-standard views ship as BUILT-IN definitions in `@silvicom/shared`**, per table, identical for every org and stored nowhere. Personal saved views sit on top of them and are private. | Measured 2026-08-30: production has 2 orgs and 6 memberships, 5 of them `admin` in one org — there is no `safety_manager`, `recruiter` or `dispatcher` account in existence. An org-sharing policy would be a schema column, an RLS clause and a role ruling built for a population that does not exist, while the views everyone actually needs ("medical expiring in 30 days") are the same for every carrier and derivable from the §391.51 catalogue the product already models. |
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

### R0a — Split the `fleet` section into `roster` and `equipment` (D-ROS12; prerequisite for R0) — **DONE 2026-08-30 (PR #392, migration 0277)**

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

### R0 — Per-section capability in the web — **DONE 2026-08-30 (PR #394, no migration)**

Delete `session.canManage`. Add `session.can(section)` and `session.canView(section)` derived from
`canManageSection` / `canViewSection`. Change `requiresManage: true` route meta to name a section,
and `router/index.ts:84` to resolve it. Migrate all 50 call sites to the section they actually mean
— which requires reading each one, because today they all say "fleet" by accident, and R0a has just
made "roster" and "equipment" two different answers.

Prerequisite: R0a.

**Done when:** `canManageFleet` has no callers in `apps/web`; `session.canManage` does not exist; a
recruiter sees recruiting write affordances without a hand-rolled check; `routes/recruitment.ts:4`'s
⚠ comment is deleted because it is no longer true.

### R1 — McLeod driver dates reach `certifications` — **DONE 2026-08-30 (PR #393, no migration)**

Resolve §2.2 in whichever direction §6 Q2 is answered, and land it before any org turns on roster
sync. Whatever the direction, the surfaces must not be able to disagree: one function, two readers.

**Done when:** a PGlite matrix asserts that a McLeod-sourced CDL/medical expiry and the DQ file's
view of the same requirement cannot diverge, printing a `RESULT` line; the hazmat gate's behaviour
on a McLeod-mastered org is pinned by a test.

### R2 — Extract `DriverRosterTable.vue` from `DriversPage.vue` — **DONE 2026-08-30 (PR #396, no migration)**

Mechanical, no behaviour change. `DriversPage` is at 493 of 500; nothing else in this plan can be
added to it. The extracted table is also what Vehicles and Trailers reuse under D-ROS10.

While extracting: `qualBadge()` does an O(n) `.find()` per row per render over the overview array.
Build the lookup once as a `Map` — three more columns off the same array would make it quadratic on
a 200-driver roster.

**Done when:** `DriversPage.vue` is under 450; `pnpm test` and `lint:filesize` green; the rendered
table is byte-identical in a snapshot test.

### R3 — Column management and saved views (D-ROS3, D-ROS14/15/16)

**Split into three steps, for two reasons found by measurement on 2026-08-30:**

1. **`DataTable.vue` is 454 lines against the 500-line budget** (`lint:filesize`, warns at 450).
   A column picker, a pinned column and a view control do not fit in 46 lines. R3 begins with an
   extraction for exactly the reason R2 did, and skipping it would be R2's problem again one file
   over.
2. **Two of the four things R3 was going to build already exist**, one of them three times. See
   R3b. The step is smaller than it looked, and mostly about *promoting* what is there.

#### R3a — Promote the URL-state buffer to `@/composables` — **DONE 2026-08-30 (PR #397, no migration)**

D-ROS14 makes the URL the description of a view, so every table needs to write several query
parameters at once without losing any. That primitive exists — and only inside
`features/reconcile/useSpendFilters.ts`, whose `pending` buffer was written to fix a real bug: two
filters set in one tick both read the same pre-navigation `route.query` and the second `replace`
silently dropped the first. The visible symptom was a date picker welded to the last 90 days.

A `roster` surface may not import a `reconcile` internal (`lint:boundaries`), and
`check-feature-boundaries.mjs` says in its own comment what to do about that: **promote the shared
thing out of `features/`, do not allow-list the leak.** So the buffer moves to
`@/composables/useQueryState.ts` and `useSpendFilters` becomes its first caller.

**Done when:** `useSpendFilters.test.ts` passes unchanged — including the one-tick collision case it
exists to pin — with the buffer no longer inside the file it is testing; `lint:boundaries` green.

#### R3b — `DataTable` column management (D-ROS3, D-ROS15) — **DONE 2026-08-30 (PR #398, no migration)**

**What already exists and must not be rebuilt:** horizontal scroll (`DataTable.vue:366`,
`overflow-x-auto`), and the pinned first column — which is real, works, and is **hand-rolled
identically on three pages** (`FuelLogPage`, `TransactionsPage`, `RejectionsPage`) as a copied pair
of `sticky left-0 …` class strings on `headerClass`/`cellClass`. Two copies of a value is a
workaround with a delay fuse (D-ROS11); three is a pattern the component should own. R3b promotes it
to a prop and deletes the copies.

**What is new:** a column picker, and the choice persisting per person per table.

The opt-in is **one new prop, `tableId`** — never a new field on `DataTableColumn`. DataTable's own
docblock already settled this shape for the status-column convention: *"49 column arrays already
exist, and a flag none of them set would be a migration disguised as an option."* There are now 62
consumers, so the argument is stronger, not weaker. Hideability is derived: the first column is the
identifier and is always shown; everything else may be hidden.

Column choice lives in the URL (`?cols=`), falling back to `localStorage` keyed by `tableId` when the
URL is silent (D-ROS15) — which is what makes a saved view able to capture columns in R3c without any
further plumbing. The picker goes in `FilterBar`'s existing `#actions` slot (design contract §5.5);
no new toolbar layout.

**Done when:** `DataTable.vue` is back under 450; the three hand-rolled pinned columns are deleted
and those pages render unchanged (snapshot them first, as R2 did); column choice survives a reload
and a link; the pinned column is keyboard-reachable; DataTable's docblock documents the new props
the way it documents the existing ones.

#### R3c — Saved views (D-ROS14/16)

A view is a name plus a query string. Built-ins ship in `@silvicom/shared` and are stored nowhere;
personal views are rows the signed-in user owns.

**Split in two, because of a prerequisite this plan did not have.** Measured 2026-08-30: the
roster's search, status, archived toggle, sort and page were **component refs, not URL parameters**.
A saved view built on that could have captured the columns and nothing else — which is the "half a
feature" §6 Q3 warned about, arrived at from the other direction. It also meant the one thing an
office does with a filtered roster, send it to somebody, was impossible.

##### R3c-1 — the roster's filters move into the URL — **DONE 2026-08-30 (PR #399, no migration)**

##### R3c-2 — saved views themselves — **DONE 2026-08-30 (PR #400, migration 0278)**

- `packages/shared` — the built-in catalogue per table, and the contract for a saved view.
- One migration: `saved_views` (module `org`, layer `core`), `primary key (user_id, table_id, name)`,
  `org_id` FK + `forbid_org_change` trigger, RLS `org_id = auth_org_id() AND user_id = auth_user_id()`
  — the `notification_preferences` shape, which is the nearest precedent and already passes every gate.
- Writes through the API (`org` module); the web reads its own rows.
- A "Views" control beside the column picker in `FilterBar`'s `#actions`.

**Done when:** applying a view is a navigation and the URL afterwards IS the view; a built-in view
needs no row; saving, renaming and deleting a personal view works and is org-scoped in the test
matrix; a PGlite matrix proves another org's user cannot read the rows — and models `auth.users`
first, or the FK will fail the write indistinguishably from an RLS refusal (HANDOFF-2026-08-30 §3).

### R4 — The roster columns (D-ROS9)

CDL expiry, medical expiry, hazmat endorsement expiry, and the file column. All read from the
existing `GET /api/compliance/overview` rollup — no new query and no second computation.

Prerequisites: R1 (or the columns will render the disagreement), R2, R3.

**Split in two, and two things in the original text turned out not to be buildable as written:**

- **The rollup could not supply the dates.** `dqAttention` filters to `state !== "current"`, because
  its job is a queue of things to DO — so the rollup carried no date for the driver whose CDL is
  perfectly fine, which is most of them. Measured on the real shape before building (2026-08-31).
  The fix is a projection of the same `DqFileSummary`, not a second calculation: **R4a**.
- **"open `RequirementDrawer` scoped to that requirement" is the R5 boundary problem, early.**
  `RequirementDrawer` lives in `features/compliance` and a `roster` component may not import it
  (`lint:boundaries`) — the same violation §4 already records for R5's documents modal. The date
  cells therefore **navigate** to `/drivers/:id?section=qualification`, which is D-ROS1 ("the grid
  reads and navigates") and D-ROS5 ("`?section=` is a public surface") agreeing with each other.
  A promoted drawer is a capability question, not a rider on a column.

#### R4a — the three expiry columns — **DONE 2026-08-31 (PR #401, no migration)**

#### R4b — the rollup filters, and the built-in view catalogue they unblock — **DONE 2026-08-31 (PR #402, no migration)**

The filters R3c-2 recorded as missing: expiry horizon and qualification state as query parameters,
so `BUILT_IN_VIEWS` in `packages/shared/src/savedViewContract.ts` becomes expressible and lands as a
data change. See that file's closing note for the three views and what each needs.

**Done when:** the three dates and the qualification badge cannot disagree, because they derive from
one rollup; a `lint:comment-claims`-valid comment on the column definition says so and names the
test that proves it.

### R5 — The documents modal (D-ROS8) — the "DQF folder" the ask asked for

One driver, every scan, per-file download, the count filed on the cell. Opening a scan replaces the
modal body; it never stacks.

Prerequisites: R4, and a placement that satisfies `lint:boundaries`.

**Split, because the prerequisite is a step of its own and two of the step's own notes were wrong:**

- **The count needs NO new query and no `documentCount` column.** `buildDqFile` already resolves
  `documentId` per item while computing the file, so the count is a fold over work the rollup has
  done anyway. The warning about "200 signed-URL round trips" was about a design nobody has to build.
- **The denominator is not 20.** `n/20` would measure every driver against the whole catalogue, so a
  carrier without the hazmat module — or a non-CDL driver — would read as permanently behind on
  requirements nobody asks of them. It is `n / items that apply to this driver`.

#### R5a — the placement, and the count — **DONE 2026-08-31 (PR #403, no migration)**

#### R5b — the modal itself, and the roster's file cell — **DONE 2026-08-31 (PR #404, no migration)**

**Done when:** the audit print path still works from the preview; no two dialogs are ever open at
once; the roster issues NO extra query for the count — asserted as a constant, not a small number.

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

**Split, because two thirds of the Done-when turned out to describe a LIVE DEFECT rather than a
missing feature.** The roster's own edit drawer never called `resolveDriverUpdate` at all — see
R6a. The layout change is R6b and is the smaller half.

#### R6a — the roster's edit becomes the audited one — **DONE 2026-08-31 (PR #405, no migration)**

#### R6b — tabs become sections on one scroll — **DONE 2026-08-31 (PR #407, no migration)**

### R7 — Recruiting leaves the driver page (D-ROS6) — **DONE 2026-08-31 (PR #406, no migration)**

⚠ **R7 runs BEFORE R6b, and the plan's numbering had it the other way round.** `DriverDetailPage`'s
own docblock records U6/D-UI7: those four recruiting sections WERE on one scroll — "roughly a
thousand lines of UI spanning §391.21's application, §391.21(b)(10)'s history, §391.23's
investigation and a PSP vendor ledger" — and that was the defect tabs were introduced to fix. R6b's
own section list (Identity & contact, Licence & medical, Employment & pay, Qualification file, Files,
Fuel) contains no recruiting, so it already assumes this step has happened. Doing R6b first would
have put that thousand lines straight back onto one scroll and reversed a recorded decision.

`ApplicationInviteCard`, `DispositionSection`, `EmploymentHistorySection`, `EmployerInquirySection`,
`PspRecordsSection` move to the recruitment surface. `SevenDayStatementSection` stays — it is a
§395.8(j)(2) record about employment, not about hiring.

Prerequisites: R0 (without it, the same workaround reappears in a new place).

**Done when:** `PspRecordsSection.vue:34`'s workaround comment is deleted because the reason is
gone; `?section=application`, `?section=employment`, `?section=screening` still resolve, redirecting
to their new homes; the three inbound links point at the new destinations.

### R8 — Retire what is now redundant — **DONE 2026-08-31 (PR #PENDING, no migration)**

With R4–R7 landed, re-examine `CompliancePage`, `ScreeningReadinessPage` and `InquiryQueuePage`
against the roster grid + saved views. Some are genuinely fleet-wide queues that a per-driver page
cannot replace; some are a saved view wearing a page. Decide **per page, with the inbound links
enumerated**, and redirect rather than delete.

**Done when:** every retired path 301s to its replacement; `notificationRoute.ts` still resolves
every category it claims to; no bookmark 404s.

### R9 — Gate the decisions (D-ROS2, D-ROS7, D-ROS11) — **DONE 2026-08-31 (PR #408, no migration)**

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

~~**Q2 — When McLeod is roster master, who owns CDL and medical expiry?** (blocks R1)~~
**ANSWERED 2026-08-30 (owner): option (a)** — the McLeod sweep writes a `certifications` row through
`insert_certification`, so the carrier's system of record feeds the gate. Built as R1.

Two consequences the ruling carries, both to be held in the implementation rather than argued again:

- **The sync must write only on CHANGE.** `insert_certification` unconditionally inserts and
  supersedes, so a naive per-sweep call adds one row per driver per sweep to an append-only table
  pinned in `RETENTION_FORBIDDEN` — forever, and unprunable by design. "Risk: a chatty sync writing
  evidence rows" is therefore not a risk to accept but an invariant to enforce, and it belongs to
  `evidence` as the owner rather than to `mcleod` as the caller (D-ARC3).
- **Option (c)'s concern survives the ruling and becomes Q6.** `buildDqFile` computes
  `present = Boolean(cert ?? record)` (`dqFile.ts:320`), so a McLeod-sourced date flips the medical
  card to `current` with **no scan on file** — while §391.51(b)(6) wants the artifact, not the date.
  Choosing (a) does not make that untrue; it decides where the date comes from, not what the file
  may claim. See Q6.

~~**Q3 — Saved views: per user, per org, or both?** (blocked R3)~~
**ANSWERED 2026-08-30 (owner): per user, plus built-in views.** Specified as **D-ROS14/15/16** and
built as R3a–R3c. The three halves of the question came apart once each was measured:

- **"Is a view a URL?" — yes, and that answers the sharing half too.** The URL already is the
  linkable, forwardable, hand-editable description of a view (`useSpendFilters`, `?section=`). So a
  saved view stores a *name and a query string*, and "share this view with Dave" is a link, not a
  schema feature. What an org-shared *record* adds over that is discoverability, not sharing.
- **"Per org?" — there is nobody to share with.** Production, measured 2026-08-30: **2 orgs, 6
  memberships, 5 of them `admin` in one org, plus 1 driver.** No `safety_manager`, no `recruiter`,
  no `dispatcher` exists. A `shared` flag needs a policy for who may create, edit and delete one,
  and that policy would be written for a population that does not exist.
- **But the need behind "per org" is real, and built-ins serve it without a policy.** What a carrier
  actually wants on day one is "medical expiring in 30 days" / "no app login" / "unassigned" — the
  same three views for every carrier, derivable from the §391.51 catalogue the product already
  models. Those ship in `@silvicom/shared` (D-ROS16). Nobody rebuilds them, and nothing is stored.

**Deliberately NOT built, and the trigger that would change it:** org-shared saved-view records. Ask
again when a second non-admin role exists in a real org and a carrier asks for a view *list* their
team shares — not before. The table is designed so adding `shared boolean` later is one column and
one RLS clause, and the primary key is the only thing that would have to move.

**Q7 — Is a LAPSED requirement "due"?** (found by R4b; blocks nothing, but the two answers are on
screen together today)
`buildAttentionStrip`'s tile counts `soonest >= 0 && soonest <= days` — future-dated only. The filter
that same tile APPLIES excludes only `soonest > days`, so it also admits the overdue. The tile
therefore reads "Due in 30 days: 2" and opens a list of 3.
- **My reading:** the filter is right and the tile is wrong. An item that lapsed last week is the
  most due thing on the list, and a count that excludes it under-reports the work. But it is a
  compliance-screen number a safety manager may already be quoting, so it is a ruling rather than a
  tidy-up. Both behaviours are preserved exactly and pinned by "disagrees with the attention tile
  that sets it, for the overdue driver (recorded, not endorsed)" in `QualificationFleetTable.test.ts`.

**Q8 — Where does a driver get EDITED, now that the record page is one scroll?** (raised by R6b)
D-ROS1 says "the record page writes", and R6a made the roster drawer audited, honest and
claim-warning — so the product now has one good editor in the place D-ROS1 says is the wrong one.
R6's prose wants editable sections on the record page, which would be a second editor unless the
drawer's job MOVES rather than being copied.
- **My reading:** move it. The drawer stays for the roster's quick status change; the record page
  gains the field-level editing, and `DRIVER_INLINE_EDITABLE` (Q4) decides which fields the ROSTER
  GRID may touch at all. Answer Q4 and Q8 together — they are the same question asked at two
  altitudes, and answering either alone produces the duplication.

**Q4 — What exactly is in `DRIVER_INLINE_EDITABLE`?** (blocks R2's cell affordances)
Candidates with no sync owner and no legal consequence: `employee_id`, `phone_alt`,
`emergency_contact_*`, `eld_id`. Explicitly **not**: any `DRIVER_IDENTITY_FIELDS` member, `status`,
`termination_date`, `hire_date`, `date_of_birth`, `pay_*`, anything McLeod writes.

**Q6 — May the DQ file read `current` on a date with no scan behind it?** (raised by Q2's ruling;
does not block R1)
`buildDqFile` treats any certification as presence, and R1 will start creating certifications from a
TMS field rather than from a document. So a driver whose medical card McLeod knows about, but whose
scan nobody has filed, will read `current` — and §391.51(b)(6)(i) wants the certificate in the file,
legible. The file already computes `documentId: null` per item, so the information to tell the two
apart exists and is simply not rendered.
- **My reading:** the honest fix is a `documented` flag distinct from `present`, surfaced as its own
  state on the item ("date on file, scan missing") rather than as a second kind of `missing`. That is
  a `@silvicom/shared` change touching the queue, the roster columns and the binder, so it is its own
  step and not a rider on R1. R1 will therefore stamp every synced row with a `notes` line naming
  McLeod as the source, so the rows are identifiable when this is answered.

**Q5 — Does the ask survive this plan?** The original request was to delete `/drivers/:id`. This
plan keeps it and instead deletes six tabs, one global boolean and (at R8) probably two pages. If
the owner still wants zero detail page after reading §2.1 and §2.3, then §6 Q6 is: where does a
`dq_*` notification land, where does the auditor print from, and what happens to the six inbound
deep links. Those are answerable — but they must be answered, not assumed.

---

## 7. What shipped

### R0a — the section split — 2026-08-30, PR #392, migration 0277

- `APP_SECTIONS` carries `roster` and `equipment` in place of `fleet`; 11 sections × 8 roles.
  `safety_manager` is `roster: manage` + `equipment: view` — the ruling. `recruiter` drops to
  `equipment: none`, a narrowing the old single section could not express.
- 9 already-derived API call sites re-pointed at `roster`; 2 stale comments corrected. 5 web nav
  entries now ask the question they mean.
- `0277` re-issues `vehicles_write` / `trailers_write` to `rolesThatManage('equipment')`. This is a
  **revocation** — `safety_manager` loses PostgREST write on both — and the header says so, with the
  measurement that no product path reaches that capability today.
- `check-section-policies.mjs` gained `TABLE_SECTIONS`, a per-table override consulted before the
  module default, because the `roster` module legitimately spans both sections after the split. The
  module was NOT split to match: module ownership answers "which code may write this" and section
  membership answers "which role may act here", and bending the former to satisfy the latter would
  have been the workaround D-ROS11 forbids.

**Deviations, both deliberate and both recorded in the code:**

1. The four hand-listed `requireRole("admin","fleet_manager")` roster mounts were **not** derived,
   though this step said to derive them. `rolesThatManage("roster")` contains `safety_manager`, so
   deriving would have silently widened credential issuing, driver-app invitation and the
   irreversible `merge_driver`. They keep the narrow list and now carry the reason. A section grants
   the section; an act that cannot be undone is granted by name.
2. `canManageFleet` is **frozen**, not deleted — this step's original text said "deleted here", which
   would have dragged R0's 50-site web migration into the same PR. Re-pointing it at `roster` was
   also rejected: it would flip `session.canManage` true for a safety_manager across the whole web,
   handing them edit buttons on Vehicles that 0277 simultaneously teaches the database to refuse.
   Removal is R0's job and the comment above the helper names R0 as the remover.

**A harness bug the new matrix caught on the way in**, worth knowing before writing the next one:
`drivers` and `vehicles` carry audit triggers whose `audit_logs.actor_id` is a real FK, so a
synthetic JWT `sub` with no `auth.users` row fails those writes **indistinguishably from an RLS
refusal**. `trailers` has no such trigger and was the only table passing, which is how it surfaced.
A matrix that asserts only refusals would have gone green on a revocation that never happened.

**Verified by:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (all suites and matrices);
`supabase/tests/equipment-section-split.test.mjs` 16/16, pinning both halves of the split against
each other; `check-section-policies.mjs --self-test`, extended so a typo in the override map cannot
go blind. Both new gates were **negative-tested**: reinstating `safety_manager` in 0277 drops the
matrix to 14/16 and fails the policy gate through the override path.

### R1 — TMS credentials become evidence — PR #393, 2026-08-30, no migration

Answers Q2 with option (a). What the research changed about the framing: this is not a McLeod
problem, it is **D-ARC3's dual-source finding** — `ARCHITECTURE.md` §3 calls it the audit's sharpest
finding — and the sweep is what turns a dormant defect into a visible one, because it writes
`drivers.cdl_expires_at` and `medical_card_expires_at` on every pass while `certifications` is the
only table the gate and `buildDqFile` read.

- `evidence.recordSyncedCredentials` — the owner's interface, on the `recordInferredTrailerPairing`
  model (collector holds the vendor fetch, owner holds the invariant). New narrow boundary edge
  `"mcleod -> evidence"`.
- **The invariant is write-only-on-change**, and it is the reason this is a function rather than
  three lines in the sweep: `insert_certification` supersedes unconditionally, so a nightly loop
  would add ~120,000 rows a year to an append-only table pinned in `RETENTION_FORBIDDEN`, burying
  the supersede chain an auditor came to read.
- Filing **inherits** the sweep's ownership decision: `applyOutcome` returns a row id only when it
  actually applied a patch, so an office-claimed row, an ambiguous match and a report-mode pass file
  nothing. Four of the five wiring tests are that rule.
- A failed filing is counted, never thrown — one bad credential must not strand the rest of the
  roster mid-sweep.
- `insertCertification`'s `userId` became `string | null`. 0127's `created_by` was always nullable;
  the signature now says what the column said, rather than making a machine caller cast a user id.

**Left open on purpose — Q6.** A row filed here reads `current` with no scan behind it. Every synced
row carries `SYNC_NOTE` so the fix can find them.

**Verified by:** `pnpm test` (all suites and matrices), `pnpm typecheck`, `pnpm lint`,
`lint:boundaries`, `lint:table-writers`, `lint:table-producers`; 11 unit tests at the seam and 5
wiring tests in `rosterIngest.test.ts`.

### R0 — per-section capability in the web — 2026-08-30, PR #394, no migration

`session.canManage` deleted. All 50 call sites now name the section whose **API gate they actually
call** — each was read rather than pattern-matched, and two came back other than expected: the
assignments end-shift is `dispatch` (a driver-shaped row on a dispatch board), and Data & sync gates
on `admin, fleet_manager` at the API rather than `admin`, so mapping it to the `admin` section would
have made the UI stricter than the API and removed a real capability.

Distribution: dispatch 14, roster 10, equipment 8, safety 3, hazmat 2, recruitment 2, fuel 1,
settings 10.

- **`settings` is a new section (D-ROS13)**, holding the ten sites that meant "may configure the
  product" — the Settings directory, Data & sync, the sidebar link, the dashboard export. Membership
  is EXACTLY the deleted `canManageFleet` set, so no role's access changed: R0's job was to say what
  the call sites meant, not to re-decide who may do what. The alternative was keeping a helper that
  answers a question no section asks, which is how the matrix and the web drifted apart in the first
  place.
- **`requiresManage` names a section and `RouteMeta` is typed.** It was a bare `true` on untyped
  meta; a misspelled section is now a compile error rather than a route that silently admits
  everybody. That is what let `routes/recruitment.ts` delete its ⚠ workaround comment — the gate
  those routes could never use now exists and says the right thing.
- Two comments corrected rather than left to rot: `DriverDetailPage`'s record that PSP sits on the
  driver page because of `canManageFleet` (a layout decision made by a permission bug — moving it is
  R7, now a choice), and the Driver App settings card, which now gates on `roster` like its route and
  its endpoint instead of agreeing with them by accident.
- `routeTable.test.ts` did the job it exists for: six `true`s became six named sections, nothing
  gained or lost a gate.

**Verified by:** `pnpm test` (all suites and matrices), `typecheck`, `lint`, `lint:filesize`,
`lint:funcsize`, `lint:boundaries`, `lint:ui-adoption`, `lint:comment-claims`, `lint:tests`,
`lint:table-writers`.

### R2 — the roster table leaves the page — 2026-08-30, PR #396, no migration

`DriversPage.vue` 493 → **335 lines**; `features/roster/DriverRosterTable.vue` is 243. R4's four
columns now have somewhere to go, and under D-ROS10 so do the vehicle and trailer rosters.

- **The split is table vs. list state, not "move some code".** The component owns the columns, the
  cells, the row menu and the two lookups the cells need; the page keeps search, filter, sort and
  paging, because it owns the toolbar that drives them. Rows arrive already filtered, sorted and
  sliced — two places deciding which twenty rows are on screen is exactly the bug an extraction is
  meant to remove rather than introduce.
- **Both per-row scans became a `Map`, not just the one the plan named.** `qualBadge()` did an O(n)
  `.find()` over the rollup per row per render; `assignedUnits()` did an O(n) `.filter()` over the
  whole vehicle list, for the same reason and with the same cost. Fixing one and leaving the other
  would have left R4 adding three more columns beside a defect the step had already looked at.
- **The snapshot was taken before the move, and did not change.** `DriversPage.test.ts` mounts the
  page over a fixture built to be awkward — one driver with every field set, one with almost none,
  one archived — and pins the rendered `<table>` for both the live and archived views. It was proven
  able to fail (renaming one column header breaks both snapshots) before it was trusted. The row
  menu teleports out of the table, so the Archive/Restore branch is pinned by its own assertion.
- **No deviations.** The extraction moved code and comments verbatim; the only edits are the two
  `Map` lookups and the props/emits seam. `lint:ui-adoption` was checked directly on the moved ⚠
  comment that contains the word "button" — the gate matches the tag, not the noun, so the comment
  stayed as written.

**Verified by:** `pnpm test` (all suites and matrices), `typecheck`, `lint`, `lint:filesize`,
`lint:funcsize`, `lint:boundaries`, `lint:ui-adoption`, `lint:tokens`, `lint:comment-claims`,
`lint:tests`, `lint:table-writers`.

### R3a — the URL-state buffer becomes a capability — 2026-08-30, PR #397, no migration

`@/composables/useQueryState.ts` (78 lines). `useSpendFilters.ts` 161 → 127 and is now its first
caller rather than its owner.

- **This is the promotion `check-feature-boundaries.mjs` asks for, not a copy.** The buffer was
  inside `features/reconcile`; the roster needs the same guarantee under D-ROS14 and may not import
  it. The script's own comment says the fix is to promote the shared thing out of `features/` and
  never to allow-list the leak, so that is what happened — `WEB_ALLOW` is still empty.
- **The bug story moved with the code**, because it is the reason the buffer exists: `router.replace`
  is asynchronous, two setters in one tick read the same pre-change query, and the second overwrites
  the first. It shipped to production once and read as a broken date picker welded to 90 days.
- **`useSpendFilters.test.ts` passes unchanged — all 12, including the one-tick collision case.**
  That is the evidence the refactor is a refactor. `useQueryState.test.ts` then pins the same
  guarantee in its GENERAL form (any two parameters, any two writers, one tick), because the hazard
  was never about dates and the roster will hit it with columns.
- Both guarantee tests were proven able to fail: removing the `pending` buffer fails "keeps every
  parameter written in one tick" and "reads back a value before the router has settled", and nothing
  else.
- **Deliberately untouched:** the five single-parameter `router.replace({ query: { ...route.query, x
  } })` sites (`DriverDetailPage`, `MessagesPage`, `AuditPage`, `IftaLedgerPage`,
  `DispatchLoadDetailPage`). One parameter per tick cannot collide with itself, so they are correct
  as written; converting them would be churn dressed as consistency.

**Verified by:** `pnpm test` (all suites and matrices), `typecheck`, `lint`, `lint:filesize`,
`lint:funcsize`, `lint:boundaries`, `lint:ui-adoption`, `lint:comment-claims`, `lint:tests`.

### R3b — column management — 2026-08-30, PR #398, no migration

`DataTable.vue` 453 → **375**. New: `DataTableCards.vue` (171), `ColumnPicker.vue` (122),
`useTableColumns.ts` (121), `driverRosterColumns.ts` (58).

- **The extraction was proven, not asserted.** Two snapshots of what `DataTable` renders — the card
  branch and the table branch, with slots, blanks, selection, expansion and footer — were recorded
  against the 453-line file, then the card view moved out and they were re-run untouched. Recording
  them *after* the move would have proved nothing, and the first attempt did exactly that before
  being redone properly.
- **The snapshot had to be normalised first, and the reason is a defect it found in itself.** The
  card sort control's `listId` is `Math.random()` per mount, so the snapshot would have failed on its
  second run — an intermittent CI failure built into the net meant to catch one. Comment whitespace
  is normalised too; Vue strips comments from production builds, so their indentation is not
  something a reader can see. `<!--v-if-->` markers survive, because a branch that stopped rendering
  IS structure.
- **The pinned lead column was a THREE-part hand-roll, not two.** Beyond the two class strings, each
  of `FuelLogPage`, `TransactionsPage` and `RejectionsPage` also had to return `group` from
  `row-class` — and each spelled that differently. Without it, `group-hover:bg-surface-subtle` never
  fires and the pinned cell silently stops following its own row on hover: visible only with a mouse
  over a scrolled table, which is to say never, in review. Now `pin-first-column`, and the three
  copies are deleted. The test asserts the EXACT class strings that were removed, so the diff between
  the deleted literals and the test file is the equivalence proof.
- **The stored set is what is HIDDEN, and that is a legal decision, not a stylistic one.** R4 adds
  CDL, medical and hazmat expiry columns to this table. Under a stored *visible*-list, every reader
  who had ever opened the picker would silently not get them — the readers who customise most would
  be the ones missing the columns a §391.51 file depends on. `useSidebarSections` had already learned
  the same lesson for the opposite reason and written it down; this is that reasoning applied.
- **A link's columns win for the visit and are not written to the reader's own default.** Following
  somebody's link must not reshape your table forever. The corollary, stated in the composable: a
  link that hides nothing lets the reader's own hidden columns stand — filters and sort change WHICH
  rows you see, columns only change how you see them.
- **Deviations, both found by gates and both real:**
  - `lint:comment-claims` rejected a docblock whose quoted test title wrapped across two lines. The
    title existed; the quotation did not survive the line break. Reflowed.
  - `@typescript-eslint/no-explicit-any` rejected a shared `cellValue` helper. That was the gate
    being right: `row[key]` is a property access, not a rule, and it did not deserve a shared module.
    Only `isBlank` — what counts as an empty cell — is a decision the two branches must agree on, and
    only that is shared. An earlier attempt to type the helper `unknown` while moving it broke five
    pages that do arithmetic on a slot value, which is recorded in `dataTable.ts` as its own step.
- **A capability built rather than a gap accepted:** the picker closes on Escape pressed *inside* the
  panel, via a document listener while open. `FilterBar`'s popover — the same shape — does not: its
  handler sits on the trigger, and the panel is teleported to `<body>`, so there is no ancestor to
  bubble to. Left alone deliberately and noted in `ColumnPicker.vue`; it is one primitive's keyboard
  contract and belongs to a step that owns popover behaviour.
- **Not built, and not asked for:** column reordering. The plan says picker and visibility.

**Verified by:** `typecheck`, `lint`, `lint:filesize`, `lint:funcsize`, `lint:boundaries`,
`lint:ui-adoption`, `lint:tokens`, `lint:comment-claims`, `lint:tests`, `lint:table-writers`, and
`pnpm test` (all suites and matrices). ⚠ One `pnpm test` run failed at the unit stage and could not
be reproduced in seven subsequent full runs (five web-only, one `pnpm -r test`, one whole `pnpm
test`); it was run immediately after a heavy parallel sequence. Recorded rather than smoothed over —
if CI shows it again, it is real.

### R3c-1 — the roster becomes linkable — 2026-08-30, PR #399, no migration

`features/roster/useRosterFilters.ts` (107). `DriversPage.vue` 348 → 334.

- **`q`, `status`, `show`, `sort`, `dir`, `page` are now query parameters**, and every setter writes
  `undefined` when a value returns to its default — so `/drivers` and `/drivers?show=live&page=1` are
  never both reachable. A URL that spells out defaults invites the reader to think something has been
  narrowed, and it makes "is this view customised" a comparison rather than a lookup.
- **A filter change clears the page in the SAME patch.** It was a `watch` that set `page` after the
  filters changed; that is two writes in one tick, which is the exact hazard `useQueryState` was
  promoted to handle at R3a. Re-introducing it through the back door would have been a poor way to
  use it. Sorting deliberately does NOT reset the page: unlike a filter, re-ordering leaves the row
  you were looking at on the roster.
- **Every read is normalised, because a linkable URL is one a person can type into.** `?page=-4`,
  `?page=banana`, `?dir=sideways`, `?show=banana` and a `dir` with no `sort` all reach this module
  from a forwarded link or a truncated paste, and each resolves to something sensible rather than to
  an empty roster — which on a 287-driver fleet reads exactly like a carrier with no drivers.
- **A "Clear filters" control was added, and it is not scope creep.** The roster can now be *arrived
  at* narrowed, from a link or (next step) a saved view. A reader who lands on `?status=terminated`
  with no way back cannot discover what the page normally shows. It uses `OdometerPage`'s existing
  shape rather than a new one.
- The R2 snapshot is untouched by all of it: the default view still renders exactly as before.

**Verified by:** `typecheck`, `lint`, `lint:filesize`, `lint:funcsize`, `lint:boundaries`,
`lint:ui-adoption`, `lint:tokens`, `lint:comment-claims`, `lint:tests`, `lint:table-writers`,
`pnpm test`. The page-reset rule and the URL-normalisation rules were each proven able to fail.

### R3c-2 — saved views — 2026-08-30, PR #400, **migration 0278**

`savedViewContract.ts` (shared), `0278_saved_views.sql`, `savedViews.ts` + tests (api),
`useSavedViews.ts` + `SavedViewMenu.vue` (web), `supabase/tests/saved-views.test.mjs` (15 cases).

- **Applying a view is a navigation, and there is no other code path.** The menu emits a query
  string; the page replaces the route with it. The URL afterwards IS the view — byte-identical to the
  link a colleague would have been sent. Anything else would be two mechanisms that agree until they
  do not. Pinned by "applies a saved view by navigating to its query".
- **A view saves the WHOLE URL**, not the filters the page happens to know about — so the column
  choice (`hide`, R3b) travels with it for free, and a filter added at R4 will too, with no change
  here. Pinned by "saves the whole current URL, not just the filters it knows about".
- **The primary key is `(user_id, table_id, name)`**, so saving over a name replaces it — which is
  what "save" means to the person doing it — and there is no rename endpoint to leave a half-done
  state. The database enforces it rather than the endpoint remembering to.
- **The matrix's load-bearing case is the one easy to leave out: an ADMIN of the same org reads
  nothing.** Every other table in this product answers an org-wide read with yes; this one and
  `notification_events` are the two that must answer no, and a matrix proving only cross-ORG
  isolation would pass just as happily on a policy that had dropped the `user_id` half.
- **The API layer needed its own test, and it is not redundant with the matrix.** The API reads with
  the service role, which BYPASSES RLS — so for anything through this router the handlers' own
  filters are the only isolation. Removing `.eq("user_id")` fails `savedViews.test.ts` and nothing
  else; it would not have failed the matrix.
- **The table id is spelled once.** `SAVED_VIEW_TABLES` in `@silvicom/shared` is where both the
  column picker's storage key and the saved-view row get it. Spelled twice they would agree until a
  rename, and the symptom would be a reader's views quietly emptying rather than an error.

**Three gates caught real things, and all three changed the code rather than the claim:**

- **`testServerTeardown.test.ts`** — no `apps/api` suite may shut a test server down by hand; they all
  go through `closeTestServer`, because undici pools keep-alive sockets to 127.0.0.1 and a plain
  shutdown waits on them until the hook times out (`apps/api` red about one run in four under
  contention). The new route test hand-rolled it. ⚠ **And this is the trap worth carrying forward:
  that scan enumerates files with `git ls-files`, so it could not see the new test while it was
  still UNTRACKED — it passed locally and failed in CI.** The same shape as the stale-`dist`
  typecheck trap: `git add` before trusting a full local run. Its sibling assertion is a plain-text
  regex, so the banned call cannot be named in a comment either — the same footgun
  `lint:ui-adoption` has.

- **`routeGates.test.ts`** — every `/api` mount must carry a role gate or be pinned with an argument.
  The saved-views router deliberately has none, so it is now pinned with the reason: a view grants
  nothing and reveals nothing, applying one is a navigation into a page that enforces its own
  permissions, and a section gate would invent a capability nobody needs — a recruiter who may read
  the roster may certainly name a view of it.
- **`lint:funcsize`** — mounting the router took `createApp` to **201 lines against a 200 budget**.
  It had been sitting at 199. The gate's own instruction is to split into an orchestrator plus stage
  helpers, so the 50 router mounts moved into `mountApiRouters()`. Deleting a comment to squeeze back
  under would have left the NEXT router to hit the same wall with no headroom at all. ⚠ The mounts
  stay in `app.ts`'s own source on purpose: `routeAuth.test.ts` discovers routers by reading that
  file, and moving them to another module would silently stop it covering them. Verified after the
  move — 36 routers discovered, `/api/saved-views` among them.

**Deliberately NOT built, and this is the one to read before R4:** the built-in view catalogue.
D-ROS16 says where the carrier-standard views live; it does not say they exist yet. Measured
2026-08-30, the roster can filter on status, the archived toggle, a search term, sort and columns —
and every candidate built-in is either a duplicate of a control the toolbar already offers in one
click ("Archived", "Terminated") or not expressible at all. The three actually wanted each need a
filter over the qualification rollup that does not exist until R4:

| Built-in | Needs |
| --- | --- |
| Medical expiring in 30 days | a filter on the overview rollup's `attention` dates |
| CDL expiring in 30 days | the same |
| Not qualified to dispatch | a filter on the rollup's `state` |

An empty registry shipped now would be structure with no content, and this codebase treats that as
rot rather than slack — `check-feature-boundaries.mjs` says exactly that about its own allow-lists.
So the catalogue lands with R4 as a data change, beside the filters that make it expressible. The
reasoning is repeated at the foot of `savedViewContract.ts`, where the next person will look.

**Verified by:** `pnpm test` (all suites and every matrix, including the new `saved-views` one at
15/15), `typecheck`, `lint`, `lint:filesize`, `lint:funcsize`, `lint:boundaries`, `lint:ui-adoption`,
`lint:tokens`, `lint:comment-claims`, `lint:tests`, `lint:migrations`, `lint:upserts`,
`lint:table-writers`, `check-rls`. The `lint:upserts` gate was checked directly against this router's
upsert — removing one column from the payload fails it, so the call is covered rather than skipped.

### R4a — the three expiry columns — 2026-08-31, PR #401, no migration

`dqRosterCells` + `DQ_ROSTER_COLUMN_KEYS` (shared), `requirements` on the rollup (api),
`dqExpiryBadge` (web), three columns on the roster.

- **They cannot disagree with the qualification badge beside them, by construction.** The cells are a
  projection of the same `DqFileSummary` the driver page renders and the queue ranks — one
  calculation, not three. Never `drivers.cdl_expires_at`, which stays a display field even when
  McLeod writes it. Pinned by "counts days to expiry the same way the queue does, so the two cannot
  disagree".
- **A date that is fine renders as PLAIN TEXT; only a date needing a phone call is tinted.** Three
  tinted columns × 20 rows is 60 pills, and a badge that appears everywhere means nothing — the same
  argument `archivedBadge` records for returning null on a live row. The rule lives in `badges.ts`
  as `urgent`, not in the template, because it is a vocabulary decision.
- **A requirement that does not APPLY renders "—", never "Missing".** The projection omits
  inapplicable items entirely, so a null cell means "not asked of this driver" — hazmat at a carrier
  without the module. "Missing" is an accusation and would be the wrong one.
- **The date cells navigate rather than edit** (see the step note above): D-ROS1 and D-ROS5 agreeing,
  rather than promoting a `compliance` component to dodge `lint:boundaries`.

**A gate asked a question and got an answer rather than an allow-list entry.**
`complianceOverview.test.ts` pins the overview row's exact key set with the comment *"so a future
field addition has to face the question"* — the question being whether a new field could leak a
§382.401(a) testing record or a §391.23 investigation result to a dispatcher (D-DQ15). Adding
`requirements` to the expected list would have answered nothing, so the shape is now asserted too:
each cell carries only computed state and a date (no document id, no record row), and its key is
checked against both `DQ_ROSTER_COLUMN_KEYS` and `isRestrictedQualificationKind`.

**Deviation:** the R2 snapshots changed, and legitimately — three columns were added. The diff was
read first to confirm it was purely additive, and the fixture was then extended so the new cells are
actually exercised (current, expiring, expired, missing, and not-applicable) rather than re-recorded
as a row of dashes. A first attempt at the plain-text-vs-tinted assertion did NOT discriminate — it
checked for a warning colour, which a neutral pill would also lack — and was caught by deliberately
inverting `urgent`. It now asserts on `rounded-detail`, which is what "this is a pill" means.

**Verified by:** `pnpm test` (all suites and matrices), `typecheck`, `lint`, `lint:filesize`,
`lint:funcsize`, `lint:boundaries`, `lint:ui-adoption`, `lint:tokens`, `lint:comment-claims`,
`lint:tests`, `lint:migrations`, `lint:upserts`, `lint:table-writers`.

### R4b — the qualification filters, and the views they make real — 2026-08-31, PR #402, no migration

`dqFleetFilter.ts` + `BUILT_IN_VIEWS` (shared), `dq` / `due` / `req` on the roster,
`QualificationFleetTable` refactored onto the shared predicate.

- **The vocabulary was promoted, not copied.** "Needs attention", "has expired items" and "due in 30
  days" were written inline in `QualificationFleetTable.vue`, and R4 gives the roster the same
  filters. A second copy is the drift D-DQ6 and D-ROS9 both name — the compliance page and the roster
  would answer "is this driver behind on their §391.51 file" differently and neither would look wrong
  on its own screen. `dqSoonest` was ALREADY duplicated twice before this (the fleet table's row
  builder and `attentionStrip.ts`), which is how the disagreement below started.
- **The LABELS moved too.** A filter that means the same thing on two pages must say the same thing
  on both, or a reader reasonably concludes they are different filters.
- **`QualificationFleetTable.vue` had no test at all**, so its semantics were pinned FIRST — nine
  cases covering every branch of the switch — and the same nine pass unchanged against the shared
  predicate. That is the proof the refactor is a refactor. The compliance surface is better tested
  than it was found.
- **The built-in views are real now, and two of them needed a filter that did not exist.**
  `dq=expiring` means "some requirement is due soon", so calling it "Medical expiring in 30 days"
  would have been a different claim from what the list shows. Rather than rename the view to fit the
  filter, R4b added `req=<key>` — cheap, because R4a's `requirements` already carries per-key state
  for every driver. Pinned by "asks about THAT requirement, not about any other one being due".
- **Every built-in is asserted to be expressible AND to narrow something**: its query may only use
  parameters this product reads, its values must be in the shared vocabularies, and it must not match
  a driver with nothing wrong. A built-in that quietly linked to everybody would be worse than none.

**A defect found and deliberately NOT fixed:** the attention tile and the filter it applies disagree
about the overdue driver (§6 Q7). Both behaviours are preserved exactly as they were. Which side is
right is a product ruling — is a lapsed item "due"? — and answering it inside a refactor would change
what a compliance screen reports without anyone deciding to.

**Verified by:** `pnpm test` (all suites and matrices), `typecheck`, `lint`, `lint:filesize`,
`lint:funcsize`, `lint:boundaries`, `lint:ui-adoption`, `lint:tokens`, `lint:comment-claims`,
`lint:tests`, `lint:table-writers`. The built-in expressibility check was proven able to fail (an
invented query parameter breaks it), as was the fleet table's characterisation suite.

### R5a — the sanctioned viewer moves to where the contract always said it was — 2026-08-31, PR #403, no migration

- **`DocumentPreview.vue` moved from `features/compliance/` to `components/`, and this was not a new
  decision.** `docs/DESIGN-SYSTEM-CONTRACT.md` §1.2 has always listed it in the shared-components
  table — with "(features/compliance)" written beside it, admitting the file was somewhere the table
  said it was not. R5 needs it from the roster and D-ROS10 will need it for tractors and trailers,
  whose `subject_type` the storage path already accepts. `check-feature-boundaries.mjs` says in its
  own comment what to do: promote the shared thing, never allow-list the leak.
- **Nothing about the component changed.** It had no `compliance` imports to begin with — the
  clearest sign it was never that feature's own — so the move is an import path and a docblock. Its
  existing three tests pass unmoved, and the contract row now carries its real line count instead of
  a parenthetical about its location.
- **`documents: { onFile, of }` on the rollup**, derived from the file items. Zero new queries on a
  287-driver roster.
- **The count is of SCANS, and that is deliberate under §6 Q6.** An item can read `current` from a
  synced date while contributing nothing here. A count states a fact without ruling that the file is
  deficient, which is the question Q6 still owes an answer to. Pinned by "counts only items with a
  document, not items that merely have a date".
- **A dangling document id counts as no scan.** `buildDqFile` resolves the id against the documents
  actually registered, so a reference to a deleted scan reads as absent rather than as evidence — a
  count that trusted the id would overstate the file. Pinned by "does not count a document id whose
  document is not in the register", which was found by a fixture that failed for exactly that reason.
- **The leak question was answered again, not waived.** `complianceOverview.test.ts` gets a second
  assertion: the count is two numbers, never document ids. Carrying ids would put a §382.401 record's
  id in front of a dispatcher — the leak that file exists to prevent — and would be 287 ids nobody on
  the roster reads.

**Verified by:** `pnpm test` (all suites and matrices), `typecheck`, `lint`, `lint:filesize`,
`lint:funcsize`, `lint:boundaries`, `lint:ui-adoption`, `lint:tokens`, `lint:comment-claims`,
`lint:tests`, `lint:table-writers`.

### R5b — the folder, and the cell that opens it — 2026-08-31, PR #404, no migration

`components/DocumentsModal.vue`, the `File` column, one modal owned by the page.

- **It swaps, it does not stack — and `DocumentPreview` is used completely unmodified.** Choosing a
  scan removes the list from the DOM and opens the sanctioned viewer; closing the viewer returns to
  the list. Exactly one panel exists at any moment. The viewer is not wrapped, re-implemented or
  given a second parent, which is the only way to be sure the audit print path still works: printing
  hides `body *` and reveals a single `.print-target`, and that is the product's actual job during a
  DOT visit. Pinned by "NEVER renders two panels at once — the list is gone while a scan is open",
  which was proven able to fail by letting the list stay open.
- **The Done-when about "one document-count query" was replaced by a stronger one.** The count costs
  ZERO queries, so the assertion is that the rollup issues the *same* number of reads for 50 drivers
  as for one — a constant, because the failure being guarded against is per-driver growth. R5's
  original worry about "200 signed-URL round trips" was about a design nobody had to build.
- **The modal is subject-shaped, not driver-shaped.** Nothing in it knows what a driver is;
  `documents.subject_type` already accepts `tractor` and `trailer`, and D-ROS10 says the equipment
  rosters reuse this. The page supplies the label and the rows.
- **Document kinds read from `DQ_KIND_LABELS`**, so a scan is called the same thing in the folder as
  on the driver's qualification page — the rule that no `.vue` file carries its own vocabulary
  applies to document kinds too.
- **A failed load says so rather than showing an empty folder**, because "nothing filed" and "we
  could not ask" are different facts and only one of them is a compliance finding.

**Deviation:** the R2/R4a snapshots changed again, additively — one `File` column. The diff was read
before re-recording, and the fixture carries two different denominators (`8/17`, `0/14`) so the
"never 20" rule is exercised rather than asserted in a comment.

**Verified by:** `pnpm test` (all suites and matrices), `typecheck`, `lint`, `lint:filesize`,
`lint:funcsize`, `lint:boundaries`, `lint:ui-adoption`, `lint:tokens`, `lint:comment-claims`,
`lint:tests`, `lint:table-writers`.

### R6a — the roster's edit becomes the audited one — 2026-08-31, PR #405, no migration

**This step began as "surface two flags" and turned out to be a live production defect.**

`DriversPage`'s edit drawer called `useUpdateDriver`, which writes `drivers` **straight from the
browser through PostgREST**. So `resolveDriverUpdate` never ran on the surface people actually use,
and two things followed, both silent:

- **The row was never claimed, so the sync overwrote the correction.** `samsaraDriverSync.ts:137-142`
  carries a comment describing exactly this failure — "an admin who fixed a misspelled name or a
  wrong phone on a telematics-sourced driver watched it revert on the next sync, silently and with
  nothing logged" — and says "that is the failure the roster PATCH exists to prevent, **so the two
  had to be fixed together**". The sync half landed. The caller half did not.
- **A change to a §391.51-relevant field left no audit row.**

**Measured on production, 2026-08-31: 282 of 287 live drivers were sync-owned** — 185 `samsara`,
97 `efs`, 5 `manual`. This was the behaviour for essentially the entire roster.

What shipped:

- The drawer now uses `useUpdateDriverProfile` (`PATCH /api/roster/drivers/:id`), so every roster
  edit runs `resolveDriverUpdate`, claims the row when it should, stamps the §391.51(c) date when it
  should, and writes an audit row.
- **The two flags now travel in the RESPONSE, not only into `audit_logs.meta`.** They were recorded
  for an auditor and invisible to the person who caused them. D-ROS1 refused a cell-editor grid
  because "a cell editor has nowhere to put that sentence"; a sentence with nowhere to come FROM is
  the same gap from the other end. `describeDriverEdit` turns them into one, and returns null for an
  ordinary edit so nothing is said when nothing happened.
- **The claim warning appears BEFORE Save** (D-ROS4), and is true of the EDIT rather than of the
  driver — a permanent banner on every synced row would be wallpaper. It reads
  `wouldClaimFromTelematics` from `@silvicom/shared`, the same identity-field list the server uses,
  so the warning and the save cannot disagree. It also says the part that matters: editing the field
  back does not undo it.
- `identity_source` joins `DRIVER_COLS`, because a form cannot say what an edit means without it.

**The sweep for the rest of the bug class, which found two more:**

- **Creating a driver had the same defect, and worse.** `useCreateDriver` INSERTed from the browser,
  and `drivers.identity_source` is `not null default 'samsara'` — so a driver typed in by hand was
  born TELEMATICS-OWNED and the next sweep could overwrite the name somebody had just entered.
  `POST /api/roster/drivers` writes `identity_source: 'manual'` explicitly, and its own comment says
  why. Create now goes through it. Measured 2026-08-31: **no production row had been created this
  way** — all 185 `samsara` rows carried a real sync link — so this was a trap rather than damage,
  closed before it fired.
- **`useUpdateDriver` was DELETED, not merely left uncalled.** A private door left standing is one
  somebody walks through, and its name is the obvious one to autocomplete. `useDrivers.test.ts` is a
  source scan pinning the whole class: `drivers` may be read from the browser and never written, the
  two writes go through the roster API, and that export may not come back. Proven able to fail by
  re-adding it.
- **Both ratchets moved.** `scripts/table-writers.json` and `check-table-modules.mjs` each carried
  `drivers <- apps/web/src/composables/useDrivers.ts`; both entries are gone and the grandfathered
  writer count fell 63 → 62. The gate caught the stale entries itself, which is the ratchet working:
  removing a writer is only finished when the register says so.
- `samsara_driver_id` left `DriverForm`'s state. It had **no input bound to it** — dead state passed
  through from the existing row — so nothing a person could set was lost; the API refuses
  client-supplied telematics provenance and Reconcile is the sanctioned way to link.

**Verified by:** `pnpm test` (all suites and matrices), `typecheck`, `lint`, and the full gate list.
The manual-row branch of the warning was proven able to fail.

### R7 — recruiting leaves — 2026-08-31, PR #406, no migration

- **The step needed a destination that did not exist.** All five sections are per-driver and the
  recruitment surface was three LISTS, so "move recruiting off the driver page" had nowhere to move
  to. `/recruitment/:id` (`ApplicantRecordPage`) is that destination — created rather than scattering
  the sections into pages that answer a different question.
- **They belong together here, having been right to split there.** U6 cut them across three tabs on
  a page a dispatcher, a safety manager and a recruiter all open, where four regulations under one
  noun is four things the reader must tell apart. Here there is one reader and one job, so the sum is
  the point. The order is the order the work happens in: ask, record, investigate, file, decide.
- **`?section=application|employment|screening` still RESOLVE.** The vocabulary is untouched — those
  values are in bookmarks and binder references — and only the destination moved: the driver page
  redirects (`replace`, so no dead history entry) instead of rendering. Dropping them from
  `DRIVER_SECTIONS` would have made `resolveDriverSection` answer `profile` and landed an old link
  silently on the wrong thing. `DRIVER_PAGE_SECTIONS` is the render list, derived from the same set,
  and a test proves the page never offers a tab it would immediately redirect away from.
- **`driverSections.test.ts` passes UNCHANGED, and that is checkable with a diff** — the new
  behaviour is a separate file, so "unchanged" is not merely claimed.
- **The route table gained a specificity pair.** `/recruitment/:id` sits beside
  `/recruitment/screening` and `/recruitment/inquiries`; vue-router ranks static segments above
  params, and `routeTable.test.ts` now probes it, so "should be immune to reordering" stays a tested
  claim rather than a belief. The inquiry queue still resolves to `inquiry-queue`.
- **All three inbound links repointed**, and a test caught the third: `InviteApplicantDrawer.test.ts`
  pins where its recovery button sends the reader. The old URL still redirects, but a button this
  product ships should point at the work rather than at a redirect.
- **`PspRecordsSection`'s workaround comment is gone**, which was R7's own done-when. What replaced
  it records that the placement outlived its justification: it was forced by `canManageFleet`, R0
  deleted that boolean, and the placement turned out to be independently right.
- **`SevenDayStatementSection` stayed**, per the step — §395.8(j)(2) is a record about employment,
  not about hiring. It sits under Profile until R6b gives it "Employment & pay"; filing an
  hours-of-service record with the hiring paperwork because that is where it happened to be would
  have been the easy wrong answer.

**Verified by:** `pnpm test` (all suites and matrices), `typecheck`, `lint`, and the full gate list.

### R6b — one scroll, and `?section=` becomes an anchor — 2026-08-31, PR #407, no migration

- **Three sections on one scroll, not six.** R6's prose described six blocks including the recruiting
  ones; R7 took those to their own surface first, so what is left is who this person is, whether they
  may be dispatched, and what they have burned — one reader's single question. Three tabs to answer
  it was three clicks to see a whole that fits on a page.
- **`?section=` scrolls instead of switching, and every value still resolves.** The vocabulary is the
  one thing this change was not allowed to touch: `/compliance/:id` redirects into
  `?section=qualification`, the binder cites it, and it is in bookmarks. `driverSections.test.ts`
  passes unchanged, and the diff proves it.
- **A test pins the shape, because a stray `v-if` would make it tabs again invisibly.** All three
  anchors must be present on any load, including one that names a section. Proven able to fail by
  putting a `v-if` back on the fuel block.
- **Two things the layout change invalidated, both fixed rather than left:** the "Export this file"
  button was gated on the qualification TAB being open — there are no tabs, and it exports the
  §391.51 file whichever part of the page the reader has scrolled to; and the page description still
  advertised "hiring paperwork", which left at R7.

**Not built, and named rather than skipped quietly:** the six *editable-in-place* sections R6's prose
describes (Identity & contact, Licence & medical, Employment & pay …). R6's three done-when clauses
are all met — `driverSections.test.ts` unchanged (R7), the claim warning before Save and both
`resolveDriverUpdate` flags surfaced (R6a) — and none of them asks for inline editors. Building six
would be a SECOND editing mechanism beside the drawer R6a just made audited and honest, which is the
duplication D-ROS11 exists to prevent. Doing it properly means moving the drawer's job onto the
record page rather than copying it, and that is a step with its own decision to make: see §6 Q8.

**Verified by:** `pnpm test` (all suites and matrices), `typecheck`, `lint`, and the full gate list.

### R6c — editing gets one home per field — 2026-08-31, PR #408, no migration

Answers §6 Q4 and Q8, which were the same question at two altitudes.

- **`DRIVER_INLINE_EDITABLE` is derived and checked, not hand-listed.** The rule is "no sync owns it
  and nothing legal turns on it", and the first half is a fact about `mcleod/rosterFields.ts` and
  `samsaraDriverSync.ts` rather than about the shared package. So the list lives in
  `@silvicom/shared` and `apps/api/src/driverFieldOwnership.test.ts` intersects it with McLeod's real
  `driverPatch` OUTPUT — the function's keys, not a copy of them. Adding `cdl_number` to the list
  fails three assertions at once.
- **`DriverContactSection` on the record page** edits exactly those fields through the audited PATCH
  (D-ROS1: "the record page writes"), sends only what CHANGED — an audit row reporting six edits for
  one typed digit is how an audit log stops being read — and clears to `null` rather than `""`,
  which in a nullable column reads as present and prints as nothing.
- **The anti-duplication rule caught my own first draft.** `employee_id` was in both the drawer and
  the inline list. The assertion is now permanent: the drawer and the record page may not both offer
  a field, because a second editor for the same field is one with a different amount of honesty, and
  which one a person used becomes a matter of where they happened to click.
- **The driver page now READS through the roster API** rather than a browser `select("*")`. It needed
  `DriverDetail` for the section, and R6a had already moved the writes — leaving the read on a raw
  select would have meant asking for every column the page does not render.

**Two gates redirected the work, both correctly:**

- **`lint:boundaries`** refused the ownership test under `modules/roster/`, because it imports
  `modules/mcleod`. It asserts two modules AGREEING, so it belongs to neither — it now sits at
  `src/`, beside `routeAuth.test.ts` and `routeGates.test.ts`, which are there for the same reason.
- **`lint:filesize`** put `rosterContract.ts` at 527. Split at a real seam rather than waived:
  `driverEditMeaning.ts` holds what an edit MEANS (the response flags, the pre-save predicate, the
  inline list); `rosterContract.ts` keeps what shape may cross the wire. One is read by a form
  deciding whether to warn, the other by a route deciding whether to accept.

**Deviation:** one `pnpm test` run failed against a stale `packages/shared/dist` after the split —
the trap `HANDOFF-2026-08-30.md` §3 already records. `build:rn` then green. Recorded because the
handoff says it costs a CI round trip, and it nearly did again.

**Verified by:** `pnpm test` (all suites and matrices), `typecheck`, `lint`, and the full gate list.
The changed-fields-only rule and the sync-overlap guards were each proven able to fail.

### R9 — the capability decisions get a gate — 2026-08-31, PR #408, no migration

⚠ **Shipped in the same PR as R6c, which deviates from one-step-per-branch.** R9's third detector
enforces R6c's rule directly; the list and the gate that keeps it honest are one idea, and splitting
them would have put a rule and its enforcement in different reviews.

`scripts/check-capabilities.mjs`, `lint:capabilities`, and the CI step.

- **Three detectors, all three self-tested.** `canManageFleet` used as an identifier anywhere in
  `apps/web`; a `requiresManage` that does not NAME a section; a surface editing driver fields
  without building them from `DRIVER_INLINE_EDITABLE`. `--self-test` fails the build if any detector
  stops firing, per house convention.
- **It PARSES rather than greps, and that is the interesting decision.** `canManageFleet` survives in
  exactly three places — `session.ts`, `PspRecordsSection.vue` and `routes/recruitment.ts` — as
  COMMENTS explaining why R0 deleted it. `lint:ui-adoption` is a plain text regex and the design
  contract records the footgun that follows; here the same choice would have forbidden saying the
  name, which would delete the reasoning the gate exists to protect. So comments are stripped first,
  and the self-test asserts BOTH that the detector fires on real use and that it does not fire on a
  comment.
- **The sections vocabulary is read from `auth.ts`**, not restated in the script. A gate that carries
  its own copy of the list it is checking is the defect it was written to prevent.
- **`SANCTIONED_DRIVER_EDITORS` is shrink-only and names three files.** A fourth is a reviewed
  decision that has to answer which fields it owns that the other three do not — which is R6c's rule,
  enforced instead of remembered.
- **The gate found a false positive on itself and was tightened:** `useDrivers.ts` DECLARES
  `useUpdateDriverProfile`, and the first draft flagged the declaration as an unsanctioned editor.
  Now it matches calls only, with a self-test case for the declaration.

**A stale note corrected, not worked around:** the session memory said `.github/workflows` pushes are
rejected for want of the `workflow` OAuth scope, and prescribed handing the YAML to the owner. That
was verified rather than trusted — the CI step went in its own commit so it could be amended away
cheaply — and **the push succeeded**. The scope has been granted since that note was written, so the
CI half of R9's done-when is genuinely done rather than owed. A gate CI never invokes is worse than
no gate.

**Verified by:** `pnpm test` (all suites and matrices), `typecheck`, `lint`, `lint:capabilities`
(including `--self-test`), and the full gate list.

### R8 — nothing was redundant, and one page was unreachable — 2026-08-31, PR #PENDING, no migration

**The per-page decision R8 asked for. Retire NONE of the three, and the evidence is what each one
carries that a roster view cannot express:**

| Page | Verdict | Why |
| --- | --- | --- |
| `CompliancePage` | **Keep** | Five surfaces the roster has no equivalent for: `QualificationSeedPanel`, `ExportHistory`, hazmat `CertManager`, the attention strip's fleet counts, and multi-driver binder selection. A saved view has no way to select ten drivers and export a §391.51 binder. |
| `ScreeningReadinessPage` | **Keep** | A task, not a queue — the fleet-wide DOB import that makes screening possible at all (P0b). Nothing about it is a list of drivers. |
| `InquiryQueuePage` | **Keep** | A queue over `employer_inquiries`, not over drivers: one driver can own several, ranked by the §391.23(c)(1) deadline. A list of drivers cannot express a list of inquiries. |

**The redundancy R8 was written to worry about turned out to be real, and already gone.** Its concern
was "some are a saved view wearing a page" — and the thing that WAS duplicated was not a page but a
DEFINITION: `CompliancePage` and the roster each had their own idea of "needs attention" and "due in
30 days". R4b promoted that vocabulary into `@silvicom/shared`, so the two surfaces now cannot
disagree by construction. Two pages answering different questions with the same predicate is not
duplication; it was two predicates that would have been.

**A real defect found by sweeping instead of assuming.** `/settings/driver-performance` was
**declared, admin-gated, and reachable only by typing the URL** — ten of the eleven `/settings/*`
routes were listed in the Settings directory and this one was not. Now linked.

**`routeReachability.test.ts` is the durable half**, because R8's answer decays: a page loses its
last inbound link the moment a step like R7 moves work elsewhere, and the failure is silent — the
route still resolves, the component still builds, and nobody notices for a year. It asserts every
declared, non-redirect, non-parameterised route is referenced by path or by NAME somewhere outside
the router.

⚠ **Its first draft reported nine orphans and eight were its own fault** — five were redirects (which
exist so an old bookmark keeps working, so having no in-app link is their entire purpose), and three
were reached by `router.push({ name })` or from outside the app. Only one was real. That ratio is
the argument for verifying a detector against the codebase before trusting it: a check with 89% false
positives does not get read, it gets skipped. The corrected version was then proven able to fail by
removing the Settings entry it had just earned.

**Verified by:** `pnpm test` (all suites and matrices), `typecheck`, `lint`, `lint:capabilities`, and
the full gate list.
