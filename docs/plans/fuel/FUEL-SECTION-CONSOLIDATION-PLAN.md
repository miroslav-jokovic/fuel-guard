# The Fuel section — consolidation, and the case model underneath it

**Opened 2026-09-01 against `main` @ c80fc1c.** Sibling to the four fuel plans at `docs/plans/`
(`FUEL-SPEND-RECONCILIATION-PLAN.md` built the spend feature, `FUEL-SPEND-RELIABILITY-PLAN.md` made it
precise, `FUEL-PRICE-DATA-PLAN.md` and `SMART-FUELING-PLAN.md` own the price layer and the planner).
Those plans each built a thing and each built it well. **This one is about what happened to the section
when eight of them landed next to each other**, and it deliberately builds almost no new capability.

The owner's framing, 2026-09-01, is the thesis and is not paraphrased away: *"we have a lot of things
that are unnecessary and extra and making our UI/UX literally complicated and overwhelming… so this
Fuel section is presentable, easy to read and useful to us and not just some pages we have and we don't
have a clue what for."*

---

## 0. Ground truth (measured 2026-09-01 against the tree; nothing recalled)

### 0.1 What is in the section

Eight nav entries under **Fuel** (`apps/web/src/lib/nav.ts`), ~16 distinct views behind them.

| Nav item | Route | Reads | Job it does | Lines |
|---|---|---|---|---|
| Fuel Log | `/fuel-log` | `fuel_transactions` where `is_canonical` | The product's own fill record: deduped, attributed to vehicle/driver/trailer, computed MPG, miles-since-last, tank type, `case_level`/`case_score`/`case_signals`/`case_gates`. Also the only fuel **write** surface (`Log fill-up` drawer). | 362 |
| Transactions | `/transactions` | `efs_transactions` | The raw vendor mirror — every line of an EFS Transaction report exactly as received, including the DEF/fee/scale lines the log discards. | 168 |
| Rejections | `/rejections` | `declined_transactions` | Declined swipes with their own suspicion scoring (`clear`/`review`/`alert`), error code, policy, plus a read-only card→truck assignment drawer. | 352 |
| Cards | `/fuel-cards`, `/fuel-cards/:id` | EFS card mirror | Card inventory as the vendor reports it, control actions, sync-job ledger, unit-mileage drawer. | 412 + 328 |
| Import | `/import` | — | Tab `efs`: drag XLSX/CSV → analyze → commit, plus a **Repair fuel data** button (`POST /api/transactions/sync-from-efs`). Tab `prices`: `PriceUploadCard` + `StationDataCard`. | 333 |
| Fuel Spend | `/fuel-spend` | `fuel_spend_lines`, `fuel_buy_fills`, statements | **Eight tabs**: Spend & trend · avoided-brand · avoided-state · Off-network · Buy discipline · Discount capture · Reconcile a file · Statements. | 353 |
| Exceptions | `/fuel-spend/exceptions` | `fuel_exceptions` | The recovery ledger: identified / claimed / recovered / still open, six-status lifecycle, CSV, server-rendered dispute packet. | 190 |
| IFTA | `/ifta` | `ifta_period_*` RPCs | Quarterly jurisdiction ledger behind an MPG-plausibility and tie-out health gate. | 211 |

**Fuel surfaces that are not in the Fuel nav group.** This is half the problem and it is invisible from
inside the group:

- **Fuel Planning** and **Truck Stops** are under *Dispatch* (`canManageSection(role,"dispatch")` and
  `canViewSection(role,"dispatch")` respectively).
- **Alerts** (`/anomalies`) is under *Safety*, gated `canViewSection(role,"safety")`. It is the
  fuel-card theft/misuse queue.
- **Anomaly Thresholds**, **Planned Fueling**, **EFS Integration**, **Data & Sync** and **Card control**
  are five Settings pages.
- The **Dashboard** is, in practice, already a fuel dashboard — `useFuelRangeTotals` drives fill-ups,
  gallons, miles, spend and fleet MPG, and the cost-composition chart splits moving / idle / reefer.

