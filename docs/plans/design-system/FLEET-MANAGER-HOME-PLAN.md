# Fleet manager home — the Operations tab

**Status:** PLAN, 2026-10-12. Nothing in the app is changed by this document. Decisions are `D-FM*`,
open questions `Q-FM*`, build steps `FM1..FM5`. Progress is appended to §9, never written into the
step table (`plan-progress-log` rule).

**Read first:** `docs/plans/livemap/LIVE-MAP-PLAN.md` D-DW1..D-DW6 and LM-T (the Dashboard is one page
of gated tabs, and a tab is never a `session.role` branch), and `FLEET-OVERVIEW-REDESIGN-PROPOSAL.md`
D-FO1/D-FO2 (a card answers one question, and every figure appears once on its tab). This plan adds
a third tab under those rules. It does not reopen any of them.

---

## 1. The ask, and what it really is

Owner, 2026-10-12: *"a new Fleet Manager page, the default page for the Fleet Manager role, like the
one we have for the dispatcher, because a fleet manager doesn't need to see the financial data on
Fleet overview."*

Measured against the code, the money half is already handled. `fleet_manager` holds `accounting: none`
(`packages/shared/src/auth.ts`), and `applyMoneyGate` already removes every dollar figure from Fleet
overview for them. The savings card is gated on `accounting` and is not drawn at all. So a fleet
manager today sees **no money**. The actual gap is that **everything they see is about fuel**.

The fleet manager is the one role holding `manage` on nearly every operational section: dispatch,
equipment, maintenance, roster, safety, hazmat, recruitment and fuel. Yet the Dashboard shows them
nothing about trucks, the shop, driver files or the road. Since #1473 (D-DW2 amended the same
morning) they land on the Dispatch live map. That is a workspace for finding one truck, not a summary
of the fleet.

So the page must answer one question:

> **Is my fleet ready to run today, and what is stopping it?**

## 2. Measured in production, 2026-10-12

Real fleet, org `86d6b3ea…`, read-only `supabase db query --linked`.

| Fact | Value | Consequence |
|---|---|---|
| Vehicles not retired | 244 = 197 active + 5 maintenance + 42 ordered | "Ordered" is a real bucket. A truck count must say which statuses it counts |
| `vehicles.winding_down` | 0 | Board already hides these (D-DB11); nothing to show yet |
| Active trucks with no `assigned_driver_id` | **39** | The biggest operational number on the page, and no screen shows it today |
| Active drivers with no truck | 9 | Pair it with the line above |
| Drivers | 168 active · 16 inactive · 113 terminated · 1 applicant | DQ rollup runs over active + on_leave (`complianceOverview`) |
| `dot_annual_inspection_expires_at` set | 193 of 244 | Good enough to count. **2 overdue, 3 due in 30 days** |
| `registration_expires_at` set | 193 of 244 | **11 overdue**. Not in the web's `VEHICLE_COLS` today (FM2 adds it) |
| `next_pm_due_at` set | 0 | Dead column (`fleetpal/ingest/equipment.ts`). PM-due is NOT available from it |
| FleetPal work orders | 19 OPEN (oldest 2026-06-24) · 5,431 closed | Real data, **no reader**. Needs FM3 |
| FleetPal defects unresolved | 51, all `severity` null | Count is real; severity cannot be shown |
| FleetPal expirations | 0 rows | Nothing to show; do not build a reader for it |
| FleetPal PM schedules / intervals | 1,106 / 1,106; no due date column | PM due/overdue needs a computation, not a read. Out of scope (Q-FM5) |
| `fmcsa_raw_rows` / `roadside_inspections` | 7,292 / **0** | The FMCSA feed runs; the projection has not filled production. Roadside card is blocked (FM5) |

## 3. Decisions

- **D-FM1: a third Dashboard tab, not a new page or route.** One `DashboardPage.vue` renders gated tabs
  (D-DW6). A new route would be the second dashboard D-DW6 deleted. Key `ops`, label per Q-FM1.

