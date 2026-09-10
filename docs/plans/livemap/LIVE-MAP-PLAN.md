# Live map + role-based dashboards — execution plan

**Status: READY TO EXECUTE.** Written 2026-09-10. Decision IDs are `D-LM*` (the map and its
collector) and `D-DW*` (the dashboard widget catalogue). Cite them the way `D-SAM2` and `D-SURF3`
are cited.

**Companion plan.** `docs/plans/mcleod/MCLEOD-COLLECTOR-PLAN.md` owns *how McLeod is read* — change
detection, cadence, isolation, and the live/sandbox split (`D-MCC*`). This plan owns *what the map
is*. Where they overlap — LM0's grant and LM1's change detection — this document defers.

**There are no open questions in this document.** Every question the research raised was closed
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
          (stats/feed, 30 s)     (1 row per vehicle) │
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

- **D-LM1 — positions come from the Samsara vehicle-stats cursor feed, at a 30-second tier.**
  Not a webhook (none exists, §0.1). Not McLeod's `mc_position` (D-LM2). Not
  `/fleet/vehicles/locations/feed`, which Samsara's own reference deprecates: *"an older API that
  does not combine GPS data with onboard diagnostics. Try our new Vehicle Stats API instead."*
  The endpoint is the one the `stats` tier already calls; this adds a second tier with **its own
  cursor row**, because the two have different freshness needs and D-SAM6 makes freshness per-feed.

  **The interval is the vendor's own recommendation, not a guess.** Samsara's TMS integration guide
  says to poll this endpoint **every 5–30 seconds** for live tracking, and their Kafka
  documentation states the underlying GPS updates **every 5 seconds while a vehicle is on** — so
  there is real data underneath a fast poll, not a repeated identical answer. 30s is the
  conservative end of the vendor's range and is what ships; the env var makes it tunable without a
  deploy of new code.

  Rate cost is settled arithmetic: the published limit is **50 requests per second per
  organization**, and a steady-state re-poll of the whole fleet drains in **one page** (measured
  2026-09-01, 192 vehicles). A 30-second tier therefore runs at **0.033 req/s — 0.067% of the
  limit**. The seed costs 12 pages, once.

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
  by D-LM1's tier cannot justify a socket to read it. The map polls at 20s with vue-query and
  pauses when the tab is hidden — see D-LM9b for how the three intervals add up.

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
  (**30 s**), and the browser poll (**20 s**). Worst case a moving truck's dot is **~55 seconds**
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
`SAMSARA_POSITIONS_SYNC_SECONDS`, default **30** (D-LM1 — the vendor's own recommended range is
5–30 s). It runs in the `api` service only — every other service from `railway.json` gets
`RUN_SCHEDULERS_IN_PROCESS=false` before its first deploy, and no gate can see a Railway variable
(`docs/WORKER-DEPLOYMENT.md`).

**Two failure modes this step must not reproduce, both already paid for:**

- **Separate cursor rows are not optional.** Two tiers reading one feed need two cursors. Sharing
  one would let the 30-second positions tier consume the deltas the 20-minute stats tier needs, and
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
state. `requestAnimationFrame` interpolation between 20s polls, paused on hidden tab. Per-truck
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