### 0.2 Measured facts, each verified

1. **`FuelEventsPage.vue` is dead.** 119 lines, **zero references** in the tree; `/fuel-events`
   redirects to `/fuel-log`. It has been dead since the merge that wrote the redirect.
2. **Fuel Log and Transactions are not the same data.** `useFuelLog` reads `fuel_transactions` with
   `.eq("is_canonical", true)`; `useEfsData` reads `efs_transactions`. One is the derived, deduped,
   scored domain object; the other is the faithful receipt. The owner's instinct that one is redundant
   is right about the *nav*, and backwards about *which one is the product*.
3. **Four unconnected "something is wrong" surfaces.** Alerts (`anomalies`), Rejections
   (`declined_transactions.suspicion_level`), Fuel Spend's three policy tabs (`analyzePolicyExceptions`,
   computed per page load), and Exceptions (`fuel_exceptions`).
4. **The two case models are not merely two vocabularies — they have a different NUMBER OF AXES, and
   this is the single most important measured fact in this document.**
   - `anomalies` is **two-axis**: `ANOMALY_STATUSES` = `open · investigating · resolved · dismissed ·
     superseded` (mirrors the `anomaly_status` Postgres enum), **plus** `ANOMALY_DISPOSITIONS` =
     `confirmed · false_positive · benign_explained · inconclusive`. Its own comment states the split:
     *"status is 'where is this in the queue', disposition is 'was the flag right'"*, and the
     disposition axis is *"the label the whole accuracy program is built on"* — `inconclusive` is
     explicitly excluded from precision.
   - `fuel_exceptions` is **one-axis**: `open · investigating · disputed · credited · dismissed ·
     resolved_by_reingest`, where the close carries money (`credited_amount`) rather than a verdict on
     the detector.
   A single flattened status vocabulary across both would silently destroy the disposition axis and
   with it the detection-accuracy program. See D-FUI7, rewritten around this.
5. **The policy tabs find money and file nothing.** `off_network_premium`, `avoided_state_premium` and
   `avoided_brand_premium` have been in `FUEL_EXCEPTION_KINDS` since 0250 with **no producer**. The
   recorded reason is `policyFindingsNote`: *"201 off-network fills in a 90-day window is not 201
   actions. F6b decides the threshold or the grouping."* **F6b shipped on 2026-08-26 as the surface and
   never answered it.** The question is orphaned — this plan adopts it (Q-FUI3).
6. **The manual Pilot price upload is not redundant with the automated fetch.**
   `postedPriceFetch.ts` scrapes Pilot's public table for **posted retail** into the global
   `fuel_prices_posted` layer. `pilotPriceIngest.ts` parses the emailed **Better-Of Pricing Report**,
   which is the only source of this org's **contracted net price**. Deleting the upload would delete the
   contract price layer.
7. **The manual EFS upload is now a backfill path, not the primary one.** `startEfsSoapPoller`,
   `startEfsIngestScheduler` and `startEfsProcessingScheduler` run per-org in the worker
   (`apps/api/src/schedulers.ts`). Nothing about the Import page says this.
8. **Filter state dies on refresh on four of the eight pages.** Fuel Spend (`useSpendFilters`) and IFTA
   put their window in the URL and say in their own headers why. Fuel Log, Transactions, Rejections and
   Cards hold filters in a local `ref` and are unshareable. Alerts reads `?vehicle=` once as a seed and
   never writes back.
9. **Fuel Spend's `barCount` already carries the fix for a defect this plan generalises.** X8's comment
   records that one unfiltered count sat beside six different tab bodies. The same class of defect —
   one page-level control describing a different tab's data — is what a naive tab merge reintroduces.

### 0.3 The one-line thesis

**The capabilities are built and mostly good; the section is organised by where data came from rather
than by what somebody is trying to do.** Transactions and Import are not jobs — they are provenance.
Alerts and Exceptions are the same job under two roofs. Everything in §5 either moves a provenance
surface behind the thing it explains, or joins two halves of one job.

