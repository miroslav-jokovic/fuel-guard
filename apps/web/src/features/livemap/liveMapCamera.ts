/**
 * What the camera does when a dispatcher picks a truck (LIVE-MAP-PLAN.md LM8, D-LM19).
 *
 * ── WHY THIS IS A MODULE AND NOT FOUR LINES INSIDE `LiveMapCanvas.vue` ──────────────────────────
 * `LiveMapCanvas` is stubbed in every test that mounts this surface, because maplibre needs WebGL and
 * cannot mount in jsdom (`LiveMapWorkspace.test.ts` says so in its header). So anything decided
 * inside that file is decided somewhere no test can reach — which is exactly where both of D-LM8's
 * stutter defects lived. The DECISION is pure and lives here; the .vue file only carries it out.
 *
 * ── THE MEASUREMENT THAT PRODUCED THE RULE ──────────────────────────────────────────────────────
 * Measured 2026-09-17 against a stand-in origin serving `apps/web/dist` and `/api` together, with
 * the production tile figures (a 512px jpeg road tile, 175 ms round trip), 199 trucks, twelve
 * consecutive row clicks:
 *
 * | camera                                        | tiles per click, median | worst | 12 clicks |
 * |-----------------------------------------------|------------------------|-------|-----------|
 * | `easeTo` always (what shipped)                 | 48                     | 272   | 804       |
 * | `flyTo` always                                 | 48                     |  86   | 611       |
 * | `easeTo` when visible, `jumpTo` when not       |  9                     |  73   | 163       |
 * | **`flyTo` when visible, `jumpTo` when not**    |  **9**                 | **46**| **139**   |
 *
 * A single viewport at zoom 11 is about 9 tiles, so the last row is very nearly the floor and the
 * first row was fetching five to thirty times the tiles the destination needs. The cost is not the
 * browser's — measured on the same rig, the frame loop never stalled and the board poll's own queue
 * wait stayed at 1–2 ms — it is the API's: `/api/fueling/map-tiles/:z/:x/:y` is a proxy that does one
 * upstream HERE fetch and buffers ~47 KB per tile, on the same Railway service that answers the
 * board. Twenty clicks used to be a thousand upstream fetches.
 *
 * ── THE RULE, AS A SENTENCE ABOUT THE READER RATHER THAN ABOUT TILES ────────────────────────────
 * The animation exists so a dispatcher does not lose their place: they watch the map travel and
 * arrive knowing how the new view relates to the old one. That only works when the destination was
 * ALREADY ON SCREEN. A truck two states away is not somewhere the reader can follow the camera to —
 * the animation is a blur of intermediate tiles ending somewhere they have to re-orient in anyway.
 * So: visible, animate; not visible, arrive. The tile count is the consequence, not the reason, and
 * the two happen to agree.
 *
 * ⚠ `flyTo` rather than `easeTo` for the animated half, and that is not a synonym. `easeTo`
 * interpolates centre and zoom linearly, so a long move at the DESTINATION zoom drags a zoom-11
 * viewport across every tile in between; `flyTo` follows van Wijk's path, which zooms out over the
 * distance and back in. Same 600 ms, same arrival, and the worst click above drops from 73 to 46.
 */

import type { MapBounds } from "./liveMapLayer";

/**
 * The zoom a selection is guaranteed at least.
 *
 * ⚠ `Math.max` and not an assignment: a dispatcher who has zoomed into a corridor and clicks a truck
 * inside it keeps their own zoom rather than being thrown back to a preset. That behaviour predates
 * this module and moved here unchanged.
 */
export const SELECT_ZOOM = 11;

/** How long the animated half runs. Unchanged from the `easeTo` this replaced. */
export const SELECT_FLY_MS = 600;

export type CameraMove =
  | { kind: "fly"; center: [number, number]; zoom: number; durationMs: number }
  | { kind: "jump"; center: [number, number]; zoom: number };

/**
 * Where to put the camera, and whether to travel there or arrive.
 *
 * `target` is the place the dot is being DRAWN at (the tween's current sample) rather than the truck's
 * last fix, so the camera lands on the marker the reader clicked rather than a few hundred feet in
 * front of it — see `liveMapMotion.ts` for why those differ by up to the latency budget.
 */
export function planCameraMove(
  target: { lng: number; lat: number },
  visible: MapBounds,
  currentZoom: number,
): CameraMove {
  const center: [number, number] = [target.lng, target.lat];
  const zoom = Math.max(currentZoom, SELECT_ZOOM);
  return isVisible(target, visible)
    ? { kind: "fly", center, zoom, durationMs: SELECT_FLY_MS }
    : { kind: "jump", center, zoom };
}

/**
 * ⚠ Inclusive on every edge. A truck sitting exactly on the boundary is one the reader can see, and
 * the alternative — an exclusive test — makes the camera's behaviour depend on a float comparison
 * nobody can predict from the chair.
 */
function isVisible(target: { lng: number; lat: number }, b: MapBounds): boolean {
  return target.lng >= b.west && target.lng <= b.east && target.lat >= b.south && target.lat <= b.north;
}