- **D-FM2: the tab's gate is `manage("equipment")`, which needs `DashboardTab.gate` widened from
  `AppSection` to `SurfaceGate`.** Every view-level gate would hand the tab to people it was not
  built for:
  - `equipment: view` adds dispatchers and safety managers.
  - `maintenance: view` adds the accountant.

  `equipment: manage` is held by exactly admin and fleet_manager, and by anyone an org grants it
  (D-PERM4 sparse overrides), which is the honest meaning of "the person who runs the fleet's
  record". Widening the type is the fix, not a detour: `SurfaceGate` and `surfaceGateAllows` are
  already what widgets use (`DashboardWidget.gate`), so a tab asking `session.canView(section)` was
  the odd one out. `visibleTabs` takes a predicate over `SurfaceGate`, and `DashboardPage` passes
  `canReachSurface`-style evaluation, exactly as `TabWidgets` does for cards. The auditor holds
  `equipment: view` only, so they do not get the tab. That is right: they audit records, they do not
  run the fleet.

- **D-FM3: `fleet_manager` moves from Dispatch's `defaultFor` to `ops`'s.** It undoes #1473's
  "for now", which is the ruling's own stated undo. Dispatch and Fleet overview stay one tab away.
  The tab strip becomes Fleet overview · Dispatch · Operations, in catalogue order; Q-FM2 asks
  whether Operations should come first.

- **D-FM4: every card has its own section gate, and the tab gate does not stand in for it.** An
  admin, or an org that grants `equipment: manage` to someone with `roster: none`, sees only the
  cards they pass. Cards are catalogued in `DASHBOARD_WIDGETS` with `tab: "ops"`, so Customize,
  the per-user layout (one row across tabs, `mergeTabLayout`) and the permissions preview work
  with no new code.

- **D-FM5: the tab is NOW, with no range picker.** Every card is current state except the fuel card,
  which states its own fixed window ("last 30 days vs the 30 before") on its face. A range control
  scoping one card of eight would be the "mixed time semantics, unmarked" defect §1.2(4) of the Fleet
  overview proposal named.

- **D-FM6: no money, by construction rather than by gate.** No card reads a currency field, so
  `applyMoneyGate` has nothing to do here. The equivalence test's "no currency figure anywhere" check
  is extended to this tab, so a later card cannot quietly add one.

