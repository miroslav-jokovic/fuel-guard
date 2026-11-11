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
