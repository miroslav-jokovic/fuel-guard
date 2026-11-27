# Out of route on our own map — and Samsara's codes on maintenance follow-ups · analysis · 2026-11-27

**Status:** owner ruled 2026-11-27 — "analyze and proceed as recommended": Q-ORM1–4 and Q-ORM6–8 take
their recommendation (§6, §7). Q-ORM5 belongs to option B and stays open. Building: codes first (§7.3),
then option A (§3). Progress in the log (§9).
Decision IDs **D-ORM**, question IDs **Q-ORM** (both unused in the repo before this file). Parent plan:
`WARNING-DESK-PLAN.md` (D-WD7 video never stored, D-WD13 Out of route is one record shared with dispatch).

## 0. The answer in one paragraph

Samsara's Out of Route incident carries **no location, no route, no geometry and no distance** — only the
truck, the driver and two times — and Samsara's route objects carry **stops but no line**. So "show it
on our map" cannot mean "draw what Samsara drew". It can mean something measured to be nearly the same
thing: our load's HERE route (Samsara's map is HERE-powered, `hereRoute.ts`) against the truck's Samsara
GPS for the incident window. At the moment Samsara says the truck left, our own line puts it **6.0 ±1 mi
off in 20 of 28 sampled incidents** — Samsara's threshold is 6 mi. We can derive the planned line for
**96%** of incidents from our own `loads`, the drive costs **one Samsara call (0.3–1.6 s) and at most one
HERE call per click**, and nothing needs storing. **Recommendation: option A** — a "Show on map" button
per Out of route warning in the follow-up drawer (both screens, one page), drawn on demand like "Play
video", with a sentence that states the verdict before the map does. The live-map layer (B) is not
worth building now: at any moment roughly one truck is really off route, while the 25 incidents Samsara
calls "still active" are all 1.5–28 days old.