- **D-FM7: counts are DERIVED from the rule that already decides them, never re-stated.**
  - Board counts call `BOARD_QUEUES[*].test`, the same predicate behind each board tab, so
    "Late risk 4" on the card is the row count on `/assignments?queue=late`.
  - DQ counts call `buildDqDigestSection` (the weekly email's rollup).
  - "In service" uses `IN_SERVICE_VEHICLE_STATUSES`.

  A card that counts differently from the page it links to is the first bug report this tab would
  get.

- **D-FM8: each card lives in the feature that owns its data; the registry in `lib/` composes them.**
  `check-feature-boundaries` refuses `features/dashboard → features/dispatch`, so a dispatch card is
  `features/dispatch/FleetNowWidget.vue`. That is the same arrangement as `SavingsWidget` in
  `features/reconcile` and `LiveMapWorkspace` in `features/livemap`.

- **D-FM9: every figure is a door.** Each count links to the page that lists exactly those rows,
  carrying the filter in the URL. A figure with no list behind it is not shown.

## 4. The cards

Grid is twelve columns (Q-FO3). `md` collapses per D-DT5. Keys are storable (LM10), so they are fixed
here.

### Row 1: the road, now

**1. `ops.fleet-now` · "Fleet right now" · span 5 · gate `section("dispatch")` + module `dispatch`**

- Question: *What is every truck doing?*
- Figures:
  - in-service truck count, as the headline;
  - Loaded (row has `current`), Empty (`emptyNow`), In shop (`inShop`), No driver (row `driver`
    null), as a stacked bar plus four labelled counts.
- Source: `useDispatchBoardQuery` (60 s poll; the cache is shared with `/assignments`).
- Doors: `/assignments?queue=empty`; In shop and No driver go to `/assignments`.

**2. `ops.road-attention` · "Needs a hand now" · span 4 · gate `section("dispatch")` + module `dispatch`**

- Question: *What is going wrong on the road?*
- Figures: one row per board queue except `all` and `attention`, so Late risk, HOS low, No GPS,
  No next load, Empty now. Plus Uncovered loads (`uncoveredCount`). A zero row reads "None", not
  hidden: a fleet manager needs to see that nothing is late.
- Footer: "HOS as of …" from `hosAsOf`.
- Doors: `/assignments?queue=<value>`; Uncovered goes to `/loads?queue=uncovered&scope=all`.
- ⚠ Empty now appears on both card 1 and card 2. Resolve per Q-FM3 (recommended: drop it from
  card 2).

**3. `ops.driver-files` · "Driver files" · span 3 · gate `section("roster")`**

- Question: *Is every driver legal to drive?*
- Figures: Expired, Expiring in 30 days, Not started (`buildDqDigestSection` over
  `GET /api/compliance/overview`), plus the soonest dated item's driver and label.
- Door: `/compliance` with its matching filter.

### Row 2: the trucks

**4. `ops.seats` · "Seats" · span 4 · gate `section("equipment")`**

- Question: *Is every truck earning?*
- Figures:
  - Trucks without a driver (active, `assigned_driver_id` null): **39 today**.
  - Drivers without a truck: **9**. This line renders only when `canView("roster")`, the same
    per-element pattern as `moneyGate`.
  - Trucks on order (`ordered`): **42**.
- Source: `useVehiclesQuery` + `useDriversQuery` (both already cached app-wide).
- Doors: `/vehicles` and `/drivers` with filters. If either list has no such filter, FM2 adds it;
  the card does not link to an unfiltered list.

**5. `ops.shop` · "Shop" · span 4 · gate `section("maintenance")`**

- Question: *What is broken or waiting on the shop?*
- Figures: Open work orders (19) with the oldest's age, Unresolved defects (51), Parts below
  minimum (low-stock count).
- Source: FM3's `GET /api/maintenance/shop-summary`. Until FM3 lands, the card is not catalogued.
  A card showing only low stock would claim to answer "what is broken" and could not.
- Doors: `/shop`, `/shop/inventory?…low`.

**6. `ops.truck-papers` · "Truck paperwork" · span 4 · gate `section("equipment")`**

- Question: *Is every truck legal to run?*
- Figures:
  - Annual DOT inspection: overdue (2), due in 30 days (3).
  - Registration: overdue (11), due in 30 days.
  - "Not on file: N", so the 51 unknowns are visible instead of counted as fine.
- Source: `useVehiclesQuery`; FM2 adds `registration_expires_at` to `VEHICLE_COLS`. No migration.
- Day maths uses the carrier's zone (`todayInZone`), per the calendar-day rule.
- Door: `/vehicles` filtered; `/shop/inspections` for the annual line.

### Row 3: the rest of the operation

**7. `ops.fuel` · "Fuel" · span 6 · gate `section("fuel")`**

- Question: *Is fuel behaving?*
- Figures, no money: Fleet MPG vs the previous 30 days (`useFleetMpg`), Open fuel cases
  (`openAnomalies`), Idle hours with delta.
- Fixed window per D-FM5.
- Door: "Fleet overview →" (`/?tab=fleet`). This card is the summary and that tab is the detail.
  None of its figures is restated elsewhere on this tab.

**8. `ops.hazmat` · "Hazmat to review" · span 3 · gate `section("hazmat")` + module `hazmatguard`**

- Figure: `GET /api/hazmat/review-count`, already the nav badge's source.
- Door: the hazmat review queue.

**9. `ops.hiring` · "Hiring" · span 3 · gate `section("recruitment")`**

- Figures: applicants by stage group: In progress (`not_started` + `filling_in`), Waiting on us
  (`awaiting_review`, `ready_to_screen`), Waiting on them (`awaiting_signature`,
  `history_incomplete`, `awaiting_releases`).
- Source: `GET /api/recruitment/pipeline`, grouped client-side. The grouping is a shared pure
  function in `packages/shared`, beside `APPLICANT_STAGES`, not in the card.
- Door: `/recruitment?stage=…`.

### Later

**10. `ops.roadside` · "Roadside inspections" (FM5, blocked)**

- Figures: last 90 days' inspections, OOS orders (driver / vehicle / hazmat), clean-inspection rate.
- Gate: `section("safety")`.
- Blocked because production has 7,292 raw FMCSA rows and 0 projected inspections (§2). It belongs
  to `safety-dqf/INSPECTION-CHALLENGE-PLAN.md`'s read layer, so this plan consumes that read and
  does not build its own.

### Left off on purpose

- **Any money**, including repair spend from `/shop` (D-FM6).
- **PM due/overdue**: no stored due date exists (Q-FM5).
- **FleetPal expirations**: the table is empty.
- **Samsara safety events, HOS violations, accidents, CSA scores**: none is stored.
- **The live map**: it is the Dispatch tab, one click away.

## 5. Build steps

Every step is branch → PR → CI → merge, and is deployed to staging on merge and to production by the
release train.

| Step | What | Files (main paths) | Proof |
|---|---|---|---|
| **FM1** | Tab + gate widening + default move. `DashboardTab.gate: SurfaceGate`; `visibleTabs(allows)` over `SurfaceGate`; `{ key: "ops", label, gate: manage("equipment"), defaultFor: ["fleet_manager"] }`; drop `fleet_manager` from Dispatch's `defaultFor`; amend D-DW2 in LIVE-MAP-PLAN. (`check-surfaces.mjs`'s `tabKeys` reads only `key:`, so it needs no change; it will demand every `tab: "ops"` widget names a real tab, which FM2 satisfies) | `dashboardTabs.ts`, `DashboardPage.vue`, `dashboardTabs.test.ts` | Tests: fleet_manager lands on `ops`; dispatcher, safety_manager, auditor and accountant do NOT see it; an org override granting `equipment: manage` to a dispatcher shows it (proves gate, not role). Ships together with FM2 so the tab is never empty in production |
| **FM2** | Cards 1, 2, 3, 4, 6, 7, 8, 9 + registry + catalogue rows; `registration_expires_at` into `VEHICLE_COLS`; missing list filters for doors (D-FM9); stage-group function in shared | `features/dispatch/*Widget.vue`, `features/compliance/…`, `features/roster/…` (seats/papers), `features/fuel/…`, `features/hazmat/…`, `features/recruitment/…`; `lib/dashboardWidgets.ts`; `packages/shared/src/dashboardWidgets.ts`; API `dashboardLayout.test.ts` pinned keys | Per card: counts equal the linked list's row count on the same fixture (D-FM7); each figure's href; no-currency test extended to `ops`; `tabWidgetsLayout` renders cards by gate; mutation pass per `prove-tests-fail-by-mutating` |
| **FM3** | `GET /api/maintenance/shop-summary` → `{ openWorkOrders, oldestOpenWorkOrderOn, unresolvedDefects, lowStockParts }`, org-scoped, `requireSection("maintenance","view")`, owned by the `fleetpal` module for WO/defects plus the inventory read; contract in `packages/shared`; then card 5 | `apps/api/src/modules/fleetpal/…`, `modules/maintenance/routes`, `shopSummaryContract.ts`, `features/maintenance/ShopWidget.vue` | `expectOrgScoped` on every query; counts on a fixture with CLOSED/CANCELED/OPEN rows; route-table snapshot |
| **FM4** | Browser pass on staging as a fleet_manager and as a dispatcher (dev-bypass recipe), at 1440 and 1104 widths; screenshots into §9 | none | Visual |
| **FM5** | Roadside card, after the inspection plan's read exists and production projects rows | per that plan | Blocked |

