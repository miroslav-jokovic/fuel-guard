# Driver App — Commercial Navigation Programme Plan

> Owner: Silvicom Inc. · Status: **AUTHORING → BUILDING** · Supersedes the deferral in `DRIVER-APP-PLAN.md` §15 (D52) · Created 2026-08-01 · **North-star revised 2026-08-01: a full commercial truck-navigation product that beats Samsara on precision.**
>
> **What we are building:** a commercial navigation product for truck drivers on par with **Samsara Commercial Navigation** (launched Nov 2025) on features, and **ahead of it on precision** — because we route on **HERE Routing v8 (truck profile)** and layer our own **HazmatGuard CFR engine** and **smart-fueling optimization** on top. Delivered in two milestones: **Milestone 1** ships a display-first foundation that de-risks the native map stack; **Milestone 2** builds the full turn-by-turn product (voice, live traffic, rerouting, last-mile, HOS, CarPlay). Display-only is a **stepping stone, not the goal.** Every decision is LOCKED (N1–N12) unless a row says otherwise. Build one phase per session; clear §7 before commit.

---

## §0. Vision & competitive target

**The bar: Samsara Commercial Navigation.** From Samsara's published materials, their product does: vehicle-profile routing (height/weight/length/width/hazmat), bridge-strike avoidance, real-time traffic with dynamic rerouting, HOS integration, in-cab via CarPlay + the driver app, preferred-fuel-vendor recommendations with low-fuel reroute, last-mile guidance to gates/yards/docks with saved entry notes, a shared live dispatcher/driver view, and fleet-admin profile management. Samsara **does not disclose its map/routing provider** ("map data from multiple sources" + their telematics); historically their app handed drivers off to *external* nav (Google Maps, Trucker Path) and their own nav is new (Nov 2025 US / Apr 2026 global).

**Why we can be more precise.** Precision in truck nav comes from the **routing engine + truck map attributes**, not the basemap renderer. We already route on **HERE Routing v8 with a full truck profile** (axle/weight/hazmat class/tunnel category) — one of the two industry-standard truck-legal routing engines. On top of HERE we have two things Samsara does not: the **HazmatGuard engine** (49 CFR placards/segregation/route restrictions — real compliance depth) and **smart-fueling** (price-optimized fuel stops in the route). That trio — HERE truck routing + hazmat-compliance routing + fuel optimization — is our differentiation.

**Layer clarity (resolves the "MapLibre vs Google Maps" question).** MapLibre is the **renderer** (draws the basemap); it is provider-agnostic and renders the HERE route over any tiles. It is **not** the precision lever and is the correct choice to keep. HERE is the **routing/precision** engine. Google Maps would be a *weaker* choice here — its consumer routing is comparatively weak on truck-legal constraints.

**Feature-parity tracker (we build toward each; ✅ = differentiator we already have server-side):**

| Samsara capability | Our plan | Notes |
|---|---|---|
| Vehicle-profile routing (H/W/L/W + hazmat) | NP1 + NP6 | ✅ HERE truck profile already built; extend avoidance params |
| Bridge-strike / low-clearance avoidance | NP6 | HERE truck attributes |
| Real-time traffic + dynamic rerouting | NP6 | HERE traffic; off-route reroute from NP2 |
| Turn-by-turn **voice** guidance | NP5 | SDK decision (N10) |
| HOS-aware routing | NP8 | ties to driver duty/HOS state |
| In-cab CarPlay / Android Auto | NP8 | entitlements (N12) |
| Preferred fuel + low-fuel reroute | NP3 + NP6 | ✅ smart-fueling built; make it live |
| Last-mile to gates/yards/docks + entry notes | NP7 | geofenced arrival + saved notes |
| Shared live dispatcher/driver view | NP9 | live position feed to the web dispatch |
| Fleet-admin vehicle profiles | NP9 | admin-managed routing profiles |
| **Hazmat-compliance routing** | NP6 | ✅ **our edge — Samsara has no CFR engine** |

