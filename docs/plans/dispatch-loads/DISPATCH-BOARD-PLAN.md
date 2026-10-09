# Dispatch board: the Assignments page becomes the board a dispatcher works from — plan

**Status: IN PROGRESS — wave 1 (schema, 0450) building.** Rulings recorded in §10; Board vs Loads split (§5.3). Written 2026-10-09 at the owner's request ("analyze our
Assignment page and let's create a proper Dispatch board from this page, where a dispatcher sees all
assignments but can also filter only his fleet"). Decision IDs `D-DB*`, open questions `Q-DB*`. This plan
defers to `docs/plans/livemap/LIVE-MAP-PLAN.md` (`D-LM*`, the map and its scope), to
`docs/plans/mcleod/LOADS-MIRROR-PLAN.md` (`D-LMR*`, McLeod authors every load) and to
`docs/plans/mcleod/MCLEOD-ROSTER-SYNC-PLAN.md` (what the roster imports); it restates none of them, and
says plainly in §3 where it asks to overturn one.

---

## 0. The request, and what triggered it

The VM connector went live on 2026-10-09 16:08Z (task "Silvicom 360 connector"): loads arrive every
minute. The owner asked one test question first — *"Vinnie has 8 trucks in his fleet; do we get that from
McLeod?"* — and the honest answer was **McLeod has it, we do not receive it**. That answer is the spine of
this plan: the board the owner wants cannot be built from the loads alone.

## 1. What the Assignments page is today

`apps/web/src/pages/AssignmentsPage.vue` (225 lines), route `/assignments`, catalogue key
`dispatch.assignments` (`packages/shared/src/surfaceCatalogue.ts`), gate `section("dispatch")`.

- **One row per DRIVER**, every driver on the roster (`listAssignments`,
  `apps/api/src/modules/loads/dispatchLoads/queries.ts`). Columns: driver, HOS duty status, truck, trailer,
  "City, ST", time in status, current load ref + board label. Search + "Active drivers only". A History tab
  (L5, the attribution trail) — that tab is good and stays.
- **The truck comes from Samsara HOS** (`drivers.current_hos_vehicle`), the map's truck↔driver pairing
  comes from `vehicles.assigned_driver_id`. Two pairings for one fact (§5, Q-DB6).
- **The duty status is up to six hours old.** `drivers.current_hos_status` is written by `sync_hos` in the
  driver-scores tier (`SAMSARA_DRIVER_SCORE_SYNC_HOURS`, default 6). The page refetches every 60 s an
  answer that changes four times a day.
- **No dispatcher, no fleet, no clocks, no stops, no ETA, no "next load"** on the wire
  (`assignmentRowSchema`, `packages/shared/src/dispatchContract.ts`).
- Design debt: a hand-rolled tab strip where the contract wants `AppTabs`; a local `HOS_BADGE` tone map
  where badges must come from `@/lib/badges`.

It is a roster with a duty badge. A dispatcher cannot answer any of the four questions they open a board
for: *which of my trucks need me now, when and where does each one empty, which has nothing next, which
load is going to be late.*

## 2. What data we have — measured in production, 2026-10-09 ~20:00Z

| Fact | Where it lives | Fill on today's board |
|---|---|---|
| Load in progress (`P`) per truck | `loads` (status `in_transit`, `source='tms'`) | 119 loads: 119 truck, 118 trailer, 112 driver, 119 dispatcher, 119 customer |
| Loads not yet covered (`A`) | `loads` `pending_approval` | 32: 0 dispatcher, 20 with a truck, 17 with a driver |
| **Pre-assigned next load** | an `A` load on a truck that also has a `P` | **8 trucks** — "next load" exists in the data |
| Stops, appointments, coordinates | `load_stops` | 327 stops: 327 appointment, 327 lat/lon, 124 arrived, 118 departed |
| McLeod's ETA | `load_stops.eta_at` | 150 set — **36 are >6 h in the past on stops nobody has reached**, oldest 09-28. Typed by hand, not computed. Not usable as an ETA. |
| Dispatcher on the load | `loads.dispatcher_external_id` → `tms_dispatchers` | 17 logins (2 system); **none linked to a Silvicom user** (`user_id` never written; LM11 unbuilt) |
| Truck's home fleet | McLeod `tractor.fleet_id` | **NOT RECEIVED** (agent never reads it — roster plan's "do not import") |
| GPS position, speed, age, fuel % | live map board (`readVehiclePositions`, `readFleetIdentities`) | every Samsara truck, 5 s poll |
| HOS duty status | `drivers.current_hos_status` | ≤6 h stale (above) |
| HOS duty segments | `hos_duty_segments` | live: 141 drivers in the last 2 days, newest 19:35Z today |
| HOS **remaining clocks** (drive / shift / cycle / break) | **nowhere stored** — fetched live only by fuel planning (`makeSamsaraHosFetcher`) | — |
| Route + truck-on-route | `GET /api/livemap/loads/:id/route` (TC3) | per load, calls HERE + fuel solver — too heavy per row |