FM1 + FM2 are one PR (owner's standing preference for large batches). FM3 is a second. Neither
needs a migration.

## 6. Risks

- **Board cost.** Two cards share `useDispatchBoardQuery`'s cache key, so this tab adds no request
  beyond what `/assignments` already makes. Not one per card.
- **Compliance overview weight.** It returns every active driver (168). That is acceptable for one
  card. If the network panel shows it is slow, a count endpoint is a follow-up, not a reason to
  hold the card.
- **Stored layouts.** New `ops.*` keys are absent from every stored row, so `resolveDashboardLayout`
  shows the default. Nobody's Fleet overview arrangement moves (`mergeTabLayout` touches only the
  offered tab's keys).

## 7. Open questions

- **Q-FM1: tab label.** (a) "Operations"; (b) "Fleet manager"; (c) "My fleet". **Recommend (a).**
  An admin sees the tab too, and a label naming a role reads wrong to everyone else who holds the
  grant.
- **Q-FM2: tab order.** (a) catalogue order Fleet overview · Dispatch · Operations; (b) Operations
  first. **Recommend (b).** It is the summary the other two drill into, and admins open on the first
  tab (they are in no `defaultFor`), so (b) also makes it the admin's landing tab. Say no if admins
  should keep landing on Fleet overview.
- **Q-FM3: "Empty now" on two cards.** **Recommend:** keep it on Fleet right now only. Card 2 keeps
  "No next load", which is the actionable form.
- **Q-FM4: does a fleet manager keep Fleet overview?** **Recommend yes.** It carries no money for
  them (§1), and MPG/idle detail lives only there.
- **Q-FM5: PM due/overdue.** FleetPal holds schedules and intervals but no due date. Computing one
  is (interval × last done × odometer) per unit, about a plan of its own. **Recommend:** defer, and
  record it in `docs/plans/maintenance/` as the shop card's next figure.
- **Q-FM6: the Shop card's work-order and defect figures have no list to open (found building FM3,
  2026-10-13).** §4 card 5 gives them the door `/shop`, but the shop home lists neither, and no page
  in the web lists FleetPal work orders or defects at all. FLEETPAL-INTEGRATION-PLAN F11 is titled
  "PM due, defects and expirations as worklists", but its text builds only PM due. D-FM9 says a
  figure with no list behind it is not shown. Production 2026-10-13: 24 OPEN work orders (oldest
  opened 2026-06-24) and 52 unresolved defects. Candidates:
  (a) build the two lists first: `GET /api/maintenance/work-orders?status=open` and
      `/defects?resolved=false`, plus two read-only pages under `/shop` (unit, reference, description,
      opened/detected, age), catalogued as `maintenance.*` surfaces. The card ships after them, with
      every figure a door. Cost: one more PR of about FM2's size, no migration.
  (b) ship the card now with those two figures and no door, labelled a workaround of D-FM9 that (a)
      removes.
  (c) ship a low-stock-only card. §4 already rejects this: it would claim to answer "what is broken"
      and could not.
  **Recommend (a).** The 24 orders and 52 defects become something a fleet manager can act on rather
  than just a number. The lists are also what F11 owes the shop anyway.