---

## §1. Locked decisions (N-register)

| # | Decision | Rationale |
|---|----------|-----------|
| **N1** | **Routing stays server-side on HERE** (truck profile), reusing `lib/here.ts::fetchTruckRoute` + `services/routeGeometry.ts::getOrComputeRoute`. Extended over the programme with traffic-aware + avoidance parameters. | Reuses the built precision core; consistent with the web app; HERE is the truck-routing standard. |
| **N2** | **The programme targets FULL turn-by-turn commercial navigation** (Milestone 2). **Display-only is Milestone 1** — a shippable stepping stone that de-risks the native map/stack — **not the end state.** Voice/live guidance is committed, not "someday." | Corrects the earlier "display-only v1, voice deferred" framing to match the real goal: beat Samsara. |
| **N3** | **Map SDK = MapLibre React Native** (renderer). | Free, swappable, offline-capable vector rendering; provider-agnostic; not the precision lever. |
| **N4** | **Tiles = a free, no-account vector source now** (CARTO/OpenFreeMap) behind `MAP_STYLE_URL`. Revisited in Milestone 2 for a production tile + traffic-tile decision (MapTiler / self-host / HERE tiles). | "Free for now"; the seam makes the production choice a config change. |
| **N5** | **Expo dev-build workflow (binding).** | MapLibre + later nav SDK are native; won't run in Expo Go. |
| **N6** | **Reverses D52** — navigation re-enters the roadmap now as its own flagship programme, ahead of the remaining driver-app phases, per user direction. | User priority; recorded like D52 recorded the deferral. HazmatGuard (driver Phase 6) + others move later. |
| **N7** | **Shell reconciliation** — Navigate becomes a real tab destination; the dead redirect is removed (done in the tab-bar refactor). | Fixes the reported routing bug. |
| **N8** | **Location:** `expo-location` foreground for Milestone 1; **background location** (required for continuous turn-by-turn) is added in Milestone 2 (NP5/NP8) with the Apple/Google always-on declarations. | Take the store-review + battery liability only when voice guidance needs it. |
| **N9** | **Driver route API is additive** under `/api/me/**` (RLS + driverOnly), wrapping `getOrComputeRoute` + smart-fuel plan for the caller's own load. | Reuses the brain; isolated driver surface. |
| **N10** | **Turn-by-turn engine/SDK = a deferred decision made at NP5**, via a spike. Options: **HERE Navigate SDK** (matches our routing, truck-grade, licensed/per-driver cost), **Mapbox Navigation SDK** (good UX, routing mismatch), or **custom** (MapLibre + HERE route steps + on-device TTS + our own guidance state machine). Leaning **custom-on-HERE-steps** (keeps HERE as the single routing brain, no per-driver license, full control) — confirmed by the NP5 spike. | Voice TBT is the biggest technical piece; pick it with real numbers, not up front. |
| **N11** | **North star = feature parity with Samsara Commercial Navigation + precision/compliance/fuel differentiation.** The §0 tracker is maintained as features land. | Keeps the programme honest against a concrete competitor. |
| **N12** | **CarPlay / Android Auto + background location + store declarations** are Milestone-2 concerns (NP8), not v1. | They gate app-store review; scoped to the phase that needs them. |

---

## §2. What exists vs what's missing (grounded)

**Built server-side (untouched):** `lib/here.ts::fetchTruckRoute` (HERE v8 truck profile), `services/routeGeometry.ts::getOrComputeRoute` (cached geometry + steps), migrations `0059/0060` (geometry + steps), `0074/0058/0028` (fuel plans + spine), `packages/shared/src/smartFueling` (`planFuelStops`). Web dispatch renders all of it.

