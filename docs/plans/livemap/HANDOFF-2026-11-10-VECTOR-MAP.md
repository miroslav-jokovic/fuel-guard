# Handoff 2026-11-10: map speed, the tile queue, and the vector map trial

Read this before touching the live map, `useMapLibre.ts`, `vectorBasemap.ts`, `mapProxies.ts` or
`tilePacer.ts`. The decision log is `docs/plans/design-system/DESIGN-REFRESH-2026-09.md` §7 (D-DR26 to
D-DR33); this file is the working state and the next step.

## 1. The owner's ruling (D-DR33, 2026-11-10)

"Proceed as proposed," with one condition: **build without assumptions.**

1. **Polish the vector map on staging** so a still frame looks at least as good as today's raster map
   (section 5).
2. **The owner compares the two on staging,** side by side, including on the slowest office PC. If it
   stutters too much there, the vector map is dropped and today's map stays. That is an acceptable
   outcome, because production's map "is working good" (the owner, 2026-11-10).
3. **Default for everyone, with an escape hatch.** Today's map stays in the basemap menu as
   "Map (classic)" for two weeks, then goes if nobody needs it.
4. **Then the follow-ups** (section 7).

Not chosen: rebuilding on Google Maps. It means weeks of work, a split data source (Google's terms bar
its places from non-Google maps, and HERE's terms limit HERE data on others' maps), and an unverified
per-load price.

## 2. What "without assumptions" means here

Each rule below comes from a mistake made on 2026-11-10 (section 4):

- **A vendor fact is read from the vendor, with our key.** No category code, field name, zoom limit or
  header is written into code until it has been seen in a real HERE response. The tools are in
  `docs/plans/livemap/tools/`.
- **Speed is measured as tile arrival and frame times, never as "time until the map reports idle".**
  maplibre's `idle` waits for fades to finish, so it rewards turning fades off.
- **Look at the motion, not only a still.** Record a video of a zoom (Playwright `recordVideo`, then
  `ffmpeg` frames into a contact sheet) and look at it.
- **The deciding test runs on staging, through the real deployment.** A local rig hid a real bug
  (section 4, the content-length bug). Use rigs to choose between options, and staging to accept one.
- **Timings: at least 5 runs, alternating between the options, reported as ranges.** This MacBook's
  timings swing by a factor of 2 to 3 between single runs.
- **Prove every new test by breaking the code it guards** (repo rule: memory `prove-tests-fail-by-mutating`).
- **No load test against HERE** until each environment has its own key (Q-DR31). Local development,
  staging and, very likely, production share one key, so a burst from a laptop spends production's
  rate limit.
- **Any icon or shield artwork must have a licence that was read, not assumed.** We draw our own, or use
  a set whose licence text allows it (for example Maki or Temaki, which are believed to be CC0; confirm
  from the licence file itself). Never copy Google's icons or styling assets; "Google-like" means the
  conventions, not the artwork.

## 3. State at handoff (2026-11-10, about 21:00 UTC)

Production `03b86b6` and staging both carry everything below. Production received three releases
that afternoon.

| PR | What | Decision |
|---|---|---|
| #2175 | 32 parallel tile requests (+ a fade-0 half that #2193 reverted) | D-DR28 |
| #2179 | map tiles get their own rate-limit budget (4 100/caller, 15 min) | D-DR29 |
| #2189 | `tilePacer.ts`: 80 tiles/s per API replica, per-caller round-robin, 20 s wait, one 429 retry, `no-store` on errors, `hereTiles` in the `[metrics]` line, address ceiling for 40 seats | D-DR30 |
| #2193 | the 300 ms raster fade back (the patchwork zoom) | D-DR32 |
| #2198 | vector trial: `vectorBasemap.ts`, 13 `--map-*` tokens, `/map-tiles/vector/` + `/map-tiles/glyphs/`, "© HERE" on every source | D-DR31 |
| #2202 | vector tiles arrived truncated (forwarded the encoded length); protobuf now compressed | D-DR31 |
| #2206 | country roads visible at regional zoom; ordinary roads' numbers from zoom 10 | D-DR31 |