---

## 1. The architecture this must end in

Five theses. A step that serves none of them does not belong in §5.

### 1.1 Raw source data is evidence, and evidence lives behind the row it explains

`efs_transactions` earned its place: D-FX2's whole argument is that the vendor's account and ours must
be separately inspectable. What it did not earn is a sidebar entry. A controller does not go to a page
called Transactions; they are looking at a fill and asking *what did EFS actually send*. That is a
drawer, and the pattern is already in the tree (`ExceptionSlideOver`, `UnitMileageDrawer`, the
Rejections card drawer).

### 1.2 One inbox, two case tables — the surface unifies, the schema does not

D-FX2 ruled that `fuel_exceptions` cannot be `anomalies`, and the reason still holds:
`anomalies.transaction_id` is `not null`, and the single most valuable finding the reconciler produces —
a line the vendor billed that we have **no** `fuel_transactions` row for — has no transaction by
definition. **This plan does not overturn D-FX2 and does not merge the tables.** It unifies the
*surface*: one Findings inbox reading both producers through a shared read contract, with **one queue
axis** presented to the reader and each source's own close semantics preserved behind it (D-FUI7, and
§0.2 fact 4 for why that qualification is load-bearing rather than fussy). A merged table would be a
workaround with a delay fuse; a merged screen is the actual product requirement.

### 1.3 A detector that does not file a finding is a report, and reports do not get worked

The three policy tabs are the clearest case: they price real money on every page load and leave no trace
that anybody looked. Every detector in the section files into the ledger, or it is honestly labelled as
an analytic view and stops pretending to be a queue.

### 1.4 One period control per page, and it is in the URL

`useSpendFilters` exists because two period controls on one page is how two figures for one week get
quoted at each other. Every page in the section adopts it, and every page becomes sendable.

### 1.5 Nothing in this plan invents a capability to justify a screen

Every merge below removes a surface or moves one. The two genuinely new things — the policy-finding
producer (C6) and the findings inbox (C7) — are both completions of work that shipped deliberately
half-done, with the reason recorded in the source at the time.

---

## 2. Decisions

- **D-FUI1 — Transactions and Rejections become tabs of Fuel Log, and Fuel Log keeps the name.** The
  page becomes `Fills | Declines | Source records`, one window, one truck filter, all three in the URL.
  Fuel Log is the enriched record and the write surface; it is the one that survives.
- **D-FUI2 — the raw EFS line moves into the fill's row drawer.** `Source records` remains as a tab for
  the reconciliation case (a line with no fill has no row to hang off), but the *normal* path to raw
  data is the drawer on the fill it explains.
- **D-FUI3 — `/import` is retired as a page.** EFS upload becomes a drawer on Fuel Log labelled as the
  backfill path it now is; the Pilot price and locations uploads become one Upload drawer on Truck
  Stops; **Repair fuel data** moves to Settings → Data & Sync, which is where the other repair actions
  already are. No capability is lost and no upload is deleted (§0.2 fact 6).
- **D-FUI4 — Fuel Spend keeps three tabs.** `Spend & trend | Buy discipline | Statements`. Reconcile a
  file becomes an upload drawer on the Statements tab (it is an upload, and every other upload in this
  plan is a drawer). Discount capture folds into Spend & trend as a KPI with drill-down. The three
  policy tabs become finding kinds — see D-FUI5.
- **D-FUI5 — the policy tabs stop being tabs and start being producers.** Grouped, not per-fill: the
  unit of work is *this truck, off-network, this month, $N* — not 201 rows. This answers the orphaned
  `policyFindingsNote` question; the grouping key is fixed in Q-FUI3 before C6 is built.
- **D-FUI6 — Exceptions is renamed Findings and becomes the section's single inbox.** Not because
  "exception" is wrong, but because it must now hold anomaly cases too, and those are not billing
  exceptions.