**Missing on the client (this programme):** a driver-facing route endpoint (N9 — `me.ts` doesn't expose it); MapLibre (added NP0) + `expo-location`; the map/guidance UI; and everything in Milestone 2 (voice, traffic, last-mile, HOS, CarPlay, dispatcher live view). `navigate.tsx`/`RoutePreview.tsx` are honest placeholders; `expo-dev-client` is present.

**Environment:** Expo SDK 57, RN 0.86, React 19, new-arch on. Native config `app.config.ts`.

---

## §3. Progress ledger

### Milestone 1 — Display-first foundation (de-risk the stack, ship a real route view)
| Phase | Scope | Build | Next |
|-------|-------|-------|------|
| **NP0** — Map spike | MapLibre renders on Expo57/RN0.86/new-arch + free tiles + a hardcoded route line | ◐ code written; **needs your dev build** | verify render |
| **NP1** — Driver route API + static render + shell fix | `/api/me/**` route endpoint; draw the real HERE route + fuel stops for the accepted load | ☐ | after NP0 |
| **NP2** — Live location, follow & off-route | `expo-location` puck + camera follow + off-route → re-request | ☐ | after NP1 |
| **NP3** — Maneuver UI + fuel detail + lifecycle | next-maneuver banner, ETA, live fuel stops, `in_transit` opens nav | ☐ | after NP2 |
| **NP4** — Offline, performance & polish | offline tile pack + cached route, battery, dark map, a11y | ☐ | after NP3 |

### Milestone 2 — Full commercial navigation (beat Samsara)
| Phase | Scope | Build | Next |
|-------|-------|-------|------|
| **NP5** — Turn-by-turn **voice** guidance (+ SDK decision N10) | spoken step guidance, lane hints, background location; the guidance engine spike + choice | ☐ | after NP4 |
| **NP6** — Live traffic + dynamic rerouting + avoidance | HERE traffic; reroute on congestion/closure; bridge/weight/hazmat avoidance params surfaced | ☐ | after NP5 |
| **NP7** — Last-mile precision | geofenced gates/yards/docks, saved entry notes, arrival/dwell detection | ☐ | after NP6 |
| **NP8** — HOS-aware routing + CarPlay/Android Auto | route respects duty/HOS windows; in-cab head-unit UI + entitlements (N12) | ☐ | after NP7 |
| **NP9** — Shared dispatcher live view + fleet profiles | live driver position/ETA to web dispatch; admin-managed vehicle routing profiles | ☐ | after NP8 |

---

## §4. Phase detail

### Milestone 1

**NP0 — Map spike (code written; awaiting your dev build).** MapLibre `MapView` on the free themed basemap + a hardcoded route polyline + start/end markers, behind `MAP_STYLE_URL`. Exit: renders on a physical dev build in light + dark; if MapLibre is incompatible with Expo 57/RN 0.86, stop and report.

**NP1 — Driver route API + static render + shell fix.** `GET /api/me/loads/:id/route` (driverOnly, RLS) → `{ geometry, steps, fuelStops }` via `getOrComputeRoute` + `planFuelStops`, typed in `@fuelguard/shared`; a `useLoadRoute(loadId)` query; draw the real polyline + fuel markers + maneuver list; make Navigate a real destination. Exit: real route renders for a seeded load; graceful empty state; route-contract test; typecheck/boundaries green.

**NP2 — Live location, follow & off-route.** `expo-location` foreground; you-are-here puck + heading; camera-follow + recenter; off-route detection (distance-from-polyline, debounced) → server re-request. Exit: puck tracks; one debounced reroute on a real detour; permission-denied non-blocking.

**NP3 — Maneuver UI + fuel detail + lifecycle.** Next-maneuver banner (icon + distance) from server steps + live position; remaining distance/ETA; live fuel-stop detail (price/gallons/in-range from `planFuelStops`); `in_transit` opens/offers Navigate; arrive/depart affordances into the outbox. Exit: banner advances along steps; ETA sane; fuel numbers match dispatch.

**NP4 — Offline, performance & polish.** Offline tile pack (MapLibre region or bundled `.pmtiles`) + cached route; battery/accuracy tuning; dark map parity; a11y. Exit: map + route display with the network off after first load; battery/CPU sanity pass; a11y checks pass.

### Milestone 2 (specs firmed when each phase is reached — the north star is fixed, the detail is authored just-in-time)

**NP5 — Turn-by-turn voice guidance.** Spike the N10 options and choose; build spoken step-by-step guidance driven by live position vs the HERE step list, with lane guidance where available, on-device TTS, and background location (N8/N12 declarations). Exit: hands-free spoken guidance end-to-end on a real drive; guidance survives backgrounding.

**NP6 — Live traffic + dynamic rerouting + avoidance.** Consume HERE traffic; reroute on congestion/closure (extends NP2's off-route); surface + honor bridge/height/weight/hazmat avoidance parameters (HERE truck attributes) — the precision parity + our hazmat-routing edge. Exit: a live congestion event reroutes; a low-bridge/hazmat-restricted road is avoided and shown as why.

**NP7 — Last-mile precision.** Geofenced gates/yards/docks with saved entry notes per facility; guided last-mile beyond the public road; arrival + dwell detection feeding the load lifecycle. Exit: arriving at a seeded facility shows the right gate + notes; dwell recorded.

**NP8 — HOS-aware routing + CarPlay/Android Auto.** Route + fuel/rest planning respects the driver's duty/HOS windows; an in-cab CarPlay + Android Auto surface (entitlements, simplified UI). Exit: a route near an HOS limit suggests a compliant stop; the head-unit surface navigates.

**NP9 — Shared dispatcher live view + fleet profiles.** Live driver position + ETA streamed to the web dispatch board (a shared live view); fleet-admin-managed vehicle routing profiles (dimensions/hazmat) that feed the truck route. Exit: dispatch sees a live truck moving on the route; an admin profile change changes the route request.

---

## §5. Dependencies & procurement (owner: Miki)

- **Turn-by-turn SDK / engine** (N10) — decided at NP5; if HERE Navigate or Mapbox Nav, that's licensing/procurement (I can't purchase). Custom needs no license.
- **Production tiles + traffic** (N4/N6) — free now; a production tile + HERE-traffic decision in Milestone 2 (accounts/keys are yours).
- **CarPlay / Android Auto entitlements** (N8/N12) — Apple MFi/CarPlay + Google entitlements + store declarations for background location; app-store review gating.
- **Dev build capability** — required from NP0 (custom dev client / EAS).
- **HERE usage** — routing already on HERE; traffic + more requests add read volume against the cached geometry.

## §6. Risks (top items)

| Risk | Mitigation |
|------|------------|
| Expo 57 / RN 0.86 / new-arch vs MapLibre (and later nav SDK) native compat | NP0 spike; fail-fast + report |
| Voice-nav is the hardest piece | N10 spike at NP5 before committing an approach; lean custom-on-HERE-steps for control/no-license |
| Background location battery + store review | Scoped to NP5/NP8 with declarations; foreground-only until then |
| Free tile SLA at scale | Config seam; production tile decision in Milestone 2 |
| CarPlay/Android Auto review complexity | Isolated to NP8; simplified head-unit UI |
| HERE cost (routing + traffic) | Reuse the geometry cache; bound request rate |

## §7. Verification bar (every phase)

Typecheck + lint (api/web/shared/driver) green; boundary + design-token linters clean; new API has a contract/RLS test; **driver-app changes get a device pass on a dev build** (map/native surface); pure logic (off-route math, ETA, guidance state) unit-tested off the native surface; no hardcoded colors outside `theme/`.

## §8. Sources

`DRIVER-APP-PLAN.md` §8/§15, D37/D51/D52; `apps/api/src/lib/here.ts`, `services/routeGeometry.ts`, migrations 0058/0059/0060/0074; `packages/shared/src/smartFueling`; `apps/driver` map/route/config files. Competitive reference: Samsara Commercial Navigation (samsara.com product + Nov 2025 launch materials) — features tracked in §0; provider undisclosed by Samsara.
