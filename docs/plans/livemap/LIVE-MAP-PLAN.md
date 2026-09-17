# Live map + role-based dashboards — execution plan

**Status: READY TO EXECUTE.** Written 2026-09-10. Decision IDs are `D-LM*` (the map and its
collector) and `D-DW*` (the dashboard widget catalogue). Cite them the way `D-SAM2` and `D-SURF3`
are cited.

**Companion plan.** `docs/plans/mcleod/MCLEOD-COLLECTOR-PLAN.md` owns *how McLeod is read* — change
detection, cadence, isolation, and the live/sandbox split (`D-MCC*`). This plan owns *what the map
is*. Where they overlap — LM0's grant and LM1's change detection — this document defers.

**One open question, `Q-LM19`, recorded in §8's dated log of 2026-09-17** — and it is the owner's to
answer, not a measurement's: whether D-LM18's scope disclosure and D-LM9b's freshness clause come off
the rail's foot, as item 6 of the owner's list asks. Every question the RESEARCH raised was closed
against a measurement, and §3 records the measurement beside the ruling. Where a fact could change
(a vendor grant, a carrier's configuration), §4's resume ritual says how to re-measure it and §5's
step says what to do when the answer differs. A step never says "investigate"; it says what to run
and what to conclude from each outcome.

---

## 0. Ground truth — measured 2026-09-10, not recalled

Two sentences of context, then the numbers.

The owner's request was: give each role its own Dashboard, starting with Dispatch, whose first
view is a live map of the trucks in that dispatcher's fleet, with loads pulled live from McLeod and
positions arriving from Samsara. Three of the four premises in that sentence turned out to be
wrong in ways that change the build, and one turned out to be far more available than anyone
thought. All four are recorded here rather than discovered again later.

**What was wrong, and what replaces it:**

1. **"Positions via webhook from Samsara" is not a thing that exists — and the vendor says so
   itself.** Samsara webhooks carry *discrete event* types. Only four are GA — `AlertIncident`,
   `DvirSubmitted`, `SevereSpeedingStarted`, `SevereSpeedingEnded` — and the beta set
   (`GeofenceEntry`, `GeofenceExit`, `EngineFaultOn/Off`, `RouteStopArrival`, `RouteStopDeparture`,
   `RouteStopEtaUpdated`, `FormSubmitted`, `DriverCreated`, `VehicleUpdated`, ~a dozen more) contains
   nothing that emits a position on a schedule. Samsara's own TMS integration guide is explicit
   about the alternative: for live tracking it recommends **polling `GET /fleet/vehicles/stats/feed`
   every 5–30 seconds**, and does not mention webhooks for location at all. Independently, our
   production token is **read-only for Webhooks and Alerts** (every write 401s), so no subscription
   could be created from here even if one existed. → **D-LM1**. `SAMSARA-COLLECTION-PLAN.md` §1.1
   reserved this in writing — *"Fuel-theft detection does not need seconds; a live map does."*

   ⚠ Our own webhook is a live illustration. `Fleetguardweb` is subscribed to five `RouteStop*`
   events, points at `/api/webhooks` (our handler is at `/api/webhooks/samsara`), and **has never
   delivered a single event**. Q-SAM2 already ruled those five are replaced by `AlertIncident`.
   Nothing in this plan depends on that webhook, and this plan must not be read as a reason to keep
   the `RouteStop*` subscriptions alive: they also require Samsara **Routes** to be configured,
   which this carrier does not use — it dispatches from McLeod.

2. **"The dispatcher's fleet" had no representation anywhere** — not in Silvicom 360, and, it turns
   out, not in McLeod either. `terminals` was created at migration 0097 and dropped at 0259 after
   measuring zero rows; McLeod's `users.terminal_id`, `users.department_id` and
   `users.employee_type` are **empty on all 208 rows**. There is no terminal, division or board
   structure to scope by at this carrier. → **D-LM3**: the scope is the *load's* dispatcher, and
   §3.6 is the measurement that forces it.

3. **McLeod's own dispatch ODS is empty.** `ods_dispatch`, `ods_move`, `bi_ods_dispatch` and
   `bi_ods_move` are all **0 rows** — the same class of trap as `pft_cost` (the capability ships,
   the carrier never configured it). Anyone who finds those table names and assumes a ready-made
   dispatch view will lose a day. → the board is assembled from `movement` + `continuity` + `stop`,
   and §5 LM1 carries the exact SQL.

4. **The one that was better than expected: `lme`, McLeod's live production database, is readable
   now.** `HAS_DBACCESS('lme')` returned **0 on 2026-08-26** and returns **1 on 2026-09-10**;
   `lme.dbo.movement` has 298,238 rows and the last mobile-comm position was written in the same
   minute as the query. The memory note `mcleod-sandbox-access` ("cannot read `lme`") is superseded.

   `lme_analytics` is **not a replica** — it is a full backup of `lme` restored on demand, and
   `msdb.dbo.restorehistory` records exactly two restores ever (2026-08-21 and **2026-09-10 11:36**,
   three hours before this measurement, which is the only reason it looked near-live). Between
   restores it is frozen. A live feature reads `lme` and nothing else; the sandbox is where the work
   is rehearsed. `MCLEOD-COLLECTOR-PLAN.md` D-MCC2 carries the full ruling.

**And one thing nobody had noticed we already own:** the Samsara vehicle-stats feed we poll every
20 minutes has requested `types=gps,...` since the tier was built. Every GPS sample — latitude,
longitude, speed, Samsara's own reverse-geocoded place name — **arrives on every tick today and is
discarded**, because only the odometer decoration and the tank level are persisted. The collector
for this feature is, in the literal sense, already running.

---

## 1. The architecture

```
  COLLECTORS                     CORE STORE                    HARNESS
  ──────────                     ──────────                    ───────
  samsara  ──── positions ────▶  vehicle_positions  ─┐
          (stats/feed, 5 s)      (1 row per vehicle) │
                                                      ├──▶  livemap  ──▶  web: features/livemap
  mcleod   ──── loads ────────▶  loads / load_stops  │      (API module)      · LiveMapPanel
           (on-prem agent push)  + dispatcher_ext_id  │                       · /live-map page
           ──── dispatchers ──▶  tms_dispatchers ────┘                       · dashboard widget
                                 (external → user_id)
```

Dependency direction is downward only, per D-ARC1. Two rules this shape exists to honour:

- **One collector per source, and each owns only what it uniquely knows.** Samsara knows where a
  truck is. McLeod knows what that truck is hauling and who is dispatching it. Neither is asked for
  the other's fact, and the two meet in the core store on a join key that §3.5 measured at 100%.
- **`livemap` owns no table.** It is a read-only harness module in the shape of `insights` — it
  joins four owners' tables behind one interface and writes nothing. The Dashboard's current habit
  of reading PostgREST directly from the browser is not extended to it (§2, D-LM11).

**This is not the shape the `eld-system-1.8-a` repo used, deliberately.** That system put live
tracking behind Kafka → Google Pub/Sub → a dedicated `realtime-ws-service` → WebSocket fan-out
across four Kubernetes deployments. Its own status document records the result: *"🚨 CRITICAL
ARCHITECTURE BREAK — the entire live tracking data flow is BROKEN at the service level"*, with
smooth marker animation — the only part a dispatcher can perceive — marked ❌ Missing. Silvicom 360
is a modular monolith by decision (D-ARC1/D-ARC2): one deploy, one Postgres. What transfers from
that repo is its *design*, and §2 names the three pieces worth taking.

---

## 2. Decisions

*(Numbers are allocation order, not document order: D-LM12–14 were added on 2026-09-10 after the
sandbox research and belong with the collector decisions they extend. A decision ID is a stable
citation, so none was renumbered.)*

### The collector

- **D-LM1 — positions come from the Samsara vehicle-stats cursor feed, at a 5-second tier.**
  *(Amended 2026-09-15: was 30 s. See the amendment block at the end of §2 — the vendor's floor is
  5 s and the owner asked for near-real-time, and the rate cost of the change is 0.4% of the limit.)*
  Not a webhook (none exists, §0.1). Not McLeod's `mc_position` (D-LM2). Not
  `/fleet/vehicles/locations/feed`, which Samsara's own reference deprecates: *"an older API that
  does not combine GPS data with onboard diagnostics. Try our new Vehicle Stats API instead."*
  The endpoint is the one the `stats` tier already calls; this adds a second tier with **its own
  cursor row**, because the two have different freshness needs and D-SAM6 makes freshness per-feed.

  **The interval is the vendor's own recommendation, not a guess.** Samsara's TMS integration guide
  says to poll this endpoint **every 5–30 seconds** for live tracking, and their Kafka
  documentation states the underlying GPS updates **every 5 seconds while a vehicle is on** — so
  there is real data underneath a fast poll, not a repeated identical answer. **5 s is the floor of
  the vendor's own range and is what ships** — their Telematics Sync guide states it as a rule:
  *"You should not request updates more frequently 5 seconds."* The env var makes it tunable
  without a deploy of new code.

  Rate cost is settled arithmetic: the published limit is **50 requests per second per
  organization**, and a steady-state re-poll of the whole fleet drains in **one page** (measured
  2026-09-01, 192 vehicles). A **5-second** tier therefore runs at **0.2 req/s — 0.4% of the
  limit**. The seed costs 12 pages, once. (At the old 30 s it was 0.033 req/s; neither figure is
  anywhere near binding, which is why the interval is a product choice and not a budget one.)

- **D-LM1b — `/assets/location-and-speed` is the documented upgrade path, and is deliberately not
  v1.** It is Samsara's purpose-built live-tracking endpoint and it is better on paper: UTC RFC-3339
  `happenedAtTime`, `location.headingDegrees`, `location.accuracyMeters`, optional
  `includeReverseGeo`, optional `includeGeofenceLookup` (closest geofence within 1000 m), optional
  `includeHighFrequencyLocations` for **up to 1 Hz**, and a cursor model identical in shape to ours
  (`after` / `endCursor`, omit `endTime` to poll live). It loses v1 on three counts, all concrete:
  it is a **new integration** with a different token scope (*Read Vehicles*, against the stats
  feed's *Read Vehicle Statistics* — and our token's scope set is not ours to change, §3.7); its
  rate limit is **10 req/s, five times tighter**; and it would be a second cursor and a second
  failure mode for data the feed we already poll already carries. Take it when the product needs
  sub-10-second tracking or built-in geofence attribution — then it is a one-step swap behind
  `samsaraPositionsFeed.ts`, because D-LM5's pure layer does not know which endpoint fed it.

- **D-LM1c — the Samsara Kafka Connector is the only true real-time option, and it is rejected on
  shape, not on merit.** It streams GPS **every 5 seconds while a vehicle is on** (5 minutes when
  off or idle), emits platform events in real time, and backfills up to 6 hours after a consumer
  outage. It is genuinely the answer to "can Samsara push positions to us". What it requires is a
  **Kafka cluster we operate**, network ingress for Samsara to produce into it, a security review
  for an external producer, and a consumer process — four things that do not exist in a product
  whose architecture is one Railway deploy and one Postgres (D-ARC1/D-ARC2). The gain over D-LM1 is
  30 seconds of staleness on a screen a dispatcher glances at; the cost is a new deployment target
  and a new class of outage. Revisit only if the product later needs second-granular safety-event
  streaming, where the same cluster would carry several feeds and the fixed cost is amortised.

- **D-LM2 — McLeod's `mc_position` is NOT ingested, and here is why, so nobody re-opens it.**
  It is real, it is live, and it is tempting: 1,074,356 rows, a fleet-wide GPS batch every ~10.5
  minutes, and — uniquely — `movement_id` and `driver_id` on every row, so position-to-load
  attribution would come free. It loses on four measured counts. **Reachability:** it lives at
  `10.0.1.171:1433` behind the carrier VPN; Railway cannot reach it, so every position would have
  to travel through the on-prem agent, making the live map depend on a scheduled task on a machine
  in the carrier's office. **Cadence:** batches land at 14:24, 14:13, 14:02, 13:52 — a ~10.5-minute
  floor no polling can improve, against a Samsara feed we can poll at any interval we choose.
  **Resolution:** `position_date` has one-minute granularity and is stored in server-local Central
  time (DST-shifting), against Samsara's second-resolution UTC. **Heading:** a compass string
  (`WSW`) against Samsara's `headingDegrees`, and a marker cannot be rotated smoothly by a
  16-point string. Coverage is also *not* the argument for it — Samsara covers 205 linked vehicles
  against `mc_position`'s 187 over 30 days. Attribution, its one real advantage, is recovered for
  free once loads carry `vehicle_id` (D-LM5).

- **D-LM3 — a load's dispatcher is `movement.dispatcher_user_id`; a truck's fleet code is not a
  scope.** Both exist in McLeod and they disagree. `movement.dispatcher_user_id` is populated on
  **270,021 of 270,021** delivered movements and **109 of 109** active ones.
  `tractor.fleet_id` is a dispatcher-named code (KANE, PETE, IVO, ROMAN…) on 585 of 590 tractors,
  and `tractor.dispatcher` on 391 of 590 — but measured against the same 107 active movements, the
  load's dispatcher matches the truck's `dispatcher` on **60 (56%)** and its `fleet_id` on
  **64 (60%)**. A truck belongs to a fleet nominally; who is dispatching it *today* is a property
  of the load. Scoping the map by the truck would show a dispatcher the wrong 40% of their board.
  Loads with `status='A'` (available, unassigned) correctly carry no dispatcher and form the
  map's "unassigned" bucket.

- **D-LM4 — the McLeod dispatcher is an identity we store, not a name we match.**
  `tms_dispatchers` maps `(org_id, provider, external_id)` → `user_id`, **nullable**, with
  `display_name` and `is_system`. Nullable is the whole point: McLeod has **15 active dispatcher
  accounts**; Silvicom 360 has **2 dispatcher memberships**. Thirteen of the people whose loads
  this map will render do not have an account yet, and their loads must still be labelled and
  grouped on the org-wide map before they do. Email cannot substitute for the mapping — only
  **6 of 15** McLeod dispatcher accounts carry one, and three of those are role mailboxes
  (`mcleod@`, `dispatch@`, `safety@`). `is_system` marks `loadmaster` and `lmeadm`, both named
  "McLeod Administrator", which between them hold **21 of the 109** active loads: those are loads
  with no human dispatcher, and the product must say so rather than invent one.

- **D-LM5 — the load ingest keeps its existing seam; only the dispatcher is added.**
  `POST /api/tms/loads` and `ingestLoads` are built, tested and correct (D48: an ingested load lands
  in `pending_approval` and never `offered`; once dispatch has approved it the feed stops writing
  and files an `amended` event carrying the diff). What is missing is not the receiver but the
  producer — `tools/mcleod-agent` pushes movements, roster, billing, settlements, vouchers,
  gl-accounts, ledger-totals, office-lines, deductions and driver-time, and **has no `loads.mjs`**.
  `tmsLoadInputSchema` already carries every field McLeod supplies except the dispatcher, so the
  contract change is two optional fields.

- **D-LM12 — hazmat is Silvicom's determination and McLeod is never asked for it.** Measured
  exhaustively on 2026-09-10 across every hazmat-bearing column in the database:
  `orders.hazmat = 'Y'` on **1 of 134,996**; `orders.equipment_type_id` carrying a `Z` (hazmat) DAT
  code on **3 of 11,880** 2026 orders; `edistatus.hazmat_code_id` blank on all 308,486;
  `freight_group_item` (which holds `hazmat_class_code` and friends) **0 rows**; `route.hazmat_type`
  is `'0'` on 5,402,250 of 5,402,295 and is a city-pair mileage cache with no load key anyway.
  **McLeod at this carrier does not record whether a load is hazmat.** Pulling the field would
  answer "not hazmat" for every hazmat load — worse than no answer.

  That is fine, because hazmat already belongs to the `hazmat` module and its versioned rules
  engine. What follows is the part that is **not** optional: `hazmat` is in
  `AMENDABLE_LOAD_FIELDS`, and `tmsMayOverwrite` lets the feed write freely while a load is `draft`
  or `pending_approval`. With `hazmat: z.boolean().default(false)`, an agent that omits the field
  sends `false`, and a re-sync **erases a hazmat flag our own engine set**. So the schema changes to
  `.optional()` with no default, and `ingestLoads` writes the column only when the key is present —
  the same "absent ≠ false" third state the per-user surface reset already uses. Silence from a feed
  that does not know is not the same as an answer.

  What McLeod *does* know is the other half, and it is fully populated: **`driver.hazmat_certified`
  is 1,311 `Y` / 159 `N` of 1,470 rows (100%)**, with `hazmat_date` on 1,336, and `equipment_type`
  code `H` has `applies_to = 'D'`. McLeod models hazmat as a **driver qualification**, not a load
  attribute. That belongs to the roster/DQF pull, not here — noted so it is not lost.

- **D-LM13 — reefer comes from the assigned trailer, because it is nowhere on the load.** Twelve
  candidate locations were checked (§3.8). `orders.equipment_type_id` — the DAT code that *would*
  carry `R`/`RZ` — is populated on **0 orders in 2023, 0 in 2024 and 5 in 2026**, and is blank on
  113 of the 114 orders on the live board. `orders.actual_reefer_profile`: 0 of 11,880.
  `orders.setpoint_temp`: 0.6%. `callin.setpoint_temp` and `callin.temperature`: **NULL on all
  162,511 rows** across 54,515 movements. `commodity`: blank on 81% of orders, and every commodity
  actually used is `is_hazmat='N'` with no temperature.

  The signal is the physical trailer: **`trailer.trailer_type`** (`V` van / `R` reefer), 91%
  classified fleet-wide and **113/113 — 100% — on the live board** (96 `V`, 17 `R`), reached through
  `continuity` type `L`. Our own roster cannot substitute: `trailers.trailer_type` is null on **186
  of 245** rows — which this pull can also backfill. "Reefer hazmat" is therefore
  `trailer_type='R'` **AND** our engine's hazmat flag; the DAT vocabulary does have `RZ` = *Reefer
  Hazmat*, and this carrier has never used it.

- **D-LM14 — the active set is bounded by scheduled date, not by status alone.** `movement.status`
  `'P'` includes **movement 11787: dispatcher `lmeadm`, scheduled March 2015, still active,
  4,182 days stale** — a phantom that would sit on a dispatcher's map forever. It is also the only
  active movement with no `continuity` row, which is how it surfaced. Exactly one such row exists
  today, and the worst *real* load is **≤7 days** past its last scheduled arrival, so a **30-day**
  bound sits about four times above reality and three orders of magnitude below the phantom. Status
  `'A'` (available, unassigned) is pulled too — 51 movements, 50 with stops and orders, scheduled
  −8 to 0 days — and forms the map's unassigned bucket.

- **D-LM15 — an unrecognised stop type is REPORTED, not guessed into a delivery and not silently
  dropped.** `stop_type` is `PU` and `SO` on 240 of 247 stops on the live board; the tail — `VA`,
  `VP`, `SP` (and `SD` historically) — is 2.8%. An earlier draft of LM1 mapped that tail to
  `dropoff`. That is a guess with a consequence: `writeStops` derives the driver's photo checklist
  from `kind` (`pickup` → `["trailer","bol"]`, anything else → `["bol"]`), so calling a yard move a
  delivery **asks a driver for a bill of lading that does not exist**. `movements.mjs` already
  refuses the same guess for the same reason, mapping the tail to `other`.

  The load contract has no `other` — `tmsStopInputSchema.kind` is `pickup | dropoff`, and
  `load_stops.kind` has a CHECK constraint — so widening it is a migration and belongs to **LM2**,
  which already ships one. Until then **LM1b sends `PU` and `SO` and reports any other type with its
  movement id and raw code**, the way `entityLookup` reports an unmatched key. Nothing is invented
  and nothing vanishes without a line in the report; the load lands in `pending_approval`, so a human
  sees the stop list before any driver does.

  ⚠ What this is NOT: a decision that the tail is unimportant. It is unmeasured — the VPN was down
  when this was written (§4.2 P5) — and measuring it is LM2's prerequisite, not a nice-to-have.

### The map

- **D-LM6 — MapLibre + the HERE proxy we already run. No new vendor, no key in a browser.**
  `maplibre-gl ^5.0.0` is a web dependency today and `features/fueling/RouteMapGL.vue` is a working
  production map against `/api/fueling/map-tiles/{z}/{x}/{y}`, which attaches `HERE_API_KEY`
  server-side and caches tiles for 24h. That component also already solves two traps that would
  otherwise be rediscovered: the oklch→sRGB conversion MapLibre's style parser requires (the canvas
  round-trip left oklch untouched on Edge and the route line silently failed to render), and the
  `transformRequest` that attaches the Supabase JWT to an authenticated tile proxy. Both are
  **extracted into a composable, not copied** (D-LM7) — the `eld-1.8` marker doc reached for Google
  Maps `AdvancedMarkerElement`; we are not adding a second map stack to get a rotating icon.

