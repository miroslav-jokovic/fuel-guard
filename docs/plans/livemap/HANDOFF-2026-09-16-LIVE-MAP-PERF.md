# Handoff — the live map: performance, then consolidation, 2026-09-16

**START HERE** for the live map. Read this, then `docs/plans/design-system/DESIGN-REFRESH-2026-09.md`
**§7 — the dated log at the END**, for D-DR8 / D-DR19 / D-DR20 / D-DR21, which are the four rulings
this queue builds on. `LIVE-MAP-PLAN.md` in this folder is the original programme (LM1–LM12) and is
still canonical for the board, the states and the scoping rule.

⚠ This file goes stale the moment the next step lands. Where it names a position, `git log` and the
plan's §7 outrank it.

`main` is at **`545ae58`**. Everything below was measured on this machine on 2026-09-16, in a browser
or against the vendor with the production key — the numbers are reproducible, not estimates.

---

## 1. The owner's rulings, so nobody re-litigates them

- **Q-DR1 — the driver app takes NO change.** The brand-hue rotation stays web-only;
  `apps/driver/src/theme/theme.roles.json` is untouched. A later step that rotates it is changing
  identity and should say so rather than treating it as a leftover.
- **DR7 was narrowed to the Dashboard and the Dispatch live map, and both are done.**
- **⚠ THE TWO LIVE MAPS BECOME ONE, AND THE DASHBOARD'S DISPATCH TAB IS THE SURVIVOR** — option
  **(a)**, confirmed 2026-09-16. This **overrules D-DW5**, which says the map is both a widget and a
  page and "neither substitutes for the other". `/live-map` goes; the Dispatch tab is the live map.
- **The drawer is the wrong shape for the truck detail.** Owner's call, and the research below agrees.

---

## 2. What shipped today

| PR | what | `main` after |
|---|---|---|
| #826 | **DR7a** — operating-metrics strip: the chip it always carried, a grid its captions fit in | `5512601` |
| #827 | **D-DR8** — the live map's basemap follows the reader's colour scheme | `2a00371` |
| #828 | **DR7b** — `RiskList` takes `ChartCard`'s header; handoff refreshed | `e6a88ae` |
| #829 | the random `test-api` failure — the label-sheet normaliser was stripping no date at all | `1499d5e` |
| #830 | **D-DR19** — a night hero plate for dark mode, instead of dimming the dawn | `be830a3` |
| #831 | **D-DR20/D-DR21** — basemap switcher (Map/Satellite/Terrain) + our own control rail | `545ae58` |

All merged, gate-green, looked at in a browser.

---

## 3. The queue — one step per PR, in this order

The order is by measured value over cost, and the last item is last for a reason: the consolidation is
the right moment to do the layout, rather than doing the layout twice.

### 3.1 Tile format — the biggest measured win and the smallest change · **SHIPPED as D-DR22**

✅ **Done 2026-09-16.** All four basemaps are jpeg; the trade was looked at before it shipped and the
label contrast measured either side of it (within ±0.2 over six label runs). The estimates below were
low by a third on the png side — re-measured across five tiles from z5 to z14, `explore.day` is
**286 KB → 47 KB** on a dense city tile and 270 KB → 29 KB at the national view, i.e. 84–91% rather
than the 87% guessed from one tile. The full entry, including where the loss actually lands, is
`DESIGN-REFRESH-2026-09.md` §7 under **D-DR22**. ⚠ `RouteMapGL` still sends no format and still gets
png — deliberately left for the colour-scheme fix it is already queued for in §7.

`apps/api/.../mapProxies.ts` already takes a `format` parameter (D-DR20 added it for satellite).
The road styles still ask for **png**, and png is the wrong container for these tiles:

| style | png | jpeg | saving |
|---|---|---|---|
| `explore.day` | 260 KB | **33 KB** | **87%** |
| `explore.night` | 261 KB | **28 KB** | **89%** |
| `topo.day` | 265 KB | **27 KB** | **89%** |

A viewport is 6–12 tiles, so a zoom level currently pulls **~2–3 MB** where it could pull ~300 KB.
HERE itself is not slow — measured round trip 150–210 ms, TTFB 100–170 ms — the payload is simply fat.

**The change is one line**: `BASEMAPS.map` / `.mapNight` / `.terrain` take `format: "jpeg"` in
`packages/shared/src/basemap.ts`. The proxy and the client already carry it end to end.

