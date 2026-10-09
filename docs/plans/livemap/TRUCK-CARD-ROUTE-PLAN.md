# Truck card on the live map: icons, the load's two ends, and its route — plan

**Status: RULINGS MADE, READY TO EXECUTE.** Written 2026-10-09 from the owner's request the same day and
the owner's four answers to the research. Decision IDs are `D-TC*`, open questions `Q-TC*`. This plan defers to
`LIVE-MAP-PLAN.md` for what the map is (`D-LM*`) and to `docs/plans/fuel/FUEL-PLANNING-PRECISION-PLAN.md`
for how a fuel stop is chosen (`D-FP*`); it restates neither.

---

## 0. The request, and what exists — measured 2026-10-09

The owner, clicking a truck on Dispatch → Live map:

1. "Open truck" and "Open driver" become proper icons.
2. The Load section shows the pickup address, the delivery address and the load's status.
3. A route button, also an icon, that uses our route planning and draws the precise route on the map
   for that truck, pickup to delivery.

**The card** is `apps/web/src/features/livemap/LiveMapVehicleFacts.vue`, mounted by
`LiveMapWorkspace.vue` (the marker's floating card, `density="compact"`) and `LiveMapRail.vue`. Its
header comment's rule stands: it links rather than restates, and it carries no money (LM-F).

**The load it shows** comes from `readLiveLoadContext` (`apps/api/src/modules/loads/liveLoadReads.ts`)
as `LiveMapLoad`: id, ref, status, source, McLeod code, and ONE stop, `nextStop`. The status is already
worded by `loadBoardState`, as on the Loads board. Pickup and delivery are not sent.

**The stops have what item 2 needs.** The 114 loads on a truck in production: 249 stops, **249 with
coordinates, 246 with an address and a place name**, 0 at (0, 0), every longitude negative. Average 2.2
stops a load, at most 6. The Loads board already names "first pickup, last delivery" in one rule,
`boardStops` (`packages/shared/src/loadBoard.ts`).

**The route machinery exists, and the map has none of it.** `planFuelRoute`
(`apps/api/src/modules/routing/fuelPlanning.ts`) = `getOrComputeRoute` (HERE v8 truck routing with
the truck profile, hazmat classes and tunnel category; cached in `route_geometries` by a key over the
whole request, so a repeat costs no HERE call) + `fetchTruckFuelState` (live fuel and HOS from Samsara)
+ the corridor station search and the solver. `RouteMapGL.vue` draws a plan's line on our own tiles.
`LiveMapCanvas.vue` has no route layer.

**What the route will NOT know yet**, said once so nobody is surprised by it:

- **The truck's size is the fleet standard, by design.** The owner ruled 2026-10-09 that every truck
  is the same standard tractor-trailer. That standard already exists ONCE: Settings → Fuel planning →
  truck defaults (`route_fuel_settings`, set 2026-08-05: 164 in high, 840 in long, 102 in wide, 5 axles,
  80,000 lb legal max), and `effectiveTruckProfile` applies it to every route, sent to HERE as
  `vehicle[height]`, `[length]`, `[width]`, `[axleCount]`, `[grossWeight]` (`buildTruckRouteUrl`).
  0 of 199 vehicles carry their own dimensions, which is correct: the per-vehicle columns are
  exceptions to the standard, not a second copy of it. Writing the standard into 199 rows would be a
  copy that drifts the day the setting changes.
- **The hazmat class.** `loads.hazmat` is a boolean; HERE needs classes. A linked `hazmat_loads`
  record may supply them (`Q-TC2`).

---

## 1. Rulings (owner, 2026-10-09)

**D-TC1 — Icons, from the barrel, with words for those who cannot see them.** "Open truck" and "Open
driver" become icon buttons: `VehicleIcon` (the sidebar's Vehicles icon) and a single-person icon
added to `packages/ui/src/icons.ts` first (the design contract, §1.3 — never import HugeIcons
directly). Each carries its words as `aria-label` and tooltip. Each still appears only where its page
opens (`useOpens`, SP5) — an icon is a new picture of the same door, not a new door.
`AppIconButton` is a `<button>` only; it gains a `to` prop rendered through `RouterLink`
(`@silvicom/ui` already depends on `vue-router`), so a link stays a link (middle-click, new tab).

**D-TC2 — The load's two ends, from the board's rule.** The card shows the load reference and status
(as today), the **pickup** (first pickup by `seq`) and the **delivery** (last delivery by `seq`) —
place name, street, city, state — and "+N stops" when there are more. Chosen by `boardStops`, so the
map and the Loads board cannot name a different pickup. `LiveMapLoad` gains optional `pickup` and
`delivery`; optional because the web and api services deploy separately and an older api must still
render a card. `nextStop` stays.

**D-TC3 — The route is pickup → delivery, and what is behind the truck is drawn lighter.** The line
drawn is the load's whole route, pickup through every stop to delivery — the load's route, not the
truck's way to it. The part the truck has already covered is drawn in a lighter, semi-transparent
shade of the same colour, the way a navigation app shows the road behind you. "Covered" is the truck's
position **projected onto the route line**: the line splits at the nearest point. Colours come from
tokens (`tokenColor`) and are checked painted in both schemes, as the markers were (D-LM24).
A truck farther than `OFF_ROUTE_MILES` from the line has no honest split: the whole line is drawn as
ahead, and the card says "Truck is off this route" — never a split guessed from a far point.

**D-TC4 — Route only, plus the calculator's fuel stops as markers.** No fuel prices, HOS panel or
directions on the map — those stay on Fuel planning. The fuel stops the planner's solver chooses for
the rest of this trip are drawn as markers on the line; clicking one shows the station's name, brand
and address. Every fuel stop is ahead of the truck by construction (`D-TC6`).

**D-TC5 — Who can press it: whoever can see the map.** The button and its endpoint are gated by the
section matrix (`dispatch`, view), read from `packages/shared/src/auth.ts` — never a hand-written
role list. `POST /api/fueling/plan` stays `dispatch` manage; the map does not borrow it.

**D-TC6 — One line, and the fuel stops are planned ON it.** This is the decision the owner did not
have to make but the build does, and it is written down because the easy version is wrong. The fuel
plan needs to start where the truck is, with the fuel it has now; the drawn line starts at the pickup.
Running `planFuelRoute` from the truck's position would compute a SECOND route — whose fuel stops need
not lie on the line drawn — and miss the cache on every press, because the position is in the key.
So the route is computed once (pickup → stops → delivery, a stable cache key) and the solver runs on
**the remaining slice of that same line**, from the projected point, with the live fuel reading.
`planFuelRoute` is split into "route" and "solve on a given geometry" so both callers use one solver.

**D-TC7 — A toggle, one route at a time.** The route icon is a toggle: press to draw, press again to
clear. Closing the card or selecting another truck clears it. Drawing fits the camera to the line and
the truck. Only one route is on the map.

---

## 2. Steps — three PRs, in this order

**TC1 — Icons (web + ui).** `AppIconButton` gains `to`; single-person icon added to the barrel; the
card's two links become icon buttons with labels. *Done when:* both icons render in the compact card,
each opens its page, each is absent where `useOpens` says no, the accessible name is the old words,
and `touchTargets.test.ts` still passes.

**TC2 — Pickup and delivery (shared + api + web).** `LiveMapStop` gains `addressLine` and
`postalCode`; `LiveMapLoad` gains optional `pickup`/`delivery`; `readLiveLoadContext` reads
`address_line, postal_code, location_name` and fills both through `boardStops`. Same PR:
`readLiveLoadContext`'s `.in("load_id", …)` goes through `chunks()` (#1392's helper) — today 114 ids
are safe, but it is the read that took the Loads board down at 454. *Done when:* the card shows both
ends for a real load on staging; a test pins that pickup is the lowest-`seq` pickup and delivery the
highest-`seq` delivery whatever the row order; an api without the fields still renders a card.