- **Q-FM7 — RESOLVED 2026-10-13 (owner): (a), build the inspections list first.** Was: the Roadside
  card's figures had no list to open. `roadside_inspections` filled in production on 2026-10-13 (1,394
  rows), but nothing read it: no route, no page, no contract. INSPECTION-CHALLENGE-PLAN §6 defines that
  list as the Inspections inbox. Candidates were (a) build the inbox's first slice now (the list, with
  period and OOS filters, and no cases or tasks), owned by `inspections` under `safety`, then the card
  on top with counts = list lengths; or (b) wait for IC4/IC6 to ship the whole inbox. (a) was
  recommended because it is the inbox's own first slice, not throwaway work.
- **Q-FM8 — RESOLVED 2026-10-19 (owner): (a), no violations at all; built with the Roadside card's rework (INSPECTION-CHALLENGE-PLAN IC16).** Was: the clean-inspection rate (found building FM5, 2026-10-13). §4 card 10 lists a
  "clean-inspection rate", and nothing defines "clean". No document in `docs/regulatory/fmcsa/`
  defines it (the SMS methodology, the DataQs manual and the SMS updates guide were searched). The
  feed gives two candidate meanings. Production's last 90 days: 111 inspections.
  (a) **No violations at all** (`violations_total = 0`): 57 of 111, 51%. This is the meaning the
      industry uses, and the stricter one.
  (b) **No out-of-service order** (`oos_total = 0`): 93 of 111, 84%. This is the complement of the
      OOS rate, so it adds nothing the OOS rows above it do not already say.
  Either way the rate needs a list behind it (D-FM9): `?clean=1` on the inspections list, filtered by
  the same predicate. **Recommend (a).** Until this is ruled, the card shows four figures and no rate.

## 8. Not in scope

No change to Fleet overview's cards, to `applyMoneyGate`, to the role matrix, or to the dispatcher's
landing tab.

## 9. Progress log

