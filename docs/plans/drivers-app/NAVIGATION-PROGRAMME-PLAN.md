# FuelGuard Commercial Navigation Programme

**Status:** planned; implementation not started beyond the NP0 MapLibre spike and the existing
server-side HERE/fuel-planning services

**Decision date:** 2026-08-07

**Product goal:** safe, precise, offline-capable commercial-truck navigation integrated with an
accepted FuelGuard load, at an enterprise quality level comparable to the best freight-driver apps

**Scope owner:** Navigation module (`navigation` entitlement; `nav.preview` remains
`released:false` until the GA gate in NP7)

**Parent decisions:** `DRIVER-APP-PLAN.md` D52 and `DRIVER-APP-DECISIONS-2026-08-07.md` D-PM5

**Supersedes:** the display-only/MapLibre option left open in `DRIVER-APP-PLAN.md` §8 and §15

---

## 1. Executive decision

FuelGuard will build active turn-by-turn navigation on **HERE SDK Navigate Edition**, using HERE's
native `VisualNavigator`/`Navigator`, map data, truck warners, route progress, voice guidance,
offline maps and offline routing.

- **HERE owns the safety path end to end:** truck-route calculation, map data, map matching,
  restriction warnings, commercial speed limits, maneuvers, traffic refresh and rerouting.
- **FuelGuard owns the operating context:** authoritative truck/trailer/load profile, route approval,
  mandatory load and fuel stops, HOS/fuel policy, facility intelligence, driver workflow, audit,
  observability and dispatch escalation.
- **MapLibre is a development/non-driving preview only.** The existing NP0 spike may remain while
  the native bridge is built, but it is not a navigation engine and must not appear in the active
  guidance path. Remove its runtime dependency before GA unless a separately justified, tested
  non-driving map surface still uses it.
- **Google Maps is not part of the commercial-navigation decision path.** Google's documented route
  vehicle types do not include a truck profile with height, weight, axle and hazardous-goods
  restrictions. A generic consumer-navigation deep link may be offered only as an explicitly
  labelled address lookup while parked; it is never a "safe fallback" for an active truck route.

The product must never promise that a route is guaranteed legal. It may say **Commercial route
validated for Unit X / Trailer Y** and must always tell the driver to obey signs, law enforcement,
facility instructions and current road conditions.

---

## 2. What “Uber Freight quality” means here

### 2.1 Verified public research — no assumptions

Uber Freight's public materials show a strong **load-execution and visibility workflow**, not a
documented truck-safe turn-by-turn engine:

