# Driver App — Navigation Programme Plan

> Owner: Silvicom Inc. · Status: **AUTHORING → BUILDING** · Supersedes the deferral in `DRIVER-APP-PLAN.md` §15 (D52) · Created 2026-08-01
>
> This is the "own programme" that **D52** promised. It starts from the handover note (`DRIVER-APP-PLAN.md` §8 + §15), reuses the server-side brain that is already built, and adds the client. **Every decision below is LOCKED (N1–N9)** unless a row says otherwise. Build **one phase per working session**; clear the §7 verification bar before commit; flip the phase boxes as they're met.

---

## §0. How to use / resume in a new chat

1. Read **§1 Locked decisions** and **§3 Progress ledger** first — the ledger says which phase is current and the next action.
2. Read the **current phase section in full** before building it. Each phase is self-contained: goal, deliverables, exit criteria, tests.
3. This programme is **grounded in existing code** — §2 lists exactly what is built server-side (untouched) and what is missing on the client. Do not re-derive it; verify against the repo if in doubt.
4. Routing is **not** re-implemented here — it stays on HERE, server-side, exactly as the web app uses it. This programme is the **on-device display + guidance client** over that route.

---

## §1. Locked decisions (N-register)

| # | Decision | Rationale |
|---|----------|-----------|
| **N1** | **Routing stays server-side on HERE.** The app requests a route for an accepted load and receives geometry + maneuver steps + fuel stops. Reuse `lib/here.ts::fetchTruckRoute` and `services/routeGeometry.ts::getOrComputeRoute` (truck profile: axle/weight/hazmat class/tunnel category) exactly as web dispatch does. No second routing vendor. | Reuses the whole built "brain"; consistent truck-legal routing across web + app; the user confirmed HERE is already the web investment. |
| **N2** | **v1 = display-only.** Live map with the HERE truck-route polyline, maneuver/turn cards, fuel-stop overlays, a GPS "you-are-here" puck, and off-route → server re-request. **No spoken voice guidance and no HERE Navigate Edition SDK in v1** (that is the deferred "Future" phase). | Matches the old §8 v1 lock; delivers a genuinely usable nav experience with zero new licensing; keeps the native surface small. |
| **N3** | **Map SDK = MapLibre React Native** (`@maplibre/maplibre-react-native`), rendering vector tiles. **Not** `react-native-maps` (Google/Apple native maps can't cleanly render free/self-hosted vector tiles, custom truck styling, or offline packs). | Free + swappable + offline-capable vector rendering; one SDK covers v1 display and the future offline packs. |
| **N4** | **Tiles = a free, no-account vector source for now** (e.g. OpenFreeMap or a Protomaps basemap style), wired behind a single **`MAP_STYLE_URL`** config seam so the source is swappable with a one-line change. **Interim resolution of D37** — the final vendor (MapTiler managed vs self-hosted Protomaps PMTiles) is deferred, not decided. **Honest caveat, not a hidden gap:** free public tile instances have no SLA and are appropriate for dev + pilot only; revisit (self-host OpenFreeMap/Protomaps or a paid tier) **before production scale**. | The user asked for "free maps for now" and is undecided on a vendor; the config seam means the choice never blocks the build and carries no rewrite cost later. |
| **N5** | **Expo dev-build workflow (binding).** MapLibre needs a config plugin + a custom dev client; it does not run in Expo Go (already true of `expo-sqlite`/SQLCipher, `expo-image-manipulator`, reanimated). `expo-dev-client` is already a dependency. All nav testing is on a dev build. | Native modules are unavoidable for maps; the workflow is already established in the app. |
| **N6** | **This programme reverses D52** and re-enters navigation into the roadmap **now**, ahead of the remaining driver-app phases, per explicit user direction (2026-08-01). Consequence acknowledged: **HazmatGuard (driver-app Phase 6) and the other remaining phases move later.** | User priority. Recorded so the roadmap change is traceable, mirroring how D52 recorded the original deferral. |
| **N7** | **Shell reconciliation.** The current `(tabs)/_layout.tsx` renders 5 native tabs with `navigate.tsx` as a dead `<Redirect href="/drive">` whose comment assumes a press-interception `NativeTabs` doesn't implement — this is the "broken routing" bug. Navigate becomes a **real tab destination** (the nav screen), OR the current-load Navigate CTA opens it; the dead redirect + modal-mismatch is removed. Reconciled in NP1. | Fixes the reported routing bug and gives navigation a real home now that it is no longer a deferred seam. |
| **N8** | **Location = `expo-location`, foreground for v1** (a "you-are-here" puck + camera follow + off-route detection). **Background location is deferred** (it needs Apple/Google always-on declarations + battery work) until the Future voice phase or a proven field need. | Foreground GPS covers display-only nav; background tracking is a store-review + battery liability we take on only when voice/continuous guidance needs it. |
| **N9** | **Driver route API is additive.** Add a driver-scoped read endpoint under `/api/me/**` that wraps `getOrComputeRoute` + the smart-fuel plan for the caller's own accepted/in-transit load (RLS + `driverOnly`, same pattern as `/api/me/equipment`, `/shift`). No changes to the web/dispatch route or the geometry cache. | Reuses the brain; keeps the driver surface isolated; mirrors the established `me.ts` driver-route conventions. |

---

## §2. What exists vs what's missing (grounded)

**Built server-side and untouched (the brain):**

- `apps/api/src/lib/here.ts` → `fetchTruckRoute(env, req): ParsedHereRoute` — live HERE Routing v8 fetch/retry/parse on a truck profile.
- `apps/api/src/services/routeGeometry.ts` → `getOrComputeRoute(admin, env, req): RouteGeometry` (+ `RouteGeometry` interface, `cacheKey`, `cached`) — cached geometry + turn-by-turn steps.
- Migrations `0059_route_geometries.sql`, `0060_route_geometry_steps.sql` (geometry + steps), `0074_fuel_plans.sql`, `0058_smart_fueling_spine.sql`, `0028_fueling_event.sql`.
- `packages/shared/src/smartFueling/` → `planFuelStops` solver, `RouteFuelSettings`, alert thresholds. Rendered for dispatch by `apps/web/src/features/fueling/**` today.

**Missing on the client (this programme's work):**

- **No driver-facing route endpoint.** `apps/api/src/routes/me.ts` exposes `/driver`, `/equipment`, `/shift`, loads/accept, etc. — nothing serves route geometry + fuel plan to a driver. (NP1 adds it — N9.)
- **No map SDK.** `@maplibre/maplibre-react-native` is not a dependency; `expo-location` is not a dependency. `expo-dev-client` **is** present.
- **`apps/driver/app/(tabs)/navigate.tsx`** = 3-line `<Redirect href="/drive">`; **`app/drive.tsx`** + **`src/features/nav/RoutePreview.tsx`** = honest hardcoded schematic previews (dummy load LD-20481, static SVG, no real data).
- **Shell drift** (N7): 5 rendered tabs vs the D51-intended 4 + reserved center; dead redirect.

**Environment (grounds the SDK choice):** Expo SDK `^57.0.0`, React Native `0.86.0`, React `19.2.3`, **`newArchEnabled: true`** (Fabric). Native config is `apps/driver/app.config.ts`.

---

## §3. Progress ledger

| Phase | Scope | Build | Next action |
|-------|-------|-------|-------------|
| **NP0** — Map spike & foundations | MapLibre renders on this exact Expo 57 / RN 0.86 / new-arch dev build; free tiles via `MAP_STYLE_URL`; a hardcoded polyline draws | ☐ | **CURRENT** — prove the SDK/tile stack on a real dev build before building features on it |
| **NP1** — Driver route API + static render + shell fix | `GET /api/me/**` route endpoint (N9); app draws the real HERE polyline + maneuver list + fuel-stop markers for the accepted load; shell reconciled (N7) | ☐ | after NP0 |
| **NP2** — Live location, follow & off-route | `expo-location` puck + camera follow + off-route → re-request | ☐ | after NP1 |
| **NP3** — Maneuver guidance UI + lifecycle triggers | Next-maneuver banner, distance/ETA, fuel-stop detail, `in_transit` opens nav, arrive/depart | ☐ | after NP2 |
| **NP4** — Offline, performance & polish | Offline tile pack + cached route, battery/perf, dark map style, a11y | ☐ | after NP3 |
| **Future** — True voice turn-by-turn | HERE Navigate Edition SDK, native bridge, background location + store declarations, offline nav | ☐ | v2 — licensing-gated, out of v1 |

---

## §4. Phases

### NP0 — Map spike & foundations (CURRENT)

**Goal / demoable outcome.** On a **dev build** of the driver app, a full-screen map renders free vector tiles (via `MAP_STYLE_URL`) with a hardcoded truck-route polyline drawn over it, in light and dark. This is a **de-risking spike** — Expo 57 / RN 0.86 / new-arch is newer than most map libraries' tested matrix, so we prove the stack before building features on it.

**Deliverables.**
1. Add `@maplibre/maplibre-react-native` + its Expo **config plugin** to `app.config.ts`; add `expo-location` (config only, used in NP2). Rebuild the dev client.
2. A `MapView` component in `src/features/nav/` reading `MAP_STYLE_URL` from `src/lib/env.ts` (default: a free no-account style URL); token-linter-clean (raw colors only in `theme/`).
3. Draw a hardcoded GeoJSON `LineString` (a real HERE polyline sample) as a branded route line; a start + end marker.
4. Light/dark map style handling wired to `ThemeProvider`.

**Exit criteria.** Map + polyline render on a physical device dev build in both themes; no new-arch/Fabric crash; `MAP_STYLE_URL` swap changes the basemap with no code change. If MapLibre proves incompatible with Expo 57/RN 0.86, **stop and report** with the specific error before proceeding (do not force an unreleased native patch).

**Risks.** Bleeding-edge Expo/RN vs MapLibre native compat (this phase exists to find out early); config-plugin prebuild issues.

### NP1 — Driver route API + static route render + shell fix

**Goal.** Open Navigate for a real accepted load and see its **real** HERE truck route, maneuver list, and planned fuel stops on the map — all from the server, no dummy data. The broken tab routing (N7) is fixed.

**Deliverables.**
1. **API (N9):** `GET /api/me/loads/:id/route` (driverOnly, RLS-scoped to the caller's own load) → `{ geometry, steps, fuelStops }` by calling `getOrComputeRoute` (+ reusing/creating the smart-fuel plan). Contract typed in `packages/shared` so the app and API share it. Mirror `me.ts` conventions (`resolveDriverId`, `apiError`, `asyncHandler`).
2. **App data layer:** a `useLoadRoute(loadId)` query (offline-first cache, like the other driver queries) hitting the new endpoint.
3. **Render:** replace `RoutePreview`'s schematic with the live map — decode the polyline, draw the route, plot fuel-stop markers, list maneuver steps beneath the map.
4. **Shell reconciliation (N7):** make Navigate a real destination; remove the dead `<Redirect>`/modal mismatch; reconcile the tab set with `DRIVER-APP-PLAN.md` D51 (update that decision's row to note navigation is un-deferred).

**Exit criteria.** For a seeded accepted load, the real route + fuel stops render; a load with no route degrades gracefully (honest empty state); tapping Navigate routes cleanly with no jank; API has a route-contract test; typecheck/lint/boundaries green.

### NP2 — Live location, follow & off-route

**Goal.** The driver sees their position on the route and the app notices when they leave it.

**Deliverables.** `expo-location` foreground permission flow (graceful denial); a "you-are-here" puck + heading; camera-follow mode with a recenter control; **off-route detection** (distance-from-polyline threshold) → re-request the route from the server (N1) and redraw.

**Exit criteria.** Puck tracks movement; recenter works; a deliberate detour triggers exactly one re-route (debounced), not a storm; permission-denied path is non-blocking.

### NP3 — Maneuver guidance UI + fuel-stop detail + lifecycle triggers

**Goal.** Turn-by-turn *display* guidance (no voice) that's genuinely usable in the cab.

**Deliverables.** Next-maneuver banner (icon + text + distance to it) driven by the server steps + live position; remaining distance/ETA; fuel-stop detail sheet (price, gallons to buy, in-range badge — from `planFuelStops`); a load reaching **`in_transit`** offers/opens Navigate; arrive/depart-stop affordances feeding the existing outbox where relevant.

**Exit criteria.** The next-maneuver banner advances correctly as position progresses along the steps; ETA is sane; fuel-stop detail matches the dispatch numbers; lifecycle trigger works end-to-end on a seeded load.

### NP4 — Offline, performance & polish

**Goal.** Works in a dead zone; doesn't cook the phone on an all-day shift.

**Deliverables.** Offline tile pack (MapLibre offline region **or** a bundled Protomaps `.pmtiles` for the operating area); cache the last route for offline display; battery/location-accuracy tuning (foreground + significant-change); dark map style parity; a11y pass (labels, contrast, dynamic type).

**Exit criteria.** With the network off after first load, the map + route still display; a measured battery/CPU sanity pass over a simulated shift; light/dark parity; a11y checks pass.

### Future — True voice turn-by-turn (v2, deferred)

Out of v1 (N2). When pursued: HERE SDK Navigate Edition licensing + per-driver cost, an Expo config-plugin native bridge, spoken guidance + continuous rerouting, offline nav packs, **background location** with Apple/Google always-on declarations, and background battery behaviour. Author as its own phase section when v1 has shipped and field testing proves the need.

---

## §5. Dependencies & procurement (owner: Miki)

- **Final map-tile vendor** — deferred (N4). Free source now; before production scale choose MapTiler (managed, account + key) or self-hosted Protomaps PMTiles (host a `.pmtiles`). Procurement/accounts are yours; I wire whatever you pick into `MAP_STYLE_URL`.
- **Dev build capability** — a custom dev client (local prebuild or EAS) is required from NP0 (N5).
- **HERE usage** — routing already runs on HERE server-side; the driver endpoint adds read volume against the same cached geometry (cache-keyed, so repeated opens of the same load don't re-bill). No new vendor.
- **Store declarations** — only if/when the Future voice phase adds background location. Not needed for v1.

## §6. Risks (top items)

| Risk | Mitigation |
|------|------------|
| Expo 57 / RN 0.86 / new-arch vs MapLibre native compatibility | NP0 is a dedicated spike; fail fast + report, don't force unreleased patches |
| Free public tile SLA / rate limits at scale | Config seam (N4); pilot-only until a vendor/self-host decision; documented, not hidden |
| GPS drift in urban canyons → false off-route | Distance threshold + debounce (NP2); require sustained deviation before re-route |
| Battery drain from continuous GPS | Foreground-only + accuracy tuning (NP4); background deferred (N8) |
| HERE per-route cost | Reuse the existing geometry cache (`getOrComputeRoute`); driver opens hit cache |

## §7. Verification bar (every phase, before commit)

Typecheck + lint (api, web, shared, driver) green; feature-boundary + design-token linters clean; new API has a contract/RLS test; **driver-app changes get a device pass on a dev build** (the map/native surface can't be fully unit-tested); no hardcoded colors outside `theme/`.

## §8. Testing

API: route-endpoint contract + RLS (driver can only fetch their own load's route). Shared: any new geometry/型 helpers unit-tested. App: logic (off-route math, ETA) in pure modules unit-tested off the native surface; the map/location/render path verified by device pass per phase.

## §9. Sources

`DRIVER-APP-PLAN.md` §8 (maps approach), §15 (D52 handover), D37/D51/D52; `apps/api/src/lib/here.ts`, `services/routeGeometry.ts`, migrations 0058/0059/0060/0074; `packages/shared/src/smartFueling/`; `apps/driver/app/(tabs)/_layout.tsx`, `navigate.tsx`, `drive.tsx`, `src/features/nav/RoutePreview.tsx`, `package.json`, `app.config.ts`.
