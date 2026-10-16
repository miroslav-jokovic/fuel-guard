# Dispatch board v2: availability first, fewer facts, the warnings dispatchers ask for — plan

**Status: RULED 2026-10-16 — building.** Owner: *"proceed as recommended"*; every §6 recommendation is a
ruling (§9). Written 2026-10-15 after the owner tested the
Dispatch board and Loads pages with the dispatchers. Decision IDs `D-DBV*`, open questions `Q-DBV*`. This
plan extends `DISPATCH-BOARD-PLAN.md` (`D-DB*`; it answers that plan's Q-DB7, "ask two dispatchers")
and `docs/plans/livemap/TRUCK-CARD-ROUTE-PLAN.md` (`D-TC*`; §5 changes D-TC3/D-TC6's fixed route). It
restates neither.

---

## 0. The request

The owner, after a session with the dispatchers:

1. *"A lot of information and data, a little bit confusing."* That applies to both pages.
2. *"Dispatch needs to see how many trucks each dispatcher has assigned. We have that, but it is not
   transparent in numbers."*
3. *"Availability based on truck location and delivery date: type a state and get which trucks will be
   available in that state and city, and at what time."*
4. *"A column with how many miles the driver has left to the destination, for a precise estimate."*
5. *Routing bug:* "the route is calculated but does not take into consideration the route the truck has
   taken; sometimes the truck is on a completely different route from our proposed one."
6. *"From FleetPal, a column with warnings for annual inspections and scheduled maintenance, and if a
   driver is selected for a random drug test, show that too."*

The reference is the board the dispatchers use today, `board.silvicominc.com/dashboard` (photo taken
2026-10-15 15:17).

## 1. What the dispatchers' current board does that ours does not

One table and **seven columns**: Truck · Full name · Trailer · Dispatcher · **Available date** · **Available
city** · State. Header links carry counts: *Dispatchers (14)*, *States (34)*, *Dashboard (167)*.

- **It answers one question: when and where each truck empties.** It is sorted by available date
  ascending and coloured red (already passed, so the truck needs a load), amber (today), green (later).
  The columns are exactly the TMW `AvailDate` + `LocationCity` pair that research ranked first
  (`DISPATCH-BOARD-PLAN.md` §4, pattern 1).
- **Warnings sit on the unit they belong to.** Under the truck: *Oil Change Due 1,133 mi*, *6-Month
  Inspection Overdue 2026-09-29*. Under the trailer: *Annual DOT Inspection Due 2026-09-16*. They are
  small, and they appear only when something is due.
- **A state filter** (the `fl` box) is how a dispatcher asks "what is coming free in Florida".

What ours shows today (`AssignmentsPage.vue`, `DispatchBoardTable.vue`, measured 2026-10-15):

| | Current board | Our Dispatch board |
|---|---|---|
| Columns | 7 | 9 (Truck, Driver, HOS, Now, Current load, Next stop, On time, Empties, Next load) |
| Facts per row | ~8 | **~18** |
| Tabs / queues | 0 | 7 queue tabs + History |
| Scope controls | dispatcher column | My fleet / All toggle + Fleet select + Dispatched-by select + saved views + column picker |
| Trucks per dispatcher | "Dispatchers (14)" page | **nowhere**: the Fleet select has no counts |
| Available when/where | the two main columns, default sort | `Empties`, the 8th of 9 columns; place is free text ("City, ST") with no state field to filter on |
| State filter | yes | no (search does not match the delivery city or state) |
| Maintenance warnings | truck + trailer | only "In shop" |
| Random drug test | no | no |
| Miles left | no | a tooltip only: straight-line miles to the *next* stop |

**The diagnosis.** Our board answers five questions at once (HOS, GPS, on-time, next stop, next load).
Theirs answers one, and it is the one a dispatcher plans the next load from. Everything ours adds is
true and useful, but it is in the wrong place: it belongs in the drawer, a click away, and not in every
row.

## 2. The numbers behind the asks (production, 2026-10-15 ~20:30Z)

**Per-dispatcher counts already exist in our data.** Fleet codes have been arriving since the VM update:
202 trucks carry `vehicles.mcleod_fleet_code`, 14 fleets, and 13 of 14 `tms_fleets` are linked to a
dispatcher. Working trucks only (not winding down, fleet `'1'` excluded):

| Fleet | Trucks | Loaded | Empty | Next load assigned |
|---|---|---|---|---|
| KANE | 15 | 9 | 6 | 1 |
| PETE | 15 | 9 | 6 | 4 |
| MIRO | 14 | 10 | 4 | 0 |
| ROMAN | 14 | 9 | 5 | 0 |
| CHRIS | 14 | 10 | 4 | 1 |
| VLADI | 13 | 10 | 3 | 1 |
| IVO | 13 | 7 | 6 | 3 |
| ROBERT | 13 | 11 | 2 | 3 |
| STEVE | 13 | 10 | 3 | 4 |
| ARTURK | 12 | 8 | 4 | 3 |
| KONI | 10 | 9 | 1 | 1 |
| ANETA | 9 | 3 | 6 | 7 |
| VINNIEV | 8 | 6 | 2 | 2 |

Fleet `'1'` (the pool): 33 trucks, 6 working. Only 2 `tms_dispatchers` are linked to a Silvicom user, so
"My fleet" falls back to All for almost everybody. That is the LM11 link, not a code gap.

**FleetPal already holds the warnings the old board shows.** In `fleetpal_pm_schedules`: *Annual DOT
Inspection* 427, *6-Month Inspection* 420, *Oil Change* 252, plus a dozen free-text variants ("Oil
Chnage", "6-Month Isnpection", "DOT Annual"). Each schedule has `last_done`, and its
`fleetpal_pm_intervals` row has `value_int` / `threshold_int` / `last_done_meter_value` (time or meter).
**Nothing computes "due / overdue / miles left" from them.** `vehicles.next_pm_due_*` has never had a
writer (FleetPal plan F11, unbuilt), and `fleetpal_expirations` has 0 rows.

**The board's ETA has never been measured.** `load_stop_eta_predictions` (0453, DB7's recorder) had **0
rows**. Every hourly insert since 2026-10-10 failed: `invalid input syntax for type integer: "5.803"`.
The GPS fix age carried milliseconds into an integer column. Fixed in #1578. The two-week measurement
that Q-DB4 waits on starts when #1578 is released.

## 3. The design

**D-DBV1 — One question per row, the old board's question.** The row stays one truck (D-DB2). The
default columns become the old board's seven plus the two the dispatchers asked for:

| # | Column | Content | Source |
|---|---|---|---|
| 1 | Truck | unit; trailer unit beneath | roster; load's trailer |
| 2 | Driver | name (team: both) | as today |
| 3 | Dispatcher | fleet code, plus a quiet "moved by asen" when it differs (D-DB1) | as today |
| 4 | **Available** | date + time; **default sort, ascending**; red = passed or now, amber = within 24 h, green = later; "Now" for an empty truck | `emptiesAt` (exists) |
| 5 | **Available in** | City, ST zip | last stop, or GPS place when empty |
| 6 | **Miles left** | road miles from the truck to the final delivery, "≈" when estimated | §3.3 |
| 7 | **Warnings** | chips only when something is due: *Annual · 6-mo · Oil 1,133 mi · Random test*, truck and trailer | §3.4, §3.5 |
| 8 | Status | one line: *Loaded · On time* / *At risk* / *Late* / *Empty 2 d* / *In shop*, plus *Next: 291013* | as today, merged |

HOS clocks, GPS age and speed, the next stop and its appointment, and the next load's stops **move to the
drawer** (DB6 already shows them). They stay reachable through a **Live** column preset in the
ColumnPicker for whoever wants the dense board. Facts per row drop from ~18 to ~10, and every fact left
is one the dispatchers named.

**D-DBV2 — Per-dispatcher counts are the scope control.** One strip of chips replaces the My fleet toggle
and the Fleet select:

`All 186 · KANE 15 (6 empty) · PETE 15 (6) · MIRO 14 (4) · … · VINNIEV 8 (2) · Pool 6`

A click filters. The linked user's own chip is selected on open (D-DB3 unchanged). Counts come from the
same rows, so the chip and the table can never disagree. "Dispatched by" moves to a *More filters*
popover; it is the rarer question. The 7 queue tabs become 3: **All** · **Available ≤ 24 h** · **Needs
attention** (late risk, HOS low, no GPS, a warning due). The predicates stay in `packages/shared` and are
re-grouped, not rewritten.

**D-DBV3 — "Available near" is a filter, not a page.** Toolbar: **State** (multi-select, with counts,
like the old *States (34)*) · **City** (optional, with radius 50 / 100 / 150 mi) · **By** (date + time).
A truck matches when its availability place is in the state, or within the radius of the city, and its
available time is at or before *By*. Empty trucks match on their GPS position and *now*. Sorted by
available time. This is the question the old board's `fl` box answers, made precise.

### 3.1 What the row needs on the wire

`emptiesAt` returns `{ place: "City, ST", at }`. Filtering by state cannot parse a display string, so
availability becomes structured, in one shared rule:
`availability: { city, state, postalCode, lat, lng, at, basis: "appointment" | "eta" | "now" }`.
`load_stops.postal_code` already exists (0085) but is not selected (`truckLoadPlanReads.ts:96`). The
radius test is a pure function beside `boardEta`. City → point uses the stops' own coordinates for a
typed city that appears on any stop. A city never seen falls back to state only and says so, so no
geocoder is bought for v1.

### 3.2 Loads page (the second half of "confusing")

The Loads page is less dense (7 columns), but it carries a **Dispatch** column for an action used **0
times ever** (`load_dispatches` = 0 rows; Q-DB9). Recommend hiding the column and moving the action to the
kebab until the driver app is used for it, and adding **Miles left** and the delivery appointment to the
Delivery cell so the two pages give the same answer.

### 3.3 Miles left (D-DBV4)

The board has rough miles today, only to the *next* stop (haversine × 1.2, `boardEta`). Two steps:

- **v1, free, every row:** chain the legs. Truck → next stop → each remaining stop → final delivery, each
  leg haversine × 1.2, shown as "≈ 412 mi". The last-stop ETA is already computed for `empties`
  (`dispatchBoard.ts:106`), but its miles are dropped. This keeps them.
- **v2, precise:** HERE road miles from the truck's **current position** over the stops not yet reached.
  That is the same call §5 needs to fix the routing bug, so the two share one cached route. A 15-minute
  server job computes it for loaded trucks only (~110), cached by position bucket. The row shows the HERE
  figure when it is under 30 min old, else the ≈ figure. Cost is the open question Q-DBV4. DB7 (now
  recording, #1578) tells us how wrong v1 is before we pay for v2.

### 3.4 Maintenance warnings (D-DBV5)

A **per-unit maintenance status** reader, owned by `fleetpal`, exported to `livemap`. This is the read
model the agent found missing. For each truck and trailer (`fleetpal_units.vehicle_id` / `trailer_id`):

- Classify each PM schedule by kind: annual DOT / 6-month / oil change / other. Classification is by
  normalised keyword, because the names are free text with typos. The classifier lives in
  `packages/shared` with the typo list as test cases.
- Next due: time intervals use `last_done + value`. Meter intervals use `last_done_meter_value +
  value_int` against the current odometer (`fleetpal_meters`, else Samsara's). The verdict is
  **overdue** / **due** (inside `threshold_int`) / **upcoming** / ok. Units are metres in the source and
  miles on screen.
- Open and scheduled work orders on the unit (`fleetpal_work_orders`, not only `OPEN`).
- **The annual inspection is already a record** (`vehicles` / `trailers.dot_annual_inspection_expires_at`,
  the annual-inspection module, `inspectionExpiry()`). Two sources for one fact is the workaround
  `CLAUDE.md` warns about, so the chip reads the record and FleetPal's annual PM is used only to raise a
  disagreement (Q-DBV2).
- Trailers: the row has only `trailerUnit` (a string). The reader resolves it to `trailers.id`.

This reader is also FleetPal plan **F11**'s missing writer input (`next_pm_due_*`). Build it once, where F11
wants it, and do not restate it for the board.

### 3.5 Random drug test (D-DBV6)

Selections exist (`medstop_selections`, 0463; `drawState`: due / upcoming / tested …). The existing
dispatch stop covers **violations only** (`returnToDutyBlocked`). Nothing tells dispatch "this driver was
drawn; send them to test". The draw list is restricted to testing-record roles (§382.305(l), owner ruling
at `medstopProgram.ts:244`). So the board gets a **redacted fact**: *Random test: send to collection*,
present while a draw is due or ordered and untested. It carries no date, no pool and no result, on the
`dispatchHoldForReader` pattern (`packages/shared/src/returnToDuty.ts:134`). Q-DBV3 asks whether that is
allowed.

## 4. Other drivers' blockers (not asked; listed so the choice is explicit)

Medical card and CDL expiry (`drivers.*_expires_at`) and the DQ attention list (`dqAttention`) exist, and
none reach the board. Recommend adding *Med card 12 d* / *CDL* to the same Warnings column in the same
PR as §3.5, because a dispatcher who books a load for a driver whose card expires mid-trip has the same
problem as one booking a truck overdue for its annual.

## 5. The routing bug (D-DBV7)

**Confirmed, and it is by design, not a slip.** The drawn route never starts at the truck:

- `liveMapLoadRoute.ts:51-60` routes **pickup → middle stops → delivery** through HERE (truck profile),
  per D-TC3/D-TC6 (Q-TC1 ruled (a)). The stops query does not read arrival status, so stops already
  done stay in the route.
- The route is cached in `route_geometries` (0059) by a key of stops + profile, **with no expiry**. One
  early HERE choice (I-80 vs I-76) is permanent for that load.
- Off-route detection exists (`nearestOnRoute`, `OFF_ROUTE_MILES = 1`). When the truck is off, the only
  effect is a note ("Truck is N mi off this route"). Then `coveredMiles = 0`, so the drawer's "still
  ahead" shows the **whole** pickup → delivery distance mid-trip, and fuel stops are planned from the
  pickup on a road the truck is not on.
- No breadcrumb is stored (`vehicle_positions` is one row per truck), and nothing draws where the truck
  actually went.

Fix, one PR each:

1. **Route from the truck.** When the truck is off route, or always once the truck is past the pickup,
   origin = the truck's GPS (rounded to ~0.05° for cache hits, with `course=<heading>` so HERE does not
   turn a moving truck around), via/destination = stops **not yet arrived**. The fuel solver runs on the
   line drawn, so D-TC6's "one line" holds. This changes D-TC3/Q-TC1(a); the TC plan gets a log entry,
   not an edit.
2. **Route cache expiry**, 24 h on `created_at` (the column exists).
3. **Driven path.** An on-demand endpoint pulls Samsara GPS history for the load's truck since pickup
   departure, thins it, and caches it for 60 s. The map draws it as its own "driven" line, replacing
   today's "covered" segment, which is only the plan up to the truck's projected point.
4. The drawer's "still ahead" uses the re-routed distance. That figure is §3.3's v2 Miles left.

## 6. Open questions — owner rulings

- **Q-DBV1 — Columns.** Adopt §3's eight columns as the default and move HOS, GPS, next stop and next
  load to the drawer and the *Live* preset? *Recommend yes.* Best confirmed by showing the dispatchers a
  mock first (one screen, half a day).
- **Q-DBV2 — Annual inspection: which source?** Our annual-inspection record or FleetPal's PM? *Recommend
  the record*, with a disagreement shown to the shop manager. The 6-month and oil change come from
  FleetPal, since they exist nowhere else.
- **Q-DBV3 — May a dispatcher see "Random test: send to collection"?** The driver has to go promptly once
  told, and the dispatcher plans around it, but §382.305(l) limits who sees testing records. *Recommend
  yes, redacted as §3.5, visible only for the dispatcher's own drivers*; the DER notification is unchanged.
  Worth one line to counsel with the counsel package.
- **Q-DBV4 — HERE per-row miles.** ~110 loaded trucks every 15 min is ~10,500 routing calls a day before
  cache hits. *Recommend v1 (≈, free) now, and v2 only after 14 days of DB7 numbers show v1's error
  matters.* The routing fix (§5) needs HERE only when a drawer opens, so it ships regardless.
- **Q-DBV5 — Colours.** Keep the old board's red/amber/green on Available, so the habit carries over (red
  = needs a load now)? *Recommend yes*; our badge tones map one to one.
- **Q-DBV6 — Loads page Dispatch column** (Q-DB9 again, now with the dispatchers' answer implied): hide it
  until used? *Recommend yes.*
- **Q-DBV7 — Idle Tractors / Idle Trailers.** The old board has both pages. Our "Empty now" covers idle
  tractors. Idle trailers are not on our board at all. Ask the dispatchers if they use them.
- **Q-DBV8 — Does the Loads page take the board's census strip?** (raised by DBV7, 2026-10-16) The
  board's strip (D-DBV2) counts TRUCKS per fleet; a Loads row is a LOAD, and an uncovered load has no
  truck and so no fleet. Borrowing the strip as it is would print truck counts above a list of loads —
  the chip and the table disagreeing, which is exactly what D-DBV2's "counts come from the same rows"
  forbids. Candidates:
  (a) a load census on Loads: the same strip anatomy, counting the list's own rows (loads in the open
  queue) per fleet of their truck, with Uncovered as its own chip and Dispatched by moved under *More*
  as on the board. `DispatcherCensus` becomes a strip over `{label, count, sub}` items fed by a truck
  counter on the board and a load counter here. About half a day with tests.
  (b) the truck strip as it is — rejected above.
  (c) keep the v1 control (My fleet · All, Fleet, Dispatched by) on Loads; the two pages then scope
  with different controls that mean the same thing.
  *Recommend (a)*, as DBV8, after the dispatchers have seen DBV7 — they named the board, not Loads, when
  they asked for counts. Until ruled, Loads keeps (c); nothing borrows the strip around the mismatch.
  **Ruled 2026-10-16 (owner: "proceed as proposed"): (a), built as DBV8.**

## 7. Steps (one PR each)

- **DBV0** — #1578: the ETA recorder writes again (merged before anything here).
- **DBV1** — Shared rules: structured `availability`, `availableNear`, chained miles (§3.1, §3.3 v1).
  Contract + API. No UI.
- **DBV2** — The page: eight columns, the dispatcher chip strip with counts, State/City/By filter, 3
  queues, the Live preset (waits on Q-DBV1, Q-DBV5).
- **DBV3** — Maintenance reader (FleetPal, trucks + trailers), with the classifier and its typo cases; the
  Warnings column (waits on Q-DBV2).
- **DBV4** — Random-test redacted fact, plus med card and CDL in Warnings (waits on Q-DBV3).
- **DBV5** — Routing: route from truck over unreached stops, cache TTL, drawer miles (§5.1, 5.2, 5.4).
- **DBV6** — Driven path on the map (§5.3).
- **DBV7** — Loads page: Dispatch column, Miles left and appointment in Delivery (Q-DBV6).
- **DBV8** — Loads page scope control: the census strip counting loads (Q-DBV8 (a)).
- **Later** — HERE miles per row (Q-DBV4, after DB7's 14 days).

## 8. What this does NOT do

No writes to McLeod (D-LMR1). No second map. No new page: Available near is a filter on the board, and the
dispatcher counts are its scope control.

## 9. Progress log

### 2026-10-15 — Written; the ETA recorder fixed

Research by reading the board, routing and data sources and measuring production (§2). Found and fixed
the ETA recorder writing nothing (#1578, merged f1d7a50). Waiting on §6.

### 2026-10-16 — Rulings: every recommendation adopted

Owner: *"proceed as recommended."* So:
- **Q-DBV1** the eight columns are the default, and HOS, GPS, next stop and next load go to the drawer and
  the Live preset. The "mock first" step is the staging build itself: the owner shows it to the
  dispatchers there before the release is approved.
- **Q-DBV2** the annual inspection reads our inspection record. FleetPal's annual PM only raises a
  disagreement. 6-month and oil change come from FleetPal.
- **Q-DBV3** the redacted "Random test: send to collection" is shown, for the dispatcher's own scope.
  One line to counsel is owed and goes in the counsel package. The flag ships behind that line's answer
  only if counsel objects.
- **Q-DBV4** miles left are the free estimate (≈) now. HERE per row waits on DB7's 14 days.
- **Q-DBV5** keep red/amber/green on Available.
- **Q-DBV6** the Loads page Dispatch column is hidden, and the action stays in the kebab.
- **Q-DBV7** stays a question for the dispatchers (idle trailers); nothing is built for it.

Build order: DBV1 → DBV2 → DBV5 → DBV3 → DBV4 → DBV6 → DBV7.

### 2026-10-16 — DBV1, DBV5 merged; DBV2 the page

- **DBV1 (merged #1583):** the row carries a structured `available` (city, state, ZIP, coordinates, time,
  basis) and `milesLeft`, chained through every stop still to make. Shared `availableNear` and
  `knownCityPoints` back the filter.
- **DBV5 (merged #1584):** a truck off the planned line gets the road ahead routed from its fix and
  heading. The route cache is refreshed after 24 h. The drawer's "still ahead" is the server's figure.
- **DBV2:**
  - **Columns.** Truck (trailer beneath) · Driver · Dispatcher · Available (red/amber/green, the
    default sort) · Available in (with ZIP) · Miles left (≈) · Status. The Live columns are hidden by
    default (`useTableColumns`'s new `defaultHidden`). Their storage key is versioned so v1
    preferences do not bring them back.
  - **Census strip.** Mine · All · each fleet with its trucks and how many are empty · Pool. It
    replaces the My fleet toggle and the Fleet select.
  - **Filters.** State, Near and Free (within N h) are the primary filters. Within (radius) and
    Dispatched by are under More.
  - **Queues.** Three tabs: All · Needs a load · Needs attention. The narrow queues stay as filters,
    because the Operations cards open the board on them (D-FM7). Such a queue shows as a fourth tab
    only while a link has it in force.
  - **Choices made in building.** "Free" is a horizon in hours, not a date, so a saved view means the
    same thing tomorrow. There is no "Live preset" button: the Live columns are one tick each in the
    column picker. The Loads page keeps the v1 scope control (`DispatchScopeControls`); DBV7 revisits it.
  - **Browser pass.** Done at 1440 and 390 on a stubbed board. It found the census strip drawing only
    its first tile, because `row` buttons are full-width; fixed.

### 2026-10-16 — DBV3 maintenance warnings

- **Where each fact comes from.** The truck's annual reads `vehicles.dot_annual_inspection_expires_at`
  and the trailer's reads `trailers`, both through roster and judged by `inspectionExpiry()` (Q-DBV2).
  The 6-month, the oil change and open repair orders come from FleetPal through the new
  `readUnitMaintenance` in the `fleetpal` module. `livemap` reads it through that module's index; the
  boundary gate has the edge. The trailer is the current load's `trailer_id`, so a bobtail truck shows
  only its own chips.
- **The rules are shared** (`packages/shared/src/maintenanceDue.ts`): `classifyPmName` (typo-tolerant;
  the production misspellings are its test cases), `pmWarning`, `annualWarning`, `sortWarnings`. F11's
  `next_pm_due_*` writer reads these when it is built, not a second copy.
- **Measured in production, and built to it.** Oil intervals are ODOMETER in metres: 20,000 mi, warn
  inside 7,000. The 6-month is TIME: 6 months, warn inside 30 days. The odometer is
  `vehicles.current_odometer`, which matches FleetPal's to within ~200 mi, so §3.4's `fleetpal_meters`
  read is not needed. Work orders are CLOSED 5,497 · OPEN 20 · CANCELED 6 · COMPLETED 1. There is no
  "scheduled" status, so "open" means `OPEN`.
- **Choices made in building.**
  - Only **overdue** and **due** (inside FleetPal's own warning window) show. §3.4's "upcoming" is
    dropped: the dispatchers' board shows only what needs acting on.
  - A schedule that cannot be judged (never done, no odometer, unknown unit) shows nothing rather
    than a false "overdue".
  - Two schedules of one kind on a unit (typo'd duplicates) show once, the worse of the two.
  - An overdue item sets `flags.maintenanceOverdue`, which puts the truck on Needs attention.
- **The column.** Warnings is a default column, the last before the hidden Live ones: "Annual overdue 09/30/2026",
  "Oil in 1,133 mi", "Trailer 6-month due 11/01/2026", "Repair order open". Red for overdue, amber for
  due. It sorts most-pressing first.
- **Still owed from Q-DBV2:** showing the shop manager where FleetPal's annual PM and our record
  disagree. Not built here.

### 2026-10-16 — DBV4 the driver's warnings: random test, medical card, CDL

- **Random test (§3.5, Q-DBV3).** The Warnings column says *"Random test: send to collection"* while
  the driver has a draw the Drug & Alcohol page's Random tab lists as **due**: open and untested, in
  the current period or an earlier one, ordered or not (`driversDueForRandomTest` reads that list, so
  the two pages cannot disagree). It carries no date, pool, service or result. A draw in a later
  period never shows, because that would be notice before the driver's. Measured in production: 22
  open untested draws, none ordered yet; ordering leaves a draw `OPEN` until its test lands.
- **Who sees it.** `randomTestVisible` follows `dispatchHoldForReader`'s shape. A testing-record reader
  (admin, safety manager) sees it on every truck. Anybody else sees it only on their own trucks
  (`inMyScope`), and the draws are not even read for a reader who is nobody's dispatcher. Until an
  office links a dispatcher in Settings › McLeod fleets, that dispatcher sees none. Only 2
  `tms_dispatchers` were linked on 10-16. That is the honest consequence of the ruling, not a
  defect to route around.
- **Medical card and CDL (§4).** From the driver's DQ file, through evidence's `getComplianceOverview`
  (the roster's own cells, D-DQ6), never `drivers.*_expires_at`. Expired is overdue and inside the
  file's 30 days is due. *Missing* shows nothing: it is the qualification queue's work, and a synced
  record with no date would otherwise read as a false alarm. They show only to a reader the org's
  `roster: view` admits, the DQ file's own gate. Every role that sees the board has it by default; an
  org override that removes it removes the chips and the read.
- **Urgent, not only overdue.** The flag is renamed `warningUrgent` (was `maintenanceOverdue`), and
  `warningIsUrgent` is anything overdue or a random test. Red chip, Needs attention, and the heavy
  weight in the Warnings sort. Sort order: urgent first, then the driver before the truck before the
  trailer.
- **Per reader, after the shared rows.** `readBoardRows` stays the same for every caller (the ETA
  recorder shares it); `readDispatchBoard` adds the driver's warnings for the reader. Two new module
  edges: `livemap -> evidence` and `livemap -> medstop`. Med-Stop already read the board's rows, so
  the two cross through each other's index, like evidence and medstop.
- **Counsel.** The one line the ruling owed is **Q19** in `COUNSEL-REVIEW-PACKAGE.md`. If counsel
  objects, the random-test chip is withdrawn and the DER calls the dispatcher instead.
- **Bound noted, not changed.** `getComplianceOverview` reads `certifications` unpaged. Production
  holds 375 current driver certifications, under PostgREST's 1,000. Past that cap the DQ queue itself
  would be short too, so the fix belongs there, for both readers at once.

### 2026-10-16 — DBV6 the road the truck drove

- **What the map draws.** With a route open, the map now draws where the truck actually went since it
  left the pickup: a solid line, from Samsara's GPS history. It replaces "covered", which was only the
  plan up to the truck's projected point. Without it (not departed, no Samsara link, no GPS, or a slow
  answer) "covered" stays as before, and the card says why in one line.
- **Its own request.** `GET /api/livemap/loads/:id/driven`, beside the route's and on the route's gate
  (`dispatch: view`), so the route never waits on Samsara. Cached a minute per load, server and
  browser. Same cache rules as the board: TTL from the start of the read, one shared read, failures
  not cached. Expired entries are swept on each call. The Samsara call is in the **live** rate lane:
  the existing bulk GPS fetcher ran in the backfill lane, which gets only what live traffic leaves.
- **The window** starts at McLeod's `actual_departure_at` on the first stop (107 of 108 loads in
  transit, 2026-10-16), else the driver app's `completed_at`. Those trips were 25 h old at the median
  and 70 h at p90, and one was 18 days. So the window is capped at **72 h**, and the card says when
  the line was cut.
- **Thinning.** Samsara answers a fix every ~6 s (6,088 points for 21 h). `thinPath` is Douglas–Peucker
  at 0.02 mi. On that trail it kept 629 points (22 KB, 13 ms) and lost 0.15% of the length; 0.05 mi
  started cutting corners.
- **Measured end to end** on six real loads in transit: 0.6–2.3 s, 33–1,192 points, each starting at
  its pickup departure, none capped.
- **Found on the way, not changed.** Importing `liveMapLoadRoute.ts` (or this file) as the FIRST module
  throws `Cannot access 'IDLE_SOURCE_WINDOW_DAYS' before initialization`. That is a samsara-module load
  cycle that predates DBV6: the existing route module hits it alone, and through `app.js` everything
  loads. It matters only to a one-off script, which must import `app.js` first.
- §5's four fixes are now all built: §5.1 and §5.2 in DBV5, §5.4 in DBV5's `aheadMiles`, §5.3 here.

### 2026-10-16 — DBV7 the Loads page

- **Dispatch starts hidden** (Q-DBV6). The page now has the board's ColumnPicker (`useTableColumns`,
  table `dispatch.loads`, `defaultHidden: ["dispatch"]`), so the column is one click away for whoever
  still wants it, and the choice is per browser and in `?hide=` like the board's. The *Dispatch…* action
  was already in the row menu and stays there. Exceptions is another table, so it shows no picker.
- **Delivery gives the board's answer.** The appointment now always shows, labelled *Appt*; an arrival
  is printed beneath it rather than in its place, because the board judges Available against that
  appointment. A pickup's arrival still replaces its appointment. For the load a truck hauls now, the
  cell adds the board row's miles left ("≈ 412 mi left"), READ off the board like the on-time verdict
  (`loadsOnBoard.milesLeftOf`) — the chain runs from the truck's GPS fix, which the list does not have.
  No figure (no fix, a stop without coordinates) prints nothing, never "—".
- The stop cell moved into `LoadStopCell.vue`, which keeps the page under its 500-line budget (491).
  The stop's display name is one function, `loadStopName`, read by the cell and by the page's search.
- **Census strip not adopted** — counts would be trucks over a list of loads. Written up as Q-DBV8
  with a recommendation; Loads keeps the v1 scope control until it is ruled.

### 2026-10-16 — DBV8 the Loads page counts its own loads

- **Ruling.** The owner answered Q-DBV8 "proceed as proposed", so (a) was built.
- **One strip, two counters.** `DispatcherCensus` now only draws buttons, and `censusItems.ts` builds
  them. `truckCensusItems` is the board's strip moved out unchanged (the board's census test passes
  as it was). `loadCensusItems` counts the Loads list by running the page's own `admits` with each
  button's choice. That is the very test the table runs, so a button's number is always the rows it
  shows, the Uncovered exemption from My fleet included.
- **What it counts.** The open tab's loads under its Type, search and Dispatched by. On Exceptions it
  counts the exceptions, each by its load; one with no load counts under All and Mine only, as
  before. Every working fleet the board knows gets a button, even at 0, so the strip does not shift
  between tabs. Pool, No fleet and **No truck** close it only when they hold something, or while
  pressed.
- **No truck** is a new scope choice (`NO_TRUCK_OPTION`). A load with no truck is unfleeted for a
  different reason from a truck with no fleet code, and the button names it. Board rows carry no
  `hasTruck`, so the board's No fleet is unchanged.
- **Dispatched by** moved under Filters with a chip, as on the board. Clear filters now keeps the
  census choice (a fleet), as the board's does.
- `DispatchScopeControls.vue` (the v1 control) and `fleetOptions` had no other reader and are gone. The
  Type filter and the hazmat chip words moved to `loadType.ts`, so the page is 475 lines.

### 2026-10-16 — Q-DBV2's second half: annual dates the shop should check

- **What the shop sees.** The Operations tab's Shop card has a fourth figure, **Annual dates to
  check**. It opens `/shop/annual-dates`, a list of the trucks and trailers whose annual inspection
  date in FleetPal disagrees with our record, the one the board reads. Each row shows both dates in
  the record's own words (`InspectionExpiryCell`), how far apart they are, and what to fix and where.
  The rows where the board's verdict would change say so. The unit links to the annual register.
- **The rule** (`annualDisagreement`, `packages/shared`): both dates are judged by `inspectionExpiry`.
  A unit is listed when the two **verdicts differ** (expired, expiring or valid), or when the dates
  are **more than the 30-day warning window apart**. A unit with no record of ours but an annual in
  FleetPal is listed. One FleetPal does not schedule is not: 12 such units, 2026-10-16.
- **Measured in production** (2026-10-16, in-service units in both systems):
  - Gaps: 409 pairs; 265 within 10 days, 61 at 11–31, and 83 beyond 31.
  - The reader lists **84**, 14 of them where the verdict differs:
    - 10 where FleetPal says expired or expiring and ours says valid;
    - 3 the other way round;
    - 1 truck with no record at all.
  - The run over production returned exactly the SQL measurement's numbers.
  - Most gaps have FleetPal about a year behind ours: this year's inspection reached our record and
    FleetPal's schedule was never marked done.
- **Where it lives.**
  - `fleetpal.readFleetPalAnnualDue` reads FleetPal's next due date: last done plus the interval,
    whichever interval comes first; for a duplicate schedule, the later date.
  - `roster.listAnnualInspectionExpiries` reads ours, over the units the annual register covers.
  - `maintenance/inspections/annualDisagreements.ts` joins the two.
  - The PM reads `readUnitMaintenance` already made are shared, not repeated.
- **Today is the board's** (the UTC day), so a badge on the page matches the board's chip. Both move
  to the carrier's day together.
- Found on the way: `InspectionExpiryCell` printed a valid date raw (`2027-06-16`) on Vehicles and
  Trailers. It now uses `formatDate`.