⚠ **Look before shipping.** jpeg is lossy and these tiles carry small text (road labels, place names)
and flat colour fields, which is where jpeg artefacts are ugliest. Render both at 1:1 and compare the
label edges — if `explore.*` looks bad, `lite.*` may compress better, or keep png for the road map and
take the win on terrain only. **Do not take the 87% on trust; it is a real trade, not a free lunch.**

### 3.2 The marker stutter — arithmetic, and a comment that is wrong

The owner reports markers freezing and restarting every 5–6 seconds. They are right, and it is exact:

```
liveMapMotion.ts:26    export const MOTION_DURATION_MS = 5_000;
useLiveMapBoard.ts:31  export const LIVE_MAP_POLL_MS   = 5_000;
```

**Exactly equal.** The tween ends at T+5000, `tweensSettled` returns true, the rAF loop stops — and the
next board does not arrive until T+5000+latency. The dead window every cycle IS the network round trip.

The comment above `MOTION_DURATION_MS` reads *"The tween is exactly as long as the gap it fills, so
motion is continuous."* It is the word **exactly** that is wrong: the tween has to OUTLAST the poll,
not match it, or it lands in the gap. Fix the comment with the constant.

**Done when:** `MOTION_DURATION_MS > LIVE_MAP_POLL_MS` by at least a realistic latency budget, a test
pins that relationship (not the literals — a test asserting `6500` teaches nothing), and the markers
are watched for 30 seconds in a browser. ⚠ `planTweens` already re-bases from the current sampled
`places`, so lengthening the tween does not make motion lag the data — it keeps the tween in flight
when the next board lands, which is the point.

### 3.3 Theme-switch caching — and this one is ours to own

D-DR8's `setTiles` (`useMapLibre.ts:210`) swaps the raster source's tiles in place, which is right for
the camera — but it **discards maplibre's entire tile cache**, so every light/dark flip refetches the
whole viewport through the slow path in 3.1. The owner feels this as "slow to change dark/light", and
the cause is a change we made.

Candidate: add BOTH raster sources up front and toggle layer `visibility`, so each scheme's tiles stay
cached and the second flip onward is instant. ⚠ Costs a warm-up fetch of the unseen scheme — measure
whether that is worth it, and note it interacts with 3.1: at 33 KB a tile, holding two sets is cheap;
at 260 KB it is not. **Do 3.1 first for this reason.**

Also here, and separate: the proxy does `Buffer.from(await upstream.arrayBuffer())`
(`mapProxies.ts:71`) — it buffers each whole tile before responding, so the browser's TTFB is HERE's
full download plus a re-send. Streaming the response is a small change with its own measurable win.

### 3.4 The consolidation (a) + the Samsara layout

Do these together. Collapsing to the Dispatch tab is the moment to fix the layout, not after.

**The consolidation** touches more than a route: `/live-map` in `router/routes/dispatch.ts:9`, the
surface `dispatch.live-map` in `packages/shared/src/surfaces.ts:193`, the widget of the same key in
`dashboardWidgets.ts:108`, `apps/web/src/lib/dashboardWidgets.ts:55`, the route ledger, and
`check-surfaces.mjs` — which asserts in **both** directions that every catalogue entry names a real
tab and a real component. `LiveMapPage.vue` and `LiveMapWorkspace.vue` are the page half;
`LiveMapPanel.vue` is the widget half. DR5 deliberately split them so they share STATE
(`useLiveMapView`) and FACTS (`LiveMapVehicleFacts`) and nothing else — that split is what makes this
tractable, so read it before merging the two.

⚠ The Dispatch tab is a widget in a grid today, and the workspace is full-bleed. Something has to give:
either the Dispatch tab becomes a full-bleed surface when selected, or the tab itself becomes the
workspace. That is the actual design decision in this step, and it is not written yet.

**The layout — what Samsara does, researched 2026-09-16.** Their Fleet Overview Map uses a two-tier
pattern and **neither tier is a drawer**:

- a **left rail** holding search + filters + the asset list, where filtering updates the list and the
  map together;
- a **marker click opens a small inline popover** — name, live location, speed, driver, fuel level —
  with "Zoom to" and "Open in new tab";
- **depth lives on a full page**, not in the overlay: driver/HOS, sensors, diagnostics.

