# Feature inventory — the product readiness programme (PR0)

**Status:** RULED 2026-10-06 (Q-PR1, Q-PR2, Q-PR4; Q-PR3 open). F02 + F04 audited, plan
waiting on the owner. This is the index for the product readiness programme. Every
feature gets its own folder under `docs/plans/product-readiness/`, with its own audit and plan,
built from the checklist in §4.

**Why this programme exists.** The audit of the week 09-29 → 10-06 found:

- 200 PRs merged across about 12 programmes at once.
- Two migration-number collisions.
- One PR that carried another chat's deletions (#1216).
- Four integrations or pipelines that needed 3–4 follow-up fixes after they shipped. One of those
  caused a production outage (10-05 15:06–15:48 UTC).
- Plans whose status lines no longer match the code.

The owner's ruling (2026-10-06): stop starting things. Finish and polish **one feature at a time**
until it is production-ready, precise, simple to use, and actually used.

Everything below was measured on 2026-10-06 from `origin/main` @ `4d4b094`. Usage figures come
from the production database for the real fleet (org `86d6b3ea…`).

---

## 1. Facts that should decide the order

### 1.1 Who uses the product today

| Measure | Value |
|---|---|
| Office members (admin 6, dispatcher 3, safety manager 1, technician 1, driver 1) | 12 |
| …signed in during the last **30** days | 8 |
| …signed in during the last **7** days | **1 (an admin)** |
| Active drivers / active trucks on the roster | 174 / 189 |
| Drivers with an app login | 1 |
| Human actions in the audit log, last 30 days (all areas) | ≈ 30, all by one person |
| Alerts ever closed by a person / dismissed by a person / open now | 10 / 95 / 81 |
| Fuel findings given a disposition by a person, ever | 0 |

The product is fed well, but the people it is built for barely use it yet. The collectors write
data every hour: 1,903 fuel transactions, 36,529 idle events and 5,201 finance entries in 30 days.

### 1.2 What we cannot measure yet

**Nobody can say whether a report page is read.** Fuel Costs, IFTA, the Fleet report, the
Dashboard and Idling only read, so they leave no row. The API's `[metrics]` line keeps only the
busiest routes, and Railway returned nothing on 10-06. "Real usage" (§4.1) cannot be answered
for read-only pages until a page-view count exists. That is cross-cutting item X1 (§5).

### 1.3 Size of what exists

| Measure | Value |
|---|---|
| Sidebar entries (`SURFACES` in `packages/shared/src/surfaceCatalogue.ts`) | 72 |
| Routed web pages (`apps/web/src/pages`) | 77 + public/auth |
| Web feature folders / API modules | 28 / 27 |
| Driver app screens / platform console pages | 24 / 8 |
| Plan documents under `docs/plans` | **241 files, 102,731 lines** |

The largest plan areas are recruitment (44 docs, 23,186 lines), the driver app (25 docs, 11,147
lines) and fuel (9 docs, 7,267 lines). Plans have outgrown what anyone can read before acting,
which is one reason their status lines drift.

---

## 2. The features

There are 22 features. For each one:

- **Pages** are path → `apps/web/src/pages/<Page>.vue`, with the line count.
- **Components** are the feature's own components; shared primitives such as `DataTable`,
  `FilterBar` and `PageHeader` are left out.
- **Used?** is the measured write activity for the real fleet over 30 days. "Automatic" means a
  collector wrote the rows, not a person.

### F01 Dashboard and live map
- **Pages:**
  - `/` → `DashboardPage` (278)
- **Components:**
  - `features/dashboard`: TabWidgets, DashboardLayoutEditor, FleetReadiness, RiskList, DonutBreakdown, SeverityBreakdown, ChartCard, widgets/
  - `features/livemap`: LiveMapWorkspace, LiveMapCanvas, LiveMapRail, LiveMapControls, LiveMapVehicleFacts, LiveMapStateGlyph
- **API:** `/api/dashboard`, `/api/dashboard-layout`, `/api/livemap` · modules `livemap`, `insights`
- **Data:** `vehicle_positions` (Samsara, automatic), `user_dashboard_layout` (1 row ever)
- **Used?** Read-only, so it can't be measured (X1).
- **Plans:** `livemap/` (6 docs)