The trial switch: "Map (vector trial)" shows in the basemap menu only where the build names a
non-production `VITE_APP_ENVIRONMENT`. Both bundles were checked: production compiles the default to an
empty string, staging to `uat`. This is a labelled workaround, because there is no per-environment
feature flag in the web app.

## 4. What was measured, and the mistakes it corrected

| Fact | How it was measured |
|---|---|
| Same staging zoom walk (7 double-clicks in, 4 wheel steps out): today's map **97–102** tile requests, vector **32–34** | `tools/staging-map-compare.mjs`, two alternating runs each |
| Rig, 18-zoom walk: raster 410 requests / 11 MB, vector 140 / 6.2 MB | local h2 rig, real HERE bytes |
| Slow PC (Chrome CPU throttled 4×), 11-step zoom, 5 interleaved runs, medians: raster 0 frames over 50 ms; vector 17–43, with 0.5–2.7 s of main-thread long tasks. The vector map finishes 1–2 s sooner. With no labels at all it still had 13–52, so the extra work is the vector map itself, not our style | rig + CDP `Emulation.setCPUThrottlingRate` |
| 40 readers × 60 tiles at once against a stand-in HERE that refuses past 200/s: main's code left 83% blank, the pacer 0 | local rig, two app instances |
| HERE refuses our key with 429 "Rate limit for this service has been reached" above roughly 200–400 tiles/s | burst against HERE itself, 2026-11-10 (it probably cost production 10–30 s; see Q-DR31) |
| Prices per 1 000 after 30 000 free/month: raster $0.12, vector $0.088, "advanced" tiles $0.239 (truck-restriction rasters; `advanced_pois` / `advanced_roads` vector content). Standard vector content, which the trial uses, is $0.088 | HERE's own pricing-calculator data, read 2026-11-10 |
| HERE sends `max-age=86400` + ETag on raster and vector tiles, and no caching header on glyphs | response headers, our key |
| Vector `road_labels.network` values seen around Chicago: `US:I`, `US`, `US:IL`, `US:IN`, `US:IL:CR` | `tools/vector-tile-values.mjs` over 9 tiles |
| Vector `landuse.kind` values seen: park, urban_area, national_park, cemetery, aerodrome, railway, golf_course, university, zoo, forest, industrial, beach, sports_centre, runway, commercial, hospital | same |

**Corrections made on the same day:**

- **Fade off (D-DR28, first version).** The "half the wait" was mostly the `idle` metric, and the zoom
  became a patchwork. Reverted by D-DR32.
- **Encoded content-length.** HERE gzips vector tiles and `fetch` decodes them. The proxy forwarded the
  encoded size, so every tile arrived short. Only the staging walk caught it; unit stubs and the
  buffered rig could not.
- **⚠ Truck place categories (NOT YET FIXED, first item of section 5).** `TRUCK_PLACE_CATEGORIES` in
  `vectorBasemap.ts` uses HERE **Browse/Search** codes (700-7900-0132 truck stop, 700-7900-0131 truck
  parking, 700-7850-0126 truck repair). The **vector tiles never carry those codes.** 40 truck places
  from HERE Browse near Joliet, Indianapolis and Dallas were looked up in the zoom-17 vector tile each
  sits in (`tools/here-browse-truck-places.mjs` → `tools/vector-poi-match.mjs`):
  - Pilot (8 of 9 Browse results found, the 9th not in the tile) and one Flying J: `kind=parking`,
    `pds_category=800-8500-0178`, `min_zoom=17`.
  - Flying J (the other one), Food-N-Fuel, Phillips 66, RaceTrac: `kind=fuel`, `700-7600-0116`, `min_zoom=14`.
  - Love's Travel Stop: `kind=convenience`, `600-6000-0061`, `min_zoom=18`.
  - Truck repair: 1 of 8 present, as `kind=car_repair`, `700-7850-0122`, `min_zoom=18`.
  - Truck & trailer parking lots: 0 of 6 present.

  So the trial's "truck stops win the room first" rule matches nothing. The vector data also does not
  name more truck places than the raster map: a Pilot is named from MAP zoom 16 in both (a vector POI is
  in the tile one zoom before its `min_zoom`; the raster names it from map zoom 16 since D-DR26). The earlier
  claim that "place names come with the vector data" is true for fuel stations and false for most truck
  places (Q-DR34).