- **D-FUI7 — one WORKFLOW axis is presented; each source keeps its own CLOSE axis.** Measured fact 4
  forbids the obvious design. What the two models genuinely share is the queue axis —
  `open → investigating → (working) → closed` — and that is what the inbox presents, filters and ages
  on. What they do not share is what closing MEANS: an anomaly closes with a **disposition** (was the
  flag right — the accuracy program's ground truth), a fuel exception closes with **money** (credited,
  or a decision not to pursue). The inbox therefore renders one status column and a per-kind close
  affordance, and the shared module maps only the queue axis. **`resolved → credited` and
  `resolved → dismissed` are both wrong and are named here so nobody writes them:** an anomaly resolved
  as `confirmed` is a true finding that recovered nothing, and mapping it onto either would corrupt both
  the recovery figure and the precision figure. `superseded` maps to `resolved_by_reingest` — the same
  idea in both vocabularies, and the only clean correspondence in the set.
- **D-FUI8 — every page in the section adopts `useSpendFilters`' URL-window pattern.** Shipped as its
  own step (C3) rather than smuggled into a merge, because it touches four pages and one regression
  there is invisible in review.
- **D-FUI9 — no new Fuel overview page.** The Dashboard already computes exactly those figures from
  `useFuelRangeTotals`. A second one would be a second source of truth for the same five numbers.
  C9 improves the Dashboard's fuel strip instead.
- **D-FUI10 — targets ship with the policy, not with the report.** An exception count without a target
  is not a management number. `route_fuel_settings` already holds `avoid_states` / `avoid_brands`; the
  target thresholds go beside them, not into a new table.

---

## 3. Facts the design is bound by (verified 2026-09-01)

- `anomalies` carries **two axes** (§0.2 fact 4) and `fuel_exceptions` carries one. Any shared read
  contract is a discriminated union on the close, not a widened enum.
- `SECTION_ACCESS` (`packages/shared/src/auth.ts`) gives `accountant` and `dispatcher`
  `fuel: "view"`, `safety: "none"`. **A Findings inbox in the Fuel section that contains anomaly cases
  hands fuel-card theft alerts to the bookkeeper and the dispatcher.** This is Q-FUI1 and it blocks C7b,
  not C7a.
- `safety_manager` has `fuel: "view"`, `safety: "manage"` — so the same inbox must let a safety manager
  *act* on the anomaly half while only reading the spend half. Per-kind write gating, not per-page.
- The Exceptions route is `requiresAuth` only, deliberately: its own comment records that a controller
  checking recoveries must not need permission to upload a statement. A merge that inherits Fuel Spend's
  `requiresManage: "fuel"` silently narrows access.
- `router/routeTable.test.ts` holds **two committed snapshots** (path-sorted, and order-sensitive
  resolution). Every route change in this plan updates them, and the diff is how the change is
  acknowledged.
- `apps/web/src/lib/nav.test.ts` requires a **unique glyph per nav item**. Removing items is free;
  any new one needs an icon added to `packages/ui/src/icons.ts` first, per that barrel's instructions.
- The old paths are kept forever, not for a deprecation window — `fuel.ts`' own comment. Every route
  retired here gains a `redirect` that preserves the query string.
- 500-line file budget, warn at 450 (`lint:filesize`). `FuelCardsPage.vue` is at 412 and
  `FuelLogPage.vue` at 362; C2 adds two tabs to the latter and **must** extract, not append.
- `lint:ui-adoption` refuses raw `<input>`; `lint:comment-claims` requires a quoted real test title;
  `pnpm lint` scans `.claude/worktrees` — filter the path before believing a failure count.
- No migration in this plan may ship in the same merge as its first reader
  (`lint:migration-ordering`, `docs/MIGRATION-DISCIPLINE.md` §the-deploy-window).

---

## 4. Execution protocol

**Resume ritual (a fresh chat starts here):**

1. Read this document top to bottom, then `FUEL-SPEND-RELIABILITY-PLAN.md` §2 and §6 (the decisions and
   the open questions this plan inherits), then `apps/web/CLAUDE.md` and
   `docs/DESIGN-SYSTEM-CONTRACT.md`.