| Verified behavior | Evidence | FuelGuard lesson |
|---|---|---|
| The current app is marketed around load booking, facility details, POD, real-time tracking, fleet management, support and scorecards. Its current store description does **not** advertise commercial turn-by-turn navigation. | [Current Google Play listing](https://play.google.com/store/apps/details?id=com.ubercab.freight&hl=en_US) | Benchmark Uber Freight for workflow and operational clarity; benchmark HERE for navigation safety. Do not invent an Uber Freight navigation architecture from the Uber rideshare app. |
| Uber Freight recommends app location **plus another automated source such as an ELD**; multiple sources improve real-time coverage. Truck and trailer identity must be supplied early so updates match the load. | [Uber Freight automated-tracking guidance](https://help.uber.com/freight/carrier/article/what-are-the-benefits-of-using-an-automated-tracking-source?nodeId=3ca48cbf-808c-4e2b-993a-7d9b9fde48f0) | Fuse phone navigation position with Samsara/ELD position, preserve provenance, and surface disagreement instead of silently choosing one. |
| The app records five explicit load milestones and offers a driver-triggered live status update when automation is wrong. | [Uber Freight tracking sources](https://help.uber.com/freight/carrier/article/what-automated-tracking-sources-does-uber-freight-use?nodeId=f7bdeccb-83d1-422c-88cf-12daa7d3c3eb) | Automatic geofence transitions need a visible manual correction/escalation path. |
| Facility intelligence includes ratings/reviews and details such as parking, scales and amenities; feedback specifically covers turning room and finding the entrance. | [Uber Freight facility ratings](https://www.uberfreight.com/blog/facility-ratings), [facility insights](https://www.uberfreight.com/en-US/blog/lessons-learned-from-facility-ratings) | Last-mile entrance quality is part of navigation quality. Build verified truck entrances and structured driver feedback, not just street-address geocoding. |
| GPS arrival/departure data supports detention evidence, and shipment location is shared with operations. | [Uber Freight detention workflow](https://www.uberfreight.com/en-US/blog/how-to-request-detention-on-uber-freight), [location sharing](https://www.uberfreight.com/en-US/blog/shipment-locations-uber-freight) | Navigation events should drive auditable arrival/departure/dwell workflows and reduce dispatcher check calls. |
| Uber Freight discloses foreground/background precise location collection, sharing and its operational purposes. | [Uber Freight Privacy Notice](https://www.uber.com/legal/id/document/?country=united-states&lang=en&name=uber-freight-privacy-notice) | Permission, collection windows, sharing and retention must be explicit. FuelGuard should collect less by tying tracking to an active duty/load/navigation session. |

**Research conclusion:** no authoritative public source reviewed on 2026-08-07 establishes that the
Uber Freight carrier app performs native, dimension-aware, hazardous-goods-aware truck guidance.
FuelGuard therefore adopts its proven workflow patterns—dual-source visibility, facility knowledge,
milestones, detention evidence and fast support—but does not use it as the safety specification.

### 2.2 FuelGuard benchmark

“Uber Freight quality” is an outcome bar:

1. A driver can start the correct load and commercial route with one deliberate action.
2. Dispatch and the driver see the same approved route, stops, ETA and exceptions.
3. Navigation survives weak/no connectivity and app restarts without losing the active trip.
4. The driver is warned about relevant truck restrictions and never receives a route with an
   unreviewed critical violation.
5. Facility approach, gate and truck entrance are as clear as the highway route.
6. Automatic status is useful, but a driver can correct it safely and every correction is audited.
7. When confidence falls, the app says so and offers a safe escalation—not false precision.

---

## 3. Baseline audit — what exists and what is unsafe to assume

| Area | Current state | Required change |
|---|---|---|
| Driver map | `NavMap.tsx` renders a hardcoded HERE-shaped line over MapLibre; `NavigationScreen.tsx` contains sample load/fuel data. | Keep DEV-only as NP0. It may not ship as navigation or carry “truck-safe” copy. |
| Routing | `buildTruckRouteUrl()` calls HERE Routing v8 in truck/fast mode with gross weight, height, width, length, axle count, hazmat and tunnel options. | Expand the combination profile and request route handles, notices, notice spans, time-dependent information and required route metadata. |
| Safety notices | `parseHereRoute()` ignores route/section notices entirely. | Parse and persist every notice. Reject every `critical` route by default; no driver can override it. |
| Weight | `effectiveTruckProfile()` silently caps an entered load weight to the configured legal default. | Delete the cap. An impossible/over-policy value is a validation error requiring dispatch correction; routing must use the actual known current weight. |
| Combination profile | Vehicle overrides supply only height/length/width/axle count; trailer properties are not composed. | Build the effective tractor+trailer profile from the active duty segment and load. |
| Load safety inputs | `loads.hazmat` is a boolean and the load has no authoritative current/gross/axle weight or HERE hazardous-goods classes. | Add typed, provenance-bearing load routing inputs. A boolean is not sufficient for commercial navigation. |
| Cache | `route_geometries` returns any key match without a freshness check; retention may keep it for months. | Separate durable approved route intent from short-lived live calculation. Never reuse old traffic, closure, notice or ETA data as current. |
| Route delivery | `/api/fueling/plan` is manager-only; `fuel_plans` is history, not attached/versioned/published to a load. | Add a driver-scoped, load-bound navigation control plane and immutable route/event history. |
| Guidance | No map matching, voice, lane/sign guidance, CVR speed, truck warners, deviation or offline reroute exists. | Native HERE Navigate bridge in NP3–NP5. |

The baseline server code remains valuable; “already built server-side brain” means reusable fuel/HOS
logic and an early HERE request builder, not a finished safety system.

---

## 4. Locked navigation decisions

| ID | Decision |
|---|---|
| **NAV-1** | Active guidance uses HERE SDK Navigate Edition on iOS and Android. One provider owns route, map, map matching and maneuvers. |
| **NAV-2** | Server planning uses HERE Routing v8 and returns a short-lived HERE route handle. The phone imports that handle into HERE SDK before guidance. Because HERE route handles can be invalidated and are not persistent storage, the server stores the complete route intent/profile/audit snapshot and recalculates a fresh handle at activation. |
| **NAV-3** | A route with any unclassified or `critical` HERE notice is not activatable. Only an allowlisted `info` notice may pass, and its policy decision is recorded. New notice codes fail closed until classified. |
| **NAV-4** | No silent vehicle defaults in active guidance. Defaults may create a dispatcher draft, visibly marked `profile_incomplete`; a driver cannot start it until every safety-critical field is verified. |
| **NAV-5** | The effective profile is the physical combination actually in service: tractor + trailer + load + hazardous goods + permits/policy. The accepted load's duty-session equipment is the identity anchor. |
| **NAV-6** | Stable route intent can be persisted; live traffic, closures, notices, ETA and route handles cannot. Recalculate at activation and refresh during the trip. |
| **NAV-7** | Mandatory load stops and dispatch-locked fuel stops survive traffic optimization. A reroute may alter the corridor between locked stops, never delete/reorder them silently. |
| **NAV-8** | When online, use traffic-aware HERE routing and controlled dynamic alternatives. When offline, use downloaded/cached HERE truck data and clearly label traffic as unavailable. |
| **NAV-9** | Location collection starts only after the driver starts duty/load navigation and stops at navigation/load/duty completion, subject to the explicit carrier policy disclosed to the driver. No covert always-on tracking. |
| **NAV-10** | Fuse HERE phone position and Samsara/ELD position for operational visibility. HERE device position drives immediate guidance; telemetry corroborates asset identity and shipment visibility. Disagreement produces a confidence event, not an averaged fictitious point. |
| **NAV-11** | In motion, navigation is voice/glance-first. Text entry, messaging, document capture, route editing and detailed browsing are locked; emergency/dispatch contact and safety-critical warnings remain available. |
| **NAV-12** | No consumer car-navigation fallback is labelled truck-safe. If navigation cannot continue safely, preserve the last validated route, announce degraded mode, show a safe-stop/dispatch action and continue only with available offline HERE data. |
| **NAV-13** | Every active route is reproducible from its audit record: profile values + provenance, stops, policies, HERE request/version/data version, notices and disposition, route version, publisher and acknowledgements. |
| **NAV-14** | Navigation ships by staged entitlement/feature rollout with a remote kill switch independent from the ordinary UI flag. The kill switch stops new guidance without erasing active-trip evidence. |
| **NAV-15** | One device holds the active guidance lease for a driver/load. Starting on another device requires an explicit, audited handoff that ends the old lease; two phones cannot simultaneously publish authoritative navigation events. |

---

## 5. Safety-critical domain model

### 5.1 Verified combination profile

Create one shared Zod contract, `navigationContract.ts`, used by web, API and driver app. The
effective snapshot must include:

- `vehicleId`, `trailerId`, `dutySessionId`, `equipmentSegmentId`, `loadId`;
- overall height, width and length, plus trailer count/length where HERE supports them;
- empty, current and maximum gross weight;
- axle count, per-axle weight and axle-group weights when known/applicable;
- tire count or other restriction inputs supported by the contracted HERE version where relevant;
- HERE hazardous-goods classes and tunnel category, derived from reviewed load/hazmat data;
- commercial status, emissions/permit attributes and fleet avoidance policy where applicable;
- value provenance (`measured`, `vehicle_master`, `trailer_master`, `load`, `telematics`,
  `dispatcher_verified`) and `verifiedAt` for every safety-critical field;
- a deterministic profile hash used by route validation and audit.

Validation rules:

1. Use the **maximum physical dimension** of the actual combination, not the tractor field alone.
2. Use actual known current weight for current restrictions and rated gross weight where HERE needs
   maximum capability. Never reduce either to make a route calculate.
3. Reject physically impossible, contradictory or expired values.
4. Hazmat `true` without classified goods is `profile_incomplete`, never “other” by convenience.
5. A trailer swap or material weight/hazmat change invalidates the active profile and route.
6. Dispatch can correct inputs with reason and audit; dispatch cannot waive a critical route notice.

### 5.2 Stop and facility model

Street addresses are not enough for a 70-foot combination. Add:

- verified truck entrance coordinate and approach bearing;
- entrance source/confidence and last verification date;
- gate name/number, side-of-street hint and private-road authorization;
- receiving/shipping hours, appointment window and contact instructions;
- structured attributes: turning room, overnight parking, staging, scale, restroom, security gate;
- driver feedback: wrong entrance, gate moved/closed, no truck access, tight turn, bad pin;
- a moderation state so unverified crowd reports cannot instantly alter every route.

Use the verified entrance as the navigation waypoint while retaining the legal street address for
documents. Where no verified entrance exists, show `Entrance not verified` and let dispatch review
the HERE alternatives before release.

---

## 6. Two-plane architecture

```text
Dispatch / API planning plane
  accepted load + duty equipment + reviewed hazmat + facility entrances
       -> verified combination profile
       -> HERE Routing v8 (truck, traffic-aware, routeHandle, notices/spans)
       -> FuelGuard safety policy (critical notice = reject)
       -> versioned route publication + mandatory stops + audit snapshot
                                  |
                                  v
Driver guidance plane (HERE Navigate)
  import fresh routeHandle -> VisualNavigator -> map matching / voice / warners
  -> route progress / deviation / traffic alternative / offline routing
                                  |
                                  v
Operations and evidence plane
  phone navigation events + Samsara/ELD corroboration
  -> ETA / milestones / geofence arrival / dwell / exceptions / SLO telemetry
```

**Consistency rule:** server and phone use the same normalized profile and policy version. The
backend route handle is imported into the SDK rather than redrawing a server polyline as if it were
a navigable route. If an SDK upgrade changes import/profile behavior, the compatibility suite must
pass before rollout.

### 6.1 Proposed persistent entities

- `navigation_routes`: org/load/driver/duty binding, monotonically increasing version, status,
  route intent, profile snapshot/hash, mandatory stops, approved geometry summary, provider/data
  versions, notice disposition, publisher and timestamps.
- `navigation_route_events`: immutable state/events (`published`, `acknowledged`, `activated`,
  `deviated`, `reroute_proposed`, `reroute_accepted`, `restriction_warning`, `degraded`, `arrived`,
  `completed`, `superseded`, `canceled`). Client UUID makes ingestion replay-safe.
- `facility_entrances`: verified/candidate truck entrance plus moderation and provenance.
- `navigation_location_samples`: optional short-retention, coarse operational samples—not the
  high-frequency guidance stream. High-frequency points stay on device unless a safety/claims
  event requires a bounded evidence window.

Route state machine:

```text
draft -> validating -> validated -> published -> acknowledged -> active -> completed
                    \-> rejected          \-> superseded         \-> degraded
```

Only one published/active version per load. Every replacement references `supersedes_route_id`.

### 6.2 Driver API

- `GET /api/me/navigation/active` — driver-owned current route publication and policy.
- `POST /api/me/navigation/:id/acknowledge` — profile/route preview acknowledged while parked.
- `POST /api/me/navigation/:id/activate` — revalidates load, duty equipment and route freshness;
  returns a fresh short-lived route handle, offline-data requirements and a device-bound active
  guidance lease.
- `POST /api/me/navigation/:id/events` — bounded, idempotent event batch; no arbitrary driver ID.
- `POST /api/me/navigation/:id/deviation` — asks the server policy whether to return to route,
  recalculate between locked stops or escalate.
- `POST /api/me/navigation/:id/report` — wrong entrance/restriction/closure/unsafe instruction.
- `POST /api/me/navigation/:id/complete` — closes guidance; load completion remains its own
  lifecycle action and is not forged by navigation alone.

All endpoints require driver role, navigation entitlement, released feature, load ownership and
active duty/equipment match. Direct PostgREST writes are denied; service/RPC writes append audit.
Event batches and completion require the active guidance lease; takeover revokes the old lease and
is visible to both the driver and dispatch.

---

## 7. Route calculation and rerouting policy

### 7.1 Online calculation

Request at minimum:

- truck transport mode and traffic-aware fastest routing at the real departure time;
- all contracted combination properties from §5.1;
- hazardous goods/tunnel category and carrier avoidance policy;
- route handle, polyline, summary, localized actions/instructions;
- route/section notices and `spans=notices` so a violation is locatable;
- time-dependent violations/no-through restrictions where supported and operationally relevant;
- route/data versions needed for audit and compatibility diagnostics.

Response policy:

1. Parse response with a strict shared schema. Unknown response shapes fail closed.
2. Zero `critical` notices is required for `validated`.
3. New/unknown notice codes are quarantined and alert engineering; they never become silently safe.
4. A restriction at a customer waypoint requires an explicit facility exception workflow and a
   safe approach/stop instruction; it cannot be buried in a maneuver list.
5. Return at most two dispatcher-comprehensible alternatives with reason labels—not a route picker
   that asks the driver to interpret truck legality.

### 7.2 Freshness and caching

- Persist the approved intent, profile and geometry for comparison/audit.
- Do not use an old cached response as current traffic/closure/notice truth.
- Activation always performs a fresh online validation when connected.
- Route handles are short-lived transfer artifacts. Do not persist them as the route record or
  assume they survive more than a few hours.
- During guidance use HERE traffic refresh/dynamic alternatives. A materially changed route is
  checked against locked stops and the same safety policy before adoption.
- Map/SDK update state is captured on the session. Installed HERE maps are checked and incrementally
  updated; stale map state is visible to the driver and fleet operations.

### 7.3 Deviation policy

- Minor deviation with the original corridor safely reachable: `returnToRoute`.
- Material deviation, closure or missed locked stop: full commercial recalculation from the
  map-matched position and current bearing, retaining remaining locked stops.
- Offline: use HERE `OfflineRoutingEngine` with downloaded truck layers; label traffic unavailable.
- Profile mismatch, critical notice, missing map data or repeated location uncertainty: degraded
  mode, voice warning and safe-stop/dispatch escalation.
- A single stale/inaccurate GPS fix never triggers a route replacement. Use HERE's map-matched
  position, accuracy/age thresholds and hysteresis; sustained uncertainty enters degraded mode.
- Never auto-adopt a meaningfully different reroute in the final approach to a facility or around a
  restriction without a clear voice/visual notification.

---

## 8. Driver experience and distraction controls

### 8.1 Before motion

1. Accepted/in-transit load shows **Review commercial route**.
2. Driver confirms the actual tractor/trailer; mismatch returns to equipment correction.
3. Preview shows route, distance/ETA, tolls if available, locked load/fuel/rest stops, known
   facility entrance and any non-critical cautions.
4. Offline corridor/region readiness is visible; download before departure when possible.
5. `Start navigation` acknowledges profile/version and begins the foreground location session.

### 8.2 In motion

- One next maneuver, lane/sign guidance, distance, road name, ETA and next locked stop.
- Voice first; large sunlight/night themes; no scrolling maneuver list while moving.
- Relevant truck restriction, commercial speed and road-attribute warnings from HERE.
- One-tap mute, route overview, report hazard, safe-stop and call dispatch/support.
- Messages are read by voice only if policy/legal review approves; composition is locked.
- Camera, document, detailed facility review, settings and route editing are locked.
- Motion state is a shared app service so D58/manual-entry and D-PM4 messaging restrictions use one
  tested source rather than separate speed guesses.

### 8.3 Facility approach

- Switch from highway guidance to the verified truck entrance, gate and approach instruction.
- Show entrance confidence and facility-provided/crowd-verified warnings.
- Geofence suggests `Arrived` only after consecutive accurate fixes, low speed and minimum dwell in
  the facility/entrance area; driver confirms/corrects with one action. One noisy ping never changes
  load state.
- Dwell timer supports detention evidence without auto-completing the business stop.
- After departure, offer a parked-only structured report: entrance correct, turning room, parking,
  scale, amenities and wait time.

---

## 9. Offline, device and battery programme

- HERE offline region download plus route-corridor prefetch; include the `TRUCK` and
  `OFFLINE_ROUTING` layers required by the contracted SDK version.
- Preflight checks available storage, map version, corridor readiness and expected download size.
- Downloads resume after interruption and never block the UI thread.
- Persist/restore the active HERE route/session safely across process death and phone restart.
- Android uses a visible location foreground service started while the app is visible; iOS requests
  authorization just in time when navigation starts. Permission denial produces a clear limited
  state, not a crash or fake location.
- Profile representative fleet devices for all-day shifts: GPS rate, screen-on, voice, LTE loss,
  thermal throttling, low-power mode, memory pressure and charger disconnect.
- The app detects GPS spoofing/impossible jumps as low-confidence telemetry; it does not make a
  driver-facing accusation or silently reroute from a suspect fix.

---

## 10. Security, privacy and abuse resistance

Use OWASP MASVS as the mobile verification baseline across storage, crypto, auth, network,
platform, code, resilience and privacy: [OWASP MASVS](https://mas.owasp.org/MASVS/).

1. **Credential separation:** distinct HERE apps/credentials for server, Android, iOS and
   development. Never ship the server API key. Mobile credentials use HERE-supported protection,
   secure bootstrap/storage, rotation, usage anomaly alerts and emergency revocation. Assume a
   determined attacker can inspect a mobile binary; quotas and backend authorization remain the
   containment boundary.
2. **Least privilege:** driver JWT can retrieve only the route for their assigned load. Server
   derives org/driver identity and validates current duty equipment on every activation/event batch.
3. **At rest:** route/offline operational metadata and pending events use the existing
   SQLCipher/SecureStore model. Keys live in platform Keystore/Keychain. Logout/offboarding destroys
   local route/session keys and revokes background work.
4. **In transit:** TLS only; server API requests use authenticated bounded payloads, timeouts,
   idempotency and anti-replay timestamps/nonces for event batches.
5. **Privacy:** collect precise/high-frequency location only for active navigation. The UI always
   shows when tracking is active and why. No location in crash breadcrumbs, analytics payloads,
   notification copy or ordinary logs.
6. **Retention:** define with legal/customer policy before pilot. Proposed default: keep high-rate
   device traces only in a rolling bounded safety window; retain coarse milestones, route events and
   audit longer. Raw trace retention must never become indefinite merely because storage is cheap.
7. **Sharing:** driver-facing policy names who receives ETA/location (carrier dispatch, shipper or
   receiver when enabled), for what load and for how long. Tenant policy can narrow sharing.
8. **Tamper/risk:** release signing, dependency/SBOM scanning, root/jailbreak and mock-location
   signals as risk inputs, not automatic lockouts. Remote config is signed/versioned; kill-switch
   actions are audited.
9. **Vendor privacy:** disclose HERE SDK usage/telemetry as required by the HERE agreement and keep
   the app-store declarations synchronized with actual foreground/background behavior.

---

## 11. Reliability and observability

### 11.1 Proposed launch SLOs

| Signal | Launch target |
|---|---|
| Activated routes with an unreviewed critical HERE notice | **0** |
| Activated routes missing a required safety-profile field | **0** |
| End-to-end online route activation success | ≥99.9% monthly, including provider dependencies |
| FuelGuard navigation control-plane availability | ≥99.95% monthly |
| Crash-free active-navigation sessions | ≥99.9% |
| Online initial route activation latency | p95 ≤5 seconds after profile is ready |
| Online reroute decision | p95 ≤8 seconds |
| Active session restoration after process restart | ≥99.5% in device matrix |
| Offline golden-route completion with preloaded maps | 100% in release suite |
| Route/event audit completeness | 100% |

SLOs are release gates, not dashboard decoration. A miss creates an incident and may pause rollout.

### 11.2 Required telemetry

- route calculation outcome/latency by profile completeness and HERE error class;
- notice code/severity/disposition, never raw secrets or full precise coordinates in general logs;
- SDK/map/API/policy version and route-handle import outcome;
- GPS accuracy/age/source, HERE map-matching confidence and Samsara agreement band;
- deviation/reroute count and reason, locked-stop preservation, offline transitions;
- map download/update failures, disk space, battery/thermal state;
- restriction warning delivery-to-ack timing;
- navigation crash/ANR, memory and session-restore outcome;
- facility entrance correction and false-arrival rates.

Dashboards separate safety, reliability, product and cost. Alerts page an owner for critical-notice
acceptance attempts, route/profile mismatches, broad route failures, stale maps and kill-switch use.

---

## 12. Verification and safety case

### 12.1 Automated layers

- Pure unit/property tests for unit conversion, maximum-combination composition, profile hashes,
  notice classification, freshness and locked-stop invariants.
- Contract fixtures captured from HERE for every known notice severity/code; unknown codes fail.
- API/RLS matrix: cross-driver/tenant route access, forged events, stale/superseded activation,
  wrong duty equipment, module/feature revocation and replay.
- Native bridge tests: lifecycle, permission changes, route-handle import, process death, voice,
  warners, map update and offline engines.
- Fault injection: HERE 401/403/429/5xx, invalid/expired route handle, corrupt map download, no disk,
  GPS loss/jump/spoof, clock skew, network flapping and server failover.

### 12.2 Golden-route corpus

Maintain a versioned corpus across the actual operating footprint:

- known low bridges/clearances and narrow roads;
- gross, current, per-axle and axle-group weight restrictions;
- hazardous-material and tunnel restrictions;
- time/seasonal closures, truck bans, no-through/private roads and ferries;
- difficult turns/U-turn traps and divided-highway side-of-street approaches;
- verified shipper/receiver truck entrances and industrial private roads;
- rural dead zones and multi-hour offline routes;
- border/state policy and mandated fuel/rest stops.

Each case stores expected safety properties, not one brittle exact polyline. A map/SDK/routing-policy
upgrade runs the entire corpus and produces a reviewed route-diff report.

### 12.3 Field rollout

1. **Simulation:** HERE Location Simulator and recorded 1 Hz traces; no driver impact.
2. **Shadow pilot:** 10–20 routes; app computes/logs but drivers use their approved current truck GPS.
3. **Guided pilot:** 5–10 trained drivers, limited lanes/daylight, dispatch watching, one-action
   fallback and daily route review.
4. **Fleet pilot:** 10% of eligible drivers; automatic rollback thresholds.
5. **GA:** entitlement + `nav.preview.released:true` only after all gates pass.

Every field report is triaged as map data, profile, facility pin, product UX, device/GPS or policy.
Safety issues receive a preserved evidence bundle and route/provider report; driver reports are
never treated as noise because the provider returned a route.

---

## 13. Delivery phases

### NP0 — procurement and native feasibility

- HERE Navigate commercial terms, MAU/driver cost, offline/prefetch rights, support SLA and rate
  limits signed.
- Build minimal Android/iOS Expo native modules proving SDK init, map render, one simulated truck
  route, route-handle import, truck restriction callback, voice and offline route.
- Confirm supported device/OS matrix, binary size, EAS/prebuild integration and upgrade path.
- Record credential and privacy requirements; complete threat model.

**Exit:** both platforms pass the same simulated route; cost/support/legal are accepted. No product
work proceeds on an unlicensed assumption.

### NP1 — safe routing foundation

- Shared strict navigation contract and verified combination-profile service.
- Add load weight/hazmat routing data and trailer composition.
- Remove the weight cap; incomplete/invalid profiles fail closed.
- Expand HERE request/response for route handles, notices/spans and time-aware metadata.
- Notice policy + captured fixtures + golden-route seed corpus.
- Separate durable intent from live route freshness.

**Exit:** no critical notice or incomplete profile can produce an activatable route.

### NP2 — route publication control plane

- Navigation tables, immutable events, RLS, service APIs and audit.
- Dispatcher route review/publish/supersede UI bound to a load and duty equipment.
- Driver active-route API, acknowledgment and activation with an idempotent event outbox.
- Push notification for published/changed/canceled route.

**Exit:** one versioned route travels dispatcher → assigned driver → acknowledgment with complete
audit and no cross-tenant/driver access.

### NP3 — online guidance vertical slice

- Production native bridge, HERE map and active guidance screen.
- Import fresh route handle; progress, maneuvers, lane/sign/voice, CVR speed and truck warnings.
- Background/foreground lifecycle, permission UX, screen wake and session restore.
- Motion service and in-motion app locks.

**Exit:** guided pilot route completes online on both platforms with process-restart recovery.

### NP4 — offline and dynamic reliability

- Region/corridor download, truck/offline layers, map updates and storage UX.
- Offline routing/return-to-route and clear no-traffic state.
- Online traffic refresh/dynamic alternatives with locked-stop enforcement.
- Battery, thermal, memory and network-flap qualification.

**Exit:** full offline golden-route suite and all-day device test pass.

### NP5 — freight execution intelligence

- HERE phone + Samsara/ELD source-confidence model and discrepancy events.
- ETA/deviation visibility for dispatch.
- Geofence milestone suggestions, dwell/detention evidence and manual live-status correction.
- Facility entrances, approach details, moderation and parked-only feedback.
- One-action support/escalation with diagnostic bundle.

**Exit:** pilot demonstrates fewer status calls, low false-arrival rate and useful facility reports
without expanding location collection beyond the declared session.

### NP6 — security and enterprise operations

- OWASP MASVS assessment, mobile penetration test, credential rotation/revocation exercise.
- SLO dashboards, on-call runbooks, HERE outage/degraded-mode drill and remote kill-switch test.
- Data-retention/sharing policy, privacy/store review and customer admin controls.
- SDK/map upgrade compatibility and SBOM/dependency gates.

**Exit:** security findings closed or formally risk-accepted; incident and rollback drills pass.

### NP7 — staged rollout and GA

- Simulation → shadow → guided → fleet pilot gates in §12.3.
- Independent safety review signs the golden-route diff and field evidence.
- Flip `nav.preview.released:true`; retain entitlement, per-org enablement and kill switch.
- Remove sample data and MapLibre from production navigation; remove dependency if unused elsewhere.

**Exit:** GA SLOs hold through the agreed pilot window; zero open P0/P1 safety findings.

---

## 14. GA release gates

Navigation is not released until all are true:

- [ ] HERE Navigate license/support/SLA and both platform packages are production-approved.
- [ ] Required combination inputs and provenance exist for every pilot vehicle/load.
- [ ] Critical/unknown notices fail closed and the corpus proves it.
- [ ] Live route activation cannot use a months-old cached response or persistent stale handle.
- [ ] Dispatcher and driver route versions cannot diverge silently.
- [ ] Offline truck maps/routing, route restore and degraded mode pass the device matrix.
- [ ] Motion lockouts and FMCSA/NHTSA-oriented distraction review pass.
- [ ] Driver-scoped API/RLS, MASVS assessment and penetration test pass.
- [ ] Location permission, collection, sharing, retention and deletion behavior match policy/store
      declarations exactly.
- [ ] SLO dashboards, on-call ownership, provider escalation, kill switch and rollback are live.
- [ ] Shadow/guided/fleet pilots complete with zero unresolved P0/P1 route-safety findings.
- [ ] No sample route/fuel data or “truck-safe guarantee” copy is reachable in production.

---

## 15. Source register (reviewed 2026-08-07)

### Uber Freight — primary product/help sources

- Current carrier-app feature description:
  https://play.google.com/store/apps/details?id=com.ubercab.freight&hl=en_US
- Dual-source app + ELD tracking, equipment matching and live status correction:
  https://help.uber.com/freight/carrier/article/what-are-the-benefits-of-using-an-automated-tracking-source?nodeId=3ca48cbf-808c-4e2b-993a-7d9b9fde48f0
- Tracking sources, load milestones and operating guidance:
  https://help.uber.com/freight/carrier/article/what-automated-tracking-sources-does-uber-freight-use?nodeId=f7bdeccb-83d1-422c-88cf-12daa7d3c3eb
- Facility ratings/amenities and structured driver feedback:
  https://www.uberfreight.com/en-US/blog/facility-ratings and
  https://www.uberfreight.com/en-US/blog/lessons-learned-from-facility-ratings
- Uber Freight privacy notice:
  https://www.uber.com/legal/id/document/?country=united-states&lang=en&name=uber-freight-privacy-notice

### HERE — primary technical sources

- Truck routing and required vehicle properties:
  https://docs.here.com/routing/docs/routing-v8-truck-routing
- Route notices and critical-notice guidance:
  https://docs.here.com/routing/docs/routing-v8-notice
- Route handles and their non-persistent nature:
  https://docs.here.com/routing/docs/routing-v8-whatis-route-handle
- HERE SDK route import/refresh:
  https://docs.here.com/here-sdk/docs/android-routing-advanced
- HERE truck navigation and restriction warners:
  https://docs.here.com/here-sdk/docs/android-navigation-truck
- Navigation, voice, map matching, offline and dynamic routing:
  https://docs.here.com/here-sdk/docs/android-navigation
- Offline maps/routing/guidance:
  https://docs.here.com/here-sdk/docs/android-offline-maps
- Offline truck-layer requirement and optimization:
  https://docs.here.com/here-sdk/docs/android-optimization
- Map update lifecycle:
  https://docs.here.com/here-sdk/docs/android-offline-maps-update

### Google / MapLibre — map decision evidence

- Google Routes documented vehicle types (no commercial truck profile):
  https://developers.google.com/maps/documentation/routes/vehicles
- MapLibre Native and React Native are map-rendering projects:
  https://maplibre.org/projects/native/ and https://maplibre.org/maplibre-react-native/

### Safety, platform and security

- FMCSA mobile-phone restrictions for CMV drivers:
  https://www.fmcsa.dot.gov/driver-safety/distracted-driving/mobile-phone-restrictions-fact-sheet
- NHTSA distraction guidance index:
  https://www.nhtsa.gov/laws-regulations/guidance-documents
- Apple location authorization/privacy guidance:
  https://developer.apple.com/documentation/corelocation/requesting-authorization-to-use-location-services
- Android foreground/background service restrictions:
  https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
- OWASP MASVS:
  https://mas.owasp.org/MASVS/