- 2026-10-12: plan written; production measured (§2).
- 2026-10-12: owner said "go" — Q-FM1 (a) "Operations", Q-FM2 (b) first tab, Q-FM3 Empty now on
  Fleet right now only, Q-FM4 keep Fleet overview, Q-FM5 PM-due deferred. FM1 + FM2 built in one PR
  (`claude/fleet-manager-ops-tab`). Changes from §4 met while building, each recorded here rather
  than edited into the section:
  - **"Due" is `inspectionExpiry`'s answer** (annualInspectionContract, 30-day equipment mark) for
    both papers. `fleetChecks.ts` holds the checks; no second window constant.
  - **D-FM9 for a composition card:** Fleet right now and Hiring partition one list, so they carry one
    door to that list (board / Applicants) plus per-row doors only where the list has a filter for
    the part (Empty now). "No driver" left Fleet right now — it is the Seats card's figure (D-FO1).
  - **Driver files counts DRIVERS** (`matchesDqState`), not the digest's items, because its doors are
    `/drivers?dq=…`; only the "Next:" line borrows `buildDqDigestSection`'s ranking.
  - **Hiring** shows the Applicants board's own waiting-on-us / waiting-on-them split
    (`countWaitingOn`, now shared with the page), not stage groups — that split is what the board
    opens on, so the figure equals the rows behind the door.
  - **New list filters for doors:** Vehicles `?check=` and `?status=` (URL-backed, plus a
    Registration column), Drivers `?seat=none`.
  - **Rows of three are 4/4/4, not §4's 5/4/3 and 6/3/3.** Browser pass at 1104 px (dev-bypass build,
    every source stubbed): a three-column card's header door sat on top of its title, and a header
    door on a four-column card squeezed the title to one word a line. So no card is narrower than
    four, and a card's door to its whole list sits under the rows (`CountList`'s `more`), never in the
    header. Driver files' "Next:" line moved under its rows for the same reason. Seats and
    paperwork stay at 6 until FM3's Shop card joins the row at 4/4/4. No `$` in the rendered text at
    1440 or 1104; no page errors.
  - **Hazmat review's door** starts off for fleet_manager (`safety.hazmat-review` `startsOnFor: []`),
    so the card shows its count without a link until an admin turns the screen on — SP5's rule.
  - No new chart colours: the cards are counts, not bars, so no palette joined `check-chart-colors`.
- 2026-10-13: FM3 built (`claude/fleet-manager-shop-card`). The FM3 build turned up Q-FM6, and the owner
  ruled (a): build the two lists first. Changes from §4 and §5 met while building:
  - **Two new read-only pages, children of the shop home:** `/shop/work-orders` (FleetPal status
    `OPEN`) and `/shop/defects` (`is_resolved = false`). Surfaces `maintenance.work-orders` and
    `maintenance.defects`, parented on `maintenance.repair-spend` like the ledger, because the group
    is fixed at six rows. Neither page has a status filter: each is exactly the list its count names.
  - **Each count is its list's length on the server** (`fleetpal/shopBacklog.ts`): one predicate per
    list, and `readShopBacklog` measures the lists rather than running a separate `count`. Both sets
    are bounded by what is outstanding (24 and 52 today), not by history.
  - **Low stock is counted in LINES** (`lowStockLines`, a part × location pair), because that is the
    row the Parts page's `?stock=low` view lists. It comes from `listLowStock`, the same reader.
  - **The oldest order is an instant** (`oldestOpenWorkOrderAt`), not a day cut on a UTC server.
    `shopDayOf` and `daysSince` in `shopSummaryContract.ts` turn it into the carrier's day for both
    the card's "oldest open N days" and the list's "Open for" column.
  - **Units are FleetPal's own fleet numbers**, not a join to our roster, so an order on an unmatched
    unit stays on the list (with a dash for the unit).
  - **The shop home gained two tiles** for the same counts, ABOVE its first-run callout: an org with no
    parts entered still has trucks in the shop.
  - **Row 2 is Seats · Shop · Truck paperwork at 4/4/4.** The card is "Shop" with three rows: Open
    work orders, Open defects, Shelves to reorder. No money, no severity (FleetPal sends none).
  - FLEETPAL-INTEGRATION-PLAN F11 still owes PM due; these lists take the defects half of its title.
- 2026-10-13: FM4 run on staging (serving the FM3 merge), signed in as two new staging test members,
  a fleet manager and a dispatcher (RELEASE-TRAIN-PLAN §5, same date), at 1440 and 1104 px.
  - **Dispatcher:** lands on Dispatch; the tabs are Fleet overview · Dispatch, with no Operations.
    `/shop/work-orders` and `/shop/defects` send them back to their home (`maintenance: none`). No
    `$`, no page errors. As designed.
  - **Fleet manager:** lands on `/?tab=ops`, with no `$` and no page errors. But right after sign-in
    the tab showed 6 cards, not 8: Fleet right now and Needs a hand now were missing, and so were
    Loads and Dispatch board in the sidebar. A reload brought all 8. (Hazmat is absent on staging by
    entitlement: the org has no `hazmatguard`.)
  - **Cause, not specific to this tab or to staging.** Before the router resolved `/login`, `App.vue`
    rendered the signed-in shell for a moment. That shell read `org_modules` with the anon key, RLS
    answered `[]`, and the cache kept the empty answer for five minutes. So anyone who signed in soon
    after opening the login page lost every module-gated surface until a reload. Fixed on
    `claude/modules-read-after-sign-in`: no shell until the router is ready, and the module query is
    keyed by org and enabled only with one.
  - Staging holds no FleetPal rows (0 work orders, 0 defects), so the Shop card read 0 / 0 / 0 and
    both lists showed their empty sentence. The layout and gating were checked; the real figures were
    seen only in the stubbed pass of the same day.
  - FM4 closes once the fix is on staging and the fleet manager's first screen after sign-in shows
    all 8 cards without a reload.