2. Establish reality: `git log --oneline -15`, `pnpm verify:live`, `git branch --show-current`.
3. Find the first §5 step not marked **DONE**. Check its prerequisites against §6. A missing
   prerequisite means take the fallback written beside it — never guess.
4. One step per branch (`claude/<topic>`), branched from `origin/main` **explicitly** (parallel chats
   share this working tree), PR to `main`, merge after CI.
5. When a step ships, mark it **— DONE \<date\>** in place with "What shipped" and "Verified by:"
   naming the gates. When a §6 question is answered, strike it through in place with the answer and the
   date. **This document is the memory between sessions.**

**Gates before any PR:** `pnpm test`, `pnpm typecheck`, `pnpm lint`, plus each step's named extras.
Every step that touches routes additionally runs the route-table and nav snapshots; every step that
touches a page runs `lint:ui-adoption`, `lint:filesize` and `lint:funcsize`.

---

## 5. Steps

Ordered so that each one is independently shippable and independently revertible, and so the two
blocked steps sit at the end rather than stalling the section.

---

### C1 · Delete the dead page, and say what Import is for

No merges, no routes moved — the cheapest possible first PR, and it makes the next four smaller.

**Build.**
- Delete `apps/web/src/pages/FuelEventsPage.vue` (§0.2 fact 2). The `/fuel-events` redirect stays.
- On the Import page's EFS tab, replace the copy that implies uploading is the normal path with what is
  actually true: the SOAP poller ingests continuously, and this is the backfill path for a gap or a
  period the feed never carried.

**Done when.** The tree has no unreferenced page in the fuel section, and no reader is told to upload a
file the worker already has.

**Verified by.** `pnpm test`, `pnpm typecheck`, `pnpm lint`, route-table snapshot unchanged.

---

### C2 · Fuel Log absorbs Transactions and Rejections

**Prerequisites:** C1.

**Build.**
- `/fuel-log?tab=fills|declines|source`, one `AppTabs`, tab in the URL.
- **One filter bar, and the count is the count of what THIS tab shows** — X8's defect, generalised. The
  window and truck filter are shared; per-tab facets (item/state for source records, error code/policy
  for declines) render only on their own tab.
- Extract each tab body to `apps/web/src/features/fuel/` — `FillsTab.vue`, `DeclinesTab.vue`,
  `SourceRecordsTab.vue` — from the existing pages, not rewritten. `FuelLogPage.vue` ends as a shell
  under 200 lines.
- `/transactions` and `/rejections` become query-preserving redirects.
- Nav loses two items: Fuel drops to six.

**Done when.** Every filter, column and sort that worked on the three pages works on the three tabs; a
link to `/transactions?unit=654` lands on the source-records tab with unit 654 applied.

**Verified by.** Page tests mounting all three tabs (the three pages have none today — this is the
first time any of them is under test); both route-table snapshots updated; `nav.test.ts`;
`lint:filesize` on the extracted files.

---

### C3 · Every fuel page becomes sendable

**Prerequisites:** C2 (so it is done once, on the merged page).

**Build.** Adopt the `useSpendFilters` pattern — the coalescing patch buffer included, for the reason
its own header records — on Fuel Log, Cards and Alerts. Alerts additionally **writes** `?vehicle=` back
rather than only seeding from it.

**Done when.** Every page in the section survives a refresh with its filters, and every one can be
pasted into a ticket.

**Verified by.** A test per page asserting round-trip through the query string, including the
two-`v-model`-in-one-tick case that welded the spend window to 90 days.

---

### C4 · Retire `/import`

**Prerequisites:** C2.

**Build.**
- EFS upload → `SlideOver` on Fuel Log, opened from the page header.
- Pilot price report + Pilot locations export + posted-price upload/fetch → **one** Upload drawer on
  Truck Stops (`PriceUploadCard` and `StationDataCard` move, unchanged).