Active trucks: **199**; with a load in progress: **119**; **80 trucks have none**.

### 2.1 The fleet, measured in live McLeod (`lme`, dispatch login, 2026-10-09)

Active tractors (`service_status='A'`), by `fleet_id`:

| Group | Trucks | `tractor_status` | Reading |
|---|---|---|---|
| 14 named fleets (KANE 15, MIRO/PETE/CHRIS/ROMAN 14, ROBERT 13, STEVE/ARTURK/VLADI 12, IVO 11, ANETA/KONI 10, VINNIEV 8) | **159** | all `A` | every working truck has a fleet |
| fleet `'1'` | 43 | 27 `I`, 11 `V`, 5 `S` | the parked / shop pool |
| no fleet | 43 | 42 null | reservations — not on our roster at all (no purchase date / model year) |

**`VINNIEV` = 658, 669, 676, 700, 710, 730, 773, 796 — exactly the owner's eight.**

Loads in progress, truck's fleet vs the load's dispatcher (122 `P` loads on a fleet truck): **100 (82 %)
dispatched by the fleet's own dispatcher**, 12 by the system user `loadmaster`, ~10 by somebody else —
e.g. VLADI's trucks: 8 by `asen`, 3 by `vladi`. The truck's own `tractor.dispatcher` field is a third,
inconsistent answer (669 → `asen`, 700 → `vinnie` misspelt, six non-VINNIEV trucks → `vinniev`) and is
not used anywhere in this plan.

Fleet codes are not logins: `VINNIEV`=`vinniev`, `CHRIS`=`chris`, but `IVO`=`ivok`, `ROMAN`=`romann`,
`ARTURK`=`arturk`. A mapping has to be confirmed once (D-DB3).

## 3. The question this plan cannot avoid — D-LM3

`LIVE-MAP-PLAN.md` **D-LM3** ruled "a truck's fleet code is not a scope; scope is the load's dispatcher"
(measured then: 60 % agreement). `MCLEOD-ROSTER-SYNC-PLAN.md` lists `fleet_id` as "do not import —
dispatch state, churns". Alex (McLeod/IT) confirmed: *"tractor.fleet_id is the fleet or group. It often
matches, but it is not the person."*

All three are right about what they measured, and the owner's request is about the other thing. **A
fleet is who OWNS a truck; the load's dispatcher is who is MOVING it today.** A board that only knows the
second shows Vinnie one truck (773) when he owns eight — three of which (669, 710, 796) are sitting on
uncovered `A` loads that are exactly what Vinnie needs to see. A board that only knows the first hides
the eight VLADI trucks Asen is moving.