- **D-LM7 — the map renders one GeoJSON source and one symbol layer, never N DOM markers.**
  The reference implementation's roadmap has "MarkerClusterer integration for 100+ vehicles" as a
  future phase and "Performance optimization for 1000+ vehicles" after it. That problem is an
  artefact of one DOM node per truck. A GeoJSON source draws on the GPU, clusters natively, rotates
  by `icon-rotate` from a feature property, and colours by a `match` expression on state — at 205
  trucks it does not need optimising and at 2,000 it still would not.

- **D-LM8 — smoothness is client-side interpolation, not a faster transport.** Between polls,
  `requestAnimationFrame` drives `lerp` on position and `lerpAngle` on heading (with 360°
  wraparound) into `source.setData()`. This is the one piece of `eld-system-1.8-a`'s design worth
  taking verbatim, and it is worth noting that the repo which built the entire WebSocket service
  **never shipped the animation** — the transport was not what a user could see. No WebSocket, no
  SSE, no Supabase realtime channel is added: the office freshness model in this product is
  polling (`useMessages` polls at 30s and writes down why), and a store refreshed every 30 seconds
  by D-LM1's tier cannot justify a socket to read it. The map polls at **5 s** with vue-query and
  pauses when the tab is hidden — see D-LM9b for how the three intervals add up. *(Amended
  2026-09-15: was 20 s. With the collector at 5 s, a 20 s browser poll would have been the binding
  constraint on freshness, and the interpolation would have been easing toward a stale target.)*

- **D-LM9 — the map's vehicle states are `moving | stopped | parked | offline`, and the word
  `idle` is deliberately not among them.** The `idle` module owns an evidence-backed definition of
  idling built from engine states, park sessions and learned per-vehicle behaviour. An
  instantaneous "engine on, speed 0" is not that, and naming it `idle` would put a second, weaker
  answer to an existing question in front of the same operator. `offline` is defined by staleness
  against the feed's own bound, not by a guess (D-LM9b, D-LM10) — and because the vendor's ping
  drops to one every 5 minutes when a vehicle is off, the `offline` threshold is measured against
  the *parked* bound, or the whole yard turns grey overnight.

- **D-LM9b — the freshness bound is stated, added up, and shown.** Three intervals stack:
  the vendor's own GPS ping (**≤5 s while moving**, 5 min when parked), the collector tier
  (**5 s**), and the browser poll (**5 s**). Worst case a moving truck's dot is **~15 seconds**
  behind reality, typical case about half that. That number is the panel's stated bound, it is what
  `offline` is measured against, and it is the figure to re-derive — not re-guess — if any of the
  three intervals changes. A parked truck legitimately reports every 5 minutes, so the bound for
  `parked` is wider by construction and the UI must not call a parked truck `offline` at 60 seconds.

- **D-LM10 — staleness is displayed per truck, never hidden.** Each position carries `sampled_at`
  and the panel shows the age; a vehicle past the tier's stated bound renders `offline` rather than
  at a location it left an hour ago. This is D-SAM6 applied to a surface: the freshness figure
  belongs on the surface that depends on it. The active board already contains the case that proves
  it — of 109 active movements, positions were 7–12 minutes old for 106, and the outliers were
  **134 minutes, 225 minutes and 17 days**. A map that draws all four the same way is lying about
  three of them.

- **D-LM11 — `livemap` reads through the API, not through PostgREST from the browser.**
  The Dashboard today fetches Supabase directly under RLS. That is tolerable for a single-table
  aggregate and wrong here: this view joins `vehicle_positions`, `vehicles`, `drivers`, `loads`,
  `load_stops` and `tms_dispatchers`, applies a scope derived from the caller's identity, and would
  otherwise ship six table shapes and the scoping rule into a browser bundle. One endpoint,
  section-gated `dispatch:view`, org-filtered in the service (the service role bypasses RLS) and
  asserted by `supabaseRecorder`'s `expectOrgScoped`.

### The dashboard feature

- **D-DW1 — the Dashboard becomes a catalogue of widgets, each declaring its own gate. It does not
  become nine pages, and `DashboardPage.vue` does not branch on `session.role`.**
  A `role === 'dispatcher'` branch in a component would be `session.canManage` all over again: one
  hard-coded answer standing beside a section × role matrix that the API, the database and the
  sidebar already model correctly — and unlike that matrix, a component branch cannot express an
  org override, so the permissions preview page would start lying about what a role sees.
  `DASHBOARD_WIDGETS` lives in `packages/shared` beside `SURFACES` and reuses `SurfaceGate`
  verbatim, so a widget is gated by exactly the mechanism a sidebar entry and a route guard already
  are.

- **D-DW2 — "the dispatcher sees the live map first" is one row of data.** `defaultFor:
  ["dispatcher"]` and an order index. An admin who wants the map gets it by granting themselves the
  widget, and an org that gives `dispatch` to its safety manager gets it for free, because the
  answer is derived from the matrix rather than restated in a layout file.

- **D-DW3 — a user may reorder and hide their own widgets, and the stored value has three states.**
  `null` = inherit the role default, which is not the same as an empty layout. This is the same
  third-value shape the per-user surface reset already shipped (S3/S4), for the same reason: an
  explicit "show me nothing" and "I have not chosen" must be distinguishable or a default can never
  be changed for anyone who once touched the setting.

- **D-DW4 — the catalogue is gate-backed on the day it ships.** `check-surfaces.mjs` grows a
  sibling assertion: every widget key has an icon in the web's `Record<key, Icon>`, every widget
  gate names a real `AppSection`, every `defaultFor` names a real `UserRole`, and every widget that
  declares a `module` names a real `ModuleKey`. A catalogue without a gate drifts — that is the
  documented history of `nav.ts` and the 28 URLs it left reachable.

- **D-DW5 — the live map ships as both a widget and a full page.** `dispatch.live-map` is a real
  surface at `/live-map`, separately grantable, and the dashboard widget links to it. A dispatcher
  works a map full-screen; a fleet manager glances at one. One is not a substitute for the other.

---

### Amendments — 2026-09-15

Six rulings and two vendor-sourced corrections, taken after the owner set the near-term scope
("dispatch page with a map showing every truck at its real location; admin sees it as a tab"). The
decisions above are edited in place where a stale *number* would otherwise be implemented; everything
that changes *shape* is recorded here rather than by rewriting the decision it supersedes.

- **D-LM1d — Samsara's own pagination advice does not hold on this organisation, and our measurement
  wins.** Their Telematics Sync sample sleeps only when `hasNextPage` is `false`, and the TMS guide
  warns *"pagination must be drained per poll, or you'll silently lag."* Both assume the flag flips.
  **It does not here**: re-measured 2026-09-01, twelve pages deep, including on a single-sample page
  and an immediate re-poll of an idle fleet, `hasNextPage` was **always `true`**. Following the
  vendor's sample literally hangs a scheduler tick forever. LM4 terminates on an empty page
  (`feedPageHasData`) with a page cap, exactly as `STATS_FEED_MAX_PAGES` already does. This is
  written down because a future reader will check the vendor docs, find them to disagree with our
  code, and "fix" it.

- **D-LM1e — `/assets/location-and-speed/stream` is now a *co-equal* vendor recommendation, not
  merely an upgrade path, and D-LM1b's ruling survives anyway.** Samsara's TMS GPS guide names it
  beside `/fleet/vehicles/stats/feed` for the same job. D-LM1b's three reasons to stay on the stats
  feed for v1 are unchanged — same token scope, 50 req/s against 10, and no second cursor. Two facts
  added: the stats feed's `types=gps` **does carry `headingDegrees`, `speedMilesPerHour` and
  `isEcuSpeed`** (confirmed against the vendor's own sample payload), so nothing about marker
  rotation requires the stream; and **`accuracyMeters` exists only on the stream and Kafka
  responses**, never on vehicle stats. If GPS jitter turns out to need filtering, that is the reason
  we move, and it is the only one.

- **D-LM16 — `vehicle_positions` holds the CURRENT fix only. No history, ever.** Owner ruling,
  2026-09-15: *"We dont need to have history here, Samsara have history."* This confirms LM2's
  `PK (org_id, vehicle_id)` rather than changing it, and it is recorded as a decision because the
  shape is a one-way door — a current-only table cannot be given a past retroactively, and the first
  person to want a breadcrumb trail will propose widening this table. The answer is that the trail
  lives in Samsara, reachable through `GET /fleet/vehicles/stats/history`, which is also the vendor's
  own prescribed gap-recovery path. Widening this table is a new decision, not an implementation
  detail.

- **D-LM17 — trailers are not on the map.** Owner ruling, 2026-09-15. Tractors only. This also drops
  `/beta/fleet/trailers/stats` from scope, which is just as well: it is a beta path, so its contract
  is explicitly subject to change. `trailerPairingSync` continues to do its own unrelated job.

- **D-LM18 — v1 draws EVERY truck. "My assigned trucks" waits for McLeod, and that is a sequencing
  fact, not a gap.** The owner's goal is a dispatcher seeing their own trucks, and that scope comes
  from `movement.dispatcher_user_id` (100% populated on active movements) resolved through
  `tms_dispatchers` — i.e. from LM1b/LM3/LM11, all of which wait on a McLeod grant the carrier has
  not issued (`MCLEOD-COLLECTOR-PLAN.md` MC0, still denied as of 2026-09-15). **The tempting
  substitute is measured and rejected:** `tractor.dispatcher` agrees with the load's actual
  dispatcher on only **56%** of the live board, so half of every dispatcher's list would be wrong —
  worse than showing everything. So the map ships fleet-wide, the scope filter arrives with the
  McLeod feed, and nothing about the surface has to be restructured when it does.

- **D-DW6 — the Dashboard gets gated TABS, and each tab declares a gate exactly as a widget would.**
  Owner ruling, 2026-09-15: an admin wants Dashboard with an **Admin** tab and a **Dispatch** tab;
  a dispatcher wants the dispatch map. This does **not** overturn D-DW1 — there is still one
  `DashboardPage.vue`, and it still must not branch on `session.role`. A tab is gated the same way a
  sidebar entry and a route guard already are, which means the three properties D-DW1 was protecting
  all survive: an org that grants `dispatch` to its safety manager gets the Dispatch tab **free**;
  the permissions preview page keeps telling the truth about what a role sees; and admin sees every
  tab by passing every gate rather than by being named in a list. Tabs are a coarser-grained
  `DASHBOARD_WIDGETS` — LM9's catalogue and LM10's per-user layout remain the finer-grained finish,
  and are no longer on the critical path for the owner's ask.

  ⚠ The failure this rules out by name: `v-if="session.role === 'admin'"` on a tab. That is
  `session.canManage` again, it is the worked example in the root `CLAUDE.md`, and it is the one
  review note that should block this step.

- **D-LM19 — the Dashboard is `gate: ALWAYS` and renders cost today; that is a live exposure and it
  is fixed FIRST, independently of the map.** Measured 2026-09-15:
  `{ key: "dashboard", label: "Dashboard", path: "/", group: "top", gate: ALWAYS }` in
  `surfaces.ts:105`, and `features/dashboard/useDashboard.ts` selects `total_cost` on fuel fills and
  runs an idle **cost basis**. So every role that can sign in — dispatcher included — lands on a page
  showing fuel spend and idle cost. This is the owner's stated reason for wanting a separate
  dispatch surface at all, it is real, and it does not need the map, Samsara or McLeod to fix. It
  becomes step LM-F and ships alone.

---

## 3. Facts the design is bound by — each verified 2026-09-10, none recalled

Re-measure with the probes in §4.2 before trusting any of these in a later session.

### 3.1 McLeod access

| Fact | Value | How measured |
|---|---|---|
| `lme` (production) readable | **yes** — `HAS_DBACCESS('lme') = 1` | was `0` on 2026-08-26; supersedes `mcleod-sandbox-access` |
| `lme` size | `movement` 298,238 rows | direct count |
| `lme_analytics` | **a full restore of `lme`, frozen at the restore instant** — restored twice ever (2026-08-21, **2026-09-10 11:36**). Not a replica, not a refreshing feed | `msdb.dbo.restorehistory`; see MCLEOD-COLLECTOR-PLAN D-MCC2 |
| Change Tracking on `lme` | **enabled**, 91 tables, 10-day retention; `VIEW CHANGE TRACKING` **denied** to our login | MCLEOD-COLLECTOR-PLAN §3.1 |
| Server timezone | `(UTC-06:00) Central Time (US & Canada)`, currently `-05:00` | `CURRENT_TIMEZONE()`, `SYSDATETIMEOFFSET()` |
| Network | `10.0.1.171:1433`, reachable from the carrier LAN; **not** from Railway | `nc -z` |

### 3.2 The dispatch tables

| Table | Rows | Note |
|---|---|---|
| `ods_dispatch`, `ods_move`, `bi_ods_dispatch`, `bi_ods_move` | **0, 0, 0, 0** | the ready-made dispatch view does not exist here |
| `movement` | 298,240 | `status`: D 270,021 · V 8,125 · **P 109 (active)** · A 61 (available) |
| `continuity` | 818,281 | the movement→equipment link: `D` driver (1,373 distinct), `T` tractor (599), `L` trailer (338) |
| `stop` | 614,284 | **231 of 231** stops on active movements are geocoded |
| `orders` | 151,934 | |
| `users` | 208 | 15 active dispatchers; `terminal_id` / `department_id` / `employee_type` **empty on all rows** |
| `mc_position` | 1,074,356 | see 3.4 |

Two traps carried from `mcleod-data-model-traps` were **re-measured against live `lme` today**
rather than trusted:

| Trap | Re-measured 2026-09-10 |
|---|---|
| `movement.id` repeats across companies | **298,255 rows, 279,494 distinct — 18,761 collisions** across 3 companies. `external_id` must be composite (LM1) |
| Far-future sentinel dates strand a watermark | `MAX(stop.actual_departure)` = **2215-03-12 14:30**. Still live, still current |

### 3.3 The dispatcher relation (D-LM3's evidence)

| Column | Populated | Distinct |
|---|---|---|
| `movement.dispatcher_user_id`, status D | **270,021 / 270,021 (100%)** | 72 |
| `movement.dispatcher_user_id`, status P | **109 / 109 (100%)** | 15 |
| `movement.dispatcher_user_id`, status A | 0 / 61 | — (unassigned, correctly) |
| `movement.fleet_manager`, status D | 44,916 / 270,021 (16.6%) | — |
| `tractor.fleet_id`, status O | 585 / 590 (99%) | dispatcher-named codes |
| `tractor.dispatcher`, status O | 391 / 590 (66%) | |
| `driver.fleet_manager` | 216 / 1,498 (14%) | 14 |
| **Agreement on the 107 active movements with a tractor** | load's dispatcher = `tractor.dispatcher` on **60 (56%)**; = `tractor.fleet_id` on **64 (60%)** | 11 tractors carry a blank dispatcher |

Active board by dispatcher, 2026-09-10 14:15 CDT: `loadmaster` 20 · `pete` 12 · `romann` 12 ·
`steve` 11 · `chris` 11 · `ivok` 9 · `kane` 7 · `arturk` 7 · `koni` 6 · `vladi` 5 · `vinniev` 3 ·
`robert` 2 · `marija` 2 · `aneta` 1 · `lmeadm` 1.

### 3.4 `mc_position` — measured, then ruled out (D-LM2)

| Fact | Value |
|---|---|
| Rows / first real row | 1,074,356 / **2026-07-12** — exactly 60 days before measurement (rolling purge) |
| Freshness | last row 14:13, server clock 14:13:58 |
| Delivery | fleet-wide **batch every ~10.5 min** (14:24, 14:13, 14:02, 13:52) plus a tail of stragglers |
| Timestamp | **1-minute resolution**, server-local Central, DST-shifting |
| Unit coverage | 157 / 1d · 168 / 7d · 187 / 30d · 191 / 90d — all `company_id='TMS'`, `mc_unit_type='T'` |
| **Longitude sign** | **stored POSITIVE (west-absolute)** — 0 negative of 119,962 rows over 7 days; range 68.39–123.39, lat 25.87–48.60. `lng = -longitude` |
| Heading | compass string (`WSW`), not degrees |
| Indexes | `x_mcp_unit_date (company_id, mc_unit_no, position_date)`, `x_mcp_move_date (company_id, movement_id, position_date)` |
| Fleet-wide latest-position query | **~0.3 s** including TLS connect |

The longitude convention is uniform: **every active stop's `longitude` is positive too** (231 of
231). Any McLeod geo column at this carrier is west-absolute.

### 3.5 The join keys — measured on the live active board, not on a sample

| Join | Result |
|---|---|
| `continuity` D `equipment_id` → `drivers.mcleod_driver_id` | **109 / 109 (100%)** |
| `continuity` T `equipment_id` → `vehicles.unit_number` (via `vehicleUnitKey`) | **108 / 108 (100%)** |
| `continuity` L `equipment_id` → `trailers.unit_number` (via `trailerUnitMatchKey`, R-strip) | **108 / 108 (100%)** |
| Fleet-wide: `mc_position.mc_unit_no` → active `vehicles.unit_number` | **154 / 157**; the 3 misses are `518new` and two ELD serials (`G6AA-5HS`, `GMN8-2TU`) |
| Active movements carrying a position | **106 / 109**; ages 7–12 min, outliers at 134 min, 225 min, 24,595 min |

`entityLookup.ts` already implements all three resolvers, already poisons an ambiguous key to
`undefined` rather than guessing, and already reports unmatched keys instead of dropping them.
Nothing about the matching layer needs to be built.

### 3.6 Silvicom 360, production

| Fact | Value |
|---|---|
| `vehicles` | 211 rows · 207 active · 205 with `samsara_vehicle_id` |
| `drivers` | 294 rows · 222 active · **168 active with `mcleod_driver_id` (75.7%)** |
| `memberships` | 11 total — 6 admin, **2 dispatcher**, 1 safety_manager, 1 technician, 1 driver |
| `loads` / `load_stops` | **0 / 0** — the dispatch feature is entitled and has never been used |
| `org_modules` | `dispatch` **enabled** on both orgs |
| `org_integrations` | `mcleod` and `mcleod_financial` both enabled and previously synced |
| Latest migration | **0334** (`fleetpal_collector`) — this plan's first migration is next-numbered at execution, never pinned |
| Roster hygiene | `vehicles` contains `"NNN - OLD"` duplicates (568, 676, 733, 738, 739, 748) and a duplicate `568`. Not this plan's to fix; noted because it inflates any "trucks without a position" count by ~7 |

### 3.7 Samsara

| Fact | Value | Source |
|---|---|---|
| `gps` object fields | `latitude, longitude, headingDegrees, speedMilesPerHour, time, address, reverseGeo, isEcuSpeed` | vendor API reference |
| Our parser models | `time, latitude, longitude, speedMilesPerHour, reverseGeo`, decorations — **`headingDegrees` and `isEcuSpeed` are not modelled** | `packages/shared/src/samsara/core.ts` |
| Feed already requests | `types=gps,fuelPercents,gpsOdometerMeters` + `decorations=obdOdometerMeters`, every tick | `samsaraStats.ts:61` |
| Current tier interval | `SAMSARA_STATS_SYNC_MINUTES` default **20** | `env.ts:68` |
| Feed returns intermediate samples | **yes** — arrays since the cursor. Proven in our own code: `findFuelLevelDrops` detects a drop *between* two polls, shipped in #582/#583 | `samsara/statsFeed.ts` |
| Rate limit | `GET /fleet/vehicles/stats/feed` = **50 req/s per organization**; 150/s per token, 200/s per org globally | vendor rate-limit reference |
| **Vendor's live-tracking recommendation** | **poll `GET /fleet/vehicles/stats/feed` every 5–30 seconds**; webhooks are *not* mentioned as an option for location | vendor TMS integration guide |
| Underlying GPS update rate | **every 5 s while the vehicle is on**, every 5 min when off or idle | vendor Kafka connector docs |
| Locations API | deprecated by the vendor in favour of stats | vendor reference |
| `/assets/location-and-speed` | exists; `headingDegrees`, `accuracyMeters`, optional reverse-geo, optional geofence lookup, optional **1 Hz**; cursor `after`/`endCursor`; **10 req/s**; scope *Read Vehicles* | vendor reference (D-LM1b) |
| Kafka Connector | real 5-second GPS streaming; needs a customer-operated Kafka cluster + ingress + security review; 6 h backfill | vendor reference (D-LM1c) |
| Webhook event types | GA: `AlertIncident`, `DvirSubmitted`, `SevereSpeedingStarted`, `SevereSpeedingEnded`. Beta: `GeofenceEntry/Exit`, `EngineFaultOn/Off`, `RouteStop*`, `FormSubmitted`, `DriverCreated`, `VehicleUpdated`, ~a dozen more. **None emits a scheduled position** | vendor reference |
| Our webhook today | `Fleetguardweb` → five `RouteStop*` events, wrong path, **zero deliveries ever**; Q-SAM2 ruled it becomes `AlertIncident` | `SAMSARA-COLLECTION-PLAN.md` §0.5 check 2 |
| Token write scope | **read-only for Webhooks and Alerts** — every write 401s | measured 2026-09-06 |
| `hasNextPage` on the delta feed | **always `true`** — it means "this stream continues", not "more data now". A `while (hasNextPage)` walk never terminates | re-measured 2026-09-01, twelve pages deep |