- **Repair fuel data** → Settings → Data & Sync.
- `/import` becomes a redirect to `/fuel-log`. Nav drops to five in the Fuel group.

**Done when.** No upload capability is lost, and the section has no page whose title is a verb applied
to a file format.

**Verified by.** Upload tests move with their components; route-table and nav snapshots;
`lint:ui-adoption` on the two new drawers.

---

### C5 · Fuel Spend, eight tabs to three

**Prerequisites:** C4. **Must land before C6**, so the policy tabs are removed by the step that
replaces them rather than left doubled.

**Build.** `Spend & trend | Buy discipline | Statements`. Reconcile a file becomes an upload drawer on
Statements. Discount capture becomes a KPI on Spend & trend that drills into the fills behind it. The
three policy tab bodies are **kept in the tree, unmounted**, until C6 files their findings — a report
deleted before its replacement produces anything is a capability gap, however brief.

**Done when.** The page has three tabs and the coverage line still renders above all of them.

**Verified by.** The existing `spendTabs.test.ts` suite, extended for the drawer; route-table snapshot
(the `?tab=` values change).

---

### C6 · The policy detectors file findings

**Prerequisites:** C5, and **Q-FUI3 answered**. Blocked until then; the fallback is that C5 ships and
the policy views remain as unmounted code with an issue reference, which is a stated gap, not a
workaround.

**Build.**
- A producer in `packages/shared/src/fuelSpend/` emitting `off_network_premium`,
  `avoided_state_premium`, `avoided_brand_premium` at the **grouping** Q-FUI3 fixes, with its own
  `POLICY_EXCEPTION_KINDS` close-scope constant beside it — never widening `RECON_EXCEPTION_KINDS`,
  per that constant's own comment.
- A deterministic fingerprint over the grouping key, so a re-run refreshes evidence and leaves status,
  owner and note alone (D-FX10).
- Wired into the same `sync_fuel_exceptions` path the reconciler uses.

**Done when.** A window that shows an off-network premium on the old tab produces findings totalling the
same money, and re-running the window twice does not reset a human's work.

**Verified by.** A PGlite matrix printing a `RESULT` line (the `fuel-exceptions` matrix pattern);
shared tests on the producer, the grouping and fingerprint stability; `lint:table-producers`,
`lint:upserts`, `lint:comment-claims`.

---

### C7 · One Findings inbox

Split in two along the seam the work has, exactly as F6 was.

**C7a — the mapping and the read contract.** *Prerequisites: C6.* A pure shared module holding (i) the
presented queue axis, (ii) a total map from each source's status onto it and back, and (iii) a single
read contract both producers satisfy, in which the close is a **discriminated union** — a disposition
for an anomaly, a money outcome for an exception — never a flattened enum. No screen. This is where
D-FUI7 is proven and it is the step that makes C7b small; it is useless to a reader on its own and that
is fine.

**C7b — the surface.** *Prerequisites: C7a, and **Q-FUI1 answered**.* `/fuel-spend/exceptions` becomes
`/findings`, holding both sources, with per-kind write gating, assignment, aging, and bulk actions.
Blocked on the permission ruling: without it, the honest outcome is that C7a ships and the inbox does
not, and **that is the outcome to take** rather than placing the page where a capability check happens
to pass.

**Verified by.** C7a: shared tests over the full cross-product of `ANOMALY_STATUSES` ×
`FUEL_EXCEPTION_STATUSES`, asserting the round trip and asserting that the two mappings D-FUI7 names as
wrong are unrepresentable; plus a test that every `ANOMALY_DISPOSITIONS` value survives the read
contract intact. C7b: page tests per role from `SECTION_ACCESS`, `lint:section-policies`, both
snapshots.

---

### C8 · Targets beside the policy

**Prerequisites:** C6.

**Build.** Target thresholds (on-network share, discount capture, avoided-state gallons) added to
`route_fuel_settings` and surfaced on Settings → Planned Fueling beside the avoid-lists they qualify.
Every policy figure renders variance-to-target. **Two merges** — the column, then its first reader
(`lint:migration-ordering`).