**TC3 — The route (shared + api + web).** The step that carries the work.
- `fuelPlanning.ts` split: route resolution apart from the solve, which takes a polyline, a start
  offset and a truck state. The Fuel planning page's results must not move: its existing tests stay
  green unchanged, and one 748 replan is compared before and after.
- `projectOntoRoute(polyline, point)` in `packages/shared` (pure): distance along the line, distance
  off it, split index. Unit-tested on a straight line, a U-shaped line where the nearest vertex is on
  the wrong arm, and a point beyond either end.
- `GET /api/dispatch/loads/:id/route` (dispatch view, org-scoped, audit not needed for a read):
  route over the load's stops by `seq` with the truck profile of the load's vehicle; the projection of
  the truck's latest position; the solver on the remaining slice. Answers the line, the split, and the
  fuel stops (name, brand, address, lat/lng) — no prices (LM-F). A missing fuel reading answers the
  route with no fuel stops and the reason, never an error.
- `LiveMapCanvas`: a route source with two layers (covered, ahead) under the truck markers, a fuel-stop
  marker layer with its own popup; the toggle in the card (`D-TC7`).
*Done when:* on staging a mid-trip truck shows a lighter covered part ending at the truck, fuel stops
ahead of it, each clickable; pressing again clears it; a second press on the same load makes no HERE
call (cache hit, measured).