The second ask (Samsara's fault codes on maintenance follow-ups, §7) is independent, smaller, and
recommended as well: a live read on open, no table.

## 1. Measured reality (live Samsara org 6308 + production DB, read-only, 2026-11-27)

### 1.1 The alert and its incidents

- Configuration `f5efe624…` "Vehicle Out Of Route", trigger 1027, scope all vehicles:
  `triggerParams.outOfRoute = { maxOffRouteMeters: 9656, minDurationMilliseconds: 600000 }` — **6 miles
  for 10 minutes**. The 6 mi is the configuration's, and is read from it (D-ORM4), not copied.
- `GET /alerts/incidents/stream`, 30 days, this configuration: **563 incidents** in 3 pages (the
  11-26 figure was 587; the window moved over Thanksgiving). 83 trucks; the top truck has 21.
- **Every key the payload carries**, from all 563: `configurationId, updatedAtTime, happenedAtTime,
  resolvedAtTime, isResolved, incidentUrl, conditions[].{triggerId, description,
  details.outOfRoute.{vehicle{id,name,serial,externalIds,tags,attributes}, driver{id,name,tags}}}}`.
  No location, no route id, no geometry, no distance off route. 4 incidents have no driver.
- Durations (resolved, n = 538): p10 16 min · **p50 2.1 h** · p75 14.7 h · p90 26 h · p99 86 h · max
  142 h. **188 (33%) last more than 6 h.**
- Open (`isResolved = false`): **25, aged 1.5 to 28.3 days** — none fresher. `samsara_warnings` holds
  16 still-active Out of route rows (the collector's window is younger than the oldest of them).

### 1.2 The route Samsara compares against

- `GET /fleet/routes` answers on our read-only token: **1,941 routes in a 45-day window, 39 pages,
  22.6 s**. Every one is named with a 7-digit McLeod order number (`0138978`) — McLeod dispatch creates
  them. `/v1/fleet/dispatch/routes` and `/fleet/routes/audit-logs/feed` answer too.
- A route carries `driver` (no vehicle), `stops[]` with either `singleUseLocation{lat,lng}` (2,795) or a
  Samsara `address{id,name}` (3,200, coordinates need a second call), `plannedDistanceMeters`, schedule
  and actual times, ETA. The first stop is **"Current Location"** — where the truck was when McLeod sent
  the load, so Samsara's route includes the empty leg to the pickup. **No polyline, anywhere.**
- 455 of 563 incidents (81%) fall inside a route for the same driver (±1 h); 31 inside two.
- So Samsara's own line is not available to us. Reading Samsara's routes per click would need a
  day-window list filtered by driver (~3 pages, ~1.7 s), only to learn stops we already hold (§1.3).

### 1.3 Our own planned route

- `loads.ref` is the same order number: all **303 route names matched to incidents are in `loads`**
  (312 rows, a few refs repeat), all with a truck, **301 with ≥ 2 located stops** (`load_stops` has
  lat/lon on 26,391 of 26,391 rows).
- Without Samsara's routes, by truck and time alone (load window = first stop's arrival − 1 h to the
  last stop's departure + 1 h): **447 of 563 (79%)** fall on a load; 5 fall on two. Of the 112 that do
  not, **91 happen within 48 h before that truck's next load starts** — the empty leg to the pickup.
  So **538 (96%) have a planned line we can derive**; 21 have none, 4 have a truck we cannot resolve.
- `route_geometries` (the routing module's HERE cache, keyed by stops, 24 h life): 125 rows, 14 MB,
  since 2026-07-15 — ~5 HERE routes a day today.

### 1.4 Does our line agree with Samsara's? (the measurement the whole design rests on)

28 incidents, every 18th resolved one, on a load. For each: HERE route over Samsara's "Current Location"
+ the load's stops (fleet truck profile 164/840/102 in, 5 axles, 80,000 lb), Samsara GPS from 45 min
before the alert to 20 min after resolve, and the cross-track distance from each fix to the line
(`pointToSegmentMiles`, the shared measure).

| | count | reading |
|---|---|---|
| Our line reads **6 ±1 mi at Samsara's `happenedAtTime`** | **20 / 28** | `happenedAtTime` is the moment the truck crossed 6 mi; our line agrees to the minute |
| our line reads 7.5 mi | 1 | near agreement |
| our line says the truck was ON route (0–3 mi) | 5 | Samsara's line went another way; we would show "on route" for an incident Samsara raised |
| our line says 12.8 / 13.3 mi | 2 | the truck was already off our line earlier |
| our line reads ~6 mi at `resolvedAtTime` | 15 / 28 | "resolved" = came back |
| **resolved while 13–311 mi off our line** | **8 / 28** | all ≥ 3 h, six ≥ 10 h; those trucks drove 11–792 mi during the incident |

Two readings. First, **"where it left" is derivable**: ~75% to the minute. Second, **`resolvedAtTime` is not
"back on route"** for long incidents — Samsara closed them while the truck was hundreds of miles away,
which reads as a route finished or replaced in McLeod while the truck went on to other work. "Back on
route" must therefore be computed from the path against the line, and say so when Samsara closed an
incident the path does not explain (D-ORM3).

⚠ The sample used Samsara's "Current Location" as the line's origin. The product would not read
Samsara's routes (§1.2), so for the ~27% of incidents before or at the pickup (58 at the pickup, 91
before it) the origin is our approximation (D-ORM2, Q-ORM2). After the pickup the origin does not touch
the leg being judged.

### 1.5 The driven path: cost and latency

`readVehicleTrail` → `/fleet/vehicles/stats/history?types=gps` (samsara module, lane-limited), one truck:

| incident | window | points | pages | time | size |
|---|---|---|---|---|---|
| 0.6 h | 1.3 h | 677 | 1 | 760 ms | 148 KB |
| 1.0 h | 1.8 h | 1,140 | 1 | 312 ms | 257 KB |
| 2.6 h | 3.3 h | 1,887 | 1 | 620 ms | 416 KB |
| 5.8 h | 6.6 h | 554 | 1 | 278 ms | 120 KB |
| 25.2 h | 26 h | 4,954 | 1 | 1,057 ms | 1,115 KB |

28-incident run: GPS p50 384 ms, max 1,627 ms; HERE p50 165 ms, max 619 ms (1,032 ms once).
`thinPath` (DBV6, measured 2026-10-16) brings 6,114 points to 629 / 22 KB, so the answer to the browser
is tens of KB. Samsara still serves GPS **88 and 180 days back** (200, 515–816 ms): the trail outlives
the 90-day `samsara_warnings` row, so there is nothing to snapshot.

### 1.6 What the repo already has (verified at the call site)

- `livemap` composes exactly these reads already: `readLoadRoute` (`liveMapLoadRoute.ts`, HERE via
  `getOrComputeRoute`, maps `HereUnavailableError`/`NoHereKeyError` to 503) and `readDrivenPath`
  (`liveMapDrivenPath.ts`, `readVehicleTrail` + `thinPath`, 60 s in-process cache, `drivenPathWindow`
  cap 72 h). `OFF_ROUTE_MILES = 1` (shared `geo.ts`) is the map's own "is the truck on the line" test,
  a different question from Samsara's 6 mi.
- Boundaries: `livemap -> samsara | loads | routing` allowed; `followups -> samsara | roster | org`
  allowed; livemap imports nothing of followups'. A `followups -> livemap` edge closes no cycle.
- The drawer's "Play video" is the pattern to copy: `GET /api/follow-ups/:id/video/:eventId` checks the
  event belongs to the follow-up, asks Samsara fresh, stores nothing (D-WD7), answers 503/502 with a
  sentence.
- One page, `pages/FollowUpsPage.vue`, serves `/shop/follow-ups` and `/loads/follow-ups`: whatever the
  drawer gains, dispatch and the desk gain together (D-WD13 holds).
- Web: `WEB_ALLOW` is empty, so `features/followUps` may not import `features/livemap/liveMapRouteLayer.ts`.
  `features/fueling/RouteMapGL.vue` (119 lines) is the precedent for a second map on the shared
  `@/composables/useMapLibre`.
- CSP: tiles come through our own proxy (`img-src 'self'`), route and path are API JSON — no new host.
  To be confirmed in a real browser at build time, the 307 lesson of #2699.

## 2. What the measurements say about the design

1. **No geometry from Samsara, so we draw our own and must say so.** The legend reads "planned route
   (from the load's stops)", never "Samsara's route".
2. **The verdict is computed, not inherited.** Where it left = first fix beyond the configuration's
   threshold; furthest = max cross-track; back = first fix back within it after that. Samsara's two
   times are shown beside ours; when they disagree (§1.4: 5 + 2 + 8 of 28) the sentence says which.
3. **`still_active` cannot drive a live layer.** 25 open, none younger than 1.5 days.
4. **Nothing to store.** Trail available ≥ 180 days, HERE cached 24 h by the routing module already,
   warning row lives 90 days. A geometry cache would be ~10 KB × 563 = ~6 MB a month, ~17 MB at 90
   days, on a database that is already micro and swapping — for no read that needs it.

## 3. Decisions (Q-ORM1 ruled (a) 2026-11-27; as built, amendments marked)

- **D-ORM1. One endpoint, keyed by the warning.** `GET /api/follow-ups/:id/route/:warningId` in
  `followups` (authorisation as for video: the warning must belong to the follow-up, the surface must
  match the category). It calls one composed read in `livemap`, exported from its index:
  `readOffRouteView(admin, env, orgId, { vehicleSamsaraId, happenedAt, endedAt })`. *(As built: our
  `vehicleId` — the follow-up resolves it through roster's `readSamsaraSubjects` — plus `stillActive` and
  the configuration's distance; `readOffRouteViewCached` is the export.)* New boundary edge
  `followups -> livemap`, recorded with its reason. livemap owns no table and gains none.
- **D-ORM2. The planned line.** The load on that truck whose window covers the incident (§1.3 rule,
  shared pure function, tested on the 5 two-load cases: pick the one whose window started last). Its
  stops go through `getOrComputeRoute` unchanged, so a dispatcher who opened the same load on the live
  map has already paid for it. Before the pickup: HERE from the trail's first fix (45 min before the
  alert, when Samsara still judged the truck on route) to the pickup, drawn as a separate faint leg
  and labelled "the way to the pickup, planned from where the truck was at 14:05". No load: path only,
  and the sentence says there is no load to compare against. *(As built: loads' `readTruckLoadSpans` +
  shared `loadSpanOf`/`loadAtInstant`; canceled loads (122 of 12,570) and McLeod-removed stops left out;
  "before the pickup" = no departure yet, or departed after the alert; the request is the live map's own
  through the extracted `loadRouteRequest`, so the cache rows are shared.)*
- **D-ORM3. The verdict, in a sentence above the map.** "Left the planned route at 14:05, at most 38 mi
  off, back on it at 15:42." / "Still 12 mi off the planned route (last fix 16:10)." / "Samsara closed
  this at 09:30 while the truck was 311 mi from the planned route — the route was probably finished or
  changed in McLeod." / "On our planned route the whole time — Samsara's route went another way." The
  map is optional on a phone; the sentence is not. Pure shared function `offRouteVerdict(trail, line,
  thresholdMiles)`, unit-tested on recorded fixtures from §1.4 (not synthetic scatter).
  - *Amended when built (2026-11-27):* **the tests are synthetic after all, on purpose** — the repository
    is public, and a real truck's GPS trace is a driver's movements. The real-data check ran against
    production instead and is in the log (§9): our "left" within 15 min of Samsara's alert on 20 of 28.
    **And the sentences guess at no cause.** "the route was probably finished or changed in McLeod" and
    "Samsara's route went another way" were inferences, not measurements; as built the drawer says only
    what was measured — Samsara closed it at a time, the truck was N mi off at the last fix drawn, and
    Samsara judges against its own route, which it does not share with us.
- **D-ORM4. The threshold is the configuration's.** `AlertConfigurationSummary` gains the trigger's
  `maxOffRouteMeters` (read by `fetchAlertConfigurations`, already exported as `readAlertConfigurations`).
  A change in Samsara moves our verdict with it.
- **D-ORM5. Drawn on demand, nothing stored.** A "Show on map" button per Out of route warning, like
  "Play video". The window is `happenedAt − 45 min` to `(endedAt ?? now) + 20 min`, capped at
  `DRIVEN_PATH_MAX_HOURS` (72 h; p99 is 86 h, so 1% are cut and say so). 60 s in-process cache per
  warning, the `readDrivenPathCached` rules. No migration, no table, no manifest change.
- **D-ORM6. Failure is a sentence.** Samsara down → 503 "Samsara did not answer — open it in Samsara"
  (the link stays). HERE down → the path and the verdict-less sentence still show; the planned line is
  replaced by "the routing service is not answering" (the 2026-10-19 lesson: never a 500).
- **D-ORM7. Phone and tablet.** The drawer is already full-screen on a phone; the map sits under the
  sentence at 16:10, `cooperativeGestures` so a one-finger scroll still scrolls the drawer, tap targets
  ≥ 48 px, three markers only (left · furthest · back). The component lives in
  `apps/web/src/components/maps/OffRouteMap.vue` — shared, so B can mount it later without a
  cross-feature import.

## 4. The options

| | A · in the follow-up drawer | B · layer on the live map | C · both, one endpoint, one component |
|---|---|---|---|
| **Shows** | per warning: planned line, driven path, left/furthest/back markers, sentence | marker badge on trucks off route now; click opens the same view | both |
| **Data** | warning row (samsara export) · load + stops (loads) · HERE (routing) · GPS (samsara) | A's, plus an "off route now" set computed per board refresh | both |
| **New** | 1 route in followups, 1 composed read in livemap, edge `followups -> livemap`, 2 shared pure fns + contract, 1 shared component | board field + a definition of "now" (Q-ORM5); livemap reads active warnings (`livemap -> samsara`, exists) | A + B |
| **Table** | none | none | none |
| **Samsara calls** | 1 per click; ≤ 563/mo if every incident were opened, ~225 at 75 follow-ups × 3 | board already polls positions; + 1 GPS read per click | sum |
| **HERE calls** | ≤ 1 per click, 0 on a cache hit; worst case ≤ ~20/day on top of today's ~5 | same per click; 0 to show the badge if "now" uses Samsara's flag + age | sum |
| **Samsara down** | sentence + link | badge from stored warnings still shows; click as A | — |
| **HERE down** | path + sentence, no line | badge unaffected | — |
| **Real value** | every follow-up, both screens: 20 open route follow-ups today | ~1 truck at a time really off route (19/day × ~1.5 h on the short ones); the 25 "active" are stale | — |
| **Rough size** | API ~300 lines + tests, web ~250 + tests; 2 PRs (API+shared, then web) | +~200 lines and a rule to tune | A + B |

**Rejected: reading Samsara's routes per click** for the exact origin — 3 pages and ~1.7 s per click to
learn the stops `loads` already holds, plus a parser on a second Samsara surface. Kept as Q-ORM2 (b).

## 5. Recommendation

**A now, built as C's first half.** One endpoint keyed by the warning and one shared component, so B costs
only its own definition of "now" if the owner wants it after A has run for a month. A answers the
owner's four questions (where it left, where it should be, where it went, is it back) on both screens
that already exist, with no table, no migration and no new host. B today would mostly draw stale
Samsara incidents or, made honest, about one truck.

## 6. Questions for the owner

| ID | Question | Candidates | Recommendation |
|---|---|---|---|
| **Q-ORM1** | Which option? | (a) A · (b) B · (c) C | **(a)**, built so C is a small step later |
| **Q-ORM2** | Where does the planned line start before the pickup (~27% of incidents)? | (a) from the truck's fix 45 min before the alert · (b) read Samsara's route for that day to get its "Current Location" (+1.7 s, +3 Samsara calls) · (c) draw no planned line before the pickup | **(a)**, labelled as ours |
| **Q-ORM3** | A third of incidents last > 6 h and many end hundreds of miles away (§1.4). Should they keep counting toward "3 in 7 days"? | (a) show them as "closed while off route", rule unchanged · (b) also stop counting incidents our verdict cannot confirm · (c) leave as is | **(a)** now; measure (b) on A's verdicts after a month |
| **Q-ORM4** | Place names in the sentence ("near Effingham, IL")? | (a) no — times and miles · (b) HERE reverse geocode, +2 calls per click | **(a)** |
| **Q-ORM5** | If B is wanted: what is "off route now"? | (a) Samsara still-active AND started < 12 h · (b) truck's live fix > threshold from its load's cached line | (a) is cheap but trusts Samsara's flag; (b) is right but routes every loaded truck |

## 7. The second ask: Samsara's codes on maintenance follow-ups

Owner, 2026-11-27: "add codes from Samsara in the maintenance tab on Follow-up pages for trucks we got
notifications for".

### 7.1 Measured

- `GET /fleet/vehicles/stats?types=faultCodes` (one page, fleet): **290 J1939 codes on 136 of 254
  vehicles**; no OBD-II. Lamps on: warning 39, emissions 28, stop 5, protect 3.
- Each code carries `spnId, spnDescription, fmiId, fmiDescription, occurrenceCount, sourceAddressName,
  milStatus, txId`. Example: SPN 1636 / FMI 3 — "Engine Intake Manifold 1 Temperature (High Resolution)
  — Voltage Above Normal", Engine #2, 3 occurrences.
- **What we keep today:** `truckLamps` (`warningRows.ts`) stores up to three `spnDescription`s in a lamp
  row's `detail.codes`. **155 of 290 live codes (53%) are "Manufacturer Assignable SPN"** (125 in the
  proprietary range 520192–524287), 15 have no description — so the stored text tells the shop nothing
  in more than half the cases, and the SPN/FMI numbers that would let them look it up are dropped.
- Where the codes come from: Forward Road Image Processor 42, Engine #2 37, Engine #1 33, Body
  Controller 30, Cellular unit 28, Exhaust Emission Controller 24, Headway Controller 20, Tire Pressure
  13. Roughly a third are camera / telematics / driver-assist modules, not mechanical.
- Open maintenance follow-ups on trucks: **32 trucks; 20 (63%) have live codes now.**
- Cost: one truck's live read 243 ms; its 7-day code history (`/stats/history?types=faultCodes`) one
  page, 355 ms, 13 KB, 41 snapshots.

### 7.2 Options

- **F1 · "Codes on this truck now"** in the drawer for maintenance follow-ups on a truck: every code as
  "SPN 1636 · FMI 3 — Intake manifold temp, voltage above normal · Engine #2 · 3×", lamp states on top.
  Live read on open, nothing stored. New `GET /api/follow-ups/:id/codes`, one samsara export.
- **F2 · F1 + "seen during this follow-up"**: the same read over `first_at → now` (≤ 30 days) shows codes
  that came and cleared, with first and last seen. One more call, same endpoint.
- **F3 · keep SPN/FMI in the lamp row's `detail`** (parser change, no migration; 2 KB holds ~10 codes),
  so the list shows numbers even when Samsara is down.

**Recommendation: F2, with F3's parser fix in the same PR** (the description-only `detail` is a defect
whatever else is chosen). One PR, ~250 lines with tests, no table.

| ID | Question | Candidates | Recommendation |
|---|---|---|---|
| **Q-ORM6** | Which follow-ups show codes? | (a) every maintenance follow-up on a truck · (b) only engine-lamp and battery ones | **(a)** — a battery or tire follow-up is often explained by a code |
| **Q-ORM7** | Show camera / telematics / driver-assist module codes? | (a) all, grouped "Engine & drivetrain" first, "Camera & telematics" folded · (b) hide them | **(a)** |
| **Q-ORM8** | Decode "Manufacturer Assignable SPN"? | (a) no — show SPN/FMI + module so the shop's own tool reads it · (b) license OEM tables (Cummins/Detroit/PACCAR) | **(a)**; (b) is a purchase, out of scope |

### 7.3 Decisions (built 2026-11-27)

- **D-ORM8. A code is SPN, FMI and module, in Samsara's words.** One shared shape (`truckFaultCodeSchema`,
  `packages/shared/src/truckFaultCodes.ts`); Samsara's payload parsed only in `modules/samsara`
  (`warnings/faultCodes.ts`). Samsara's "Manufacturer Assignable SPN" text sets `makerSpecific` and leaves
  no description — the flag is Samsara's text, not an SPN range of ours. Grouping reads the J1939 source
  address (`txId`): 232, 42, 74, 37, 76 (camera, radar, cellular, gateway, radio — 99 of 290 live codes)
  fold beneath the truck's own; any other address, seen or not, is drawn with the truck's.