**Done when.** No policy figure on the section renders as a bare count.

---

### C9 · The Dashboard's fuel strip earns its links

**Prerequisites:** C2, C7a.

**Build.** The five fuel tiles all link to `/fuel-log` today. Point each at the view that answers it,
and add open-findings and recovered-this-quarter beside them, from the ledger. No new page (D-FUI9).

---

## 6. Open questions register

| Id | Question | Owner | Fallback the code takes until answered |
|---|---|---|---|
| **Q-FUI1** | **Where does a fuel-card theft alert belong in the capability matrix?** `/anomalies` is gated `safety`, but an `accountant` and a `dispatcher` have `fuel: view`, `safety: none`. Merging Alerts into a Fuel-section inbox either shows theft cases to the bookkeeper or hides them from the safety manager. Candidates: **(a)** the inbox lives in Fuel and each finding kind carries its own section — a `safety`-kind row is filtered out for anyone without it (**recommended**: it is the only option that does not move a capability boundary to suit a screen); **(b)** move fuel-card anomalies from `safety` to `fuel` in `SECTION_ACCESS` — defensible, since a card-misuse alert is a fuel fact, but it is a real widening and needs saying out loud; **(c)** two inboxes stay. | Miki | **C7b does not ship.** C7a ships and the two inboxes remain. No page is placed where a permission check happens to pass. |
| **Q-FUI2** | **Does the merged Fuel Log stay `requiresAuth`?** Fuel Log is ungated today so drivers keep it; Transactions and Rejections need `canViewSection(role,"fuel")`. Per-tab gating is the obvious answer and needs confirming, because it means a driver sees a tab strip with one tab. | Miki | Per-tab gating, driver sees Fills only. Stated in the page header comment. |
| **Q-FUI3** | **What is the unit of work for a policy finding?** Inherited from `policyFindingsNote` via F6b, which shipped without answering it. Candidates: per truck × kind × month (**recommended** — matches how a fleet manager holds a conversation with a driver); per kind × month fleet-wide; per fill above a dollar threshold. | Miki | **C6 does not ship.** C5 ships and the policy views stay in the tree unmounted, with the gap stated. |
| **Q-FUI4** | Inherits **Q-FX8** from `FUEL-SPEND-RELIABILITY-PLAN.md` §6 — who owns a finding operationally. C7b needs a default assignee; the question is now blocking rather than theoretical. | Miki | `rolesThatManage("fuel")` writes; unassigned by default. No new role invented on a guess. |
| **Q-FUI5** | Should **Fuel Planning** and **Truck Stops** move from Dispatch into Fuel? They are fuel objects gated on `dispatch`. Moving them means either changing their gate or accepting a nav group whose items ask two different capability questions (Fleet already does this deliberately, and says so). | Miki | They stay in Dispatch. C4 puts the price upload on Truck Stops regardless — the drawer follows the page, wherever the page lives. |

---

## 7. What this plan deliberately does not do

- **It does not merge `anomalies` into `fuel_exceptions`.** D-FX2 ruled on that with a reason that still
  holds — `anomalies.transaction_id is not null` cannot express a billed line we never recorded. The
  unification is at the surface (§1.2).
- **It does not touch IFTA.** The owner has said it is an incomplete mirror of Samsara's report and is a
  separate track; `SAMSARA-IFTA-MILEAGE-PLAN.md` owns the data underneath it.
- **It does not touch McLeod.** The financial pipeline is mid-flight and its own plans own it.
- **It does not delete an upload path.** §0.2 fact 6 — the Pilot email report is the only source of
  contract net price. Every upload in `/import` survives; only its address changes.
- **It does not add a Fuel overview page.** D-FUI9.
- **It does not build a new lifecycle, and it does not flatten the two that exist.** C7a maps the queue
  axis the two models share and leaves each close axis alone — the disposition the accuracy program is
  built on is not a status and is not converted into one.
- **It does not pin migration numbers.** Next-numbered at execution.