### F02 Fuel transactions and cards (EFS)
- **Pages:**
  - `/fuel-log` → `FuelLogPage` (165)
  - `/fuel-cards` → `FuelCardsPage` (473)
  - `/fuel-cards/:id` → `FuelCardDetailPage` (335)
  - `/settings/card-control` → `CardControlSettingsPage` (369)
  - `/settings/efs-soap` → `EfsSoapPage` (450)
- **Components:**
  - `features/fuel`: FillsTab, DeclinesTab, SourceRecordsTab, FillUpForm
  - `features/fuelCards`: CardOperationDrawer, CardEffectiveConfig, ActiveOverridesPanel, CardApproverList, CardChangeLog, UnitMileageDrawer, OverrideLimitPicker, EfsLocationPicker, TypeToConfirm
  - `features/import`: EfsImportDrawer
- **API:** `/api/transactions`, `/api/fuel-cards`, `/api/integrations/efs-soap` · modules `efs` (**112 files, 22,870 lines, the largest API module**), `fuel`
- **Data:** `fuel_transactions` (1,903 in 30 days, automatic), `fuel_cards` (194)
- **Used?** Card actions: 4 EFS audit events in 30 days. Fuel Log reads can't be measured.
- **Plans:** root `EFS-*` (9 docs), `fuel/`

### F03 Fuel costs and savings reports
- **Pages:**
  - `/fuel-spend` → `FuelCostsPage` (253)
  - `/fuel-buy-discipline` → `FuelBuyDisciplinePage` (124)
  - `/fuel-invoices` → `FuelInvoicesPage` (127)
  - `/fuel-invoices/:id` → `FuelInvoiceCheckPage` (77)
- **Components:** `features/reconcile`: FuelCostDaysTable, FuelOpportunitiesStrip, BuyDisciplineTab, DiscountCaptureCard, CheckInvoiceDrawer, InvoiceUpload, ReconResultView, ReportExportButton, PriceCoverageStrip
- **API:** `/api/fueling`, `/api/fueling/recon-runs`, `/api/fueling/statements` · module `fuel-spend` (7,143 lines)
- **Data:** `fuel_report_days` (derived), `fuel_recon_runs` (4 ever), `fuel_recon_run_rows` (1 ever)
- **Used?** 4 invoice checks ever. The first real Pilot statement upload still waits on the owner.
- **Plans:** `fuel/FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md` (1,353 lines), `FUEL-SPEND-*` (≈150k chars), `fuel/UX-TASK-TEST-PROTOCOL.md`

### F04 Fuel findings and alerts
- **Pages:**
  - `/findings` → `FuelExceptionsPage` (440)
  - `/anomalies` → `AnomaliesPage` (155)
  - `/settings/thresholds` → `ThresholdsPage` (141)
  - `/recall-audit` → `RecallAuditPage` (150)
  - `/coverage` → `CoveragePage` (277)
  - `/reefer-coverage` → `ReeferCoveragePage` (192)
- **Components:**
  - `features/reconcile`: ExceptionsTab, ExceptionSlideOver
  - `features/anomalies`: AnomalyDetail and others
- **API:** `/api/anomalies` · modules `anomalies` (4,916 lines), `fuel-spend`
- **Data:**
  - `anomalies` (1,807 in 30 days; 81 open)
  - `fuel_exception_events` (87 in 30 days)
  - `fuel_txn_dispositions` (**0 ever**)
  - `scoring_attempts` (1.9 M in 30 days, machine)
