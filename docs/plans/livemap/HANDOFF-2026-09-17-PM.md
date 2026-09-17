# Live map — handoff, 2026-09-17 afternoon

**Read the dated log at the END of `LIVE-MAP-PLAN.md` first.** D-LM25 through D-LM28 and the tile
deadline were all written there, with their measurements. This file is the position and the queue,
not the decisions.

`HANDOFF-2026-09-17-OWNER-LIST.md` is now a RECORD of a finished queue. Its per-item "not started"
table has been wrong since the morning; do not work from it.

## Where it stands

**The owner's nine are done except item 3.** `main` is `8630f5c` plus whatever of #852 has landed.

| PR | what | state |
|---|---|---|
| #841–#847 | items 2, 4, 5, 6 (count), 7, 9 + the camera fix + the bounds collapse | merged 2026-09-17 am |
| #848 | **D-LM25** — Q-LM19 ruled; the rail foot is one line | merged |
| #849 | **D-LM26** — `LiveMapVehicle.fuel` on the contract (API only) | merged **and deployed** |
| #850 | **D-LM27** — the tank on the card, rule (b′) | merged |
| #851 | **D-LM28** — the card moved onto its marker | merged |
| #852 | the tile proxy's 8 s upstream deadline | merged (`9d00756`) |
| #853 | **B2** — the tile is streamed, not buffered (~52 ms of TTFB per tile) | open |

## What is left

1. **Item 3 — the freeze. Not closed, and the next move is NOT more measuring.**
   Ask the owner two things about **today's** deploy: *does it still happen*, and *when it does, does
   the RAIL still scroll*. That separates a wedged map (tiles stopped; #852 removes the mechanism)
   from a dead tab (GPU/context loss, or something on their machine). Everything cheap on the browser
   side has been measured and is in the plan; three candidates are dead, one is removed by #852.
   ⚠ Do not change browser code for this without a reproduction.

2. ~~**B2 — stream the tile instead of buffering it.**~~ **DONE on #853.** Measured on the route:
   time-to-headers 181.4 → 129.6 ms, ~52 ms per tile, completion unchanged. The dated log at the end
   of `LIVE-MAP-PLAN.md` has the numbers and the one surprise — **`pipeline` destroys both streams
   itself**, so the new `headersSent` guard is not what saves the reader from a half-tile; what it
   buys is not reporting a HERE outage to Sentry as a bug in our own route.

3. **B3 — a tile cache / request coalescing. STILL GATED, and the gate cannot currently be opened —
   `Q-LM21`.** The Railway-side storm measurement was attempted on 2026-09-17 and the data does not
   exist: **this API has no HTTP request logging of any kind** (no `morgan`/`pino`/`winston`, no
   hand-rolled middleware, no logging dependency), so both services return **0 log lines** for
   `map-tiles` and the storm cannot be counted from the outside. **The recommendation is to read
   HERE's own quota console** — the vendor bills per tile and already has the number, it needs no
   code and no deploy, and it answers the cost question in the dimension that decides it. Candidates
   and reasoning are in `Q-LM21` at the end of `LIVE-MAP-PLAN.md`. Do not build B3 on the assumption.

4. **B4 — `webglcontextlost` handling in `useMapLibre.ts`.** There is none, so a lost context leaves a
   dead canvas silently. Only worth building if the owner's answer to (1) points at the map.

5. **Blocked on McLeod, and not ours**: `tms_dispatchers` **does not exist in production**;
   `loads`/`load_stops` are **0 rows**, so every card reads "No load on this truck" until LM12 runs.
   Until LM3/LM11 land, `scope` is `all` forever — the rail foot already knows how to say "assigned
   to you" the day it is not.

## Traps this queue paid for

- **Vendor CSS is UNLAYERED, and unlayered beats every `@layer`.** Two overrides written beside
  `.map-panel` in `@layer components` did nothing at all; the popup measured `rgb(255,255,255)` with
  15px padding while the rule sat in the stylesheet. Moving them out fixed one; the tip needed a
  THIRD class, because maplibre colours it per anchor (0-2-0) and a two-class override only ties.
  Read computed styles back from the DOM — a white card on a white basemap is invisible until
  somebody opens dark mode.
- **maplibre picks a popup's side once and never revises it.** A popup opened mid-camera-flight kept
  `anchor-top` through a pan and hung 94px below the fold at 390×844.
- **A freshness measurement without an hour and a population is worthless.** "6 of 272 fresh" was a
  parked fleet at 22:20 and a denominator full of retired trucks; the same query at 08:55 over the
  171 trucks the board draws answered 101. Fuel comes off the ECU, and an ECU reports while the
  engine runs.
- **`numeric` arrives as a STRING from PostgREST.** `samsara_fuel_percent` is `numeric(5,1)` and
  production answers `"100.0"`. Without the coercion a browser renders "68.0%".
- **Three components were deleted in three steps** — the drawer, the floating panel, the corner
  catalogue — each dead since an earlier consolidation and each still carrying a comment claiming it
  was in use. When a surface is being consolidated, check what its last caller was.
- **Both branches appending to the END of the plan file conflict every time.** Take `origin/main`'s
  copy of the file first, then append.

## Rigs worth rebuilding

- **One origin, not `route.fulfill`**: a node stand-in serving `apps/web/dist` AND `/api` on :8080,
  with `VITE_DEV_BYPASS=true` and `VITE_SUPABASE_URL` pointed at the same origin so `org_modules`
  answers too. The dispatch tab is `/?tab=dispatch`, not `/dashboard`.
- Production numbers come from `supabase db query --linked`; `vehicle_positions` is current state,
  one row per vehicle.
- **Deployment is a per-service question.** Before a web change reads a new API field, watch BOTH
  `fleetguardapi-production` and `fleetguardweb-production` `/api/version` to the merge commit. That
  was done for #849 → #850 and is the reason A3 was safe.