---

## 3. Open questions

**Q-TC1 — A truck still on its way to the pickup.** D-TC3 draws pickup → delivery, so a truck 80 miles
from its pickup sits off the line, and the fuel plan has no way to the start. Candidates: (a) show the
line only, and the card says "Truck has not reached the pickup"; fuel stops from the pickup with
today's fuel; (b) also draw the approach, truck → pickup, dashed, and plan fuel from the truck — one
more HERE call per press, uncached; (c) as (b) without fuel on the approach. **Recommendation: (a) for
TC3**, (b) as a follow-up if dispatchers ask
— measured today, every one of the 113 pickup stops on loads on a truck is departed in McLeod, so the case is rare.

**Q-TC2 — Hazmat routing.** A hazmat load's route should avoid what its classes may not use. Candidates:
(a) pass the classes from the load's `hazmat_loads` record when it is cleared, none otherwise; (b) treat
every hazmat-marked load as restricted for all classes. **Recommendation: (a)** — (b) routes a Class 9
load around tunnels a Class 1 must avoid, and the record is the evidence the hazmat module owns.

**Q-TC3 — `OFF_ROUTE_MILES`.** The distance past which a truck is "off this route". **Recommendation:
1 mile**, revisited after a week of real trucks; it is a constant beside `projectOntoRoute`, not a
setting.

---

## 4. Log

- **2026-10-09** — Request, research and rulings D-TC1–D-TC7 in one conversation. Measurements in §0
  taken against production that afternoon.
- **2026-10-09, later** — The owner asked for one standard truck size in every route; it was already
  the org setting the planner reads (§0), so nothing was copied onto vehicles. The owner accepted the
  recommendations: **Q-TC1 (a), Q-TC2 (a), Q-TC3 1 mile** — they are rulings now. TC1 built.
- **2026-10-09, evening — TC3 built.** As planned, with three things the build settled:
  - **Where it lives.** `GET /api/livemap/loads/:id/route`, beside the board in `livemap` (same gate,
    `dispatch` view + the module), not under `/api/dispatch`: the map module already composes `loads`
    and `samsara`, and `routing` importing `samsara/index` would close a module cycle. `loads` gained
    `readLoadForRoute`; `routing` gained `loadPlanningTruck`, `solveOnRoute` and `readStationAddresses`;
    the planner's stop view gained `stationId` (the only change to the Fuel planning page's answer —
    pinned by the new characterisation test, which was written and green BEFORE the split).
  - **Q-TC2 is half-built, on purpose.** Production has no `hazmat_loads` row and no hazmat-marked load
    on a truck; reading classes out of `declared_lines` is real work for zero rows today. A hazmat-marked
    load is routed WITHOUT restrictions and the card says so (`hazmatNotApplied`). **TC4** owes the
    class reader, the day the first hazmat record is cleared.
  - **Rehearsed read-only on production** (HERE called directly, no cache row written), six live loads:
    routes of 255–1,077 mi at the fleet standard; 4 of 6 trucks on their route (0–0.8 mi off), 2 off
    by 1.0 and 1.7 mi with 0 mi covered — at or near the pickup, Q-TC1's case; fuel planned on 5, one
    stop on 2 of them; one truck had no Samsara fuel sample in the last 3 h, so no fuel stops, said so.
