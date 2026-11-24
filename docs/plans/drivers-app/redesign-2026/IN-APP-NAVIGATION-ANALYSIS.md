# In-app navigation for the driver app: MapLibre and HERE (2026-11-23)

Written for the owner's ruling of 2026-11-23 (`DRIVER-APP-FEATURE-LIST-FOR-RULING.md`, DF-21). This is
analysis only; nothing is built. Question ids: **Q-NV1..** (unused in the repo on 2026-11-23).

## 1. What we already have (read from the code, 2026-11-23)

| Piece | Where | State |
|---|---|---|
| MapLibre in the driver app | `@maplibre/maplibre-react-native` 11.3.6; `src/features/nav/NavMap.tsx` | **Spike only.** It draws a hard-coded Joliet→Columbus line. The `navigate` tab is hidden and renders in DEV builds only. |
| Driver basemap | `src/lib/env.ts:36-37` | OpenFreeMap `liberty`/`dark` (free, no key). This is a public community server with no SLA (see §4). |
| HERE truck routing | `apps/api/src/lib/here.ts`, `packages/shared/src/smartFueling/hereRoute.ts` | **Live and proven.** HERE Routing v8 `transportMode=truck` with weight, height, width, length, axles, hazmat classes and tunnel category. It already asks for `return=polyline,summary,actions,instructions`, so **turn-by-turn instructions come back today**. Retries on 429/5xx. |
| Route cache | `apps/api/src/modules/routing/routeGeometry.ts` (`route_geometries`) | Keyed by stops + truck profile + hazmat. Usage was ~5 routes/day in October. |
| HERE map tiles | `routing/routes/mapProxies.ts` (`/map-tiles`) | Web only. The key stays on the server. HERE rate-limits our key under bursts (429, memory `map-zoom-speed-measurements`). |
| Web live map | `apps/web` maplibre-gl 5 | Truck card, load route, fuel stops (TC1–TC3). |
| Navigation plan | `NAVIGATION-PROGRAMME-PLAN-V2.md` (2026-08-08) | Self-hosted Valhalla + our own cited restriction dataset + Ferrostar guidance. Eight phases, months of work. Its NP0 never started. Its cost table assumes Hetzner, which no longer fits the **AWS-only** rule (2026-11-15). |

**So the expensive half already exists:** a truck-legal route for the load's stops, built for the
load's truck and hazmat. What is missing is everything on the phone: the live map, following the truck,
spoken turns, and re-routing when the driver leaves the route.

## 2. The options

| | A. Route preview + hand-off | B. Our own guidance on HERE routes | C. HERE SDK Navigate | D. The v2 programme (Valhalla + Ferrostar) |
|---|---|---|---|---|
| What the driver gets | The truck-safe route on a map in our app, the stops, the turn list, and "Start" opens the driver's own GPS app | Full turn-by-turn in our app: following map, voice, re-route | Full turn-by-turn, offline maps, restriction warnings ahead (HERE's WarnerEngine) | Same as C, plus a cited reason for every restriction |
| Routing | HERE (built) | HERE (built), server-side re-route | HERE, on the device | Self-hosted Valhalla |
| Device engine | None | **Ferrostar** (BSD; MapLibre-based). It takes a custom route, so our server converts HERE into its format. | HERE native SDK | Ferrostar + offline Valhalla |
| React Native | Fine (MapLibre RN, which we have) | Ferrostar's RN packages are **pre-alpha, not on npm** (0.58/0.59, Oct 2026). Fallback: a native full-screen guidance view launched from RN, the same pattern as our `capture-native` module. | **No RN SDK.** A native bridge on both platforms. | Same as B |
| Cost | HERE per-request only (cents/month at our volume) | Same + re-route calls | **No public price.** Navigate is quote-only and needed for any turn-by-turn. | ~$1.5–1.8/truck/month infra in the plan (Hetzner; needs an AWS re-cost) + months of engineering |
| Offline | Map tiles only, if cached | Online re-route only. The current route keeps working without signal. | Yes | Yes (NP5) |
| Time to a driver | **~2–3 weeks** | ~6–10 weeks after A | Unknown until a quote; ~8–12 weeks of bridging | 6+ months |
| Truck-safety claim | Ours for the route shown. The hand-off app is labelled **not truck-checked** (NAV-17). | Ours, as long as the driver stays on our route. A re-route is HERE truck again. | HERE's | Ours, with citations |

