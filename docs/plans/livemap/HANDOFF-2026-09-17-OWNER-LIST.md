# Handoff — the owner's nine, live map, 2026-09-17

**START HERE** for the live map. Read this, then `LIVE-MAP-PLAN.md`'s dated log at the END, then
`docs/plans/design-system/DESIGN-REFRESH-2026-09.md` **§7** for D-DR22–D-DR25. ⚠ This file goes stale
the moment a step lands; where it names a position, `git log` outranks it.

`main` is at **`3b8637b`**. One PR is open and in CI: **#839** (item 1 below). One PR should be
CLOSED rather than merged: **#825** — it merges cleanly but rewrites the plan's status header to a
position twelve decisions out of date, and no conflict marker would warn anyone.

---

## 1. Where the surface is now

The live map is **the Dashboard's Dispatch tab and nothing else** (D-DR24 — `/live-map`,
`LiveMapPage.vue` and `LiveMapPanel.vue` are deleted; D-DW5 is overruled). Its shape:
`DashboardPage` → `TabWidgets` → `LiveMapWorkspace` = **`LiveMapRail`** (search, census-as-filter,
sort, fleet list) **+ `LiveMapCanvas`** (maplibre, D-DR21's control rail, the basemap switcher) **+**
a floating truck card in the top-right corner. State is `useLiveMapView`; pure logic is
`liveMapLayer.ts` and `liveMapMotion.ts`; the board is `useLiveMapBoard` (5 s poll).

---

## 2. The nine, as the owner wrote them — with what is already measured

| # | Item | State |
|---|---|---|
| 1 | markers still slow down every ~4.7 s | **FIXED, PR #839** — see below |
| 2 | show SPEED per truck in the rail, not "3s ago" | not started |
| 3 | clicking a row sometimes freezes the whole page | **not reproduced yet — do this first** |
| 4 | clearing the search must close the truck card | not started |
| 5 | Map/Satellite/Terrain should open from a button, not sit in a row | not started |
| 6 | replace the scope paragraph + "171 of 171 shown" with a plain total | not started |
| 7 | a toggleable "only trucks in the viewport" filter | not started |
| 8 | hover a marker → fuel level, speed, current location | ⚠ **check the contract first** |
| 9 | bigger, better-coloured, per-status marker artwork | not started |

### 1 — done, and the method matters more than the fix
Production, 2026-09-17: **27 moving trucks, median fix age 5.6 s, worst 13.6 s** → fixes arrive about
every **11 s** against a **5 s** poll, so most boards REPEAT a truck's position. `planTweens` re-based
on every one, restarting a 6.5 s tween with nothing to cover. Now a repeated `sampledAt` leaves the
tween alone and a new fix animates over the interval the two fixes describe (capped 15 s). Measured
through the real module: velocity swing **127% → 21%**, slow frames **1,204 → 4**.
⚠ Every unit test passed through both stutter defects, because each asks about ONE tween and both
defects were in the SEQUENCE. `liveMapMotionVelocity.test.ts` is the one that measures a speed.

### 3 — the freeze. Reproduce before touching anything
`LiveMapRail` emits `select` → `LiveMapWorkspace.select()` → `selectedId` + `canvas.flyTo(id)`.
Candidates, none verified: `flyTo`'s camera animation running against the rAF tween loop (both drive
`setData` on the same source); a `flyTo` to a marker whose tween is mid-flight; maplibre's
`easeTo` never firing `moveend` when the tab is throttled. **Measure it:** wrap `requestAnimationFrame`
as in the velocity rig, click rows until it hangs, then read the last 200 frame timestamps and the
map's `isMoving()`/`isEasing()` state. A page needing a reload is the worst item on the list.

### 8 — one fact to check before designing
**Fuel level may not be on the board at all.** `LiveMapPosition` in `packages/shared/src/livemapContract.ts`
carries lat/lng/heading/speed/`isEcuSpeed`/`formattedLocation`/`sampledAt`/`receivedAt` — no fuel. If
the Samsara feed has it, adding it is an API + contract change (and `vehicle_positions` is
samsara-owned, so `lint:table-writers` applies). If it does not, say so rather than shipping a hover
card with a blank line.

### 5, 7, 9 — notes that will save a rediscovery
- **5** `LiveMapControls.vue` holds zoom + the segmented basemap control; `BASEMAP_CHOICES` is the
  catalogue, `D-DR20` refuses a Day/Night button and that ruling stands whatever the control looks like.
- **7** the board is fleet-wide; filtering to the viewport is a CLIENT filter over `filtered`, and it
  has to survive `moveend` (the map moves constantly). ⚠ It interacts with the rail's census, which
  counts the whole fleet on purpose — decide whether the counts follow the viewport before building.
- **9** markers are drawn from `liveMapIcons.ts` (canvas-generated sprites, one per state × heading
  presence) and coloured from `STATE_COLOR_CLASS`. ⚠ `tokenColor()` exists because maplibre cannot
  parse `oklch()`; any new colour must go through it, and `lint:tokens` forbids a hex literal.

---

## 3. Recipes this queue paid for

**See the surface** (`vite dev` is broken here; the tile proxy needs auth, so tiles are mocked):
```bash
cd apps/web && set -a && . ./.env && set +a && VITE_DEV_BYPASS=true npx vite build
# then serve dist AND /api from ONE origin — see below
```
⚠ **A Playwright `route.fulfill` answers ABOVE the network stack**, so it can never measure caching.
For anything about bytes or TTFB, run a node stand-in on `:8080` that serves `apps/web/dist` **and**
`/api/...`, proxying real HERE tiles with the proxy's own `Cache-Control`. That rig is what proved
D-DR23's premise half wrong.

⚠ **The Dispatch tab needs the `dispatch` MODULE**, which comes from PostgREST and not our API, so a
dev-bypass walk must also `page.route("**/rest/v1/org_modules**", …)` or the tab renders
"Nothing to show here".

⚠ **An overlap check must include the vendor's DOM and exclude boxes that paint nothing.** DR5's
missed maplibre's zoom control for a fortnight; the first version of the D-DR25 check reported four
overlaps that were all a `pointer-events-none` wrapper and an SVG `className` object.

**Read production directly** — `supabase db query --linked "select …"`. `vehicle_positions` is
CURRENT state, one row per vehicle (199), so fix intervals are measured from the AGE distribution,
not from history.

---

## 4. Rules that bit during this queue

- **A primitive is never re-styled.** Six `!important`s on `AppButton` were refused by
  `lint:template-integrity`; the answer was the missing `size="row"`. That file has now learned the
  same lesson three times — read its comments before writing a class.
- **`git add docs` swept two untracked files into a PR** (#837), and a `git status | grep -v` hid it.
  Stage paths, not directories, and never filter the status you are checking.
- **Snapshots change for two reasons** — a real change and a class REORDER. Prove which before
  updating (`DriversPage`'s moved because `AppButton`'s class list was re-ordered: 21 classes,
  set-identical).