---

### 3.8 Where the load's equipment character is — and is not (sandbox, 2026-09-10)

Searched exhaustively on `lme_analytics` (a copy of `lme`, so structure and multi-year population
are identical), read-only, without touching the live server.

| Candidate | Result |
|---|---|
| `orders.equipment_type_id` (the DAT code carrying `R`/`RZ`) | **0 in 2023 · 0 in 2024 · 5 in 2026**; blank on 113 of 114 live-board orders |
| `orders.equipment_type_options` | blank on all 134,963 |
| `orders.actual_reefer_profile` | **0** of 11,880 2026 orders |
| `orders.setpoint_temp` / `temperature_min` / `temperature_max` | 855 of 134,996 (0.6%) |
| `orders.commodity_id` → `commodity` (62-row lookup) | blank on 81% of 2026 orders; every used commodity is `is_hazmat='N'` with no temperature |
| `callin.setpoint_temp` / `callin.temperature` | 162,511 rows over 54,515 movements — **NULL on every one** |
| `freight_group` / `billing_freight_group` (108k) | LTL/interline structure (`bol_nbr`, `pro_nbr`, place uids) — no equipment |
| `freight_group_item` (holds `hazmat_class_code` etc.) | **0 rows** |
| `route.hazmat_type` | 5,402,250 of 5,402,295 are `'0'`; city-pair mileage cache, no load key |
| `edistatus.hazmat_code_id` | blank on all 308,486 |
| `orders.hazmat` | **1** of 134,996 |
| **`trailer.trailer_type`** ✅ | `V` 267 · `R` 100 · blank 37 fleet-wide; **113/113 on the live board** |

Also established: `equipment_type` is a full DAT lookup (`R` Reefer, **`RZ` Reefer Hazmat**, `FZ`
Flatbed Hazmat — `Z` marks hazmat; `H` = Hazmat with `applies_to='D'`, a driver endorsement). The
vocabulary exists; the carrier does not use it on loads.

### 3.9 Load identity and shape (sandbox, 2026-09-10)

| Fact | Value |
|---|---|
| Orders per active movement | **exactly 1** on all 111 — `movement_order` is 1:1 here |
| `orders.id` uniqueness | unique within TMS (134,963 / 134,963); **16,948 collisions across companies** |
| `orders.blnum` uniqueness | **2,020 collisions** in 134,315 — unusable as `ref` against `unique (org_id, ref)` |
| `blnum` on the live board | 110 of 111 populated, 110 distinct |
| Stop vocabulary | `PU` pickup · `SO` delivery · `VA`/`VP`/`SP` (7 of 247); status `A` pending / `D` done |
| Status `A` movements | 51, of which 50 carry stops and orders; scheduled −8 to 0 days |
| Status `P` staleness | −6 to **4,182** days — the tail is movement 11787 (March 2015), the only one over 7 days |
| `driver.hazmat_certified` | **1,311 `Y` / 159 `N` of 1,470 (100%)**; `hazmat_date` on 1,336 |
| `continuity` vs `equipment_item` | **disagree on the live board** — see D-LM12/§6 trap 16 |

## 4. Execution protocol — read before executing anything, every session

### 4.1 Resume ritual

1. Read this document top to bottom, then `CLAUDE.md` (root, `apps/web`, `apps/api`, `supabase`)
   and `docs/MIGRATION-DISCIPLINE.md`.
2. Establish reality: `git log --oneline -15`, `pnpm verify:live`, and
   `gh run list --workflow=migrate.yml` before believing any schema mismatch.
3. **Re-measure §3.1 before any step that touches McLeod** (§4.2). `lme` access appeared between
   2026-08-26 and 2026-09-10 with no recorded grant; an access nobody can explain is one that can
   vanish. LM0 exists to make it explicable.
4. Find the first §5 step not marked **DONE**. Its "If the measurement differs" clause is the
   instruction — it never means guess.
5. One step per branch (`claude/<topic>`), PR to `main`, merge after CI. `main` is branch-protected
   (required check `build`), so there is no other path. **Branch from `origin/main`** — parallel
   chats share this working tree.
6. When a step ships, append a dated line to §8's progress log. **Do not** edit a status column in a
   table; parallel PRs marking adjacent table rows conflict every time.

### 4.2 The probes

The runner used to produce §3 is reproducible. Write it to the scratchpad (not the repo), import
`mssql` by absolute path from `tools/mcleod-agent/node_modules/`, and run it with
`--env-file=tools/mcleod-agent/.env`. Check `nc -z 10.0.1.171 1433` first — a failure there means
the VPN is down, not that credentials are wrong. **Run each probe as its own statement**: one bad
column name kills every branch of a `UNION ALL`.

The three probes that gate this plan:

```sql
-- P1 · is production still readable, and is it still live?
SELECT HAS_DBACCESS('lme') AS can_read_lme, GETDATE() AS server_local,
       (SELECT COUNT(*) FROM lme.dbo.movement WHERE status='P') AS active_movements;

-- P2 · is the dispatcher relation still total? (D-LM3 depends on 100%)
SELECT COUNT(*) AS active, SUM(CASE WHEN LTRIM(RTRIM(ISNULL(dispatcher_user_id,'')))<>'' THEN 1 ELSE 0 END) AS with_dispatcher
FROM lme.dbo.movement WHERE company_id='TMS' AND status='P';

-- P6 · does dbo.location carry a trade name, and what is the column called? (D-LM15's neighbour)
--      The stop NAME is currently composed from city and state because `location` has never been
--      read and its columns are unverified. If it carries one, stopName() becomes a join and the
--      LM0 grant gains an eighth table.

-- P5 · what ARE the VA / VP / SP stop types? (D-LM15, blocks LM2's vocabulary widening)
--      Look at their location, appointment window and position in the sequence against the PU/SO
--      around them. Decide whether they widen the enum or stay reported-and-unsent.

-- P4 · was equipment_item ever really in conflict with continuity? (trap 16's correction)
--      Join the way MOVEMENT_FACTS does — via m.equipment_group_id, NOT currentmovement_id — and
--      compare per (movement, type) as SETS, so team drivers cannot fan out into false mismatches.
--      Expected: they agree. If they do, delete this probe and the note beside D-LM12's neighbour.

-- P3 · do the join keys still resolve? (compare against drivers.mcleod_driver_id / vehicles.unit_number)
SELECT cd.equipment_type_id, COUNT(DISTINCT LTRIM(RTRIM(cd.equipment_id))) AS distinct_codes
FROM lme.dbo.movement m
JOIN lme.dbo.continuity cd ON cd.movement_id=m.id AND cd.company_id=m.company_id
WHERE m.company_id='TMS' AND m.status='P' GROUP BY cd.equipment_type_id;
```

### 4.3 Backend rules (each machine-enforced; gate names verified against `package.json` and `ci.yml`)

- Migration numbers are **never pinned in advance** — next-numbered at execution (`lint:migrations`).
- Every new table: `org_id`, `enable row level security` (`lint:rls`). No client policy means
  deny-all, API-only — the default here.
- **A new COLUMN and its first reader ship in two separate merges** (`lint:migration-ordering`,
  invoked directly in `ci.yml` at lines 111 and 117, not through `pnpm`). New *tables* are exempt.
  The window is 2m44s and a writer counts as a reader: a write to a column that does not exist yet
  fails exactly as a read does.
- Every service query org-filters itself; a test asserts it with `supabaseRecorder`'s
  `expectOrgScoped` (the API reads with the service role, which bypasses RLS).
- **Never `.upsert()` with a partial payload** (`lint:upserts`). `vehicle_positions` is written by a
  set-based RPC with a complete row, on the 0174/0175 pattern.
- Every new table gets a PGlite matrix in `supabase/tests/*.test.mjs` printing a `RESULT` line.
- Features may not import another feature's internals (`lint:boundaries`); 500-line file / 200-line
  function budgets (`lint:filesize`, `lint:funcsize`).
- A comment claiming test coverage must quote a real test title (`lint:comment-claims`).
- Agent changes are covered by `lint:agent-syntax` (chained onto `lint:cli-streams` in CI).
- Schema changes must commit the regenerated `schema.generated.sql` — that check hides inside
  `lint:table-writers`.
- New table ownership goes in `scripts/table-modules.json` (`lint:table-modules`, chained onto
  `lint:table-writers`), and a new table needs a producer (`lint:table-producers`).

---

## 5. Steps — each stands alone; execute in order

> **Execution order for the owner's 2026-09-15 ask** ("dispatch page with a map showing every truck
> at its real location; admin sees it as a tab"), which is a different order from the numbering.
> The numbering is allocation order and is never renumbered; this is the route through it:
>
> **LM-F** (close the cost exposure — stands alone, ships first) → **LM2** (migration) → **LM4**
> (the 5 s positions tier) → **LM5/LM6** (pure layer + API) → **LM7** (extract `useMapLibre`) →
> **LM8** (the `/live-map` surface) → **LM-T** (the Dashboard tabs, D-DW6).
>
> **None of those seven needs McLeod.** LM0/LM1b/LM3/LM11 — the dispatcher-scope half — stay blocked
> on the grant (D-LM18), and the map is fleet-wide until they land. LM9/LM10 (the widget catalogue
> and per-user layout) come off the critical path entirely, superseded for now by LM-T.

---

### LM-F · Stop showing fuel spend and idle cost to every role that can sign in

**Why, measured 2026-09-15 and not recalled.** `surfaces.ts:105` gates the Dashboard `ALWAYS`, and
`features/dashboard/useDashboard.ts` selects `total_cost` on fuel fills and runs an idle cost basis
(`useIdleCostBasis`). A dispatcher therefore lands on `/` and reads fuel spend. This is D-LM19, it is
the owner's actual reason for asking for a dispatch surface, and it needs neither the map nor any
integration — so it ships on its own, first, and the map work does not inherit it.