That maps onto our defects directly: the bottom dock costs **337px** when open, and the Filters panel
is what collided with the zoom buttons (D-DR21). A left rail carrying search + filter + fleet list
would retire both, and the popover gives the drawer's job away. ⚠ `LiveMapVehicleFacts`'s own comment
already says "it links rather than restates" — handing depth to `/vehicles/:id` is the philosophy it
was built with, not a new idea.

⚠ **One unsolved problem, stated rather than discovered later:** a left rail inside the dashboard sits
beside the app's own sidebar. Two left rails is worse than a dock. This only works if the sidebar
collapses on this surface — which is also the answer to "the map is not full screen" (§4).

Sources: [Samsara Fleet Overview Map](https://kb.samsara.com/hc/en-us/articles/41266933936269-Monitor-Your-Fleet-on-the-Fleet-Overview-Map) ·
[Dispatch a Vehicle](https://kb.samsara.com/hc/en-us/articles/360018296052-Dispatch-a-Vehicle)

---

## 4. "The map is not full screen" — the measurements behind it

Measured at 1512×900 with a clean `localStorage`:

| state | map canvas | % of viewport |
|---|---|---|
| default | 1225×787 | **71%** |
| sidebar collapsed *(control ships today)* | 1437×787 | **83%** |
| true full screen | 1512×900 | 100% |

The chrome is a 272px sidebar, a 64px top bar and a 28px banner. ⚠ **The top bar is ~90% empty on this
page** — measured 1225×64 holding three controls. Comp (7) earns that height by putting the map's own
toolbar in it (search + status/type/terminal filters + clock + a fullscreen button); ours spends it on
a sidebar toggle and a bell.

**Recommendation, not yet ruled:** no new full-screen mode. Auto-collapse the sidebar on `fullBleed`
routes (83% for free, and the reader can expand it back), and fix the 28px. A true full-screen mode
costs an escape affordance, a persisted preference, and a dispatcher who cannot reach Loads.

⚠ **`docScroll: 28` is reproducible on this page** — a full-bleed page declaring `overflow-hidden`
still gains a 28px document scrollbar whenever a banner shows. That is DR5 follow-up 2, and the proper
fix is a flex chain from `#app` down, which restyles every page's layout container to buy 28px in two
environments. Not traded for yet.

---

## 5. Traps this programme paid for — do not re-learn these

⚠ **An overlap check that only compares OUR elements to each other is blind.** DR5's did, and missed
maplibre's zoom control sitting under the filters panel by 27×56px at every width for a fortnight. The
first re-run of that check this session reported "no overlaps" and was wrong the same way. The owner
saw it before any measurement did. **When a gate and a pair of eyes disagree, the eyes are reporting on
the product.**

⚠ **A normaliser that strips nothing is indistinguishable from one that works.** `labelPdf.test.ts`
stripped `/CreationDate\s*\([^)]*\)`; pdfkit writes `/CreationDate 13 0 R` with the date in its own
object, so the regex never matched and the test passed only because two renders usually land in the
same second. Fixed in #829 — and the lesson generalises: **any test helper that redacts
non-determinism should assert it redacted something.**

⚠ **A dev-bypass render is not the full surface.** The operating-metrics strip showed 8 tiles in the
browser and has **10** with real data, because dev-bypass returns no findings summary. Second time this
has bitten, after DR3's all-zero charts.

⚠ **`localStorage` state survives between measurements.** The live map's panels are localStorage-backed
(D-DR6), so a "45% of viewport" reading turned out to be leftover clicking from an earlier run; clean
it is 71%. Clear it before quoting a default.

⚠ **A mean averages the subject away.** The night plate reads 1.01:1 against the page as a mean, which
sounds like it vanished; its brightest 1% — the truck and headlights, i.e. what a reader calls glare —
is 2.09:1, down from 14.22:1. Quote the percentile that matches what the eye picks out.

⚠ **Viewport breakpoints invert inside a container. This programme has been bitten three times**
(D-DR17, DR5's `FilterBar`, DR7a's chip). The clincher: the four-up cell at a 1024px viewport is 168px
and the two-up cell at 390px is 172px — nearly the same tile, 634px apart. Derive column counts from a
measured tile width, and check every breakpoint **at its boundary**, not in the middle of its range.

⚠ **Ask the vendor, do not read the docs.** Q-DR2 sat open for a fortnight as "satellite may carry
different licensing"; five curls answered it in a minute. `hybrid.day` is the only thing comp (7) draws
that we genuinely cannot have.

---

## 6. Recipes

**See the app** (`vite dev` is broken on this machine):

```bash
cd apps/web && set -a && . ./.env && set +a && \
  VITE_DEV_BYPASS=true npx vite build && VITE_DEV_BYPASS=true npx vite preview --port 4173
```

**Drive the live map under dev-bypass.** The board is an `/api` route whose body is `{ ok, data }`,
and it is served from the API origin, not the preview origin — so match on the path, not the host:

```js
await page.route('**/api/livemap/positions**', (r) => r.fulfill({ status: 200,
  contentType: 'application/json', body: JSON.stringify({ ok: true, data: board }) }));
// A 1x1 PNG as raw bytes — this runtime has no atob/Buffer.
await page.route('**/map-tiles/**', (r) => r.fulfill({ status: 200, contentType: 'image/png',
  body: new Uint8Array([137,80,78,71,13,10,26,10,/* … */]) }));
```

⚠ `vi.stubGlobal("fetch", …)` in an api test also replaces the **test client's** transport. Capture
`globalThis.fetch` before stubbing, or every request is answered by the stub and never reaches Express
— five failures with one cause, and it reads like the route being broken.

**Probe a HERE style** (this is how Q-DR2 was answered):

```bash
K=$(grep -h "^HERE_API_KEY=" apps/api/.env | cut -d= -f2-)
curl -s -o /tmp/t.png -w "%{http_code} %{size_download}B\n" \
  "https://maps.hereapi.com/v3/base/mc/5/8/11/png?style=topo.day&size=512&apiKey=$K"
```

**Measure contrast from a screenshot** — no PIL here; `sips -s format bmp`, then parse the 54-byte
header in plain Python (offset at 10, w/h at 18, bpp at 28; rows bottom-up unless height is negative;
stride `((w*3+3)//4)*4`).

**Gates worth running before pushing UI work**, from the repo root:

```
pnpm lint:ui-adoption   pnpm lint:ui-contrast   pnpm lint:comment-claims
pnpm lint:filesize      pnpm lint:funcsize      pnpm lint:template-integrity
pnpm lint:boundaries    pnpm lint:surfaces      pnpm lint:chart-colors
node apps/web/scripts/check-design-tokens.mjs
```

⚠ `lint:tokens` is an `apps/web` script, not a root one — a bare `pnpm lint:tokens` fails with
"Command not found" and reads as "this gate does not exist".

---

## 7. Still open, and whose call each one is

- **Q-DR4 — should the operating-metrics strip stay a strip?** Raised by DR7a. It is the one dashboard
  surface that is not a card: either the point of it, or the last thing left to convert. **Owner's.**
- **Which hero plate?** `highway-dawn` + `highway-night` ship. `coast-mist` and `prairie-dusk` have no
  night variant and would keep the 6.54:1 band in dark mode — that fallback is deliberate and asserted.
  **Owner's.**
- **DR7e — the two MPG detail charts sit outside the chart theme's options layer entirely** (no
  `trendOptions`, no themed gridline, no terminal dot). DR3's one real miss and the only remaining DR7
  item with a visible payoff. Not in the narrowed scope; still worth doing.
- **DR7c/DR7d/DR7f** — the KPI tile's three sources of truth, `ChartCard` trapped in
  `features/dashboard/` (and **misnamed**: it owns "a titled panel", not "a chart"), and `StatCard`
  needing a `valueTone`. Mostly de-dup, **not** visible changes — do not budget them as a redesign.
- **DR2b — the delta pill.** Still blocked on DATA: `useDashboard` never fetches a previous window, and
  "Active alerts" is current-state so it cannot have a delta even in principle.
- **`RouteMapGL` (Fuel Planning) does not follow the colour scheme** and keeps maplibre's own zoom
  control. One line and the same `basemapFor` call — left out of #827/#831 deliberately.
- **§4.2 has two rulings that are now OUT OF DATE**, and the next reader should not repeat them:
  *"no weather provider is integrated"* — Open-Meteo is already in `env.ts`
  (`OPEN_METEO_URL`, free, no key) for idle backfill, so a current-conditions card is reachable though
  not free; and *"this board has no alert feed"* — `features/anomalies/useAnomalies.ts` is an ordered,
  recent-first, severity-carrying query. ⚠ Its rows are FUEL findings, not the telematics events comp
  (7) draws, so the honest statement is "a different kind of alert", not "no feed".