## 5. The next step: polish on staging (estimated 2–3 days)

Each item lists the check that accepts it.

1. **Truck places, from the measured data.**
   - Replace the Browse codes with what the vector tiles carry: `kind=fuel` (700-7600-0116) gets fuel
     priority; a `kind=parking` POI whose name is a known truck-stop brand gets truck-stop priority.
   - ⚠ A brand list is a heuristic. Write it down as one, sourced from the measured names (Pilot,
     Flying J, Love's, TA, Petro, ONE 9), and pin it with a test.
   - ⚠ Whether 800-8500-0178 is "truck parking" or ordinary "parking" is **unknown**. Do not guess;
     read HERE's category list, or count it on tiles.
   - Accept: a staging screenshot at zoom 16 over the Joliet Pilot (41.4805, −88.0792) names it, and a
     unit test pins the matching.
   - The gaps (Love's at min_zoom 18, missing repair shops and truck parking) are Q-DR34, not this item.
2. **Icons** (sprite served from our own origin, licence read first, see section 2). Kinds to cover,
   all seen in tiles: fuel, parking, car_repair, station (transit), airport, hospital, plus a truck-stop
   variant. Accept: the sprite loads on staging with no 404 or CSP error in the console.
3. **Road shields per network.** Interstate (`US:I`), US route (`US`), state (`US:<ST>`), county
   (`US:<ST>:CR`). Before writing the mapping, sample tiles from at least TX, IN and OH so the state
   codes are seen rather than inferred. Accept: a zoom 9 still shows the right shapes.
4. **Land colours** for the measured landuse kinds (hospital, industrial, aerodrome/runway, university,
   cemetery). These are new `--map-*` tokens; `lint:token-gamut` must pass.
5. **Road density at regional zoom.** Compare zoom 7–10 stills with the raster map at the same spot.
   Accept: the owner, looking at them.
6. **Night map, checked on staging by eye** (`isDark` repaint). It has passed the validator and a rig
   render only, never been seen on the real map.
7. **Re-measure:** request counts with `tools/staging-map-compare.mjs`, 5 slow-PC runs, and a zoom video
   of both maps. Record them in §7 of the design plan with ranges.

Then the owner's gate (section 1, step 2). The owner tries the trial on the slowest office PC.

## 6. Open questions (full text in the design plan §6)

- **Q-DR30** — our real HERE per-second limit, and can HERE raise it? Until answered, the pacer runs at
  80/s per replica.
- **Q-DR31** — separate HERE keys per environment (owner, in the HERE console). Blocks any load test.
- **Q-DR33** — glyphs carry no caching header, so they are re-fetched on every map load. Act only if the
  metrics show it matters.
- **Q-DR34 (new)** — truck places are thin in the vector data (section 4). Candidates:
  - (a) accept HERE's vector data as it is;
  - (b) add a truck-places layer from HERE Browse (billed per search, 5 000 free a month). It may be
    kept at most 30 days (Platform Terms §6.4(j)), and only as the response's caching headers allow
    (Exhibit 2 §1.3). Those headers have **not been read yet**, so read them before designing anything;
  - (c) ask HERE whether `advanced_pois` content ($0.239/1 000, 2.7× the price) carries the truck
    categories. Fetch one tile with `content=default,advanced_pois` to see before asking.

  Recommendation: (c) first, because it is one request. Then decide between (a) and (b) on what it shows.
- **Q-DR4** — only matters if the raster map is kept and a place-names overlay is added; obsolete if
  the vector map is adopted.

## 7. After the switch, if it happens

- Remove the trial switch, and after two weeks remove "Map (classic)".
- Fuel Planning's `RouteMapGL` moves to the vector map. It still asks for png raster tiles.
- Truck unit numbers on the markers, now that glyphs are served.
- Retune `HERE_TILE_PACING` and the tile rate-limit budgets for about a third of the tiles. Use a week of
  production `[metrics]` `hereTiles` lines, which needs the owner's AWS access.
- Drop D-DR27's raster overlay plan.

## 8. Owner tasks (not code)

- In the HERE console: separate keys per environment, usage alerts at budget levels (HERE has no hard
  cap), and this month's tile count. The count turns the cost scenarios below into a real number.
- Email HERE: our per-second limit and a raise (Q-DR30), volume pricing, and whether `advanced_pois`
  carries truck categories (Q-DR34 (c)).

Cost scenarios for 40 dispatchers over 22 days, at published prices:

| Tiles per person per day | Today's map | Vector map |
|---|---|---|
| ~500 | ~$49/month | ~$10/month |
| ~2 000 | ~$208/month | ~$49/month |
| ~5 000 | ~$524/month | ~$127/month |

The per-person tile counts are scenarios, not measurements.

## 9. Tools

`docs/plans/livemap/tools/`: four scripts. Each has its usage in its header and reads the HERE key from
`apps/api/.env` through `--env-file`:

- `vector-tile-values.mjs`
- `here-browse-truck-places.mjs`
- `vector-poi-match.mjs`
- `staging-map-compare.mjs`

The local h2 A/B rig (a stand-in proxy plus a bare maplibre page) lived in a session scratchpad and is
gone. It is rebuilt from its description in D-DR28 and D-DR30 when needed, and it is a tool for choosing
between options, never for accepting one (section 2).

Added since: `staging-map-views.mjs`, `staging-truck-places.mjs`, `truck-places-advanced.mjs`,
`staging-map-frames.mjs` (prints the WebGL renderer; run with `GPU=1`), `staging-map-freeze-profile.mjs`.

## 10. Revision 2026-11-11 (evening): the remaining work re-read against the code

Polish items 1–7 of section 5 are done and on staging (D-DR34–D-DR38). Before the owner's gate, the
list of what is left was read against the code on `main` and against what 40–50 dispatchers at once
would do to it. Three things changed: the two speed items turned out to be one bug that production has
today; two of the proposed fixes were the wrong lever; and ten gaps had no home. This section replaces
sections 5–8 as the working list. Nothing here is built.

### 10.1 The finding: the truck layer is rewritten sixty times a second, and the vector map pays for it

`LiveMapCanvas.vue`'s `step()` calls `setData` with the whole truck collection on EVERY animation
frame while any tween is unsettled. `tweensSettled` needs every truck to have either finished its
tween or be standing still, and tweens last 6.5–15 s (D-LM8a/b) against a 5 s poll. With 236 trucks
some truck is always moving in working hours, so the loop never stops. That is as designed for the
glide; what was not seen is what maplibre does with each write.

Verified in maplibre-gl 5.24.0's `_updatePlacement` (the installed copy): on every render it adds
EVERY symbol layer to the cross-tile index, and a layer whose buckets changed marks the placement
stale, after which the placement pass walks every symbol layer in the style. The truck layer has
`icon-ignore-placement`, so trucks never collide with anything, but a fresh truck bucket still makes
the whole pass run again. On today's raster map there is one symbol layer and the pass is cheap. On
the vector map there are six (places, road names, shields, POIs, truck places, cities), so each
sixty-a-second write re-places thousands of labels. That is the "main thread placing labels" in the
freeze profile, and it is why the vector map's extra cost looked structural: every measurement so far
ran with this loop under it. The D-DR31 claim that "no labels at all still gave 13–52 stutters" was a
software-rendering figure (PR #2262) and is withdrawn.

How much of the redraw is wasted, by zoom. A truck at 65 mph covers 29 m a second, 0.48 m a frame:

| Zoom | Metres per CSS pixel near Chicago | Frames before the truck has moved one pixel |
|---|---|---|
| 7 (regional) | ~455 | ~950 (about 16 s) |
| 10 | ~57 | ~120 (2 s) |
| 14 | ~3.6 | ~7 (0.12 s) |
| 17 | ~0.45 | ~1 |

⚠ Corrected the same evening, in the M1 PR: the first version of this table used a 256-pixel world
and doubled every figure. maplibre's world is 512 CSS pixels wide at zoom 0, so a pixel at zoom 7 near
Chicago is ~455 m (`metresPerPixel` in `liveMapMotion.ts`, pinned by the test "shrinks with latitude
by the cosine, so a Chicago pixel is three quarters of an equator pixel"). The conclusion stands at
half the size: at the zooms a dispatcher watches the fleet from, no dot moves a pixel for a quarter
of a minute, and the source was rewritten ~950 times in that quarter minute.

### 10.2 The fix, and the two levers NOT to pull

**M1 — redraw only when a dot has moved a pixel (proposed as D-DR39, both maps, a production PR).**
Keep the frame loop and the glide. Each frame still samples the tweens and still moves the popover
(that is DOM work and cheap). `setData` runs only when some truck's sampled position differs from the
last DRAWN position by at least one CSS pixel at the current zoom, or its heading by more than a
threshold to be chosen from the icon's size, with a ceiling of about 15 writes a second at street
zoom. Projecting 236 points a frame is cheap; cheaper still is one metres-per-pixel number for the
current zoom and latitude, compared against lat/lng deltas. A camera move needs no write: the
coordinates have not changed and maplibre re-projects on its own.

Expected: at zoom ≤ 10 the write count falls from 60 a second to about 0; the vector map's placement
then runs only when tiles arrive or the camera moves, which is what it was built for. Accept: a write
counter added to `tools/staging-map-frames.mjs` shows the writes a second at zoom 7 and 14, as ranges
over 5 alternating runs with `GPU=1`, and the longest frame of BOTH maps is re-measured the same way.
Pin with a unit test ("a fleet moving under a pixel at zoom 7 produces no source write in a second of
frames"), proven by breaking the gate.

- ⚠ **Do not shorten the tweens** ("let the glide end between position updates"). D-LM8a made them
  outlast the poll on purpose; before that, the map froze four times every 30 s. The animation-off
  run of 2026-11-11 is the CEILING of the gain, not the fix.
- ⚠ **`updateData` is the wrong lever.** 236 features is a small payload; parsing is not the cost.
  The cost is the frequency of the write, and a diff write at 60 Hz triggers the same placement.
- The section 5 settings list (A3 in the chat summary) is tuning, not a plan item: fold
  `maxTileCacheSize` and `fadeDuration` into M1's rig as parameters. `cancelPendingTileRequestsWhileZooming`
  is already `true` by default in 5.24 (read from the installed source), so it is not a change at all.

The comparison the owner judges (section 1, step 2) is made AFTER M1, on both maps. Until then the
office PC would be judging the bug.

### 10.3 Capacity for 40–50 dispatchers at once, from the numbers already measured

The transport side was sized in `LIVE-MAP-CONCURRENCY-PLAN.md` and is already built: one board per
org per 2.5 s (C3), gzip on every JSON route (C2, the Caddyfile deliberately adds none), the API's
own rate budget per caller (C1). 50 dispatchers polling every 5 s is 10 requests a second against at
most 0.4 database reads a second, and about 5.7 KB a poll, about 40 GB a month of egress, about $4.
Not built: the ETag/304 (C4), which only saves bytes on a parked fleet. The poll path is not the risk.

The tile path is. Production runs **two API replicas** (`infra/server/production.env`
`API_REPLICAS=2`; staging runs one), so the pacer's 2 × 80 = 160 tiles a second fleet-wide, plus
2 × 100 burst, holds as designed. A cold start, every dispatcher opening the map in the same second,
against a 20 s maximum wait:

| | Tiles for 50 first views | Drain at 160/s after the burst | On ONE replica (80/s) |
|---|---|---|---|
| Today's raster map (~60 tiles a view, from the pacer's own sizing) | ~3 000 | ~17 s — inside the 20 s wait, barely | ~35 s — roughly 2 in 5 tiles answered 503 "busy" |
| Vector map (38% of the requests, measured on staging) | ~1 150 | ~6 s | ~12 s |

So the vector map is the only one of the two that survives a 50-seat cold start with one replica
down, without a HERE 429 and without the pacer's "busy". Server CPU is not a constraint either way:
3 000 tiles at the measured 1.6 ms is 4.8 s of CPU on 2 vCPU. After the first view the browser holds
tiles a day (`max-age=86400`, HERE's own header), so a dispatcher who keeps the tab open costs only
what they pan and zoom. Steady-state tile cost is therefore behaviour, which is what the month's
HERE count (section 8) measures and nothing else can.

The bill at published prices is section 8's table: $10–127 a month for the vector map against
$49–524 for raster, before the truck-places tiles at $0.239 per 1 000 at zoom 13 only. ⚠ Assumed,
not read: that HERE bills `content=default,advanced_pois` as ONE advanced tile and not as a default
tile plus an advanced one. The console count settles it.

### 10.4 Gaps that had no home, now with one

1. **The escape hatch resets on every page load.** The basemap choice is deliberately not remembered
   (`LiveMapWorkspace.vue`, the D-DR6 note). A dispatcher who needs "Map (classic)" would pick it
   every morning for two weeks, and whether anybody used it cannot be read from preferences. Q-DR36.
   Candidate measure without new telemetry: raster against vector tile route counts in the
   `[metrics]` line, which needs the owner's AWS access.
2. **The office-PC check has no protocol and returns no number.** Write one page for the owner (open
   Dispatch, the 7-in 4-out zoom sequence, a pan, a basemap switch, the night scheme) and add a
   long-frame counter to the trial's basemap menu from a `longtask` observer, so the ruling comes
   back as a count per map, not a feeling. Also open `chrome://gpu` on that PC: "no real PC sits at
   the software floor" is an assumption, and a blocklisted driver puts a PC exactly there.
   **Built 2026-11-12:** the page is `OFFICE-PC-CHECK-2026-11-12.md` beside this file; the counter
   is `liveMapLongFrames.ts` shown under the choices in `LiveMapControls.vue` on trial builds only,
   restarting on every basemap change (design plan §7, 2026-11-12 later).
3. **Glyphs are HERE's Fira GO from a keyless endpoint, with no caching header (Q-DR33) and no terms
   read.** Follow-up C9 would set OUR unit numbers in that font. Self-hosting the glyph files of a
   font whose licence allows it (Fira GO is believed to be under the SIL Open Font License; read the
   licence file, not the belief) answers Q-DR33, the terms question and C9's dependency in one small
   PR, served with our own cache headers from our origin. **M2.**
4. **C9 re-enters collision.** Text labels DO take part in placement, so unit numbers raise the
   cost M1 removes. C9 comes after M1 and gets its own re-measure with labels on.
5. **No fallback when the vector style fails.** A glyph or tile 502, or a lost WebGL context, leaves
   a dispatcher with no map and, per gap 1, no remembered way back. Falling back to the raster
   basemap for the session on a style `error` event is cheap. Part of **M3** with gaps 1 and 2.
6. **The shared HERE key.** The owner's staging check spends production's rate limit (Q-DR31), so the
   separate staging key is wanted BEFORE the office-PC check, or the check runs outside the busy hours.
7. **Truck repair shops via HERE Browse (Q-DR34 (b)) likely conflicts with Platform Terms §6.4(l)**,
   which forbids scaling one request to many end users, so a shared server cache is out and per-user
   caching against 5 000 free searches a month across 40 seats is thin. The carrier's own repair
   vendors are first-party data with no HERE terms at all; that is the candidate to propose.
8. **Section 9's tool list was stale** (four scripts listed, eight exist). Corrected above.
9. **The cost case is scenarios until the HERE console count lands** (section 8). It shares its
   blocker, the owner's AWS and HERE access, with the pacing retune.
10. **The strategic alternative was never priced: self-hosted vector tiles.** Q-DR35, below. Not
    recommended before the owner's gate, because the HERE vector map is 2–3 small PRs from decided and
    the alternative has two unread documents in front of it.

### 10.5 Q-DR35 — self-hosted OpenStreetMap tiles: the cheapest shape, and what blocks it

For "cheapest to run for 50 seats with no vendor limit", the shape is a single PMTiles archive of
OpenStreetMap (a Protomaps basemap build, or our own Planetiler run) cut to North America, served as
a static file by Caddy or S3 with HTTP range requests, drawn by the same maplibre with the same
`--map-*` style tokens. There is no per-tile API call, no key to protect, no pacer, no 429, and
nothing for the Node API to do. Rough size and cost, TO BE MEASURED and not to be quoted as fact: a
North America extract in the tens of gigabytes; S3 storage well under a dollar a month; egress at the
measured 6–11 MB per zoom walk, about 20 GB a month for 50 seats, about $2; a monthly rebuild job.
Call it $3–5 a month against $10–127. The client cost is the same vector map M1 fixes.

Two documents stand in front of it, and both are reads, not builds:

- **HERE's terms on mixing.** The route line and ETAs come from HERE Routing
  (`TRUCK-CARD-ROUTE-PLAN.md`), and section 1 already notes HERE's terms limit HERE data on
  others' maps. The exact clause has not been quoted. If HERE routes may not be drawn on an OSM
  basemap, the option carries self-hosted routing with it (Valhalla with truck costing, its own
  memory footprint, likely a second instance), and the saving shrinks to a question.
- **OSM's truck places.** `amenity=fuel` with `brand`, `amenity=parking` with `hgv=*`,
  `shop=truck_repair`: run the SAME 40 HERE Browse places through OSM the way
  `vector-poi-match.mjs` ran them through HERE's tiles, and count. HERE's advanced tile named 17
  truck stops and 19 truck parking lots in 24 zoom-13 tiles; the number to beat is that one.

Recommendation: finish the HERE vector decision first (M1 → M3, then the owner's gate). Open Q-DR35
as a measured spike only if the owner wants the per-tile bill and the vendor rate limit gone
entirely, and only after the two reads above.

### 10.6 The list, in order

1. **M1** — redraw gate (10.2), production PR, both maps, with the write counter and the re-measure.
   **Built 2026-11-11 (D-DR39):** `redrawDue` + `metresPerPixel` in `liveMapMotion.ts`, the gate in
   `LiveMapCanvas.vue`'s `step()`, zero tolerance on the settling frame, `livemap:write` announced per
   write, `planFleetFit` moved to `liveMapCamera.ts` to keep the canvas inside the 500-line budget.
   Nine mutants of the gate and the fit each failed their tests. `staging-map-frames.mjs` now prints
   writes a second over a 10 s still hold at the fitted zoom and writes per walk.
   **Measured 2026-11-12 on staging (PR #2273 merged):** writes fell from ~60 a second to 0.4–5.6
   a second still and from ~780 to 33–124 over the zoom walk, both maps, two sessions (design plan
   §7, 2026-11-12). ⚠ Still owed: the FRAME-TIME comparison, because both sessions ran on a Mac at
   load average 19–30 and their frame figures measure that load, not the map. Run it on a quiet
   machine (the tool now prints the load; record only under ~4) — then the office-PC check (gap 2).
2. **M2** — self-hosted glyphs (gap 3), licence read first.
3. **M3** — trial hardening: remember the basemap choice for the window (Q-DR36), fall back to
   raster on a style error, long-frame counter in the trial menu, the one-page office-PC protocol.
   **Counter and protocol built 2026-11-12** (gap 2 above), ahead of M2 because the owner's check
   needs them and neither waits on the glyph licence. Still open in M3: Q-DR36 and the fallback.
4. **Owner** — separate HERE keys (Q-DR31) and usage alerts; the month's tile count; the road
   density stills of section 5 item 5; then the office-PC check with the protocol; then the ruling
   (default with "Map (classic)" for two weeks, or drop).
5. **If the switch** — section 7 as written, with C9 after its own re-measure, and the pacing retune
   from a week of `[metrics]` once AWS access is in hand. Q-DR4 and D-DR27 close.
6. **Q-DR35** — only on the owner's ask, after its two reads.