**Recommendation (D-DB1, needs the owner): two axes, never merged.**
- **Fleet** (truck's home fleet, `tractor.fleet_id`) — the default "My fleet" scope.
- **Dispatched by** (load's `dispatcher_user_id`) — a second filter, and a column. A row where they
  differ gets a quiet marker ("moved by asen"), because that is precisely the covering-for-a-colleague
  case a fleet owner wants to notice.

D-LM3 stays true of the map's scope rule and is not edited; this plan records that the board adds the
fleet axis beside it, and LM6's "derived, never stored" scope becomes "fleet, OR loads I dispatch".

## 4. Research — what good dispatch boards do

Sources are vendor help docs where they exist (Trimble TMW Planning Worksheet, Ditat Dispatch Board,
Dispatch Science, Rose Rocket, Alvys, Optimal Dynamics, Samsara Routes); McLeod's own screen docs are
behind its customer portal, so McLeod notes come from release notes (v17.2 fleet/driver-manager filter on
Order Planning; LoadMaster//web 25.2 "Dispatch Slide-Out", "Task Filters", visual planner). Full report
with URLs: §9.

Patterns worth copying, ranked for a 200-truck McLeod + Samsara carrier:

1. **One row per TRACTOR ("power board") with *when and where it empties* as first-class columns** — TMW
   `AvailDate` + `LocationCity`, McLeod PTA, Alvys "Available in". Long-haul planning thinks in that pair.
2. **"My fleet" is a group FILTER, not a permission** — McLeod 17.2 fleet/driver-manager filter, Ditat
   "Dispatched by" + truck groups. Default to mine, one click to all.
3. **Separate exception columns, each red/amber/green** — late vs appointment, stale GPS, HOS risk,
   truck/trailer mismatch (Ditat). Never one blended "status colour".
4. **Worst state rolls up to the row's left edge** (Dispatch Science) so one scan finds every problem.
5. **Exception queues as presets** — Late/at risk · No next load · Uncovered loads · Appointment
   conflicts (McLeod Task Filters, Samsara "Unassigned", Dispatch Science "View by").
6. **HOS as remaining drive / shift / cycle**, ideally projected to the available time (Optimal
   Dynamics), not just a duty badge.
7. **A side drawer for detail** — the driver's past, present, next; stops; HOS; mini-map (McLeod
   Dispatch Slide-Out, Alvys sidebar, Ditat Truck Info Card). The board never navigates away.
8. **Saved views** — a locked default plus per-user named views (Ditat ≤10 per user, Rose Rocket).
9. **Pinned identity column, dense configurable columns** (Alvys, TMW Field Chooser).
10. **Home-time signal** — last time home (TMW `LastHome`).
11. **Map linked to the list**, secondary to it (Dispatch Science, Motive).
12. **Timeline (Gantt) as an alternate layout** of the same rows (Rose Rocket, McLeod Visual Planner).

Deliberately low for us: drag-and-drop assignment and inline dispatch. **McLeod authors every load**
(D-LMR1); a board that pretends to assign would be a second system of record. Writes stay in McLeod.

## 5. The design

**D-DB2 — Layout: a power board (tractor rows) with exception presets and a drawer.** Research layout A;
the two-pane "available power vs available loads" matcher (B) is a later "Find a truck" action on an
uncovered load (DB8), and the map is not duplicated — the drawer links to the Dashboard's Dispatch tab
(D-DR24: one live map).

Page: `/assignments` keeps its path; the sidebar label and title become **Dispatch board** (Q-DB5). Tabs
(`AppTabs`): **Board** · **History** (the existing L5 tab, unchanged). There is deliberately no Uncovered
tab here — the Loads page already owns that queue (§5.3).

**Toolbar** (`DataWorkspace` + `FilterBar`, design contract §5.2b/§5.5):
- `AppSegmentedControl`: **My fleet** · **All** (default My fleet when the user is linked, else All
  with one line saying why — LM6's banner rule).
- `FilterSelect` **Fleet** (14 fleets + "Unassigned pool"), `FilterSelect` **Dispatched by**.
- Queue chips (counts in each): **Needs attention** · **Late risk** · **No next load** · **Empty now** ·
  **HOS low** · **No GPS**. Each one is a predicate over the row, defined once in `packages/shared`.
- Search (unit, driver, order, customer, city). `ColumnPicker`, `SavedViewMenu` (views are URLs).

**Row = one active tractor** (199 today; fleet `'1'` pool behind the Fleet filter). Columns, left to right:

| Column | Source | Notes |
|---|---|---|
| ● attention | derived | worst of the exception flags, the row's left edge |
| Truck | `vehicles.unit_number` | pinned; fleet code as a small secondary line |
| Driver(s) | load's driver, else `assigned_driver_id` | team = both names (Q-LMR4) |
| Duty · clocks | HOS status + drive / shift / cycle remaining | needs DB3; bar turns amber < 2 h drive |
| Now | `formattedLocation`, speed, GPS age | "No GPS 3 h" in caution when stale |
| Current load | order #, customer, `loadBoardState` label | "moved by asen" marker when dispatcher ≠ fleet owner |
| Next stop | kind, city, appointment window | |
| On time? | computed ETA vs appointment end | green / amber / red / "—"; **our** ETA, not McLeod's (D-DB4) |
| Empties | last stop's city + time (appointment or ETA, whichever later) | the PTA pair |
| Next load | pre-assigned `A` on this truck | "None" badge when empty — the No-next-load queue |
| Trailer | load's trailer | |
| Fuel | `samsara_fuel_percent` | |

**Drawer** (`SlideOver`): stops timeline (appointments, arrivals, ETA), HOS clocks, the route summary
from TC3 *on demand* (one HERE call when opened, never per row), links to the load page, the truck,
the driver, and the map with this truck selected.

**Uncovered loads are a link, not a tab**: the toolbar carries "12 uncovered loads in my fleet →", which
opens Loads on its Uncovered queue in the same scope. A load with no truck has no row here and must never
be invisible; it must not get a second list either.

**Freshness**: header line "McLeod as of 19:49 · Samsara as of 19:50" in the existing pattern; the board
polls at 60 s, positions come from the live map's cache rather than a second Samsara read.

### 5.1 ETA (D-DB4)

McLeod's `eta` is a hand-typed field (36 stale in the past today) and stays a reference value in the
drawer only. The board's ETA is: remaining distance from the truck's position to the next stop ÷ a
planning speed, plus required HOS rest if the drive clock runs out first. v1 uses great-circle distance ×
road factor (Ditat ships 45 mph solo / 54 mph team on raw GPS); HERE's matrix API is the later precision
step (Q-DB4). An ETA is never shown without its basis in the tooltip ("by distance, 50 mph").

### 5.2 Scope (D-DB3)

"My fleet" = trucks whose fleet code maps to me **∪** trucks on loads whose dispatcher login is me.
Needs two links the office confirms once on Settings → Integrations → McLeod (this is LM11, extended):
fleet code → McLeod dispatcher login (prefilled where the names match: 10 of 14 do), and McLeod login →
Silvicom user. An unlinked user lands on All. A fleet manager / admin can pick any fleet.

### 5.3 Board and Loads — one question each (D-DB5)

The owner's condition (2026-10-09): *no duplicate of the Loads page — either two pages showing different
data, or one page that shows everything with proper UX.*

**The Loads page today** (`apps/web/src/pages/DispatchLoadsPage.vue`, LR7 — owner's column list of
2026-09-23): row = one McLeod LOAD. Columns Load # (dispatcher beneath) · Status · Driver (truck/trailer
beneath) · Pickup · Delivery (+N stops) · Type (Regular/Reefer/Hazmat) · Dispatch. Queues Active ·
Uncovered · Delivered · All, plus an Exceptions feed (events, D-L2). Dispatcher + Type filters, search,
20 per page, "McLeod as of". Row opens `/loads/:id` (stops, events, hazmat record, dispatch history).
Measured: 482 McLeod loads stored (since 2026-09-17), 0 non-McLeod; **`load_dispatches` = 0 rows, ever** —
the Send-to-driver action has never been used.

**Where the two overlap, as originally drafted:**

| Fact | Loads | Board (draft) | Verdict |
|---|---|---|---|
| Load in progress with its truck/driver | Active queue (row = load) | every truck row's Current load | **real overlap** — same 119 facts, keyed two ways |
| Uncovered loads | Uncovered queue | Uncovered tab | **duplicate** — removed from the board above |
| Delivered / history / search by order | yes | no | Loads only |
| HOS, GPS, empties, next load, on-time | no | yes | board only |
| Trucks with no load (80 today) | invisible | yes | board only |
| Hazmat clearance, dispatch send, exceptions | yes | no | Loads only |

**Two shapes considered:**

- **One page, tabs per row unit** (Trucks · Loads · Uncovered · Delivered · Exceptions · History).
  One sidebar entry, one scope control. Rejected as the recommendation: six tabs over two different row
  units is the shape `CLAUDE.md`'s worked example warns about (the driver page that "grew six tabs"); a
  dispatcher would still be switching between two tables, just inside one URL, and the deep link to one
  load still has to be its own page.
- **Two pages, each answering ONE question — recommended.**
  - **Dispatch board = "what do my trucks need from me now?"** Row = truck. Live (60 s), exception-first,
    starts on My fleet. No delivered loads, no history of orders, no hazmat paperwork.
  - **Loads = "what is the state of this order?"** Row = load. The record: find an order by number,
    customer, BOL, place; Upcoming / In transit / Delivered; hazmat clearance; send to driver;
    exceptions; the load page. Not live-ops: no HOS, no GPS age, no empties.

**What changes on Loads to make the split real (D-DB6, part of DB5):**

1. **Same scope control** as the board (My fleet · All, Fleet, Dispatched by) — one component, one
   scope definition in `packages/shared`, so "my fleet" can never mean two things on two pages. The
   current Dispatcher filter becomes the Dispatched-by filter of that control.
2. **Active is renamed by what it holds**: Upcoming (planned, incl. pre-assigned next loads) and In
   transit, so an office reader searching for an order sees it in the order's own terms. The in-transit
   list stays — answering a customer's "where is order 123?" is a load question — but its truck column
   links to the truck's board row (`/assignments?truck=773`), never re-renders HOS or GPS.
3. **The on-time verdict is one fact in two places**, computed once (`packages/shared`, D-DB4) and shown
   as the same badge on the board row and the load row. That is one fact read twice, not a copy.
4. **Board → Loads, Loads → Board, both ways in one click**: board's current/next load opens `/loads/:id`;
   the load page's truck opens the board drawer for that truck.

Sidebar after the change, Dispatch group: **Dispatch board** · Loads · Messages · Fuel planning · Truck
stops — the same five entries, no new one.

## 6. Open questions — owner rulings needed before DB1

- **Q-DB1 — Two axes (§3).** Import `tractor.fleet_id`, overruling the roster plan's do-not-import, and
  scope "My fleet" by fleet ∪ my loads? *Recommend yes* — it is the only way Vinnie sees his eight.
- **Q-DB2 — Fleet `'1'` (43 trucks: parked, shop, `V`).** Hide by default behind "Unassigned pool"? *Recommend
  yes*; and what is status `V` (11 trucks)? Alex knows.
- **Q-DB3 — Who links fleets and users?** Admin only, or fleet manager too? *Recommend admin + fleet manager.*
- **Q-DB4 — ETA precision.** Distance-based v1 (free, instant, ±) then HERE matrix (cost per call ×
  119 trucks per refresh)? *Recommend distance v1, measure its error against actual arrivals for two
  weeks, then decide.*
- **Q-DB5 — Name.** "Dispatch board" replacing "Assignments" in the sidebar? *Recommend yes; keep the path.*
- **Q-DB6 — Driver↔truck truth.** For a truck with no load, the board needs one driver: Samsara's HOS
  vehicle, or `vehicles.assigned_driver_id` (the map's)? *Recommend the map's*, so the board and map
  never disagree — one rule, read from one place.
- **Q-DB7 — Ask two dispatchers** which McLeod Order Planning / Driver Manager columns they actually
  look at all day. The column list in §5 is our best reading of the research; theirs beats it.
- **Q-DB8 — Two pages or one (§5.3).** *Recommend two pages, one question each*: Dispatch board (trucks,
  now) and Loads (orders, the record), sharing one scope control and linking both ways.
- **Q-DB9 — Send to driver.** `load_dispatches` has never been written (0 rows). Keep the Dispatch
  column and action on Loads, or retire it until drivers use the app? Not a board question, but the
  remodel should not polish a column nobody uses. *Recommend: ask the dispatchers with Q-DB7.*

## 7. Steps (one PR each unless noted)

- **DB0 — Rulings** above. Nothing below starts without Q-DB1.
- **DB1 — Fleet code reaches us.** Agent: `t.fleet_id` added to `VEHICLE_IDENTITY`, sent as neutral
  `fleet_code` (`tmsVehicleInputSchema`). **New SQL → Alex reviews it before the VM runs it**; ships in the
  VM package refresh already owed for `fuel_tax_excluded`. Migration: `vehicles.mcleod_fleet_code` (merge
  1); ingest writes it (merge 2) — `lint:migration-ordering`.
- **DB2 — Links.** `tms_fleets(org_id, provider, code, dispatcher_external_id)` (new table, RLS on), the
  settings card (LM11 + fleet mapping), prefilled by name match, audited.
- **DB3 — HOS clocks stored.** A light job reading Samsara `/fleet/hos/clocks` (one call, whole fleet)
  every 5 min into `driver_hos_clocks`; the 6-hour `sync_hos` stays as it is (memory of the 2026-10-06
  freeze: keep this job tiny, nothing per-row in JS). Also fixes the Assignments page's six-hour status.
  Scheduler placement per `docs/WORKER-DEPLOYMENT.md`.
- **DB4 — Board API.** `GET /api/dispatch/board` → `DispatchBoardRow[]` (contract in
  `packages/shared/src/dispatchBoardContract.ts`): composes roster, positions (live map's cache), loads +
  stops, clocks, fleet, links; every read org-scoped (`expectOrgScoped`); the row predicates (late risk,
  no next load, empty, HOS low, stale GPS) and the ETA are pure functions in `packages/shared` with their
  own tests.
- **DB5 — The page.** Board tab on `DataWorkspace`; `AppTabs`; badges from `@/lib/badges` (the local
  `HOS_BADGE` goes); scope control (a shared component); chips; ColumnPicker; SavedViewMenu; the
  "N uncovered loads →" link.
- **DB5b — Loads adopts the split (§5.3).** The shared scope control replaces the Dispatcher filter;
  Active → Upcoming + In transit; truck links to the board; the shared on-time badge.
- **DB6 — Drawer.** Stops timeline, clocks, on-demand route summary, links.
- **DB7 — ETA measured.** Compare the v1 ETA with actual arrivals for 14 days; Q-DB4 decided on numbers.
- **Later (not planned here):** DB8 "Find a truck" on an uncovered load (ranked by empty-time, deadhead,
  HOS); Timeline view; home-time signal (needs a home-terminal fact we do not have).

## 8. What this does NOT do

- No assignment, dispatch or status writes to McLeod — read-only connector, and McLeod authors loads.
- No second live map; no per-row HERE routing.
- No change to the History tab.

## 9. Research sources

Primary (vendor help docs): help.ditat.com/dtm/dispatch-board · learn.transportation.trimble.com
(Planning Worksheet: PW-AvailResources, PW-TrimbleDispatchAdvisor) · support.dispatchscience.com (Dispatch
Board) · help.roserocket.com/platform/customizing-your-boards, /calendar · help.alvys.com Dispatch Planner
v2 · support.optimaldynamics.com (Assign by Driver) · kb.samsara.com (Routes, Dispatch Settings).
Release notes / press: McLeod v17.2 (PRWeb), LoadMaster//web 25.2 (mcleodsoftware.com), PowerBroker
Brokerage Planning (truckinginfo.com/321265). Marketing / reviews (weaker): Motive dispatch blog, Axon,
PCS, Truckbase (bestcarriertms.com review), Tailwind (softwareadvice.com).

## 10. Progress log

**2026-10-09 — rulings.** The owner read §5.3 and §6 and said *"let's start with this plan
implementation"*. Taken as adopting the recommendations, and recorded so a later reader can tell a
ruling from a default: **Q-DB1** two axes, `tractor.fleet_id` imported (the roster plan's
"do not import" is overruled for this one column; D-LM3 stands for what it measured); **Q-DB2**
fleet `'1'` behind an "Unassigned pool" choice; **Q-DB3** admin + fleet manager link fleets and
users; **Q-DB4** distance ETA first, measured before HERE; **Q-DB5** "Dispatch board", path kept;
**Q-DB6** the map's driver↔truck pairing; **Q-DB8** two pages. Still open and not blocking:
**Q-DB7** (ask two dispatchers which McLeod columns they use) and **Q-DB9** (Send to driver,
0 uses ever). Any of these is one sentence from the owner to reverse.

**Waves** (large PRs, per the owner's standing batch rule):
- **Wave 1 — schema (0450).** `vehicles.mcleod_fleet_code`, `tms_fleets`, `driver_hos_clocks`,
  schema-only (`lint:migration-ordering`).
- **Wave 2 — the facts arrive.** Agent reads `fleet_id` (new SQL, held for Alex's review before the
  VM runs it), ingest writes the code and seeds `tms_fleets`; the HOS clocks poll; the links API.
- **Wave 3 — the board.** Board API + shared predicates and ETA; the page; the Loads scope (DB5b);
  the links card.