- **D-ORM9. Read on open, never stored.** `GET /api/follow-ups/:id/codes`, for `followUpHasTruckCodes`
  (maintenance + truck, shared by API and drawer). Two parallel GETs: the latest reading and the history
  from a day before the first warning (Samsara writes a reading only on a change, so a code on at the
  start is only seen in an earlier one) to the close or now, capped at 30 days. The reading's own time is
  always shown — measured from minutes to 561 days old (p50 2 days, p90 83).
- **D-ORM10. The lamp row keeps whole codes, and they are the fallback.** `truckLamps` keeps up to eight
  codes (the truck's own first) cut to 1,200 text bytes, because 0653's CHECK measures jsonb, which is
  larger: on the live fleet's worst truck 1,556 text bytes were 2,007 in production's Postgres, 1,199 were
  1,604. When Samsara fails, the newest lamp row's codes are shown with the time they were kept; with
  none kept, 502. No Samsara token is 503, as for the video. Rows written before this change hold
  descriptions only and are passed over.

## 8. Out of scope

Writing anything to Samsara (token is read-only, and must stay so) · changing the Out of Route
configuration's 6 mi / 10 min · storing GPS, routes or video · webhooks (alerts are polled).

## 9. Log

- 2026-11-27 — Analysis written. Measured read-only on org 6308 and production; scratch scripts not
  committed. Waiting on Q-ORM1 (and Q-ORM6–8 for the codes).
- 2026-11-27 — Owner: "analyze and proceed as recommended". Q-ORM1 (a), Q-ORM2 (a), Q-ORM3 (a), Q-ORM4 (a),
  Q-ORM6 (a), Q-ORM7 (a), Q-ORM8 (a) ruled; Q-ORM5 open with option B. Codes built first (D-ORM8–10).
  Measured before building: fault-code history is one reading per change (0 in 30 days on a truck whose
  14 codes never moved), ≤ 2 pages and ≤ 483 ms for 30 days on the four busiest trucks; lamp-row jsonb
  size checked in production's Postgres (above).
- 2026-11-27 — Option A API built (D-ORM1–6). Before it was trusted, the real verdict function ran on the
  28 sampled incidents against production (read-only; trails and lines not committed — public repo):
  "left" within 15 min of Samsara's alert on 20 of 28, most within a minute; 15 judged back, 14 of them
  within a minute of Samsara's close; 9 closed while off; 4 never off our line. p50 36 ms, max 149 ms on
  windows of up to 8,922 fixes. Mutation-checked: moving the "back" rule fails 3 tests, dropping the
  start slack fails 1 (added after the first mutation showed nothing caught it).