## 3. Recommendation

**Build A now, design B behind it, and do not start C or D.**

1. **A is most of the value for little work.** The server already makes the truck-legal route. The app
   needs one driver endpoint (the load's cached route for *its own* dispatched load, org- and
   driver-scoped) and one screen.
   - The screen shows the MapLibre map, the route line, numbered stops, the next three turns from HERE's
     `instructions`, the miles and time left, and a **"Start"** button.
   - "Start" asks once which app the driver uses. It hands over the next stop's coordinates, never a
     street address, because shipper addresses geocode badly.
   - It also answers "is this route OK for my truck?" before the driver leaves, which no hand-off app
     answers.
2. **B is the real in-app navigation, and HERE stays the router.** No new vendor and no new dataset.
   - Our server converts HERE's route to Ferrostar's format. Ferrostar on the phone does the snapping,
     the off-route detection and the step advance.
   - Off-route means "ask our server for a new HERE truck route from here". `expo-speech` reads the turns.
   - Start with a 2-week spike (Q-NV3): try Ferrostar RN from a pinned tag first, then the native
     full-screen fallback.
3. **C is closed until HERE quotes a price.** v2 dropped HERE Navigate because of an unquotable per-user
   licence and no RN support. Both are still true in November 2026.
4. **D stays the long-term product plan**, and A and B do not waste it. Ferrostar is the guidance plane
   in D too, and v2 already makes the router swappable (NAV-1). Moving B from HERE to Valhalla later is
   a server change only.

## 4. Things to settle before A ships

| Id | Question | Recommend |
|---|---|---|
| **Q-NV1** | **Which basemap does the phone use?** OpenFreeMap is free but has no SLA; HERE tiles through our proxy are already rate-limited by bursts; Q-DR35 proposes self-hosted OSM PMTiles on S3 + CloudFront (~$3–5/month) for the web map. | One answer for web and phone: **self-hosted PMTiles** (Q-DR35). It also gives B offline maps later. Until then, OpenFreeMap. |
| **Q-NV2** | **HERE licence.** Q-DR38 (open) found HERE's Limited Base plan excludes "Asset Management", i.e. showing tracked vehicles and their routes. Using HERE routes for in-app driving may also fall under a licence line. | The owner checks our HERE plan in the HERE console before A reaches drivers. |
| **Q-NV3** | Approve the 2-week B spike (Ferrostar on a pinned tag; native full-screen fallback). | Yes, after A |
| **Q-NV4** | **Which apps does "Start" offer?** Google Maps, Apple Maps, Waze, or truck apps the drivers already use (Trucker Path, CoPilot). Car apps get a "not truck-checked" label. | Ask three drivers which app they use today. |
| **Q-NV5** | **Samsara Commercial Navigation.** We already pay Samsara, which shipped truck navigation in 2025-11. If it is in our contract, "Start" could open it. v2 NP0.0 asked for this quote line and it was never answered. | Ask the Samsara rep, in writing. |
| **Q-NV6** | **Truck profile per load.** HERE needs height, weight and hazmat. Today the profile comes from org/truck settings. A load with an unknown weight must show "profile incomplete" and never pretend (NAV-6). | Yes, as NAV-6 says |
| **Q-NV7** | **While driving** (Q-DF-4). The map and voice stay on; typing, capture and messages lock (NAV-16). | Yes |

## 5. Where it sits in the app

The **Navigate** screen opens from the load (Today card → "Route") and from each stop. It is not a tab,
so the tab bar stays Today · Loads · Messages · Me.
- Before departure: the route preview (A).
- While moving: the guidance view (B), with the next stop's "Arrived" button when the truck is inside
  the stop's geofence.

## Sources

- [Ferrostar Book](https://stadiamaps.github.io/ferrostar/)
- [Ferrostar RN usable PR #883](https://github.com/stadiamaps/ferrostar/pull/883)
- [Ferrostar on makewithmaplibre](https://makewithmaplibre.com/routing/ferrostar/)
- [HERE SDK licences](https://docs.here.com/here-sdk/docs/android-introduction-editions)
- [HERE SDK truck navigation](https://docs.here.com/here-sdk/docs/android-navigation-truck)
- [HERE SDK pricing (Techjockey)](https://www.techjockey.com/detail/here-sdk)
- [HERE SDK reseller (Placematic)](https://placematic.com/here-location-services/here-sdk/)