**The fix is a gate, not a `v-if` on a role.** The cost-bearing elements move behind a
`SurfaceGate`, evaluated by the same `session.can(...)` path the sidebar and the route guard already
use. **Do not** branch on `session.role` (D-DW6's ⚠) and **do not** merely hide the tiles — a hidden
tile still fetched the money. The query that reads `total_cost` must not run for a caller who cannot
see it, or the figures are in the browser's network tab regardless of what is painted.

**`Q-LM-F1` — RULED 2026-09-15, and the answer is "neither section, split the data instead".**
There is no `finance` section; the sidebar *group* is `finance` and the *section* is `accounting`.
Read against the live matrix:

| role | `fuel` | `accounting` |
|---|---|---|
| admin | manage | manage |
| **fleet_manager** | **manage** | **none** |
| **dispatcher** | **view** | none |
| safety_manager | view | none |
| auditor | view | view |
| **accountant** | **view** | manage |
| technician / driver | none | none |

**`fuel` fails outright** — the dispatcher holds `fuel: view` by design, so gating spend there leaves
the exact figure the owner wants hidden. **`accounting` overshoots and contradicts a recorded
ruling**: `fleet_manager` has `accounting: none` deliberately (D-SEP7 — books access "does not ride
along fleet or dispatch"), and the `accountant` role was granted `fuel: "view"` with the stated
reason that *"fuel spend IS the largest expense line and accounting surfaces cite it"*. That grant
only makes sense if spend is reachable under `fuel: view`; moving spend to `accounting` would make it
pointless. **The sections do not separate fuel volume from fuel cost, because the matrix does not
model that distinction at all.**

**So the split is per ELEMENT, not per section.** Operational figures stay on `fuel`; money moves
behind `accounting`:

| Stays on `fuel` (dispatcher keeps) | Moves behind `accounting` |
|---|---|
| Fleet avg MPG stat + MPG trend chart | "Fuel spend" stat + its sparkline |
| Active alerts stat, both risk lists | "Fuel spend" daily chart |
| **idle HOURS** (`${idleHours} idle hrs`) | "Where fuel dollars go" donut |
| | the **dollar half** of the Idle waste tile |

The Idle waste tile already carries its own operational twin in its sub-label, so a dispatcher keeps
*"Idle waste — 412 idle hrs"* and loses the *"$8.2k"*. Same tile, same position, no new section, no
matrix change, no migration.

**Owner ruling on the side effect, 2026-09-15: option (a).** `fleet_manager` loses the spend figures
too, because they hold `accounting: none`. That is D-SEP7 working as designed. An org that wants its
ops lead to see money grants it **per-org** through the sparse section overrides (D-PERM4) rather
than by widening the shipped matrix for everybody.

**Done when.** A dispatcher session renders the Dashboard with no cost figure **and issues no request
that returns one** — asserted against the network layer, not against the DOM. An admin session is
unchanged. `pnpm lint:surfaces` green; the permissions preview page shows the same answer the real
page does for both roles.

⚠ **What this step does NOT do, measured 2026-09-15 — read before describing it to anyone.**
`DashboardPage` reads **PostgREST directly from the browser under RLS**, not through our API. The
governing policy has never been narrowed:

```sql
-- supabase/migrations/0004_rls.sql:60 — the only definition of ftxn_select, never superseded
create policy ftxn_select on fuel_transactions
  for select using (org_id = auth_org_id());
```

**Any authenticated member of the org can select every column of `fuel_transactions`, including
`total_cost`, with no section check at all.** So LM-F is a **product boundary, not a security
boundary**: it stops the dispatcher's browser rendering money and stops it fetching money, which is
what the owner asked for, and it does not make the figure unreachable to someone who calls PostgREST
directly. Saying otherwise would be false.

Closing the second half is **LM-F2**, recorded below rather than folded in here, because it is a
different size of change and pretending otherwise is how a blocker becomes debt nobody can find.

---

### LM-F2 · Make the cost boundary real in the database — **scoped, not scheduled**

**Why it is separate.** LM-F stops the product showing money to a dispatcher. `ftxn_select` still
lets any org member read `total_cost` straight from PostgREST (see LM-F's ⚠). Until this step, "a
dispatcher cannot see fuel spend" is true of the product and false of the data.

**Why it is not a one-line fix, stated so nobody scopes it from the sentence above.** Postgres RLS is
**row**-level. Hiding one *column* from one role needs either column-level `GRANT SELECT (…)` or a
view that omits it — and `fuel_transactions` is read by the Fuel Log, the Transactions page and the
reconciliation surfaces, all of which a dispatcher legitimately reaches under `fuel: view`. So the
blast radius is every browser reader of that table, not the dashboard.

**Three candidate shapes, to be chosen with a measurement rather than a preference:**

1. **Column-level grants** — revoke `total_cost` from the authenticated role and re-grant per
   section. Narrowest, but PostgREST error behaviour on a denied column is a 400 the callers do not
   currently handle.
2. **A cost-free view** for the operational readers, with the base table reserved for
   `accounting`. Cleanest boundary; renames every call site that currently reads the table.
3. **Move the dashboard off PostgREST onto an API endpoint** that org-filters and section-filters in
   the service, which is what D-LM11 already rules for `livemap` and for the same reason. Largest
   change, and the only one that also fixes `idle_rollup_days` and anything added later.

**Recommendation: (3)**, because it is the direction D-LM11 already commits the newer surfaces to and
because (1) and (2) both leave the next browser-side reader to rediscover the rule. But it is a
genuine piece of work and it is **not** part of LM-F.

**Open until ruled — `Q-LM-F2`:** does the owner want the database boundary at all, or is the
product boundary the actual requirement? Both are legitimate answers. A carrier whose dispatchers are
employees with org logins may reasonably decide that hiding money in the UI is the whole ask; a
carrier onboarding outside dispatchers would not. **This question is recorded rather than assumed,
and LM-F ships either way.**

---

### LM-T · The Dashboard's gated tabs (D-DW6)

**What.** `DashboardPage.vue` renders a tab strip whose entries come from a catalogue with the same
`SurfaceGate` shape `SURFACES` uses — **Admin** and **Dispatch** to begin with. Admin passes both and
sees both; a dispatcher passes one and sees one; an org that grants `dispatch` to a safety manager
gets the tab without anybody editing a list.

The Dispatch tab embeds the same `LiveMapPanel` LM8 puts at `/live-map` — D-DW5 stands: the tab is
the glance, the full page is the work surface, and neither substitutes for the other.

⚠ **The review note that blocks this step:** any `session.role === 'admin'` (or `'dispatcher'`) test
in the component. The gate is the mechanism; the role is not.

**Done when.** A dispatcher and an admin session each render the correct tab set **derived from the
matrix**, proven by a test that flips a *section grant* rather than a role and watches the tab set
change; a single-tab role sees no tab chrome; `pnpm lint:surfaces` green.

---

### LM0 · A production read-only login scoped to the dispatch tables — owner action, no code

**Why.** Everything in §3 was read through the `NikiAnalytics` login, which holds `db_datareader`
and can therefore read `social_security_no` on 1,461 driver rows. That is fine for reconnaissance
and is **not** the shape of a grant that should back a production feature. Separately, its access to
`lme` appeared between 2026-08-26 and 2026-09-10 with no recorded change.

**Ask IT for.** A login `silvicom_dispatch_ro` on the `APPNEW` instance with `SELECT` on exactly
**seven tables**:

`lme.dbo.movement`, `lme.dbo.movement_order`, `lme.dbo.continuity`, `lme.dbo.stop`,
`lme.dbo.orders`, `lme.dbo.trailer`, `lme.dbo.users`

plus a **column-scoped** grant on `lme.dbo.driver` covering
`id, company_id, first_name, name, fleet_manager, tractor_id, is_active, termination_date` — used
only to name an unresolved driver code in the unmatched report. No write anywhere.

**What is deliberately NOT in the list, and why** — the scope shrank when the owner ruled the live
connection is for load data only (2026-09-10):

- **`tractor`** — the unit number comes from `continuity`, and it resolves to `vehicles.unit_number`
  at 108/108 on the live board. Nothing needs McLeod's tractor row.
- **`mc_position`** — positions come from Samsara (D-LM2).
- **`company`** — the sweep is single-company (`TMS`); the id is configuration, not a lookup.
- ⚠ `lme.dbo.driver` has **no `status` column** — it is `is_active` + `termination_date`. An earlier
  draft of this step named `status` and would have produced a grant script that fails.

**Plus `VIEW CHANGE TRACKING`** on the tracked tables in that list — see
`docs/plans/mcleod/MCLEOD-COLLECTOR-PLAN.md` MC0 for the exact grants and why. Change Tracking is
**already enabled** on `lme` (91 tables, 10-day retention); the permission is the only missing
piece, and without it the collector falls back to a trailing-window re-read that works but costs
more. Note `continuity` is **not** change-tracked, so it needs `SELECT` only (D-MCC3).

**Plus `VIEW CHANGE TRACKING`** on the tracked tables in that list — see
`docs/plans/mcleod/MCLEOD-COLLECTOR-PLAN.md` MC0 for the exact grants and why. Change Tracking is
**already enabled** on `lme` (91 tables, 10-day retention); the permission is the only missing
piece, and without it the collector falls back to a trailing-window re-read that works but costs
more.

**Done when.** The §4.2 P1–P3 probes and the LM1 board query all return under the new login,
`SELECT COUNT(*) FROM CHANGETABLE(CHANGES lme.dbo.movement, <current-1000>) AS ct` returns a number,
and `SELECT social_security_no FROM lme.dbo.driver` is refused.

**If the grant is refused or delayed:** proceed with every other step using the existing login —
the agent already runs on-prem with a working credential and nothing downstream changes. Record the
refusal in §8 and re-raise at LM12, which is the step that turns the feed on in production. This is
a security posture item, not a blocker, and it is written down so it does not quietly become
permanent.

---

### LM1 · The agent learns to push loads — no database schema change; one API behaviour fix

**Files.** `packages/shared/src/tms.ts`, `apps/api/src/modules/mcleod/tmsLoadIngest.ts`,
`tools/mcleod-agent/loads.mjs` (new), `tools/mcleod-agent/agent.mjs`,
`tools/mcleod-agent/queries.mjs`.

⚠ **Loads only. The dispatcher *endpoint* does not exist until LM3.** The dispatcher fields ride
along inside the load payload from this step (harmlessly stripped by the deployed API until LM3
reads them), but `POST /api/tms/dispatchers` is created in LM3 — so `--loads` must not call it yet,
or every run logs a 404. Gate the dispatcher push behind the same flag that LM3 turns on.

⚠ **The hazmat fix ships here, both halves together.** The `.optional()` schema change (D-LM12) and
the `ingestLoads` change that writes the column only when the key is *present* are one correctness
unit: shipping the schema half alone would send `undefined` into the writer, whose serialisation is
exactly the ambiguity the change exists to remove. Neither half touches the database schema, so this
is not a migration-ordering concern.

⚠ **Change detection is not this step's to invent.** `docs/plans/mcleod/MCLEOD-COLLECTOR-PLAN.md`
owns it (D-MCC1/D-MCC5): this step asks `changes.mjs` which movement ids moved and re-reads only
those, plus `continuity` for the active set (D-MCC3 — 420 rows, 0.19 s, because `continuity` is the
one table this plan needs that Change Tracking does **not** cover). Build MC1 first, or build LM1
against the trailing-window fallback and rewire at MC2 — both are sequenced there.

**Contract.** Add to `tmsLoadInputSchema`:

```ts
/** McLeod's `movement.dispatcher_user_id` — 100% populated on active movements (D-LM3). */
dispatcher_external_id: z.string().trim().min(1).max(32).nullish(),
dispatcher_name: z.string().trim().max(120).nullish(),
```

and a new `tmsDispatchersPayloadSchema` carrying `{ external_id, display_name, is_system, is_active }`.

⚠ **`hazmat` must also change from `.default(false)` to `.optional()` — see D-LM12.** It is in
`AMENDABLE_LOAD_FIELDS`, so as the schema stands today an omitted `hazmat` becomes `false` and a
re-sync of an unapproved load would **erase our own hazmat determination**. Absent and false must
become distinguishable, and `ingestLoads` must write the column only when the key is present.

Except for that one, the additions are optional, so **this step ships before any migration and
breaks nothing**: `tmsLoadInputSchema` is a plain `z.object`, which strips unknown keys, so the
deployed API accepts the enriched payload and ignores the new fields until LM3 reads them.

**The SQL** (shape validated 2026-09-10; the board returns in ~0.3 s):

```sql
SELECT m.id                                  AS movement_id,
       m.status                              AS movement_status,
       LTRIM(RTRIM(m.dispatcher_user_id))    AS dispatcher_id,
       u.name                                AS dispatcher_name,
       o.id                                  AS order_id,      -- → ref (see below)
       o.blnum                               AS bol_number,    -- customer's BOL; NOT unique
       o.commodity                           AS commodity,
       m.move_distance                       AS total_miles,
       -- TEAMS: 'D' appears twice on 176 movements, so a LEFT JOIN here would emit the
       -- movement twice and duplicate the load. Aggregated, exactly as MOVEMENT_FACTS does.
       STUFF((SELECT ',' + LTRIM(RTRIM(d.equipment_id))
                FROM lme.dbo.continuity d
               WHERE d.movement_id = m.id AND d.company_id = m.company_id
                 AND d.equipment_type_id = 'D'
               ORDER BY d.equipment_id
                 FOR XML PATH('')), 1, 1, '')      AS driver_codes,
       LTRIM(RTRIM(ct.equipment_id))         AS tractor_unit,
       LTRIM(RTRIM(cl.equipment_id))         AS trailer_unit,
       LTRIM(RTRIM(ISNULL(tr.trailer_type,''))) AS trailer_type  -- 'R' ⇒ reefer (D-LM13)
FROM lme.dbo.movement m
LEFT JOIN lme.dbo.users u        ON u.id = m.dispatcher_user_id AND u.company_id = m.company_id
LEFT JOIN lme.dbo.movement_order mo ON mo.movement_id = m.id AND mo.company_id = m.company_id
LEFT JOIN lme.dbo.orders o       ON o.id = mo.order_id AND o.company_id = mo.company_id
LEFT JOIN lme.dbo.continuity ct  ON ct.movement_id=m.id AND ct.company_id=m.company_id AND ct.equipment_type_id='T'
LEFT JOIN lme.dbo.continuity cl  ON cl.movement_id=m.id AND cl.company_id=m.company_id AND cl.equipment_type_id='L'
LEFT JOIN lme.dbo.trailer tr     ON tr.id = cl.equipment_id AND tr.company_id = m.company_id
WHERE m.company_id = @company
  AND m.status IN ('P','A')
  -- Staleness bound (D-LM14). Excludes exactly one row today: movement 11787, scheduled
  -- March 2015, still 'P', 4,182 days stale. The worst REAL load is ≤7 days.
  AND EXISTS (
    SELECT 1 FROM lme.dbo.stop s
    WHERE s.movement_id = m.id AND s.company_id = m.company_id
      AND s.sched_arrive_early >= DATEADD(day, -30, GETDATE())
  )
```

**Field mapping — each measured, none assumed:**

| Contract field | Source | Measured |
|---|---|---|
| `external_id` | **`${company_id}:${movement.id}`** | `movement.id` collides 18,761× across companies |
| `ref` | **`orders.id`** (e.g. `0134754`) | unique within TMS: 134,963 rows, 134,963 distinct. ⚠ collides 16,948× **across** companies — if a second McLeod company is ever swept into one org, `ref` must become composite too |
| — | **NOT `blnum`** | 2,020 collisions in 134,315 orders (1.5%); `loads` has `unique index (org_id, ref)`, so blnum would fail the ingest on ~1.5% of loads. Carry it in `raw` and surface it as a searchable BOL |
| `driver_employee_id` | `continuity` D, **aggregated** | 109/109 → `drivers.mcleod_driver_id`. ⚠ Teams: 2 drivers on 176 movements. The contract carries ONE driver, so the feed sends the first and reports the second — it does not silently drop a co-driver, and it does not duplicate the load |
| `vehicle_unit` | `continuity` T | 108/108 → `vehicles.unit_number` |
| `trailer_unit` | `continuity` L | 108/108 → `trailers.unit_number` (R-strip) |
| `equipment` | `trailer.trailer_type` | 113/113 on the live board (96 `V`, 17 `R`) |
| `commodity` | `orders.commodity` | present where coded; blank is honest |
| `total_miles` | `movement.move_distance` | the only usable distance — `pay_distance`, `manifest_loaded_distance`, `manifest_empty_distance` sum to **exactly 0** across 21,547 movements |
| `hazmat` | **omitted entirely** | D-LM12 — McLeod does not have it |
| `external_status` | `movement.status` | `P` active · `A` available · `D` delivered · `V` void |
| `stops` | `lme.dbo.stop` by `movement_id`, ordered by `movement_sequence` | 231/231 active stops geocoded |

**Stop mapping.** `stop_type` → `kind`: **`PU` → `pickup`, `SO` → `dropoff`**, and **nothing else**
(D-LM15). The live board also carries `VA`, `VP` and `SP` (7 of 247 on that snapshot); those are
**reported with their movement id and raw code, not sent** — mapping them to `dropoff` would put a
bill-of-lading capture on a driver's phone for a stop that has no bill of lading. `sched_arrive_early`/`sched_arrive_late` →
`appointment_start`/`appointment_end`. `status` `D` = done, `A` = pending — so **picked up** is a
`PU` stop with `status='D'` and **delivered** is the final `SO` stop with `status='D'`.
`lat = latitude` but **`lon = -longitude`** (§3.4 — every McLeod geo column at this carrier is
west-absolute; a copied sign puts the whole fleet in Asia).

**Five traps this step must encode, each already paid for once:**

- **Assignments come from `continuity`, and the alternative is not a trap — my comparison of the
  two was.** ⚠ **CORRECTED 2026-09-10, same day it was written.** This bullet claimed
  `equipment_group`/`equipment_item` "disagrees with `continuity` on the live board" and cited
  movement 290227. **That measurement was invalid, twice over.** It joined
  `equipment_group.currentmovement_id = m.id` — "which group is *currently* pointing at this
  movement" — where this repo's own production-proven `MOVEMENT_FACTS` joins
  `equipment_item.equipment_group_id = m.equipment_group_id`, the movement's own reference to its
  group. And it paired driver rows on type alone while **176 movements carry two drivers** (teams),
  producing a cartesian product whose mismatched pairs *are* the "disagreements" — which is why the
  comparison returned 617 rows where 111 movements × 3 types is 333.

  What survives: `continuity` **is** validated for this feed — 109/109 drivers, 108/108 tractors,
  108/108 trailers resolved against our roster, spot-checked against real dispatcher/driver/truck
  combinations on the live board. It is used here because it is keyed by movement and carries
  `is_preassignment` and arrival dates. Nothing establishes that `equipment_item` is wrong, and
  `queries.mjs` documents it as the canonical path to a movement's tractor. **Do not re-derive a
  conflict between them from this document.** The re-measurement, when the VPN is up, is in §4.2 P4.

- `external_id` is **`${company_id}:${movement.id}`**, never the bare id. `movement.id` repeats
  across companies — 18,761 collisions across TMS/TMS2/TMS3 — and the ingest is keyed
  `(org_id, provider, external_id)`. Composite from day one costs nothing; retrofitting it costs a
  reconciliation.
- **Never take a watermark from `MAX(date)`.** `MAX(stop.actual_departure)` is **2215-03-12** —
  McLeod uses far-future sentinels for unset values, and a high watermark advances past every real
  row and then returns nothing, forever. Use a bounded trailing-window re-read plus the hash diff
  `roster.mjs` already implements.
- **Never order by `xfer2settle_date`.** It is a batch stamp: 70.3% of consecutive movement pairs on
  the same tractor share it to the second. This already shipped as a real bug once
  (`inferDeadheadLegs` reported 133% deadhead against a true ~3.5%).

**Done when.** `node agent.mjs --loads --dry-run` prints the active board with stops, dispatchers
and 100% key resolution; `pnpm lint:agent-syntax` green; and unit tests in
`tools/mcleod-agent/*.test.mjs` pin — each **proven able to fail** by mutating the implementation —
the longitude negation, the composite `external_id`, `ref` taking `orders.id` rather than `blnum`,
the `PU`/`SO` → `pickup`/`dropoff` mapping, and the staleness bound rejecting movement 11787.

**If `dispatcher_user_id` is below 100%:** push what is there. A load with no dispatcher is
representable (status `A` already has none) and lands in the map's unassigned bucket. Nothing in the
design assumes totality — D-LM3 needs it to beat 56%, not to be perfect.

**If a movement carries more than one order:** today every one of the 111 active movements carries
**exactly one** (`movement_order` measured 1:1), so the `LEFT JOIN` above cannot fan out. If that
ever changes, take the lowest `order_id` for `ref` and record the rest in `raw` — do **not** emit
one load per order, because a driver drives the *movement*, and the board is a board of trips.

---

### LM2 · Migration — `vehicle_positions`, `tms_dispatchers`, `loads.dispatcher_external_id`,
### and the stop-kind vocabulary

**Prerequisite: run §4.2 P5 first.** D-LM15 leaves `VA`/`VP`/`SP` reported-but-unsent because nobody
has measured what they are. This migration is where that is settled — either `load_stops.kind` gains
`'other'` (widening the CHECK constraint and `tmsStopInputSchema`, after which LM1b's reporting
branch becomes a mapping), or the measurement shows the tail is genuinely not driver work and the
reporting branch stays as the permanent answer. **Do not widen the enum without the measurement**;
an `'other'` nobody can define is worse than a reported exception.

**Schema only. No reader, no writer.** The two new tables are exempt from the ordering rule; the
new *column* is not, and its first writer is LM3 in a separate merge.

`vehicle_positions` — owner `samsara`, layer `raw`, PK `(org_id, vehicle_id)`, one row per vehicle:
`lat`, `lng`, `heading_degrees`, `speed_mph`, `is_ecu_speed`, `formatted_location`, `sampled_at`,
`received_at`, `source`. Constrained: lat ∈ [-90, 90], lng ∈ [-180, 180], heading ∈ [0, 360).
FK `(vehicle_id, org_id)` → `vehicles(id, org_id)` — that composite unique already exists, so the
org can't drift from the vehicle's. RLS on, no client policy (API-only). Header comment states why
this is not columns on `vehicles`: `roster` owns that table, and a per-tick UPDATE on a core roster
row would contend with every other writer.

Both module names are verified against `scripts/table-modules.json`: `samsara` and `mcleod` are
existing modules, and `samsara_feed_cursors` is already samsara-owned — so LM4's new cursor is a
*row*, not a schema change.

`tms_dispatchers` — owner `mcleod`, layer `raw`, PK `(org_id, provider, external_id)`:
`display_name`, `user_id` **nullable** → `auth.users` ON DELETE SET NULL, `is_system`, `is_active`,
timestamps. The nullability carries D-LM4's reasoning in its comment: 15 McLeod accounts, 2
Silvicom dispatcher memberships.

`loads.dispatcher_external_id` — `text`, nullable, indexed with `org_id` and `status` for the
scoped board read.

Plus: `scripts/table-modules.json` entries, a PGlite matrix per new table printing `RESULT`, and the
regenerated `schema.generated.sql`.

**Done when.** `pnpm lint:migrations lint:rls lint:table-writers lint:table-producers
lint:table-modules`, `node scripts/check-migration-ordering.mjs`, `pnpm test` (matrices included),
and the migration applies cleanly on PGlite.

---

### LM3 · The ingest writes the dispatcher — **one merge after LM2, not the same one**

⚠ **This is the step the deploy window governs.** `loads.dispatcher_external_id` is a new *column*,
and Railway serves a merge ~2m44s before `migrate.yml` applies its migration. A writer against a
column that does not exist yet fails exactly as a reader does, so LM2 and LM3 **cannot** be the same
PR (`lint:migration-ordering`, invoked directly at `ci.yml:111`/`:117`). The two new *tables* are
exempt — it is the column that forces the split.

**Files.** `apps/api/src/modules/mcleod/tmsLoadIngest.ts`,
`apps/api/src/modules/mcleod/routes/tmsIngest.ts`, new `tmsDispatcherIngest.ts`.

`ingestLoads` persists `dispatcher_external_id`. A new `POST /api/tms/dispatchers` upserts
`tms_dispatchers` with a **complete** payload (`lint:upserts`), never touching `user_id` — the link
is an office act (LM11), and a re-sync must not unlink a person an admin has mapped. This step also
turns on the agent-side dispatcher push LM1 left flagged off.

**Done when.** `expectOrgScoped` asserts both writers; a test proves a re-sync of an existing
dispatcher leaves `user_id` untouched; a test proves `is_system` is set for `loadmaster`/`lmeadm`;
`pnpm verify:live` shows migration LM2 **applied** before this merge is served.

---

### LM4 · The Samsara `positions` tier

**Files.** `packages/shared/src/samsara/core.ts` (add `headingDegrees`, `isEcuSpeed` to
`RawGpsPoint` and a `latestGpsFix` reducer), `apps/api/src/modules/samsara/samsaraPositionsFeed.ts`
(new), `samsaraScheduler.ts`, `env.ts`, plus a `record_vehicle_positions(jsonb)` RPC.

The tier reuses `startTier()`, takes **its own cursor row** in `samsara_feed_cursors`
(`feed = 'vehicle_positions'`, distinct from the existing `vehicle_stats`), and registers with
`samsaraFeedHealth` so the staleness alarm covers it (D-SAM6). Interval
`SAMSARA_POSITIONS_SYNC_SECONDS`, default **5** (D-LM1 — the vendor's floor, and the bottom of
their recommended 5–30 s range). It runs in the `api` service only — every other service from `railway.json` gets
`RUN_SCHEDULERS_IN_PROCESS=false` before its first deploy, and no gate can see a Railway variable
(`docs/WORKER-DEPLOYMENT.md`).

**Two failure modes this step must not reproduce, both already paid for:**

- **Separate cursor rows are not optional.** Two tiers reading one feed need two cursors. Sharing
  one would let the 5-second positions tier consume the deltas the 20-minute stats tier needs, and
  the loss would be *silent* — fuel-drop detection would simply stop seeing intermediate samples.
- **`hasNextPage` is always `true`** on a delta feed (re-measured 2026-09-01, twelve pages deep,
  including on a single-sample page and an immediate re-poll of an idle fleet). It means "this
  stream continues", not "there is more right now". Terminate on an empty page (`feedPageHasData`)
  with a page cap, exactly as `STATS_FEED_MAX_PAGES` does — a `while (hasNextPage)` walk hangs the
  tick forever.

**Done when.** A test drives the tier from a recorded feed page and proves the *latest* fix per
vehicle wins when a page carries several; a test proves the walk terminates on an empty page with
`hasNextPage: true`; `expectOrgScoped` on the write; the feed-health surface lists `positions` with
a staleness figure.

---

### LM5 · The pure layer — `packages/shared/src/livemap.ts`

`deriveVehicleState(position, now, bound) → "moving" | "stopped" | "parked" | "offline"`,
`lerp`, `lerpAngle` (360° wraparound), `positionAgeSeconds`. Pure, no clock, no randomness — the
map, any future report and the driver app get the same answer to "what is this truck doing".

**Done when.** Tests cover the wraparound (359° → 1° interpolates through 0, not backwards through
180), the staleness boundary, and `moving` vs `stopped` at exactly the speed threshold. **Prove each
test can fail** by mutating the implementation — a fixture too uniform to discriminate has passed
ten assertions in this repo while proving nothing.

---

### LM6 · API module `livemap`

`GET /api/livemap/positions` — `requireOrg`, `requireSection("dispatch", "view")`, org-filtered in
the service. Returns per vehicle: unit, driver, position, heading, speed, derived state, age,
current load ref + next stop + appointment window, dispatcher (external id, display name, mapped
user), and the caller's own scope (`mine` | `all`) with the reason.

The scope is **derived, never stored** (D-LM3): a dispatcher's fleet is the set of vehicles on loads
whose `dispatcher_external_id` maps to that user, with status in the active set. A caller with no
mapping gets the org-wide board **with an explicit banner saying so** — not a silent empty list and
not a fake personal scope.

Owns no table; reads `vehicle_positions`, `vehicles`, `drivers`, `loads`, `load_stops` and
`tms_dispatchers` through their owners' interfaces (`lint:boundaries`, `lint:table-access`).

⚠ **This step ships before the loads feed is on (LM12), and must be correct with zero loads.**
`loads` has 0 rows in production today, so the first working version of this endpoint returns
positions with **null load context** for every truck. That is the normal state for weeks, not an
error: the map is useful showing where the fleet is before it can show what each truck is hauling.
Load context, dispatcher labels and the `mine` scope all light up when LM12 turns the feed on.

**Done when.** `expectOrgScoped`; a test proves an unmapped caller gets `all` plus the reason and a
mapped caller gets only their own; **a test proves the endpoint returns every vehicle with a
position when `loads` is empty**; response stays under the 500-line file budget by splitting the
query builder out.

---

### LM7 · Extract `useMapLibre` from `RouteMapGL.vue` — refactor, no behaviour change

Pull the oklch→sRGB token conversion, the JWT `transformRequest`, style construction and lifecycle
teardown into `apps/web/src/composables/useMapLibre.ts`, and make the **existing** fuel-planning map
use it. Doing this before the new map exists means the extraction is proven against a working
surface rather than validated by the thing it is about to be copied into — and a copy is a
workaround with a delay fuse.

**Done when.** Fuel Planning renders identically (screenshot via `vite build` + `vite preview`;
`vite dev` is broken by a WASM crash in this repo), and no new hex literal appears
(`lint:tokens-parity`, `lint:token-gamut`).

---

### LM8 · `LiveMapPanel.vue` and the `/live-map` surface

GeoJSON source + symbol layer (D-LM7), `icon-rotate` from `heading_degrees`, colour by a `match` on
state. `requestAnimationFrame` interpolation between 5 s polls, paused on hidden tab. Per-truck
staleness (D-LM10). Filters: dispatcher, state, load status. Click → the load, the truck, the driver.

**Clustering is available but off by default at this fleet size.** A dispatcher wants to see each of
~200 trucks, not a disc reading "47". Turn it on at a zoom/threshold where markers actually collide,
not as a blanket setting — the GeoJSON layer makes it a one-line change either way (D-LM7).

New surface `{ key: "dispatch.live-map", label: "Live map", path: "/live-map", group: "dispatch",
gate: section("dispatch"), module: "dispatch" }`, its icon in the web's `Record<key, Icon>`, and the
committed route snapshot regenerated.

**Done when.** `pnpm lint:surfaces`, `lint:ui-adoption`, `lint:ui-contrast`, `lint:light-dark`
green; the page renders against Playwright route mocks in both themes — and remember dev-bypass API
mocks are **raw JSON**, never `{ok, data}`, or the error boundary swallows the mismatch.

---

### LM9 · `DASHBOARD_WIDGETS` — the catalogue and its gate

`packages/shared/src/dashboardWidgets.ts` beside `surfaces.ts`, reusing `SurfaceGate`.
`DashboardPage.vue` renders from the catalogue instead of a fixed template; every tile and chart it
has today becomes a widget with the gate it effectively has now, so **this step changes no
behaviour for any existing role**. `check-surfaces.mjs` grows D-DW4's four assertions and its
self-test.

**Done when.** Every current Dashboard element is a catalogue entry; the permissions preview page
renders a role's dashboard as well as its sidebar; `pnpm lint:surfaces` green including the new
self-test.

---

### LM10 · Role defaults and per-user layout — **this step carries a migration**

Default layouts per `UserRole` live in code beside the catalogue (`defaultFor` + an order index,
D-DW2) — no schema. The **per-user override does need a table**, and an earlier draft of this step
omitted it:

`user_dashboard_layout` — owner `org`, layer `core`, PK `(org_id, user_id)`: `widget_keys text[]`
(the visible set, in order) and `updated_at`. A **missing row** means inherit the role default; an
empty array means "I chose to hide everything". Those are the two states D-DW3 requires to be
distinguishable, and storing the layout as a row-or-no-row gives them for free — no third sentinel
value to remember. Modelled on `user_surface_access`, RLS on, and it is a **new table**, so its
reader may ship in the same merge (the ordering rule exempts new tables).

**Done when.** A dispatcher signing in sees the map first with no configuration; a user who hides a
widget still inherits a later default change to widgets they did not touch; deleting the row
restores the role default exactly; `pnpm lint:rls lint:table-modules lint:table-producers` green and
the PGlite matrix prints `RESULT`.

---

### LM11 · Link McLeod dispatchers to Silvicom users — **no new surface**

A card on the **existing** Settings → Integrations → McLeod page, not a new route: the observed
dispatcher list with load counts, a user picker, and `is_system` rows (`loadmaster`, `lmeadm`) shown
as system accounts that cannot be linked. Reusing that page means no `SURFACES` entry, no route
snapshot change, and no new thing for an admin to find — it sits where the rest of the McLeod
integration already lives. Audited like every other membership-adjacent act.

**Done when.** Linking a dispatcher immediately narrows that user's `/api/livemap/positions` scope
from `all` to `mine`; a matrix proves an unlinked dispatcher's loads still render for everyone else;
`pnpm lint:surfaces` green **without** a new key (the absence is the point).

---

### LM12 · Turn the loads feed on in production — runbook, no new code

1. Confirm LM0's grant, or record the decision to run on the existing login.
2. Decide `auto_approve_loads` **explicitly**. It is `false` today and `loads` has **0 rows**, so
   the first sweep will present its whole backlog for review. Recommended: leave it `false` for the
   first week, then turn it on once the field mapping has been checked against a known load —
   turning it on is itself audited.
3. Schedule the agent's `--loads` run (Windows Task Scheduler, on-prem), starting at 10 minutes and
   tightening only if the review queue proves it is worth it.
4. Verify, each against a number rather than a glance:
   - `loads` row count ≈ the active board (111 at the last measurement, and it moves);
   - the unmatched-key report is **empty** — driver/tractor/trailer all resolved 100% on 2026-09-10,
     so anything unmatched is a roster-link regression, not an expected miss;
   - `tms_dispatchers` seeded with **15** rows, of which **2** (`loadmaster`, `lmeadm`) are
     `is_system`;
   - **movement 11787 is absent** — the March-2015 phantom is the staleness bound's test case
     (D-LM14);
   - reefer loads appear: ~17 of 113 on the live board carried `trailer_type='R'`;
   - the live map shows positions for the active board.

**If the first sweep reports unmatched keys:** they are reported, never dropped (`entityLookup.ts`).
Fix the roster link and re-run — the ingest is idempotent on `(org_id, provider, external_id)`.

**Out of scope, recorded so it is not lost:** `driver.hazmat_certified` is 100% populated in McLeod
(1,311 `Y` / 159 `N` of 1,470, `hazmat_date` on 1,336). That belongs to the roster/DQF pull, not to
this feature, and it is worth a step in its own plan once this connection exists (D-LM12).

---

## 6. Traps — each already cost someone something

1. **McLeod longitude is positive.** `lng = -longitude`, on every geo column. 0 of 119,962 rows
   carry a negative longitude.
2. **McLeod datetimes are Central local, DST-shifting.** Not UTC, not a fixed offset. A naive parse
   reads five hours stale in summer and four in winter, and every truck renders `offline`.
3. **`movement.id` repeats across companies.** Composite `external_id` from day one.
4. **Far-future sentinel dates** (`2215-03-12`) strand any `MAX()` watermark permanently.
5. **`xfer2settle_date` is a batch stamp** — 70.3% ties. Never an ordering key.
6. **The `ods_*` tables are empty**, as is `pft_cost`. A McLeod table existing says nothing about
   this carrier having configured it. Count rows before designing against one.
7. **`lme_analytics` is not production.** It lags by hours. Live features read `lme`.
8. **A new column and its first writer ship in two merges.** A write to a not-yet-applied column
   fails exactly as a read does.
9. **`vite dev` crashes on WASM in this repo.** Use `vite build` + `vite preview` for a real browser
   loop.
10. **Dev-bypass API mocks are raw JSON**, not `{ok, data}` — the error boundary hides the mismatch.
11. **PostgREST caps every response at 1,000 rows.** `.limit(10_000)` is a fiction; page explicitly.
12. **Prove a test can fail** by mutating the implementation before believing it passed.
13. **`hasNextPage` is always `true` on a Samsara delta feed.** Terminate on an empty page plus a
    page cap, never on the flag.
14. **Two tiers on one feed need two cursor rows.** A shared cursor makes the faster tier eat the
    slower tier's deltas, silently.
15. **Samsara's GPS ping drops to every 5 minutes when a vehicle is off or idle.** A single global
    staleness threshold marks the whole parked fleet `offline` overnight (D-LM9b).
16. **A movement can carry TWO drivers — the carrier runs teams.** `equipment_type_id = 'D'`
    appears **twice on 176 movements** (measured 2026-08-26, `queries.mjs` header). `'T'` and `'L'`
    appear exactly once. A `LEFT JOIN` on the driver row therefore **emits the movement twice** and
    duplicates the load. `MOVEMENT_FACTS` already solves this by aggregating drivers into a
    delimited list instead of joining them; the load feed must do the same.
17. **`orders.blnum` is not unique** — 2,020 collisions. It cannot be `ref` against
    `unique (org_id, ref)`. Use `orders.id`; carry the BOL in `raw`.
18. **`orders.id` collides across companies** (16,948×), exactly like `movement.id`. Single-company
    sweeps are safe; a second company makes `ref` composite too.
19. **A McLeod column existing says nothing about this carrier using it.** `orders.hazmat` (1 row),
    `orders.equipment_type_id` (5 rows in 2026), `callin.temperature` (0 of 162,511),
    `freight_group_item` (0 rows), all four `ods_*` tables (0 rows), `pft_cost` (0 rows).
    **Count rows before designing against a column.**
20. **`movement.status='P'` is not "active"** — one row has been `P` since March 2015. Bound the set
    by scheduled date (D-LM14).
21. **`hazmat` is in `AMENDABLE_LOAD_FIELDS`.** A feed that sends `false` because it does not know
    erases what our own engine determined. Absent must not mean false (D-LM12).

---

## 7. What "done" looks like

A dispatcher signs in and lands on a Dashboard whose first panel is a map of the trucks on their
loads — each truck moving smoothly, rotated to its heading, coloured by what it is doing, and
labelled with how old its position is. Clicking a truck gives the load, the driver, the next stop
and the appointment window. A dispatcher not yet linked to their McLeod account sees the whole
fleet and a line saying why. A fleet manager sees the same map as one widget among their own. No
role sees a screen built by branching on their role.

---

## 8. Progress log

Append a dated line per merge. Never edit a status column — parallel PRs conflict on table rows.

- 2026-09-10 — plan written. §3 measured against `lme` (production, live) and production Supabase.
  No steps executed.
- 2026-09-10 — Samsara transport re-verified against the vendor's own documentation after the owner
  challenged the "no location webhook" finding. **The finding holds and is now vendor-sourced**:
  Samsara's TMS integration guide recommends polling `stats/feed` **every 5–30 seconds** for live
  tracking and does not list webhooks as a location option; no GA or beta webhook event type emits
  a scheduled position. Three corrections fell out of the check and are now in the plan — the tier
  interval drops from 2 minutes to **30 s** (D-LM1), `/assets/location-and-speed` is recorded as the
  documented upgrade path (D-LM1b), and the **Kafka Connector** — real 5-second GPS streaming — is
  named and rejected on architectural shape rather than left unmentioned (D-LM1c). Added D-LM9b
  (the freshness bound, added up) and traps 13–15.
- 2026-09-10 — **LM1b built, NOT yet done** (PR pending): `queries.mjs` gains `DISPATCH_LOADS`,
  `DISPATCH_LOAD_STOPS` and `DISPATCH_DISPATCHERS`; `loads.mjs` maps them; `--loads` is wired.
  Fifteen unit tests, each proven able to fail — and the fourth mutation found a fixture that could
  not distinguish `is_system` from configuration versus inferring it from a display name, because
  both answers agreed on the data it used. **Its Done-when is NOT met**: the VPN is down, so the
  query shape has never been exercised against real rows. `--loads --dry-run` against `lme` is the
  first thing to run when the tunnel returns, alongside probes P4, P5 and P6. Also fixed while
  wiring: `--dry-run` was hard-wired to the roster, so a loads dry-run silently ran the roster.
  The dispatcher roster is read but not posted — `POST /api/tms/dispatchers` arrives at LM3.
- 2026-09-10 — **Two corrections to this document, found while executing LM1b.** (1) Trap 16 and its
  decision bullet claimed `equipment_item` disagrees with `continuity`; **the comparison behind that
  was invalid** — wrong group join, plus a cartesian product over team drivers — and the claim is
  withdrawn. `continuity` remains the source because it is validated and keyed by movement, not
  because the alternative is broken. (2) **The plan's LM1 SQL had a real defect**: `'D'` appears
  twice on 176 movements (the carrier runs teams), so the `LEFT JOIN` on the driver row would have
  emitted those movements twice and duplicated the load. Now aggregated, as `MOVEMENT_FACTS` already
  does. Both were caught by reading `tools/mcleod-agent/queries.mjs`, whose header records the
  team-driver measurement from 2026-08-26 — **the repo already knew, and the plan had not asked it.**
- 2026-09-10 — **LM1a shipped** (PR #734): the contract + ingest half of LM1. `hazmat` is
  `.optional()` with no default and the ingest writes it only when present (D-LM12), closing a live
  defect where a silent feed erased our own engine's determination; `dispatcher_external_id` /
  `dispatcher_name` and `tmsDispatchersPayloadSchema` added. **LM1 is split**: LM1b is the agent
  half (`loads.mjs`, `--loads`), because this fix stands alone. ⚠ Lesson for every later step: the
  route parses with `safeParse` BEFORE the ingest sees the payload, so a zod default is invisible to
  a test that builds its input in TypeScript — mutating `.default(false)` back left the whole ingest
  suite green. Schema behaviour gets a test in `packages/shared`.
- 2026-09-10 — `MCLEOD-COLLECTOR-PLAN.md` written beside this one after the owner set the collector
  architecture (change detector → collector → store → harness) and ruled that loads read **live
  `lme`**, not the sandbox. **Change Tracking turned out to be already enabled on `lme`** — 91
  tables, 10-day retention, 2.3 M versions retained — so the detector is a grant, not a build. LM0
  gains `VIEW CHANGE TRACKING`; LM1 defers its change detection to MC1/MC2. `continuity`, the one
  table this plan needs that CT does not cover, is handled by a 420-row re-read rather than an
  ALTER on production.
- 2026-09-15 — **scope set by the owner, vendor guidance re-read at source, and one live exposure
  found.** Six rulings recorded as the amendment block at the end of §2, and the interval figures
  edited in place in D-LM1 / D-LM8 / D-LM9b / LM4 / LM8 rather than left for a reader to reconcile.

  **From Samsara's own documentation** (TMS GPS tracking guide + Telematics Sync guide, read
  2026-09-15, not recalled): the recommended live-tracking cadence is **5–30 s**, and the floor is a
  stated rule — *"You should not request updates more frequently 5 seconds."* **D-LM1 drops from 30 s
  to 5 s**, which costs 0.2 req/s against a 50 req/s per-org limit — **0.4%**. D-LM8's browser poll
  drops 20 s → 5 s for the same reason: at a 5 s collector, a 20 s poll was the binding constraint
  and the interpolation would have eased toward a stale target. **D-LM9b's stated bound therefore
  goes from ~55 s to ~15 s** worst case for a moving truck. Two corrections fell out: the stats feed's
  `types=gps` **does** carry `headingDegrees`, `speedMilesPerHour` and `isEcuSpeed`, so nothing about
  marker rotation needs a second integration (D-LM1e); and `accuracyMeters` exists **only** on
  `/assets/location-and-speed/stream` and Kafka, which is now the sole reason to move. ⚠ **Samsara's
  own pagination advice is wrong for this org** — their sample drains while `hasNextPage` is true,
  and ours is *always* true (re-measured 2026-09-01, twelve pages deep). D-LM1d writes that down so a
  future reader does not "fix" our code to match their docs and hang the tick.
  **Samsara documents nothing about map smoothing or interpolation** — searched for it specifically.
  D-LM8's animation is our design, not a copied spec.

  **Owner rulings:** no position history — Samsara holds it, so `vehicle_positions` stays
  current-only and LM2's PK is confirmed rather than changed (D-LM16); no trailers on the map
  (D-LM17); the map draws **every** truck in v1, with "my assigned trucks" sequenced behind the
  McLeod grant, because the available substitute `tractor.dispatcher` matches the real dispatcher on
  only **56%** of the live board (D-LM18); and the Dashboard gets **gated tabs**, Admin and Dispatch,
  rather than a second dashboard page (D-DW6 — one `DashboardPage.vue`, no `session.role` branch, so
  D-DW1 survives intact and LM9/LM10 come off the critical path).

  ⚠ **Found while checking whether the owner's concern was real: it is, and it is live.** The
  Dashboard is `gate: ALWAYS` (`surfaces.ts:105`) and `useDashboard.ts` selects `total_cost` on fuel
  fills and runs an idle cost basis — so **every role that can sign in, dispatcher included, lands on
  a page showing fuel spend and idle cost**. That is D-LM19 and new step **LM-F**, which ships alone
  and first because it needs neither the map nor any integration. Its one open question, `Q-LM-F1`,
  is which section owns fuel *spend*, given a dispatcher plausibly needs fuel *planning* without it.
  New step **LM-T** carries D-DW6's tabs. Execution order for this ask is recorded at the top of §5:
  LM-F → LM2 → LM4 → LM5/LM6 → LM7 → LM8 → LM-T, none of which needs McLeod.
  No code written this session.
- 2026-09-15 — **`Q-LM-F1` ruled, and LM-F's honest bound found while ruling it.** There is no
  `finance` section — the sidebar *group* is `finance`, the *section* is `accounting`. Neither
  candidate works alone: **`fuel` fails outright** because the dispatcher holds `fuel: view` by
  design, and **`accounting` overshoots** because `fleet_manager` holds `accounting: none`
  deliberately (D-SEP7) *and* because the `accountant` role was granted `fuel: "view"` on the
  recorded reasoning that "fuel spend IS the largest expense line" — a grant that only makes sense
  if spend is readable under `fuel`. **The matrix does not model the volume/cost distinction at
  all**, so the split is per ELEMENT: MPG, alerts, risk lists and **idle hours** stay on `fuel`; the
  spend stat, the spend chart, the dollars donut and the **dollar half of the Idle waste tile** move
  behind `accounting`. The Idle waste tile already carries `${idleHours} idle hrs` as its sub-label,
  so the dispatcher keeps the operational number and loses only the money — no new section, no
  matrix change, no migration. Owner ruled **(a)** on the side effect: `fleet_manager` loses the
  figures too, and an org that wants otherwise grants it per-org through the sparse overrides
  (D-PERM4) rather than by widening the shipped matrix.

  ⚠ **And the bound, which changes what LM-F may be described as.** `DashboardPage` reads
  **PostgREST directly under RLS**, and `ftxn_select` (`0004_rls.sql:60`, never superseded) is
  `using (org_id = auth_org_id())` with **no section check** — so any org member can select
  `total_cost` directly. LM-F is therefore a **product boundary, not a security boundary**: it stops
  the browser rendering and fetching money, which is what was asked, and it does not make the figure
  unreachable. Recorded as new step **LM-F2** with three candidate shapes and a recommendation (move
  the dashboard onto an API endpoint, the direction D-LM11 already commits newer surfaces to), plus
  **`Q-LM-F2`** — whether the database boundary is wanted at all, which is a real question rather
  than an oversight, and which LM-F does not wait on. No code written this session.
- 2026-09-15 — **LM-F, LM-T and LM2 all merged; handoff written.** `#803` split the Dashboard into a
  shell plus gated tabs (D-DW6): tabs derive from the section matrix, `defaultFor` is the only place a
  role is named, and there is no `session.role` test in the rendering path. `moneyGate.ts` carries
  Q-LM-F1's per-element ruling. Two live behaviour changes to watch: **`fleet_manager` lost the spend
  figures** (holds `accounting: none` — owner ruled correct, org overrides are the remedy) and
  **drivers lost the dashboard** for an empty state (`Q-LM-T1` still open). ⚠ LM-F shipped as a
  PRODUCT boundary only — `ftxn_select` has no section check, so `total_cost` is still reachable from
  PostgREST; **LM-F2** is scoped and `Q-LM-F2` asks whether the database boundary is wanted at all.
  `#804` shipped LM2: `vehicle_positions`, PK `(org_id, vehicle_id)`, current-only, RLS deny-all,
  **applied to production**. Two plan assertions were wrong and are corrected in place — `vehicles`
  had **no** `(id, org_id)` unique (0341 adds it, as 0148 did for `loads`), and the migration header's
  claim that a west-positive longitude would be refused was false and has been removed, because +88 is
  a legal longitude for a carrier east of Greenwich. **LM4 is next**, and its PR must delete the
  producer waiver `check-table-producers.mjs` now carries for `vehicle_positions`. Full context in
  `docs/HANDOFF-2026-09-15.md`.
- 2026-09-15 — **LM4 built: the 5-second positions tier, and `vehicle_positions` has a producer.**
  Migration **0342** carries `record_vehicle_positions(p_org, p_rows)` and the producer waiver is
  deleted from `check-table-producers.mjs`, as that entry said it would be. The collector is
  `samsaraPositionsFeed.ts`, polling `GET /fleet/vehicles/stats/feed?types=gps` on its OWN cursor row
  (`feed = 'vehicle_positions'`), terminating on an empty page with a 50-page cap, accumulating across
  pages before reducing each truck to its newest fix, and writing the whole tick in one call.
  `SAMSARA_POSITIONS_SYNC_SECONDS` defaults to **5** and the schema refuses anything between 1 and 4 —
  the vendor's floor as a constraint rather than a comment.

  **Five deviations from this step as written, each a decision rather than a shortcut:**

  1. **An RPC with an only-go-forward guard, not just "an RPC for volume".** The step said
     `record_vehicle_positions(jsonb)` without saying why a function. The decisive reason turned out
     to be one line PostgREST cannot express: `where excluded.sampled_at > vp.sampled_at`. The feed is
     at-least-once by design (D-SAM4), so a cursor write that fails after its page was applied
     re-delivers that page — and with no history in this table, an older fix written over a newer one
     is unrecoverable and makes a live truck look stale. The matrix proves it, and proves it by
     failing when the guard is removed.
  2. **The tier does NOT run through the jobs ledger**, contrary to every other collecting tier. At 12
     ticks a minute it would write ~17,000 `jobs` rows per org per day against a 90-day retention, to
     record that a poll ran. Its freshness stamp is `samsara_feed_cursors.updated_at`, which 0288
     created for exactly this — Samsara mints a fresh endCursor on every call, including one returning
     no samples, so the column moves when the VENDOR ANSWERED rather than when we ran. Precedent:
     `readTelematicsStamp` already judges the per-fill tier by its own stamp. **Cost, stated:** with no
     job rows there is no error text, so `positions` can read `fresh`, `late` or `never` but never
     `failing` — a refusal looks like a stop, and the server log is where it is legible.
  3. **`positions` is a RULED bound of 15 minutes** (`SAMSARA_RULED_TARGET_HOURS`, the first fractional
     entry). Leaving it out was the tempting non-decision and has the worse failure: the fallback is
     `cadence × 3`, which for a 5-second tier is **fifteen seconds**, so one slow tick paints the card
     amber and the freshness surface becomes the wallpaper that module's header argues against. 15
     minutes is what a person should react to. It says nothing about PER-TRUCK staleness — that is
     D-LM10, drawn on the map itself. **Owner may retune; this is the number to argue with.**
  4. **The feed alarm's first delay went 5 → 7 minutes.** `never` is alertable for any ruled feed, and
     a collector that has not had its first tick yet is indistinguishable from one that has never
     delivered — so an alarm evaluating at the same instant as the positions tier's first run was a
     coin flip on mailing a carrier about a cold start. Costs two minutes once per process start.
  5. **No snapshot bootstrap.** Samsara prescribes "snapshot once, then deltas" and
     `makeSamsaraGpsSnapshotFetcher` exists, but a cursorless call to the feed already returns every
     vehicle's current value — the stats tier has relied on that since SAM-S2. One mechanism that
     seeds and resumes beats two that have to agree.

  **Two refactors the file-size gate forced, both splits rather than waivers:** `lib/tierRunner.ts`
  (`orgsToSync` / `runOrgTier` / `startTier`, moved unchanged out of a 556-line `samsaraScheduler.ts`)
  and `lib/samsaraDeltaFeeds.ts` (both feed fetchers, re-exported from `lib/samsara.ts` so no importer
  moved). `lib/feedCursor.ts` is a third extraction and the only one that is not about line count: the
  stats tier's private cursor helpers became shared so the two tiers cannot drift apart on
  at-least-once semantics — a copy of that would be a workaround with a delay fuse.

  **Every assertion added here was proven able to fail by mutating the implementation** (five mutants
  against the shared reducer, two against the migration). The second migration mutant — tenant scope
  read from the payload instead of the argument — **survived the first draft of the matrix**, because
  no fixture row had ever carried an `org_id` at all. The test that now catches it says so in place.

  **Nothing has been seen in production.** The table is still empty until this merges and the tier's
  first tick lands ~5 minutes after the release boots; the first deploy may log one
  `record_vehicle_positions is not in the database yet` warning while `migrate.yml` catches up, which
  is the deploy window behaving as designed. **LM5 is next** (the pure layer), then LM6.
- 2026-09-15 — **LM5 built: `packages/shared/src/livemap.ts`, and its thresholds are measured rather
  than chosen.** `deriveVehicleState`, `positionAgeSeconds`, `lerp`, `lerpAngle`, `lerpPosition`.
  Pure, `now` is always a parameter.

  **The thresholds came off production, an hour after LM4's first tick, not off a preference.** 171
  active trucks: speed was exactly 0 for 120, between 0 and 3 mph for 9, between 3 and 5 for **one**,
  and ≥5 mph for 41 — so `STOPPED_SPEED_MPH = 3` sits in a GAP rather than through a cluster. Age was
  ≤30 s for 60, ≤5 min for 140, ≤15 min for 142, beyond for 29 — **bimodal, with only two trucks
  anywhere between 5 and 15 minutes**, which is what makes `OFFLINE_BOUND_SECONDS = 900` robust
  instead of tuned. It is also the same 15 minutes the feed's own staleness bound uses, so a
  dispatcher and the freshness card cannot call one outage by two names.

  **How `stopped` is told from `parked` with no history at all.** `vehicle_positions` holds one row
  per truck, so nothing here can read a series — and it does not need to. The vendor's PING RATE is
  the signal: Samsara pings every ≤5 s while a vehicle is on and drops to ~one every 5 minutes when it
  is off (D-LM9b), so the AGE of the newest fix says which regime the truck is in. A truck at 0 mph
  heard from seconds ago is at a dock with the engine running; one heard from four minutes ago has
  been switched off. `ENGINE_ON_BOUND_SECONDS = 30` is twice D-LM9b's 15-second stack, so one missed
  tick does not flip a truck at a dock to `parked`.

  **Verified against the real fleet, at the DATABASE's clock.** All four states are reachable:
  45 moving, 14 stopped, 87 parked, 53 offline across 199 trucks (43/14/85/29 over the 171 active).
  ⚠ The first run of that check said **zero `stopped`** — an artefact of measuring a minutes-old
  snapshot against wall-clock `now`, which aged every truck past the 30-second bound. Re-run against
  `now()` as the export saw it, `stopped` is 14 and matches an independent SQL count of 13 taken
  minutes earlier. Recorded because a state nothing ever produces is dead code that looks like a
  feature, and the first measurement would have said exactly that.

  **`STOPPED_SPEED_MPH` was promoted out of `matchFuelingMoment`**, which had carried it as a bare
  `?? 3` since the fuel matcher was written. Same judgement about the same fleet; two copies would
  have drifted the first time either was tuned.

  **Ten mutants run; nine caught.** ⚠ The survivor is recorded in place rather than hidden: deleting
  the `Number.isFinite` guard in `deriveVehicleState` changes nothing, because `NaN > 3` is already
  false. The guard is kept as documentation — and because it stops being redundant the moment somebody
  rewrites the branch as `speed <= stoppedSpeed` — and both the function and its test now say so, so
  no reader mistakes it for the thing that handles a missing speed.

  **Two limits stated rather than discovered.** `lerpAngle` resolves an exact 180° opposition
  counter-clockwise; either answer is equally right, so the tie is pinned by a test only to stop it
  changing silently. `lerpPosition` does NOT handle the antimeridian — a road fleet cannot cross it,
  and a branch no test could exercise against anything real is worse than a stated gap. Note this is
  the opposite question from 0341's, which refused to encode a hemisphere in the SCHEMA: a schema must
  admit any legal coordinate, while an animation may say where it stops being right.

  **LM6 is next** — `GET /api/livemap/positions`, gated `dispatch:view`. ⚠ It must be correct with
  **zero loads**, which is still production's state, and its `mine` scope stays unreachable until the
  McLeod grant lands (D-LM18 ships the board fleet-wide).
- 2026-09-15 — **LM6 built: `GET /api/livemap/positions`, gated `dispatch:view`, WITHOUT the
  dispatcher join.** New module `apps/api/src/modules/livemap/` + `livemapContract.ts`. Owner-directed
  deviation, and it is the right one: LM6 as written resolves the `mine` scope through
  `tms_dispatchers`, and **that table does not exist in this database** — it is downstream of the
  McLeod `VIEW CHANGE TRACKING` grant, which is still refused. Building the join against a table that
  is not there would have been a branch no test could exercise. The board ships fleet-wide per D-LM18,
  `scope` is `"all"` for everybody, and `scopeReason` carries the banner in plain words, because a
  dispatcher who believes they are seeing only their own trucks will read an empty column as "nothing
  of mine is late".

  **It owns no table and reads all four through their owners.** Only `vehicle_positions` is
  machine-sealed (`layer=raw`; a direct select fails `lint:table-access`, and that was verified by
  making one and watching the gate fire). `vehicles`, `drivers`, `loads` and `load_stops` are core and
  could legally have been selected from here — three new reader functions exist instead
  (`readVehiclePositions`, `readFleetIdentities`, `readLiveLoadContext`), because reaching past an
  owner because no gate happens to stop you is how `drivers` came to be written from 54 files. Three
  `API_ALLOW` edges added with that reasoning attached.

  **Verified against the real fleet, not only fixtures.** 199 vehicles assembled, untruncated:
  42 moving, 12 stopped, 93 parked, 52 offline; 188 with a driver, 199 with a heading, **0 with a
  load**, 0 with a placeholder unit number. A sample marker: unit 670, 60.3 mph, heading 16°, fix
  **2 seconds old**. The zero-load case is the one LM6 most had to get right and it is now observed
  rather than assumed.

  ⚠ **Assembly measured at ~1.0 s — from a laptop, over three sequential round trips to Supabase.**
  That is not the production number (the API runs in Railway beside the database) but it is the only
  one measured, and the browser polls this at 5 s per D-LM8. **Re-measure in Railway before LM8 ships**
  rather than assuming it shrinks. If it does not, the reads are independent and can go concurrent —
  the sequential choice is recorded in `liveMapBoard.ts` with its reason, so changing it is an edit to
  a decision rather than a discovery.

  **Six service mutants and three gate mutants, all caught**, including the two the test fake
  structurally cannot catch by filtering: `supabaseRecorder` RECORDS predicates without APPLYING them,
  so dropping the live-status filter entirely would have left every assembly test green. Two tests
  read the recorded filters directly for exactly that reason. The gate mutants prove the section gate
  is present, is `view` and not `manage` (an auditor must not be locked out of a read-only board), and
  that the module entitlement layer is separate.

  **LM7 is next** (extract `useMapLibre` from the working fuel-planning map, no behaviour change),
  then LM8 draws this.
- 2026-09-15 — **LM7 built: `useMapLibre` extracted, and Fuel Planning proven byte-identical.**
  `apps/web/src/composables/useMapLibre.ts` now owns the four things LM8 was about to need twice: the
  oklch→sRGB token conversion, the Bearer token on every tile request, the style pointing at our
  authenticated proxy, and a teardown that unsubscribes as well as disposing the map. `RouteMapGL.vue`
  keeps only what is about a ROUTE — the line, the markers, the fit — and drops from 191 lines to 107.

  **The Done-when is met exactly rather than approximately.** Same fixture, same browser, same
  viewport, built before and after the change: the rendered map is **7,861 bytes with an identical
  SHA-256 both times**. Not "looks the same" — the same pixels. 1 canvas, 4 markers, 0 error
  boundaries, no console errors, on both builds. `lint:tokens-parity` and `lint:token-gamut` green, and
  no hex literal was introduced.

  **One API addition, and it is about ordering.** `onBeforeTeardown` exists because Vue runs
  `onBeforeUnmount` hooks in REGISTRATION order: a component that registered its own teardown after
  calling this composable would find the map already disposed and be calling `Marker.remove()` into a
  dead object. The original removed markers first. Rather than depend on where a line happens to sit in
  a setup block, the hook makes the order explicit.

  **The extraction bought a test that could not previously exist.** `toMapColor` lived inside a `.vue`
  file that needs a WebGL canvas to mount, so the only way to exercise it was to look at a map — and
  its failure mode is silent (maplibre throws `color expected, 'oklch(…)'` and the line is simply not
  drawn; it shipped broken on Edge once for that reason). It now has 8 assertions and 7 mutants.
  ⚠ **One mutant survived the first draft**: feeding the hue to `Math.cos` in DEGREES instead of
  radians left every assertion green, because 25 and 250 radians wrap to angles with the same dominant
  channel — "the red channel dominates for a red hue" reads like an assertion and is not one. The test
  now pins three exact sRGB triples, which is the only version that can tell a correct conversion from
  a plausible one.

  **Three traps met on the way, all recorded because the next person meets them too:**
  1. `vite build` fails locally with "Production web build is missing: VITE_SUPABASE_*" even though
     `apps/web/.env` defines them — `vite.config.ts` reads `process.env` directly, not Vite's `loadEnv`.
     **Use `pnpm --filter @silvicom/web preview:local`**, which loads the file itself. The handoff
     recorded this as unresolved local setup; it is not, the script already solves it.
  2. **Every preview server serves the one `apps/web/dist`.** Ports 4173–4175 were all serving the same
     bundle, so an A/B by port proves nothing — the tree must be rebuilt between arms. One measurement
     in this session was invalidated exactly that way before it was caught.
  3. **The error boundary swallows the cause and logs nothing.** A `PlanResult` fixture missing
     `status` puts the page in "Something went wrong" with an empty console, because
     `PlanStatusBanner` does `META[props.status]`. The way out was not to defeat the boundary: it was
     to run the SAME fixture against the pre-change tree, see it fail identically, and know the fault
     was the fixture. That comparison is cheaper than any debugging and is the one to reach for first.

  **LM8 is next** — the real map. It inherits this composable and D-LM7's GeoJSON-source design, and
  it is the step that finally draws what LM4 collects and LM6 serves.
- 2026-09-15 — **LM8 built: `/live-map` draws the board, and `Q-LM8a` is ruled.**
  The surface is a page (`LiveMapPage.vue`) over a panel (`features/livemap/LiveMapPanel.vue`), because
  LM-T embeds the same panel as the Dashboard's Dispatch tab (D-DW5) and a second caller written now is
  a second call rather than a second copy. Five files carry the work: the pure layer
  (`liveMapLayer.ts`), the pure animation (`liveMapMotion.ts`), the canvas-drawn markers
  (`liveMapIcons.ts`), the poll (`useLiveMapBoard.ts`) and the map component (`LiveMapCanvas.vue`).
  `LiveLocationIcon` was added to `packages/ui/src/icons.ts`; the surface, the icon map, the route and
  both committed snapshots moved together.

  **`Q-LM8a` — should the live map draw RETIRED trucks? Ruled (a): no, and the predicate is
  `<> 'retired'` rather than `= 'active'`.** The handoff's candidate (a) was spelled "filters to
  `status = 'active'`", and that spelling is wrong for a reason only the enum shows: `vehicle_status`
  is `active | maintenance | retired` (migration 0001), so `= 'active'` would also drop every truck
  sitting in the shop — which is exactly a truck a dispatcher goes to a map to find. This carrier has
  no `maintenance` rows today (**235 active, 37 retired**, measured on production 2026-09-16), so the
  two spellings are indistinguishable right now and would have stayed that way until the first truck
  went into the shop and quietly vanished. 28 of the 199 rows the collector held were retired vehicles.
  The predicate lives in `liveMapBoard.ts` and not in `readFleetIdentities`: the ruling is the live
  map's, not the roster's, and `FleetIdentity.status` crosses that interface precisely so this module
  can apply its own. A null status is DRAWN — "we do not know" is not "retired".

  **Deviations from the step as written, each with its reason:**
  1. **Two of the three filters are not built.** LM8 lists "dispatcher, state, load status".
     `tms_dispatchers` does not exist in this database (downstream of the McLeod `VIEW CHANGE TRACKING`
     grant) and `loads` holds 0 rows until LM12, so two of the three would have shipped permanently
     empty. An empty dropdown does not read as "not yet", it reads as "this page is broken". Only the
     **state** filter is built, and it carries the census in its option labels.
  2. **The markers carry no unit number, and cannot.** A maplibre `symbol` layer renders `text-field`
     only if the style declares a `glyphs` endpoint; this product's style is one RASTER source pointed
     at our own authenticated tile proxy, and adding glyphs would mean sending users to a third party
     for fonts. That is why the table beneath the map is part of this surface rather than a decoration
     on it — it is where a truck is identified, searched and sorted, and it is the accessible reading
     of a canvas a screen reader cannot enter.
  3. **The table does not paginate.** 199 rows that rewrite themselves every five seconds; a page 2
     that reshuffled under the reader on every poll would be worse than a scroll, and `DataTable`
     already scrolls its own body with the header pinned.

  **What is new and deliberate.** The animation snaps instead of interpolating past
  `SNAP_DISTANCE_DEGREES` (0.05°, ~3.4 mi — a truck at 100 mph covers 0.14 mi between polls, so nothing
  driving comes near it). The case it exists for is a FEED EVENT: telematics that went quiet in Oregon
  and reported again in Idaho, or a tab hidden for an hour. Without it the map draws a dot gliding
  across three states in five seconds, which is a picture of something that did not happen. The
  interpolation's own cost is stated rather than hidden: a dot travels TOWARD the newest fix, so it
  lags by up to one poll on top of D-LM9b's ~15 s — accepted because a five-second teleport at 199
  trucks reads as a broken map, and because the per-truck age beside it comes from the server and is
  unaffected.

  **The pause on a hidden tab is TanStack's, not a hand-rolled listener**, and the distinction matters:
  in query-core 5.101 "focused" is defined as `document.visibilityState !== "hidden"` — visibility, not
  window focus. A poll that stopped on BLUR would stop exactly when a dispatcher has the board on a
  second monitor beside their TMS.

  **Nine mutants, all caught.** Two on the API (deleting the retired predicate; and narrowing it to
  `= 'active'`, which the maintenance test exists to kill), three on the animation (`lerpAngle` →
  `lerp`, the snap guard removed, `<` → `<=` in the settle check), and four on the layer. ⚠ **One test
  FIXTURE was wrong before the code was**: the first "halfway at half the interval" assertion moved a
  truck a whole degree, the snap guard correctly fired, and the test failed against a correct
  implementation. Recorded because it is the mirror image of the usual failure — a fixture can be too
  extreme as well as too uniform.

  **Verified in a browser, both themes**, via `VITE_DEV_BYPASS=true pnpm --filter @silvicom/web
  preview:local` and Playwright route mocks: page, markers, legend census, drawer, fly-to on row click,
  the empty board, and the nav entry. No console errors in either theme. Two mock traps cost time and
  are worth writing down: **Playwright matches the most recently added route FIRST**, so a
  `**/api/**` catch-all registered last shadows every specific mock and the page renders "Something
  went wrong" with nothing in the console; and **`useModulesQuery` goes straight to PostgREST**, not
  through `/api`, so the whole Dispatch nav group stays hidden — which looks like a missing nav entry
  and is not one.

  ⚠ **The measurement §3 of the handoff owed is STILL OWED.** Board assembly has not been timed inside
  Railway — `railway ssh` into the API service was refused by this session's permissions. ~1.0 s from a
  laptop remains the only figure, against a 5 s poll. vue-query dedupes by key rather than stacking
  requests, so a slow board degrades to "as fast as the server answers" instead of building a queue,
  but that is a floor and not the measurement.

  **LM9 is next** (the `DASHBOARD_WIDGETS` catalogue), and LM-T after it embeds this panel.
- 2026-09-15 — **LM9 begun with an equivalence harness, which immediately found four LM-F leaks.**
  The harness (`features/dashboard/dashboardEquivalence.test.ts`) snapshots the elements each caller
  sees on the Dashboard, in document order, parameterised on `accounting` — captured against the
  pre-change tree so that LM9's "changes no behaviour for any existing role" can be *proved* rather
  than asserted. Third use of this shape, after `routeTable.test.ts` (route split) and
  `navEquivalence.test.ts` (sidebar catalogue). Three mutants prove it discriminates: a dropped hero
  tile, a dropped chart card, and a defeated money gate, the last killed only by the no-money snapshot.

  ⚠ **Two drafts of its `StatCard` stub were blind before the third**, and both are recorded in the
  file because the failure is silent: the real card renders its label in a `<p>`, so the first capture
  missed all four hero tiles; the second carried label and sub but not value, which reads
  "Idle waste — idle hrs" whether or not the number survived the gate. A harness that quietly covers
  half a screen is worse than no harness, because it is believed.

  **What it found, on the first run: LM-F leaked money in four places on the very tab it was written
  for.** A caller without `accounting` — `fleet_manager` holds exactly that — saw:

  1. **`Recovered · $12,500`**, because `LedgerTile` had no `money` field and `applyMoneyGate` only
     acts on tiles that carry one. It sat on the same strip from which "Fuel spend" and "Reefer fuel"
     had just been correctly removed, so the screen was internally inconsistent rather than uniformly
     permissive.
  2. **The `Fuel spend` chart** — a daily currency figure across the whole range, ungated.
  3. **The `Where fuel dollars go` donut** — every slice in dollars plus a dollar centre total. Its
     own title said so while the gate above it said the opposite.
  4. **`total_cost` is still SELECTED for every caller** (`useDashboard.ts:87`), so the figures reach
     the browser regardless of what is painted — which is LM-F's own stated rule ("a hidden tile still
     fetched the money"), unmet.

  **1–3 are fixed here. 4 is NOT, and is recorded rather than routed around:** withholding the column
  means `aggregateDashboard` must tolerate a fill with no cost, and `totalSpend`, `spendTrend`,
  `movingSpend` and `idleCostUsd` all derive from it. That is a real change with knock-ons and it
  belongs beside **LM-F2**, which already owns the other half of this boundary (`ftxn_select` has no
  section check, so the API answers the same question directly). Scoped, not done.

  **And the mechanism for 2–3 had been written and never connected.** `hasMoney` carried the comment
  "used by the page to decide whether a whole chart card is worth rendering" and had **no production
  caller from the day it shipped**. It is deleted rather than wired: the charts now read
  `canSeeMoney` (`session.canView("accounting")`) directly, which is the same fact `applyMoneyGate`
  is handed and the one every other gate in the app reads — deciding a chart's fate from whether a
  *tile strip* still contains money would be an answer by proxy to a question we can ask outright.
  ⚠ `lint:comment-claims` did not catch the false claim and cannot: it validates comments quoting a
  TEST TITLE, not ones asserting a call site exists.

  **A standing assertion now states the rule** rather than recording it — "a caller without
  `accounting` sees no currency figure anywhere on the tab", matched against the full rendered HTML
  so a dollar figure in a hover title or an aria-label fails it too. A snapshot run with `-u` will
  happily record a regression; this will not. Both leak fixes were mutation-tested and each mutant is
  killed twice, by the snapshot and by the guard.

  **Two things found while reading, not yet acted on:**
  - `DispatchTab.vue` still renders a placeholder reading "Not connected yet — vehicle positions are
    still being wired up to the Samsara feed." That has been false since LM8 merged. It becomes the
    live-map widget in LM9's second PR (D-DW5), which is also why it was not patched in isolation:
    cataloguing a placeholder would freeze the wrong thing.
  - Embedding `LiveMapPanel` in `features/dashboard` is a cross-feature import and `WEB_ALLOW` is
    deliberately empty. **Where widget components live is therefore a question LM9 must answer**, and
    the answer this plan will take is the documented one: the registry lives OUTSIDE `features/`, so a
    widget may come from any feature without a leak.
- 2026-09-15 — **LM9 built: `DASHBOARD_WIDGETS`, and the Dashboard renders from it.**
  `packages/shared/src/dashboardWidgets.ts` holds ten widgets; `apps/web/src/lib/dashboardWidgets.ts`
  maps each key to a component; `features/dashboard/TabWidgets.vue` renders one tab from the
  catalogue. `FleetOverviewTab.vue` and `DispatchTab.vue` are DELETED — there is one renderer now,
  and adding a widget is a row of data plus a component rather than an edit to a template.

  **The gate is reused, not re-implemented.** `surfaceGateAllows` / `canReachSurface` were typed to
  `Surface`, which demands `path` and `group`; they now take a structural `Gated` that both `Surface`
  and `DashboardWidget` satisfy. One external caller existed (`nav.ts`) and it did not change. The
  gate builders `section`/`manage`/`ALWAYS`/`STAFF`/`ADMIN` are exported for the same reason — a
  copied `section()` reads identically and drifts the first time either learns a new kind.

  **`Q-LM9a` — a widget is a CARD, not a tile. Ruled.** Read literally, "every tile and chart becomes
  a widget" is fifteen entries on the fleet tab, four of them cells in one four-column grid — and a
  grid with one cell hidden is still a grid. D-DW3's promise is reorder-and-hide, which only means
  something at the grain a user could move. Nine cards, and the finer per-tile question (which show
  money) stays where it was already answered correctly, in `applyMoneyGate`.

  **`span: "full" | "half"` carries layout in a permissions catalogue**, which is a compromise named
  as one: the alternative was a third home for a fact about a widget, and LM10's per-user layout has
  to read it from somewhere. The values are transcribed from the grids the tab renders today.

  **The equivalence claim is PROVED, not asserted.** `dashboardEquivalence.test.ts` now mounts
  `TabWidgets` — a different renderer — and reproduces both fleet snapshots, captured from the
  hand-written template, byte for byte. The no-currency guard still passes.

  ⚠ **Two fixture defects found, and both are the interesting part of this step:**
  1. **The refactor created a SECOND path to "may this caller see money".** The widget gate resolves
     `accounting` through `canReachSurface`; `applyMoneyGate` reads `session.canView`. In production
     they agree — both go through the same shared functions — but the harness stubbed only the second,
     so the no-money case passed the gate and the diff read as a money-gate regression. It was the
     fixture. The ROLE is now the single input and `canView` is derived from it by the real
     `callerCanView`.
  2. **An `accounting: "none"` override on an ADMIN does nothing**, by design: `resolveSectionAccess`
     ignores a claim on a non-editable role, because an admin cannot be denied. The second draft of
     the fixture tried exactly that and rendered every dollar. The no-money case is now
     `fleet_manager`, which is the real role LM-F was written for.

  **One intended behaviour change, stated rather than absorbed:** the dispatch tab renders the real
  `LiveMapPanel` (D-DW5). It had shown a placeholder reading "Not connected yet — vehicle positions
  are still being wired up to the Samsara feed", true when LM-T wrote it and false from the moment
  LM8 merged. A test asserts that sentence cannot come back.

  **Where widget components live is answered:** `apps/web/src/lib/`, OUTSIDE `features/`.
  `check-feature-boundaries.mjs` refuses `features/dashboard → features/livemap` and `WEB_ALLOW` is
  deliberately empty; a registry outside `features/` is the promotion its comment prescribes, and it
  is the composition root for the Dashboard exactly as a page is for a route. `lint:boundaries` green.

  **D-DW4 shipped with the catalogue**, as it required: `check-surfaces.mjs` grows eight widget
  detectors — missing component, unknown section, unknown role in `defaultFor`, unknown module,
  unknown tab, bad span, duplicate key, and drift in either direction between catalogue and registry
  — each proven to fire by the self-test, which now covers seventeen. Mutation-checked against the
  real catalogue by deleting a component from the registry.

  ⚠ **One unrelated latent type error surfaced and was fixed**: `DonutBreakdown` typed its config
  `ChartConfiguration<"doughnut">` while `BaseChart` declares the union, which is not assignable. The
  mismatch was always there and began failing when this step moved the component's only caller.

  **LM10 is next** — role defaults and the per-user layout, which is the step that carries a migration
  (`user_dashboard_layout`, row-or-no-row for D-DW3's three states).
- 2026-09-15 — **LM10, first half: the table, the resolver and the endpoint. Deliberately dark.**
  Migration **0343** `user_dashboard_layout`, `packages/shared/src/dashboardLayoutContract.ts`, and
  `/api/dashboard-layout` (GET/PUT/DELETE, in the `org` module beside saved views). Nothing on screen
  changes yet — `TabWidgets` still renders every gate-admitted widget — and that is a decision, not an
  omission. See "why this did not ship in one PR" below.

  ⚠ **`hidden_keys` is a DEVIATION from this plan's schema, and this plan's own Done-when forces it.**
  LM10 §5 specifies one array, `widget_keys`, "the visible set, in order", and then requires that "a
  user who hides a widget still inherits a later default change to widgets they did not touch". Those
  cannot both hold. With a visible set alone, a widget added to the catalogue AFTER somebody saved is
  absent from their array, is therefore hidden, and is hidden from a person who never ruled on it —
  every user who once opened the editor frozen at the catalogue as it stood that day, which is
  exactly the failure D-DW3's third state exists to prevent, arriving by the back door. So the row
  records the DECISION: `widget_keys` (kept, in order) and `hidden_keys` (turned off). A key in
  neither is one nobody has ruled on and it follows the role default. "Show me nothing" survives
  intact and stays distinct from silence — empty `widget_keys`, with a row. Rejected: a `known_keys`
  column holding the catalogue as it stood at save time, which carries the same information but
  states it as a UI artefact rather than as something a person decided.

  **The three-state promise is now a constraint, not a convention.** `not (widget_keys && hidden_keys)`
  is the only CHECK in 0343 that encodes a rule rather than a ceiling: without it the resolver would
  have to invent a winner in TypeScript for a state the database was happy to store.

  **The read is OWN-ROW, and that is tighter than 0298 on purpose.** What a role may REACH is not a
  secret from the org that configured it. How somebody arranged their own screen is not the org's
  business — `saved_views` (0278) and `notification_events` (0089) made the same call. An admin of
  the org is asserted to read nothing, which is the assertion most likely to be deleted by somebody
  building a support tool; the matrix says so at the assertion.

  **A layout cannot grant a widget, by construction rather than by intention.**
  `resolveDashboardLayout` is never handed `DASHBOARD_WIDGETS` — only the widgets the caller's gates
  already admitted — so a stored key naming a widget they may not see has nothing to resolve to. That
  is what licenses `/api/dashboard-layout` being pinned in `AUTH_ONLY_MOUNTS` with no section gate,
  and the argument is written there beside saved views'.

  **Mutation-tested, because that is the only thing that made any of it true.** Four mutants against
  the resolver (collapse the third state, ignore `hidden_keys`, prepend instead of append, ignore
  `defaultFor`), four against the router (drop either user filter, flatten `null` into an empty
  layout, accept unknown keys), five against the migration. ⚠ **One assertion passed proving
  nothing**: "an update cannot move a layout to another org" was refused by the composite FK, not by
  the trigger, so deleting `forbid_org_change` left the matrix green. Rewritten the way
  `user-surface-access.test.mjs` already had to — the row moves between two orgs the person really
  belongs to, and the error message is checked. Same trap, same file, second time.

  **One unrelated change, forced and stated rather than absorbed:** `app.ts` reached **503 lines**
  against the 500 budget when this step added one router mount, so `securityMiddleware` and
  `mountBodyParsers` moved to `apps/api/src/appHttp.ts` (435 lines now). ⚠ The router MOUNTS could
  not move: `routeAuth.test.ts`, `routeGates.test.ts` and `routeGateLedger.test.ts` discover every
  mounted router by reading `app.ts`'s SOURCE, and they would go on passing while covering less. The
  new file's header says so, and `app.ts`'s own comment already said squeezing back under by deleting
  a comment is the wrong move. All 3,779 api tests pass, including the three that read that source.

  **Why this did not ship in one PR.** Applying the defaults without an editor is a REGRESSION, not a
  partial feature: `dispatch.live-map` declares `defaultFor: ["dispatcher"]`, so the moment
  `TabWidgets` respects defaults, an admin's Dispatch tab renders EMPTY and they have no way to get
  the map back. D-DW2 intends the default; it does not intend the dead end. So the rendering switch
  and the editor ship together, next, and no deploy ever sits in the state where a default applies and
  nothing can change it.

  **Left for the second half:** `TabWidgets` reading the layout, the editor (reorder + show/hide +
  reset), a `useDashboardLayout` composable, and an empty state for a tab whose widgets are all
  hidden. `span` stays in the catalogue — a stored layout is an ORDER, not a geometry.
- 2026-09-15 — **LM10, second half: the Dashboard reads the layout, and a person can change it. LM10 COMPLETE.**
  `TabWidgets` resolves the stored row over the gate-admitted widgets;
  `features/dashboard/DashboardLayoutEditor.vue` is the drawer; `composables/useDashboardLayout.ts`
  is the data layer. The rendering switch and the editor shipped in ONE merge on purpose — the
  previous entry has the argument, and it is that `defaultFor: ["dispatcher"]` empties an admin's
  Dispatch tab the moment defaults are respected.

  **The equivalence snapshots did not move, and that is LM10's own claim as well as LM9's.**
  `dashboardEquivalence.test.ts` holds the layout at `null` — D-DW3's "no row" — and reproduces both
  fleet snapshots byte for byte. A caller who has never opened the editor sees exactly what they saw.
  ⚠ It follows that that harness cannot fail on a layout defect, so the varying half is a separate
  file, `tabWidgetsLayout.test.ts`. A harness cannot both hold a value fixed and vary it, and one
  that tried would have to pick a layout to call correct.

  **The layout is applied strictly AFTER the gate, and the test that matters proves it cannot widen.**
  "Cannot show a card the caller's gates refused, however the layout names it" renders a
  `fleet_manager` naming both money cards in their `widget_keys` and asserts no dollar reaches the
  page. Mutating `TabWidgets` to resolve against the CATALOGUE instead of the admitted list kills it.

  **`mergeTabLayout` exists because the drawer edits one tab and the row spans every tab.** A save
  that sent only what it was showing would erase the other tab's decisions, invisibly, until somebody
  next opened it. ⚠ And it is handed the keys the editor actually OFFERED, not every catalogue key on
  the tab: a widget whose gate the caller has temporarily lost is not on screen, cannot be ruled on,
  and must not have its existing decision deleted.

  **`AppButton` gained `size="icon"`**, because the drawer's move/hide controls are square icon
  buttons and `lint:ui-adoption` refuses `class="!h-8 !w-8 !p-0"` on a primitive — correctly, and the
  `ghost` variant's own comment already records the same lesson from the other direction. The caller
  still owns the accessible name; the primitive cannot enforce that and says so.

  **`data-test="widget-<key>"` on each grid item.** The cards do not agree on how they announce
  themselves — most carry an `h3`, the hero strip carries none — and the first draft of the layout
  test matched `h2` and captured ONE card out of nine. It failed loudly; a variant matching `h3` would
  have passed while ignoring the two widgets with no heading at all.

  **Mutation-tested, 13 more mutants, all killed:** 3 against `TabWidgets` (ignore the layout, suppress
  the empty state, resolve before the gate), 4 against the editor (reset becomes an empty save, save
  forgets the other tab, seed ignores the on-screen order, move is a no-op), 2 against
  `mergeTabLayout`, 4 against the resolver in the first half.

  **Deliberately not built:** drag-and-drop (move-up/down is keyboard- and screen-reader-reachable
  with no library, and nine cards is a list somebody reorders once), and a per-tab reset ("Restore the
  default" deletes the whole row, which is what D-DW3 defines the default to be).

  **Two defects the unit tests could not have found, and the browser did.** Built with
  `VITE_DEV_BYPASS=true pnpm --filter @silvicom/web preview:local` and driven with the route mocks the
  LM8 traps prescribe (catch-all registered FIRST; `**/rest/v1/org_modules**` answered as a RAW array):
  1. **The drawer's footer wrapped.** `SlideOver`'s footer slot is a plain `div` with no display of
     its own, so a bare `flex-1` spacer between the buttons is a block element among inline ones and
     takes a line to itself — "Restore the default" sat on its own row above a left-aligned
     Cancel/Save. The layout now lives in the call site, as `ApplicationReviewDrawer` already does.
  2. **"Save" was rendering as a secondary button**, because that is `AppButton`'s default variant and
     the first draft passed none. The primary action of a drawer has to look like one.

  ⚠ Both are invisible to the unit tests ON PURPOSE-ish: those find buttons by label and are perfectly
  happy with them stacked wrongly and styled flat. This is the case for looking at the thing.

  **Walked end to end in the browser, not only asserted:** hiding "Fuel spend trend" and moving "Top
  drivers by risk" up produced exactly
  `{"widgetKeys":[…,"fleet.top-drivers","fleet.top-vehicles"],"hiddenKeys":["fleet.spend-trend"]}` —
  singly encoded (the double-encoded-body trap), in the moved order, and the drawer
  closed on the 204.

  **A THIRD empty state, found by reading the gates rather than the screen.** The Dispatch TAB is
  gated on the `dispatch` section alone while `dispatch.live-map` additionally requires the `dispatch`
  MODULE, so an org that has not bought the module, whose user holds the section, passes the tab gate
  with nothing behind it. The first draft offered them a Customize button that opened a drawer on no
  rows and a Save that saved nothing. "Nothing to show here" now says so, with no control — and it is
  deliberately a different sentence from "No cards on this tab", which implies something they turned
  off and can turn back on.

  ⚠ **And its assertion was measuring the wrong thing.** `expect(html).not.toContain("Customize")`
  failed on CORRECT markup, because Vue keeps HTML comments in its output and the comment explaining
  why there is no Customize button contains the word "Customize". That is the lucky direction; the
  same mistake inverted passes on a page that really does offer the button. Whether a CONTROL exists
  is a question about buttons, and the helper now reads `wrapper.findAll("button")`.

  **Q-LM-F2 is untouched and still open** — `useDashboard.ts` still SELECTs `total_cost` for every
  caller, so the figures reach the browser whatever the page paints. It is LM-F2's, not LM10's.

- **2026-09-16 — D-LM8 AMENDED: the tween must OUTLAST the poll, not match it.** The owner reported
  markers "freezing and restarting every 5–6 seconds". They were right and the arithmetic was exact:
  `MOTION_DURATION_MS` was `5_000` and `LIVE_MAP_POLL_MS` is `5_000`, under a comment reading *"the
  tween is exactly as long as the gap it fills, so motion is continuous"*. **"Exactly" is the word
  that was wrong.** The poll timer fires at T+5000 and the board LANDS at T+5000+latency, so the
  tween ended in front of a dot that then had nothing to do until the response arrived;
  `tweensSettled` went true, `step()` stopped requesting frames, and the dead window every cycle was
  the round trip itself.

  **Measured in a browser rather than argued, before and after, 30 s each with the board delayed
  800 ms** (24 moving trucks, dev-bypass preview, `requestAnimationFrame` wrapped to record every
  frame):

  | | max gap between frames | freezes > 300 ms | time frozen | animating |
  |---|---|---|---|---|
  | duration == poll (the defect) | **599.9 ms** | 4 in 30 s | 2,300 ms | 91.6% |
  | duration == poll + budget | **9.4 ms** | **0** | **0 ms** | **100%** |

  Four freezes in 30 seconds is one per poll cycle, which is exactly what the owner described.

  **D-LM8a — the budget is 1.5 s, and the cost of it is exactly the budget.** The transport floor to
  the production host measured 97–168 ms over eight requests (`/api/version`, which does no work),
  and the board itself is three sequential queries that `useLiveMapBoard` records as ~1.0 s from a
  laptop — still never measured inside Railway, which remains the open item. ⚠ Simulated over 400
  cycles, a tween of `P + B` re-based every `P` settles where the dot trails the newest fix by
  precisely `B` of travel: **1.5 s, or 143 ft at 65 mph**, on top of the up-to-one-poll lag D-LM8
  already accepted. That is sub-pixel below zoom 14, while a dot that stops dead once a cycle is
  visible at every zoom. It also means the budget is not free and must not be inflated "to be safe".

  **The constants are now DERIVED** — `MOTION_DURATION_MS = LIVE_MAP_POLL_MS + MOTION_LATENCY_BUDGET_MS`
  — because the defect was two literals that agreed with each other and with nothing else. The test
  asserts the RELATIONSHIP; one asserting `6_500` would have passed on every day the map stuttered.

  ⚠ **AND THE FRAME LOOP'S STOP CONDITION HAD TO CHANGE WITH IT, which is the part that is easy to
  miss.** Once the tween outlasts the poll, no tween is ever finished when the next board re-bases
  it — so the clock-only `tweensSettled` would mean the rAF loop NEVER stops, and `step()`'s own
  comment ("a permanent rAF loop over a parked fleet would keep a laptop's GPU awake for a picture
  that is not changing") would have quietly become false. A tween is now settled when it has run its
  course **or has nowhere to go** (same place, same bearing). Measured over a PARKED fleet, 15 s:
  **3,107 frames before, 117 after — 96% fewer.** The old code interpolated a parked truck towards
  itself for five seconds out of every five, so this is strictly better than what it replaced rather
  than a cost of the fix.

  Four new tests, all four **proved by mutation**: reverting the duration to the poll interval fails
  the relationship test and the in-flight test; dropping the "nowhere to go" check fails the parked
  test; ignoring heading in it fails the turning-on-the-spot test. ⚠ A round trip slower than the
  budget brings the stutter back for the excess — the fix for that is measuring the board inside
  Railway, not a bigger constant.

- **2026-09-16 — D-DW5 IS OVERRULED: one live map, on the Dashboard's Dispatch tab.** `/live-map` is
  gone — the route, `LiveMapPage.vue`, the `dispatch.live-map` SURFACE entry and its sidebar icon, and
  `LiveMapPanel.vue`, which was the card-in-a-grid reading of this board. The widget catalogue keeps
  the key (same key, different catalogue: it names the entitlement the tab gates on) and carries
  `span: "workspace"`, a third value meaning the widget IS its tab. The full entry, the measurements
  and the two new `lint:surfaces` detectors are in `DESIGN-REFRESH-2026-09.md` §7 under **D-DR24**.

  ⚠ For this plan the consequence worth carrying forward is that **LM8's page and LM-T's tab are now
  one surface**: a defect in the board has one place to be fixed, `useLiveMapView` has one consumer
  rather than two, and anything written here about "the page" means the Dispatch tab.

- **2026-09-16 — D-DR25: the fleet list is a left rail, and D-DR7's dock is retired.** Search, the
  census (which is now the status filter itself), the ordering and the list are one column beside the
  map; the two corner panels and the bottom dock are gone, and with them D-DR6's `localStorage` panel
  memory. For this plan the parts that matter: **LM8's fleet list is still the keyboard's only route
  to a named truck** and is still mounted at every width — the rail is a permanent column at `lg` and
  an overlay below it, never `v-if`'d away — and **D-LM18's scope sentence now has two homes**,
  because below `lg` the rail is shut and a disclosure behind a button is one a dispatcher can miss
  for a whole shift. The dock's seven sortable columns became four orderings in a select
  (`sortVehicles`), which keeps "which truck has the oldest fix" rather than losing it with the
  columns. Measurements and the rest of the reasoning: `DESIGN-REFRESH-2026-09.md` §7, **D-DR25**.

- **2026-09-17 — D-LM8b: the tween is cut from the FIXES, and a board that repeats one is left
  alone.** The owner reported the markers still "slowing down every 4.7 seconds" after D-LM8a fixed
  the freeze, and they were right again. Measured on production rather than reasoned about:

  | | |
  |---|---|
  | moving trucks | 27 |
  | median age of their fix | **5.6 s** |
  | mean age · worst | 5.5 s · 13.6 s |

  Ages are uniform over the arrival interval, so a mean age of 5.5 s means fixes land about every
  **11 seconds** — against a **5-second** poll. **A moving truck therefore gets a new position on
  fewer than half the boards that mention it**, and `planTweens` re-based on every one of them:
  a repeat restarted a 6.5 s tween with almost nothing left to cover, so the dot crawled for that
  whole window and jumped when a real fix landed. D-LM8a's constant was right and its input was wrong.

  **Two changes, both in the same direction — let the data say it.** A board carrying a truck's
  existing `sampledAt` now leaves that truck's tween untouched; a board carrying a NEW fix animates
  over the interval the two fixes describe (plus D-LM8a's latency budget), capped at 15 s so a truck
  parked for an hour arrives rather than gliding for one. Duration therefore lives on the tween, not
  in a module constant.

  **Measured through the real module at 60fps over a minute of production-shaped boards:** velocity
  swing **127% → 21%** of the mean, and frames below half speed **1,204 → 4**. Pinned by
  "holds a steady speed instead of crawling on every repeated fix", which asserts the RATIO against
  the old behaviour rather than an absolute, so it cannot be satisfied by tuning a constant.

  ⚠ The lesson worth keeping: every unit test in `liveMapMotion.test.ts` passed throughout both
  defects. Each asks whether ONE tween is built correctly, and both defects lived in the SEQUENCE of
  them. What a reader sees is a speed, so there is now a test that measures a speed.

- **2026-09-17 — Item 3, the click freeze: NOT REPRODUCED, and the method is the deliverable.**
  The owner's worst item is "clicking a row sometimes freezes the whole page". It was measured before
  anything was changed, the way D-LM8b was. It did not happen once.

  The rig: `apps/web/dist` and `/api/…` served from ONE origin by a node stand-in (the recipe
  `HANDOFF-2026-09-17-OWNER-LIST.md` §3 records, because a playwright `route.fulfill` answers above
  the network stack and can never show a request queuing), 199 trucks on a board that moves every
  poll, production latencies — 175 ms per 512px jpeg tile, 1.0 s for the board. Two independent
  clocks: a wrapped `requestAnimationFrame`, which stops when the ANIMATION stops, and a 100 ms
  `setInterval`, which stops only when the MAIN THREAD is blocked. A freeze the owner would call
  "the whole page" is the second one stopping.

  | pattern | clicks | worst frame gap | worst main-thread gap | worst board gap (poll is 6.0 s) |
  |---|---|---|---|---|
  | one click every 250 ms | 30 | 66 ms | 114 ms | 6,041 ms |
  | as fast as playwright dispatches | 60 | 9 ms | 108 ms | — |
  | the SAME row every 80 ms, so every animation is interrupted mid-flight | 60 | 9 ms | 109 ms | — |
  | opposite ends of the fleet, every 120 ms | 40 | 9 ms | 117 ms | — |
  | one click every 700 ms for a minute | 85 | 11 ms | 119 ms | 6,096 ms |
  | one click every 400 ms, CPU throttled ×6 | 60 | 76 ms | 154 ms | 6,199 ms |

  Nothing stalled, the page answered `1 + 1` after every pattern, and the heap did not move (37.8 MB
  throughout). **Two candidate causes are therefore dead rather than merely unproven.** The rAF tween
  loop does NOT fight the camera animation — both drive `setData` on the same source and the frame
  gap never exceeded 76 ms. And the tile burst does NOT starve the board: Chrome opens seven sockets
  to the origin and the board's own `requestStart - startTime` stayed at **1–2 ms** through a click
  storm, because Chrome ranks a `fetch` above an image in its socket pool.

  ⚠ **What is left is the half of the path this rig cannot see: our own API.** See D-LM19 — which is
  where the measurement went instead.

- **2026-09-17 — D-LM19: the camera arrives at a truck it cannot see, and only travels to one it can.**
  Measuring item 3 did not find the freeze; it found that **one row click fetched a median of 48 map
  tiles and as many as 272**, against the **nine** a zoom-11 viewport actually contains.

  `flyTo()` called maplibre's `easeTo`, which interpolates centre and zoom linearly — so selecting a
  truck two states away dragged a zoom-11 viewport across every tile in between. Each of those is a
  real request to `/api/fueling/map-tiles/:z/:x/:y`, which is a PROXY: one upstream HERE fetch and a
  ~47 KB buffer per tile, on the same Railway service that answers the board. Twenty clicks was a
  thousand upstream fetches against our HERE quota.

  | camera | tiles/click, median | worst | 12 clicks |
  |---|---|---|---|
  | `easeTo` always (what shipped) | 48 | 272 | 804 |
  | `flyTo` always | 48 | 86 | 611 |
  | `easeTo` when visible, `jumpTo` when not | 9 | 73 | 163 |
  | **`flyTo` when visible, `jumpTo` when not** | **9** | **41** | **134** |

  **The rule is about the reader, and the tile count only agrees with it.** The animation exists so a
  dispatcher does not lose their place — they watch the map travel and arrive knowing how the new view
  relates to the old. That only works when the destination was ALREADY ON SCREEN; a truck two states
  away is not somewhere the eye can follow the camera to, so the animation is a blur of intermediate
  tiles ending somewhere the reader has to re-orient in anyway. Visible, animate. Not visible, arrive.

  ⚠ `flyTo` rather than `easeTo` for the animated half is not a synonym: van Wijk's path zooms out
  over the distance and back in, so the one case that still animates a long move — the reader sitting
  at the fitted fleet view, watching the map dive into a truck — costs 41 tiles instead of 73.

  ⚠ The decision is `liveMapCamera.ts` and NOT four lines in `LiveMapCanvas.vue`, because that file
  is stubbed by every test that mounts this surface (maplibre needs WebGL). A rule kept there is a
  rule no assertion in this repo can reach — which is exactly where both of D-LM8's stutter defects
  lived. Six tests, three **proved by mutation**: always-animate fails the two off-screen cases,
  a longitude-only visibility test fails the latitude case, and assigning the zoom rather than raising
  it fails the reader's-own-zoom case.

  ⚠ **This is NOT a fix for item 3 and must not be recorded as one.** It is a measured defect on the
  exact path the owner named, and it is the leading remaining hypothesis for the freeze — the browser
  survives the tile storm, and the API's side of it has never been measured. Item 3 stays open.
- **2026-09-17 — D-LM20: the rail's right-hand slot carries the speed while the feed keeps up, and
  the fix age the moment it does not.** The owner's item 2 was "show SPEED per truck in the rail, not
  '3s ago'", and they are right about the defect: on a healthy board that slot read "1s ago", "3s
  ago", "8s ago" down two hundred rows — a column of noise that separated no truck from any other.

  ⚠ It is NOT simply "speed instead of age", because D-LM10 requires the fix age to be visible per
  truck and that requirement has not stopped being true. A truck is `moving` if its fix is inside the
  offline bound, which is fifteen minutes — so a truck CAN be moving on a fix nobody has refreshed in
  twenty, and "62 mph" alone would be a lie with a number on it. `rowMetric` therefore shows the
  speed while the fix is fresh and the age as soon as it is not, so on a healthy board almost every
  row shows a speed (the change the owner asked for) and the one truck that has gone quiet says so
  (what D-LM10 exists for). Neither requirement was traded.

  ⚠ The seam is **30 s**, derived rather than picked: D-LM8b measured this fleet's moving trucks
  being re-fixed about every 11 s, worst 13.6 s, so twice the worst measured interval is where the
  feed has demonstrably skipped a report. ⚠ And a fresh ping carrying NO speed shows its age too —
  `speedMph` is nullable in `vehicle_positions` and absent is not zero, so "0 mph" there would be an
  invented measurement.

- **2026-09-17 — D-LM21: clearing the search closes the truck card (the owner's item 4).** Searching
  is how a dispatcher finds ONE truck — type a unit, the rail narrows, click it, the card opens.
  Clearing the box is how they say they are done with it, and the card used to stay, over a map still
  parked on a truck nobody was looking for, with nothing on screen admitting the two were connected.

  ⚠ On CLEARING, not on BEING EMPTY: an empty search is also the state the rail opens in, so the
  second reading would mean a truck picked off the map could never stay selected. ⚠ And deliberately
  not generalised to "the selection left the filtered list", which was the tempting one-rule version
  and is wrong twice — clearing a search makes the list LARGER, so that rule does nothing on the
  gesture the owner named, while a census button pressed with a truck already open would shut a card
  the reader had not finished reading. Four tests, two **proved by mutation**.

- **2026-09-17 — item 6, half shipped and half asked back: `Q-LM19`.** The owner asked to "replace
  the scope paragraph + '171 of 171 shown' with a plain total".

  **The count is done.** "171 of 171 shown" is a fraction whose two halves are equal, which is how it
  read on every unfiltered board — most of them. It is now "171 trucks", and the fraction survives for
  the case it was written for: "42 of 171 trucks" when the list really is narrowed.

  **The paragraph is not this step's to delete, and that is `Q-LM19`.** It is two recorded decisions
  with stated reasons, not decoration. D-LM18 requires the board to say out loud that it is
  fleet-wide — "a dispatcher who believes they are seeing only their own trucks will read an empty
  column as 'nothing of mine is late'" — and D-LM9b requires the freshness clause, read from
  `LIVE_MAP_POLL_MS` so the sentence cannot quietly become false. Deleting either silently is exactly
  the move this repo's register calls a workaround.

  The candidates, with a recommendation:

  | | what the rail's foot becomes | costs |
  |---|---|---|
  | (a) leave both | today's two lines | the owner's complaint stands; the reason sentence is ~150 characters at `text-2xs` in a 320px rail, which is four lines |
  | (b) **shorten the scope to its first clause, keep the reason reachable** | "Every truck in the fleet · 171 trucks · refreshes every 5s", the full reason on the tab's own help | D-LM18 satisfied by the clause that carries the disclosure; needs somewhere for the reason, and there is no help surface on this tab today |
  | (c) drop the reason, keep the disclosure | "Showing every truck in the fleet." + "171 trucks · refreshes every 5s" | one line instead of four; loses *why*, which is the half that tells a dispatcher it is temporary |
  | (d) do as asked — total only | "171 trucks" | D-LM18 and D-LM9b both gone. A dispatcher can no longer tell whose trucks these are, which is the misreading D-LM18 was written to prevent |

  **Recommended: (c).** The disclosure is the half D-LM18 is actually about, it is one line, and the
  reason belongs with the carrier's McLeod grant rather than on a dispatcher's screen every day. ⚠ It
  needs an API change, not a client one — `scopeReason` is one string from `FLEET_WIDE_SCOPE_REASON`
  in `apps/api/src/modules/livemap/liveMapBoard.ts`, and splitting the server's sentence in the
  browser would be a copy with a delay fuse. **(d) is the owner's to choose and is recorded here so
  that choosing it is a decision rather than a deletion.**
- **2026-09-17 — D-LM22: the basemap opens from a button (the owner's item 5).** Map / Satellite /
  Terrain were a permanently-lit segmented row in the map's control rail. They are now one button
  naming the active basemap, opening the same three through `KebabMenu`.

  ⚠ **This overrules `LiveMapControls.vue`'s own written reasoning, and that reasoning is kept in the
  file rather than deleted.** It argued: "three options, all always available, one active — that is a
  radio group, and comp (7) draws it as one. A dropdown would hide two of three choices behind a
  click to save 90px on a surface whose whole point is that it is large." The 90px was the wrong
  quantity. A basemap is chosen rarely and then left alone for a shift, so a control sized for a
  once-a-day decision was sitting at full size all day on a canvas that IS the product. The trigger
  still NAMES the active basemap, so nothing the row told anybody is hidden.

  ⚠ D-DR8 is untouched: there is still no Day/Night entry, because the road map follows the reader's
  colour scheme and a fourth entry would put that answer on screen twice. The control renders
  `BASEMAP_CHOICES` rather than a list of its own, so it cannot grow one without the catalogue doing.

  ⚠ **Two attempts at marking the active entry inside the panel both failed, and the second failed
  SILENTLY — which is the part worth carrying forward.** A tick beside the active label centred its
  own row and left the other two on a different edge, because `.kebab-item`'s `text-left` is in
  `@layer components` and loses to `AppButton`'s `justify-center`. A brand tint then did nothing at
  all: read back from the rendered DOM rather than looked at, all three entries measured
  `background-color: oklch(1 0 0)`, one colour and `font-weight: 600`. A call-site utility and the
  button's own utility share a cascade layer, so Tailwind's ordering decides, not the class
  attribute. `AppButton`'s own comments say three times that an override at a call site means a
  variant is missing; this is the fourth. The panel therefore marks the active entry with
  `aria-current` alone and the trigger carries the visual answer. Six tests, three **proved by
  mutation**: restoring the permanent row fails five, a trigger that stops naming the basemap fails
  the one about hiding, and a fourth Day/Night entry fails two.
- **2026-09-17 — D-LM23: "only trucks in view" is a SCOPE, and the census follows it (item 7).** The
  rail gains a toggle beside the census; when it is on, the list and the four counts describe what
  the map is showing rather than the fleet.

  **The order is the design, and it is why this is not a fourth field inside `filters`.** The census
  counts `scoped`; the list shows `filtered`. Pressing "Moving" therefore narrows the list without
  touching the four numbers beside it, which is what makes the census usable as a filter at all —
  fold the viewport in with the others and the census counts its own output, so every press zeroes
  the other three.

  ⚠ **Q from the handoff, RULED: the census FOLLOWS the viewport.** A count on a button has to
  describe what pressing that button gives you; a rail scoped to Chicago showing "Offline 34" for a
  fleet-wide 34 is a button lying about its own effect. The cost is real and is stated rather than
  hidden — a dispatcher zoomed into one metro reads "Offline 0" and could take it for the fleet — and
  the foot's total is what keeps it honest: it says "12 of 199 trucks", so the 187 the counts exclude
  are on screen as a number beside them. The rail is therefore passed `vehicles` (the whole fleet,
  for that denominator) and `counts` (already scoped), not one list doing both jobs.

  ⚠ `moveend` and not `move`. The map is in motion for the whole of a selection animation and for
  every frame of a drag, so `move` would re-filter the rail sixty times a second and hand two hundred
  rows to Vue on each — the list would shimmer while the hand was still down.

  ⚠ The canvas emits its bounds ON LOAD as well as on every settle, and the toggle switches on using
  the bounds already reported. Over a still map there is no next `moveend`, so without both halves
  the filter would appear to do nothing until the reader happened to pan.

  ⚠ A selected truck's card SURVIVES panning away from it — `selected` resolves against the whole
  board, not the scope. The panel answers "what is 204 doing", and that does not stop being true
  because the camera moved; it would also flicker, since `moveend` fires on every pan.

  ⚠ **A third empty state, and it was found by WALKING the surface rather than reasoning about it.**
  Zoom into open country with the toggle on and the rail emptied under "No trucks match these
  filters" — which sends a reader hunting through a census where nothing is pressed. The camera is
  the filter in that case, so the sentence names the camera and both ways out of it. Eleven tests,
  five **proved by mutation**: counting `filtered` instead of `scoped` fails the census-independence
  case, counting `vehicles` fails the follows-the-viewport case, resolving `selected` against the
  scope fails the panned-away case, treating `null` as an empty rectangle fails the off case, and one
  empty sentence for both fails the camera case.
- **2026-09-17 — D-LM24: bigger markers, and a colour per status that survives colour blindness and
  both schemes (the owner's item 9).** `SIZE` 24 → 30; `parked` moves off its grey to `warning-600`;
  `offline` moves to `neutral-400`. Everything below is measured, and three of the measurements
  contradicted what the code already said about itself.

  **Size. The comment's second claim was false in the view the map OPENS in.** It read "24 px is the
  smallest an arrow stays readable as a DIRECTION rather than a blob, and the largest that leaves 199
  of them legible over a metro area". Measured against the 198 positions production holds today,
  projected into the map's real box beside the rail (1132×780 at 1512×900) with
  `fitBounds(padding: 56, maxZoom: 9)`:

  | zoom | what it is | trucks touching another at 24 px | at 30 px |
  |---|---|---|---|
  | 3.87 | the fitted fleet, the default view | **77.2%** | 83.8% |
  | 5 | a region | 46.2% | 49.7% |
  | 9 | a corridor, where markers are actually read | 25.4% | **25.4%** |

  The default view is already three-quarters overlapped at 24 px, so the size was not buying the
  legibility claimed; and above zoom 9 the figure does not move with size at all, because those 480
  pairs are trucks at the same coordinates in a yard. 30 costs 6.6 points where the map is already a
  pile and nothing where it is read. 24 stays the FLOOR for the arrow reading as a direction.

  **Colour, measured AS PAINTED — which changed the answer.** The first pass compared raw tokens and
  named `parked`/`offline` as the collapsed pair. But offline is drawn at `icon-opacity: 0.65`, so an
  offline dot is its token blended with the basemap; composite it and the real weak pair is different:

  | scheme | worst pair before | after |
  |---|---|---|
  | light | `stopped`/`parked` **0.076** | `moving`/`stopped` 0.117 |
  | dark | `moving`/`offline` **0.021** (deuteranopia) | `moving`/`offline` 0.079 |

  ⚠ **The dark scheme was the worse of the two and nobody had ever looked at it.** A moving truck and
  an offline one measured **0.021** apart for a red-blind dispatcher — one colour — because a green
  marker at full opacity and a grey one at 0.65 over a dark basemap land in the same place.

  ⚠ **Two candidates were rejected BY MEASUREMENT, and both were the ones taste would have picked.**
  `accent-600` (violet) for parked collapsed against offline at **0.016** under deuteranopia, worse
  than what it replaced. `neutral-700` (a darker grey) fixed parked/offline and then collapsed against
  `success-600` at **0.037** — dark green and dark grey are one colour to a red-blind reader.

  ⚠ **`parked` is amber and `offline` is deliberately not.** `badges.ts` records why offline must
  never be alarm-coloured: 54 of 199 trucks rendered offline the day the board first had data, and a
  page a fifth alarm-coloured teaches its reader to stop reading colour. That argument is about
  POPULATION, so it was re-measured rather than inherited — production 2026-09-16: stopped 123,
  offline 59, moving 17, **parked 1**. `parked` is a ten-minute transitional band that almost nothing
  is ever in, so amber there colours half a percent of a board and the objection does not reach it.

  ⚠ **The cost, stated.** Offline on `neutral-400` is fainter against a LIGHT basemap — ΔE to the
  basemap falls 0.181 → 0.145, a fifth. The white keyline and the larger marker both work against
  that, and an offline position is one we deliberately no longer stand behind, but it is a cost.

  ⚠ `vehicleStateTone` moved with it. The rail shows a census DOT from `liveMapLayer.ts` beside a
  state BADGE from `badges.ts`, so the two disagreeing is visible in one glance in one column.
  Three tests, two **proved by mutation** — putting `parked` back on a grey fails the one-ramp-per-state
  test, and making `offline` amber fails the population test. Rendered and looked at in BOTH schemes
  over a flat basemap, which is how the keyline's job in each was checked.