- 2026-10-13: **FM4 closed.** The sign-in fix merged (`claude/modules-read-after-sign-in`), and staging
  served it on both hosts before the pass was repeated.
  - **Fleet manager**, in a fresh browser, with no reload: lands on Operations with all 8 cards (Fleet
    right now and Needs a hand now included), Loads and Dispatch board in the sidebar, and both shop
    lists opening. Row 2 is 4/4/4 at 1440 and 1104 px. No `$`, no page errors.
  - **Dispatcher:** lands on Dispatch with the live map, which had ALSO been missing after sign-in
    before the fix (the same module gate). No Operations tab, and the shop lists send them home.
  - The only API refusal left is `/api/me/notifications` → 403 `module_disabled`: staging's org does
    not have the notifications module, so that is correct.
  - Staging still has no FleetPal rows, so the Shop card's real figures are seen in production after
    the release.
  - Owed from this plan: FM5 (roadside, blocked on the projection) and Q-FM5 (PM due, its own plan).
- 2026-10-13: **FM5 built** (`claude/roadside-inspections-list`), after Q-FM7 was ruled (a).
  - **The list:** `GET /api/roadside-inspections[?from=]`, owned by `inspections` and gated
    `safety: view`. It reads the inspections FMCSA currently records (vanished ones are left out),
    newest first, with each unit and whether 0458 matched it to our roster. The page is
    `/roadside-inspections` (Safety › Roadside inspections), with period (90 days / 365 days / all)
    and OOS-kind filters plus search.
  - **The card:** `ops.roadside`, gated `section("safety")`, reading `GET /api/roadside-inspections/summary`.
    That endpoint is `summarizeRoadside` over the same reader with the card's window, cut on the org's
    calendar (`roadsidePeriodStart`), so each figure is the length of the list its door opens. It
    shows four figures: inspections, plus inspections carrying a driver, vehicle or hazmat OOS order.
  - **The OOS kinds overlap.** On every one of the 30 inspections where `oos_total` differs from the
    sum of the three, the hazmat order is also counted as a vehicle (or driver) order. So the card
    never totals them.
  - **Production, last 90 days, 2026-10-13:** 111 inspections; 1 driver, 18 vehicle, 2 hazmat.
  - **Clean-inspection rate:** held for Q-FM8.
  - The card sits alone on a fourth row at 4 of 12 columns, after Hiring.
- 2026-10-13: **FM5 released and checked on staging.** #1499 merged as `42b381b`, and release
  v2026.10.13.2 (#1500) put it in production at 17:01 UTC; `verify:live` shows code and schema (0466)
  matching the production branch. FMCSA's feed last projected at 14:17 UTC that day, newest
  inspection 10/09, 111 in the last 90 days — the figure the card should show there.
  - **Fleet manager** on staging, signed in as the real member at 1440 and 1104 px: the Roadside card
    is on Operations after Hiring, reading 0 / 0 / 0 / 0 (staging holds no FMCSA rows), with
    Roadside inspections in the Safety sidebar. Each door opens the list with its count: "0 roadside
    inspections" and, with a filter set, "No roadside inspection matches that."; the unfiltered list
    says "No roadside inspections on our FMCSA record." Both endpoints answer 200, and there are no
    page errors.
  - **Dispatcher:** no Roadside card and no sidebar entry. Each `/roadside-inspections` URL sends them
    to `/?tab=dispatch`, and neither endpoint is called.
  - The only refusal is again `/api/me/notifications` → 403 `module_disabled` (FM4's entry).
  - Owed: the card's real figures, seen in production by the owner (staging cannot show them), and
    Q-FM8 (the clean-inspection rate). Q-FM5 (PM due) is still its own plan.