- **Used?** 105 alerts ever acted on by a person. Findings have never been dispositioned.
- **Plans:** `fuel/CARD-FRAUD-ALERTS-PLAN.md` (CF2 stalled, #1216), `ALERTS-DECLINES-AUDIT.md`

### F05 Idling and the idle engine
- **Pages:**
  - `/idling` → `IdlingPage` (348)
  - Console → `CustomerIdleEnginePage`
- **Components:** `features/idle`: IdleBurnRatesPanel, IdleEngineParityPanel
- **API:** `/api/idle` · module `idle` (4,632 lines)
- **Data:** `idle_events` (36,529 in 30 days, automatic), idle engine hour/stop/day tables (0404, 0407)
- **Used?** Read-only, so it can't be measured. The engine's own gate (IE5b) is due about 10-16.
- **Plans:** `fuel/FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md`

### F06 IFTA
- **Pages:**
  - `/ifta` → `IftaLedgerPage` (270)
  - `/ifta/:jurisdiction` → `IftaJurisdictionPage` (301)
- **Components:** `features/ifta` (logic only, 200 lines)
- **API:** `/api/ifta` · module `ifta` (354 lines) plus the McLeod receipts collector
- **Data:** `mcleod_fuel_tax_receipts` (0434), `vehicle_fuel_tax_exclusions` (0433), Samsara IFTA miles
- **Used?** Read-only, so it can't be measured. The Samsara IFTA "400 for September" has no owner.
- **Plans:** `fuel/IFTA-PRECISION-PLAN.md` (IP3 waits on Alex, IP5 and IP7 not started)

### F07 Fuel planning and truck stops
- **Pages:**
  - `/fuel-planning` → `FuelPlanningPage` (149)
  - `/truck-stops` → `FuelStationsPage` (160)
  - `/settings/fuel-planning` → `FuelPlanningSettingsPage` (345)
- **Components:** `features/fueling`: FuelPlanForm, FuelPlanSummary, RouteMap, RouteSummary, TripPlan, PlanHistory, PlanStatusBanner, ManualTelematicsPanel, PriceUploadDrawer
- **API:** routes under `/api/fueling` · modules `routing`, `posted-prices`
- **Data:** `fuel_plans` (6 ever, the last on **09-16**)
- **Used?** No plan in 20 days.
- **Plans:** root `FUEL-PRICE-DATA-PLAN.md`, the planner precision plan

### F08 Dispatch: loads, assignments, messages
- **Pages:**
  - `/loads` → `DispatchLoadsPage` (405)
  - `/loads/:id` → `DispatchLoadDetailPage` (319)
  - `/assignments` → `AssignmentsPage` (226)
  - `/messages` → `MessagesPage` (264)
- **Components:**
  - `features/dispatch`: DispatchLoadDrawer, AssignmentHistory
  - `features/messages`
- **API:** `/api/dispatch`, `/api/tms`, `/api/messages` · modules `loads`, `mcleod`, `messaging`
- **Data:**
  - `loads` and `load_stops` (303 and 629 rows, **all from one 09-23 import**, nothing since)
  - `messages` and `message_threads` (**0 ever**)
- **Used?** Messages have never been used. Loads are not flowing.
- **Plans:** `dispatch-loads/`, `loads-detail/`, `mcleod/`

### F09 Driver performance
- **Pages:**
  - `/driver-performance` → `DriverPerformancePage` (234)
  - `/settings/driver-performance` → `DriverPerformanceSettingsPage` (131)
- **API:** module `performance` (824 lines); the driver app's Score tab
- **Used?** Read-only, so it can't be measured.

### F10 Fleet roster: trucks, trailers, drivers, odometer
- **Pages:**
  - `/vehicles` → `VehiclesPage` (292)
  - `/vehicles/:id` → `VehicleDetailPage` (166)
  - `/trailers` → `TrailersPage` (312)
  - `/drivers` → `DriversPage` (492)
  - `/drivers/:id` → `DriverDetailPage` (356)
  - `/odometer` → `OdometerPage` (214)
- **Components:** `features/roster`: DriverRosterTable, DriverForm, VehicleForm, TrailerForm, VehicleSetupImport, DriverAccessModal, DriverContactSection, SevenDayStatementSection
- **API:** `/api/roster/drivers` · modules `roster`, `samsara`, `mcleod` (roster sweep)
- **Data:** `vehicles` (189 active), `trailers`, `drivers` (174 active), all mostly synced from McLeod/Samsara
- **Used?** Synced automatically. FL2's first live parity run is still owed.
- **Plans:** `roster/`, `samsara/`

### F11 Driver qualification (DQF)
- **Pages:**
  - `/compliance` → `CompliancePage` (200)
  - Sections inside `DriverDetailPage`
- **Components:** `features/compliance`: QualificationFleetTable, QualificationSection, RequirementTable, RequirementDrawer, CertificationHistory, DocumentDropCard, ExportHistory, QualificationSeedPanel
- **API:** `/api/compliance` · module `evidence`
- **Data:**
  - `certifications` (74 in 30 days)
  - `documents` (51 in 30 days)
  - `qualification_records` (**0**)
  - `dq_exports` (**0**)
- **Used?** Documents and certifications are being written. The DQ export has never run.
- **Plans:** `safety-dqf/` (8 docs)

### F12 Recruiting and hiring (office side plus the applicant's page)
- **Pages:**
  - `/recruitment` → `RecruitmentPage` (449)
  - `/recruitment/:id` → `ApplicantRecordPage` (166)
  - `/recruitment/screening` → `ScreeningReadinessPage` (218)
  - `/recruitment/inquiries` → `InquiryQueuePage` (189)
  - `/recruitment/templates` → `RecruitmentTemplatesPage` (98)
  - `/settings/recruiting` → `SettingsRecruitingPage` (67)
  - Public `/apply/:token` → `ApplyPage` (448)
- **Components:**
  - `features/recruitment` (33 vue): HireDrawer, InviteApplicantDrawer, HiringChecklistCard, HiringStepDrawer, ApplicationReviewDrawer, DispositionSection
  - `features/apply` (**59 vue, 18,242 lines**): the applicant's flow, the scanners, signing
- **API:** `/api/recruitment`, `/api/public/application` · module `recruiting` (**142 files, 25,826 lines**)
- **Data:** about 25 tables.
  - `application_intakes`: **1 ever** (the 09-30 test walk)
  - `driver_applications`: **0**
  - `employer_inquiries`: **0**
- **Used?** No real applicant has ever gone through it.
- **Plans:** `recruitment/` (**44 docs, 23,186 lines**)

### F13 Hazmat
- **Pages:**
  - `/hazmat/calculator` → `HazmatCalculatorPage` (13)
  - `/hazmat/review` → `HazmatReviewPage` (107)
  - `/hazmat/loads/:id` → `HazmatLoadDetailPage` (247)
  - Public `/placard-calculator`
- **Components:** `features/hazmat` (14 vue), plus `packages/hazmat-*` (rules engine and regulatory data)
- **API:** `/api/hazmat`, `/api/me/hazmat`, `/api/public/hazmat` · module `hazmat`
- **Data:** `hazmat_loads`, `hazmat_reviews`, `hazmat_documents`, `hazmat_runs` (**all 0 ever**)
- **Used?** Never.
- **Plans:** `hazmat-consolidation/`

### F14 Finance: fleet report and billing
- **Pages:**
  - `/fleet-report` → `FleetReportPage` (294)
  - `/billing` → `BillingPage` (114)
- **Components:** `features/accounting` (17 vue): FleetOverview, FleetHeadlines, FleetTrendChart, FleetTrucksTab, FleetDispatchersTab, FleetContractorsTab, IncomeStatementTab, FleetPeriodRail, ActivityTable
- **API:** `/api/accounting`, `/api/billing` · modules `financial`, `accounting`, `billing`, `mcleod`
- **Data:** `financial_entries` (5,201 in 30 days, automatic), `finance_month_closes` (9, the last on **09-03**)
- **Used?** Read-only, so it can't be measured. No month has been closed since 09-03.
- **Plans:** `financial/` (6 docs)

### F15 Maintenance: shop home, repair spend, FleetPal
- **Pages:**
  - `/shop` → `MaintenanceHomePage` (280)
  - `/shop/repair-spend` → `MaintenanceSpendPage` (96)
  - `/settings/fleetpal` → `FleetpalSettingsPage` (190)
- **API:** `/api/maintenance` · modules `maintenance` (8,660 lines), `fleetpal` (3,185)
- **Data:** the FleetPal raw tables (139,952 meter rows, plus payments and order lines from 0424)
- **Used?** Read-only, so it can't be measured. The C1 collector is live; C2–C4 are not started.
- **Plans:** `maintenance/` (7 docs, 6,489 lines)

### F16 Annual inspections
- **Pages:**
  - `/shop/inspections` → `AnnualInspectionsPage` (296)
  - `/shop/inspections/:id` → `AnnualInspectionFormPage` (383)
  - `/shop/inspectors` → `InspectorRegisterPage` (203)
- **Components:** `features/maintenance`: InspectionHeaderFields, InspectionItemRow, NewInspectionDrawer, PrintInspectionDrawer, DeleteInspectionDrawer, InspectorDrawer
- **Data:** `vehicle_inspections` (**49 in 30 days, 6 in 7 days**), `vehicle_inspection_items` (2,744 in 30 days)
- **Used?** **Yes. This is the most-used human workflow in the product.**

### F17 Parts and inventory
- **Pages:**
  - `/shop/inventory` → `PartsPage` (226)
  - `/shop/inventory/:id` → `PartDetailPage` (345)
  - `/shop/assets` → `AssetsPage` (203)
  - `/shop/assets/:id` → `AssetDetailPage` (320)
  - `/shop/units` → `UnitsPage` (204)
  - `/shop/units/:kind/:id` → `UnitDetailPage` (206)
  - `/shop/count/:sessionId` → `CountSessionPage` (51)
  - `/shop/scan` → `ScanPage` (183)
  - `/shop/labels` → `LabelsPage` (265)
- **Components:** `features/inventory` (21 vue, 4,558 lines)
- **API:** `/api/maintenance/inventory/*` (9 mounts)
- **Data:** `parts`, `part_stock`, `inventory_assets`, `asset_types`, `kit_expectations` (**all 0 ever**), `stock_locations` (1)
- **Used?** Never. The plan's next step, I10, has not started.

### F18 Driver app (Expo)
- **Screens:**
  - Tabs: home, loads, documents, navigate, score, more
  - Flows: duty check-in and end-shift, the loads/stop detail, hazmat capture, messages, notifications, the scanner, settings
- **API:** `/api/driver-app`, `/api/me/*` · module `driver-app`
- **Data:** `driver_duty_sessions` and `duty_equipment_segments` (**0 ever**); 1 driver login
- **Used?** Effectively not yet.
- **Plans:** `drivers-app/` (25 docs, 11,147 lines)

### F19 Settings, users and permissions
- **Pages:**
  - `/settings` → `SettingsPage` (77)
  - `/settings/org` → `OrgSettingsPage` (209)
  - `/settings/users` → `SettingsUsersPage` (468)
  - `/settings/permissions` → `SettingsPermissionsPage` (116)
  - `/settings/data` → `DataSyncPage` (500, **at the file budget**)
  - `/settings/driver-app` → `DriverAppSettingsPage` (497)
  - `/settings/audit` → `AuditPage` (137)
- **Components:** `features/permissions` (RolesTab, PeopleTab, WhoHasAccessTab, SidebarPreview), `features/settings`, `features/jobs`
- **API:** `/api/members`, `/api/invites`, `/api/section-access`, `/api/surface-access`, `/api/access-review`, `/api/org-settings`, `/api/audit`, `/api/jobs` · module `org`
- **Used?** 3 member changes and 2 permission changes in 30 days. SP1–SP11 are complete.
- **Plans:** `permissions/` (10 docs)

### F20 Notifications and scheduled reports
- **Pages:**
  - `/settings/notifications` → `NotificationsPage` (110)
  - `/reports` → `ReportsPage` (287)
  - The bell in the app shell
- **API:** `/api/me/notifications`, `/api/reports` · module `messaging`
- **Data:** `notification_events` (2,888 in 30 days, automatic), plus the dedupe ledger (0432)
- **Used?** It produces a lot. Whether anyone reads it can't be measured.
- **Plans:** #1218, the routing plan (open, unreviewed)

### F21 Ask AI
- **Pages:** `/ask` → `AskAiPage` (92). Admin-only since 09-30.
- **API:** `/api/ai`
- **Used?** Can't be measured.

### F22 Platform console (`apps/admin`, `apps/admin-api`)
- **Pages:** Customers, CustomerDetail, CustomerView, CustomerIdleEngine, Dashboard, Settings (release alert recipients), Login, MFA
- **Used?** **The owner has never signed in.** IE-ADMIN step 2 and #1259 wait on it.
- **Plans:** `platform-console/`

### Data feeds (not a page, but every number depends on them)

| Feed | Module | Feeds features |
|---|---|---|
| EFS (SOAP + card control) | `efs` | F02, F03, F04, F06 |
| Samsara | `samsara` | F01, F05, F06, F09, F10 |
| McLeod (agent plus sweeps) | `mcleod` | F06, F08, F10, F14 |
| FleetPal | `fleetpal` | F15 |
| PSP (MVR and screening) | `psp` | F11, F12 |
| Posted prices | `posted-prices` | F03, F07 |
| Brevo email / Telnyx SMS | `messaging` | F12, F20 |

The fuel-numbers audit (precision §4.2) has to start at the feed: freshness, gaps and failure
alarms. A page cannot be more precise than its feed.

---

## 3. Proposed order

This is a recommendation for the owner to rule on. Order inside a tier follows business value.

**Tier A: used or essential now. Make it right first.**

1. **F02 + F04 Fuel transactions, cards, findings and alerts.** This is the core of the
   fuel-security product. There are 81 open alerts, and no finding has ever been dispositioned.
   Either the workflow is wrong or nobody owns it.
2. **F03 Fuel costs.** It is the money story the owner shows, and the first real invoice upload
   is pending.
3. **F16 Annual inspections.** It is the one workflow people use every week. Protect it, then
   polish it.
4. **F10 Roster** and **F11 DQF.** Every other feature trusts these two lists.
5. **F01 Dashboard** and **F14 Fleet report.** These are the first screens a manager sees.
6. **F19 Settings and permissions.** These are done, but need the same UX and wording pass.

**Tier B: built, never used for real. Get ONE real user per feature before polishing.**

F05 Idling, F06 IFTA (a quarterly filing is due 10-31), F12 Recruiting, F15 Maintenance spend and
FleetPal, F07 Fuel planning, F09 Driver performance, F20 Notifications, F22 Console.

**Tier C: no recorded use. Decide: keep, hide from the sidebar, or retire.**

F13 Hazmat, F17 Parts and inventory, F08 Messages (assignments/loads are part of the same
decision), F18 Driver app duty, F21 Ask AI. Hiding needs no code beyond the existing
`startsOnFor` / section grants. Retiring is a separate, explicit decision per feature.

---

## 4. The per-feature audit checklist

Each feature folder (`docs/plans/product-readiness/Fnn-<name>/`) holds two files:

- **`AUDIT.md`**: findings only, each with evidence (file:line, a query, a screenshot). Nothing
  proposed.
- **`PLAN.md`**: the fixes, ordered as small PRs, each with an acceptance check. Owner questions
  go at the top. It has a one-line status at the top and a dated log at the end. Keep it **under
  300 lines**; if it needs more, the feature is two features.

`AUDIT.md` answers these eight sections, in this order.

### 4.1 Real use and benefit
- Who uses it (role, by name if known), how often, and for which decision.
- Measured use (§1.1 method); where it can't be measured, say so.
- Benefit in dollars, hours or compliance risk. If nobody can name one, the verdict is hide or
  retire.
- **Verdict:** keep and polish / simplify / hide / retire.

### 4.2 Numbers and precision
- Every number on screen and in exports gets its definition, source table, formula, units,
  rounding and date window.
- One definition per number, living in `packages/shared`. A number computed twice is a finding.
- Reconcile at least one number against an outside source (EFS statement, Samsara, McLeod,
  FleetPal) for a real week, and record the difference.
- How stale it can be and how staleness is shown. When data is missing it says "unavailable",
  never 0.
- Watch for PostgREST's 1,000-row cap, calendar day vs instant, and MM/DD/YYYY from the one
  definition.

### 4.3 UI/UX and wording
- The top 3 tasks a real user does here: clicks, screens and scrolls for each, measured.
- Count the tabs, filters, panels, explainer texts and badges. Anything that doesn't serve the
  top 3 tasks is a finding.
- **Wording:** read every label, heading, empty state and error as a busy office user whose first
  language is not English. Use plain words, put the term of art in the hover, and say one thing
  once.
- Loading, empty, error, partial-data and no-permission states; mobile width; keyboard.
- Check against `docs/DESIGN-SYSTEM-CONTRACT.md` and the shared components (reuse, don't replace).

### 4.4 Frontend structure
- Pages, components and composables, with sizes (500-line budget).
- Duplicated logic or components across features; dead components; props nobody passes.

### 4.5 Architecture and API
- Module boundaries (`lint:boundaries`), table ownership (`scripts/table-modules.json`).
- Every service query org-scoped (`expectOrgScoped`), permissions match the section × role matrix,
  and no workarounds (CLAUDE.md §No workarounds).
- Tests: do they fail when the rule breaks (mutation)? Is there a matrix for the SQL?
- Performance: slowest query, largest response, indexes.

### 4.6 Data feeds and jobs
- Which feeds and schedulers it depends on, how a failure shows up, and who gets told.

### 4.7 Production readiness
- Errors are visible (alarm or log), there is a runbook line for the common failure, and the
  docs are current.
- Retention and evidence rules respected; audit rows written for every human change.

### 4.8 Open questions for the owner
- Each question with candidate answers and a recommendation. Nothing is built on an assumption.

**Definition of done for a feature:**
- Every finding in `AUDIT.md` is fixed, ruled "won't fix" by the owner, or moved to another
  feature's plan by name.
- The numbers reconcile to the outside source.
- One real user has done the top 3 tasks without help.
- The plan's status line says DONE with the closing PR.

---

## 5. Cross-cutting items (do these before or beside the first feature)

| ID | Item | Why |
|---|---|---|
| X1 | **Page-view count per surface:** surface key + role + day, no user id, no query string | Without it, §4.1 can't be answered for any report page. |
| X2 | **Plan hygiene:** this programme's plans stay under 300 lines; older plans are linked, not copied | 102,731 lines of plans whose status lines drift. |
| X3 | **One feature at a time, at most 2 chats, each in its own worktree** | The 09-29 → 10-06 collisions (0416, 0434, #1216). |
| X4 | **A migration number is checked against main right before merge** (a gate) | Two collisions in one week. |
| X5 | **Clear the stalled queue first:** #1323 → #1324, then #1216, #1259, #1311, #1314, #1320, #1321, #1218, #1181, #1100 (merge, rebuild or close each) | Open work blocks the release train and hides the real state. |
| X6 | **Commit or delete the untracked local material:** `docs/audits/2026-10-03-database/`, `LEAD-SOURCING-PLAN.md`, `LEAD-ENGINE-RESEARCH.md`, the design-audit evidence | A tracked plan cites a file that exists only on one laptop. |

---

## 6. Open questions for the owner

- **Q-PR1, order.** Accept §3's tiers and start with F02 + F04? **RULED 2026-10-06: yes**, as
  one audit, because findings and alerts are about those transactions. Folder:
  `F02-F04-fuel-transactions-and-findings/`.
- **Q-PR2, Tier C.** Hide Hazmat, Inventory, Messages, Driver-app duty and Ask AI from the sidebar
  until each has a named first user? **RULED 2026-10-06: hide; retire nothing.** Use the existing
  surface grants (`startsOnFor` / section), not a new code path.
- **Q-PR3, who the users are.** Name the person who uses each Tier A feature, so the §4.3 task
  walk is done with them, not imagined. **STILL OPEN.** It is asked before each feature's task
  walk. For F02 + F04 it is that plan's Q-F1.
- **Q-PR4, X1.** Build the page-view count first? **RULED 2026-10-06: yes, early.** It is Step 1
  of the F02 + F04 plan.

---

## Log

- 2026-10-06: Inventory measured and written (PR0). No feature folder created yet; waiting on
  Q-PR1.
- 2026-10-06: Owner ruled Q-PR1, Q-PR2 and Q-PR4 ("proceed as proposed"). Q-PR3 is still open.
  The first feature folder, `F02-F04-fuel-transactions-and-findings/` (AUDIT + PLAN), is written
  and waits on its own Q-F1..Q-F6. Correction to §1.1: "fuel findings given a disposition, ever:
  0" measured `fuel_txn_dispositions`, which holds Recall audit verdicts, not finding reviews.
  Findings have 1 human close (`fuel_exceptions`), and alerts had 410 human status changes, from
  07-01 to 08-14.
