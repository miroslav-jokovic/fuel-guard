/**
 * What the live map DRAWS, as data (LIVE-MAP-PLAN.md LM8, D-LM7).
 *
 * ── PURE ON PURPOSE, BECAUSE THE ALTERNATIVE IS UNTESTABLE ───────────────────────────────────────
 * Everything here takes a board and returns a value: no map, no canvas, no clock. The map itself
 * needs WebGL and cannot be mounted in vitest's jsdom, so any decision left inside `LiveMapPanel.vue`
 * is a decision only a screenshot can check. `toMapColor` learnt that lesson at LM7 — it had shipped
 * broken on Edge because it lived in a `.vue` file that needed a canvas to exercise.
 *
 * ── ONE SOURCE, ONE SYMBOL LAYER, NEVER N DOM MARKERS (D-LM7) ────────────────────────────────────
 * Every truck is a feature in one `FeatureCollection`. The layer rotates by `icon-rotate` from
 * `heading`, and picks its picture with a `match` on `icon`. At 199 trucks this draws on the GPU in
 * one pass; the reference implementation this plan reviewed had "MarkerClusterer for 100+ vehicles"
 * on its roadmap, which is a problem you only have once you have made one DOM node per truck.
 *
 * ── THE MARKERS CARRY NO UNIT NUMBER, AND THAT IS A CONSTRAINT RATHER THAN A CHOICE ──────────────
 * A maplibre `symbol` layer can only render `text-field` if the style declares a `glyphs` URL, and
 * this product's style has a single RASTER source pointed at our own authenticated tile proxy
 * (`/api/fueling/map-tiles`). There is no glyph endpoint, and adding one would mean sending our
 * users to a third party for fonts to get a label. So the dots are anonymous on the map and the unit
 * numbers live in the table beneath it — which is why that table is part of this surface and not a
 * decoration on it.
 */
import type { LiveMapVehicle, VehicleMapState } from "@silvicom/shared";

/**
 * The four states, in the order a dispatcher reads them: what is working, down to what we have lost
 * touch with. Legend, filter options and the census row all iterate this one array, so they cannot
 * come to disagree about the order or about which states exist.
 */
export const MAP_STATES: readonly VehicleMapState[] = ["moving", "stopped", "parked", "offline"];

/**
 * A state's colour, as a SEMANTIC TOKEN CLASS resolved at runtime by `tokenColor`.
 *
 * ⚠ Never a hex literal: `lint:tokens-parity` and `lint:token-gamut` refuse to have a colour written
 * down anywhere but `tokens.css`, and a map layer needs a concrete string — so the indirection
 * through a class name is the whole mechanism, not a flourish.
 *
 * The four are descriptive and deliberately NOT a severity ramp. `offline` is neutral rather than
 * amber because 54 of 199 trucks render offline on day one (measured 2026-09-16) and a board that is
 * a quarter alarm-coloured teaches its reader to stop looking at colour. `stopped` is `info` and not
 * `warning` for the reason D-LM9 refuses the word `idle`: an instantaneous "engine on, speed 0" is
 * not a judgement about the driver, and the `idle` module owns the judgement that is.
 */
/**
 * ── D-LM24 (the owner's item 9): MEASURED, IN BOTH SCHEMES, AS PAINTED ──────────────────────────
 * These four are the only thing carrying status on the canvas, so two that measure the same are two
 * states a dispatcher cannot tell apart. Measured 2026-09-17 as ΔEok between the colours AS
 * COMPOSITED — offline is drawn at `icon-opacity: 0.65`, so comparing raw tokens (which the first
 * pass did) overstates how different it looks — and through deuteranopia and protanopia simulations,
 * because a fleet map read by a red-blind dispatcher is not a hypothetical.
 *
 * | scheme | worst pair before | worst pair after |
 * |---|---|---|
 * | light | `stopped`/`parked` **0.076** | `moving`/`stopped` 0.117 |
 * | dark  | `moving`/`offline` **0.021** (deuteranopia) | `moving`/`offline` 0.079 |
 *
 * ⚠ **The dark scheme was the worse of the two and nobody had looked.** A moving truck and an
 * offline one measured 0.021 apart for a deuteranope — the same colour — because a green marker at
 * full opacity and a grey one at 0.65 over a dark basemap land in the same place.
 *
 * ⚠ **`parked` is amber and `offline` is NOT, which is a distinction with a measurement behind it.**
 * `badges.ts` records why offline must not be alarm-coloured: 54 of 199 trucks rendered offline the
 * day the board first had data, and a page that is a fifth alarm-coloured teaches its reader to stop
 * reading colour. That argument is about POPULATION, so it was re-measured rather than assumed —
 * production, 2026-09-16: stopped 123, offline 59, moving 17, **parked 1**. `parked` is a ten-minute
 * transitional band (heard from 5–15 minutes ago) that almost nothing is ever in, so amber there
 * colours half a percent of the board and the objection does not reach it.
 *
 * ⚠ **Two candidates were rejected BY MEASUREMENT, both of which looked right on taste.**
 * `accent-600` (violet) for parked collapsed against offline grey at **0.016** under deuteranopia —
 * worse than what it replaced. `neutral-700` (a darker grey) fixed parked/offline but collapsed
 * against `success-600` at **0.037**: dark green and dark grey are one colour to a red-blind reader.
 *
 * ⚠ **The cost, stated rather than buried.** Moving offline to `neutral-400` makes it fainter against
 * a LIGHT basemap — ΔE to the basemap falls 0.181 → 0.145, a fifth. That is the right side of the
 * trade (the white keyline and D-LM24's larger marker both work against it, and an offline position
 * is one we deliberately no longer stand behind) but it is a cost, not a free win.
 */
export const STATE_COLOR_CLASS: Record<VehicleMapState, string> = {
  moving: "text-success-600",
  stopped: "text-info-500",
  parked: "text-warning-600",
  offline: "text-neutral-400",
};

export const STATE_LABEL: Record<VehicleMapState, string> = {
  moving: "Moving",
  stopped: "Stopped",
  parked: "Parked",
  offline: "Offline",
};

/**
 * Which picture a truck gets: an arrow when we know which way it is pointing, a dot when we do not.
 *
 * ⚠ THE DOT IS NOT DEAD CODE, even though production has 0 rows with a null heading today (measured
 * 2026-09-16, 199 of 199 carried one). The contract admits null — `LiveMapPosition.headingDegrees` is
 * `number | null` because a ping may arrive without a bearing — and the failure mode if this branch
 * did not exist is silent and wrong rather than loud: `icon-rotate` would receive 0 and every
 * bearing-less truck would claim, in a picture, to be driving north.
 */
export function iconNameFor(vehicle: LiveMapVehicle): string {
  const shape = vehicle.position.headingDegrees == null ? "dot" : "arrow";
  return `live-${vehicle.state}-${shape}`;
}

/** Every icon the layer can ask for. The panel pre-registers all eight; a missing one is a blank. */
export const ICON_NAMES: readonly string[] = MAP_STATES.flatMap((state) => [
  `live-${state}-arrow`,
  `live-${state}-dot`,
]);

export interface LiveMapFeatureProperties {
  id: string;
  unit: string;
  state: VehicleMapState;
  icon: string;
  /** Degrees clockwise from north. 0 for a bearing-less truck, which draws a dot and does not rotate. */
  heading: number;
  /** Drawn on top of everything else and given a ring — see the panel's `selected` layer. */
  selected: boolean;
}

export interface LiveMapFeature {
  type: "Feature";
  id: number;
  properties: LiveMapFeatureProperties;
  geometry: { type: "Point"; coordinates: [number, number] };
}

export interface LiveMapFeatureCollection {
  type: "FeatureCollection";
  features: LiveMapFeature[];
}

/** Where a truck is being DRAWN this frame, which is not always where its last fix put it. */
export interface RenderedPlace {
  lat: number;
  lng: number;
  heading: number | null;
}

/**
 * The board as one GeoJSON collection.
 *
 * `places` is the animation's override: between polls `useLiveMapMotion` hands back an interpolated
 * position per truck, and a truck it does not know about falls back to its own fix. Passing nothing
 * draws the board exactly as the server sent it, which is what the first frame and every test do.
 */
export function toFeatureCollection(
  vehicles: readonly LiveMapVehicle[],
  places?: ReadonlyMap<string, RenderedPlace>,
  selectedId?: string | null,
): LiveMapFeatureCollection {
  return {
    type: "FeatureCollection",
    features: vehicles.map((v, index) => {
      const place = places?.get(v.vehicleId);
      const lat = place?.lat ?? v.position.lat;
      const lng = place?.lng ?? v.position.lng;
      const heading = place ? place.heading : v.position.headingDegrees;
      return {
        type: "Feature",
        // A numeric feature id, because maplibre's `setFeatureState` requires one. Index is stable
        // within a frame and that is all it has to be — nothing persists a feature id between polls.
        id: index,
        properties: {
          id: v.vehicleId,
          unit: v.unitNumber,
          state: v.state,
          icon: iconNameFor(v),
          heading: heading ?? 0,
          selected: v.vehicleId === selectedId,
        },
        geometry: { type: "Point", coordinates: [lng, lat] },
      };
    }),
  };
}

export interface LiveMapFilters {
  /** Empty means every state. A state the dispatcher un-ticked is simply absent. */
  states: readonly VehicleMapState[];
  /** Matched against unit number and driver name, case-insensitively. */
  search: string;
}

export const EMPTY_FILTERS: LiveMapFilters = { states: [], search: "" };

/**
 * A rectangle of the world, in the shape `maplibregl.LngLatBounds` already answers with.
 *
 * ⚠ **THE ONE bounds type on this surface**, and it was briefly two. `liveMapCamera.ts` declared an
 * identical `CameraBounds` because the camera (D-LM19) and the viewport filter (D-LM23) were built on
 * separate branches of the same queue and landed within an hour of each other. Both read the same
 * four numbers off the same `map.getBounds()` call, so the split was never a distinction — it was two
 * names for one fact, which is this repo's register for a copy with a delay fuse: the day one of them
 * grows a `padding`, the other silently will not have it.
 *
 * ⚠ It lives HERE and not in `liveMapCamera.ts` for a reason worth keeping: this module imports only
 * `@silvicom/shared` and nothing local, so everything else in the feature can depend on it without a
 * cycle. `liveMapCamera.ts` imports this; nothing imports `liveMapCamera.ts` but the canvas.
 */
export interface MapBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * The trucks inside a rectangle — the owner's item 7, "only trucks in the viewport" (D-LM23).
 *
 * ⚠ A SEPARATE STEP FROM `filterVehicles`, not a fifth field inside it, and that is the whole design.
 * The census has to count the population the rail is drawing FROM — the fleet normally, the viewport
 * when the reader has asked for the viewport — while the state and search filters narrow WITHIN that
 * population. Folding the viewport in with them would make pressing "Moving" zero the other three
 * counts, which is what `stateCounts(vehicles)` exists to avoid.
 *
 * ⚠ `null` means the filter is OFF and every truck is in scope. It is not an empty rectangle: a map
 * that has not reported its bounds yet would otherwise show an empty fleet for one frame, which reads
 * as a broken board rather than as a filter waiting for a camera.
 */
export function scopeToViewport(
  vehicles: readonly LiveMapVehicle[],
  viewport: MapBounds | null,
): readonly LiveMapVehicle[] {
  if (!viewport) return vehicles;
  return vehicles.filter(
    (v) =>
      v.position.lng >= viewport.west &&
      v.position.lng <= viewport.east &&
      v.position.lat >= viewport.south &&
      v.position.lat <= viewport.north,
  );
}

/**
 * ⚠ The dispatcher and load-status filters LM8 originally listed are deliberately absent.
 *
 * `tms_dispatchers` does not exist in this database — it is downstream of the McLeod
 * `VIEW CHANGE TRACKING` grant the carrier has not given — and `loads` holds 0 rows until LM12. Two
 * dropdowns with nothing in them do not read as "not yet"; they read as "this page is broken", and
 * the dispatcher who concludes that is right to. They arrive with the grant and with LM12.
 */
export function filterVehicles(
  vehicles: readonly LiveMapVehicle[],
  filters: LiveMapFilters,
): LiveMapVehicle[] {
  const needle = filters.search.trim().toLowerCase();
  const states = new Set(filters.states);
  return vehicles.filter((v) => {
    if (states.size > 0 && !states.has(v.state)) return false;
    if (!needle) return true;
    return (
      v.unitNumber.toLowerCase().includes(needle) ||
      (v.driver?.name.toLowerCase().includes(needle) ?? false)
    );
  });
}

/** How many trucks are in each state — the census the legend shows, over the WHOLE board. */
export function stateCounts(
  vehicles: readonly LiveMapVehicle[],
): Record<VehicleMapState, number> {
  const counts: Record<VehicleMapState, number> = { moving: 0, stopped: 0, parked: 0, offline: 0 };
  for (const v of vehicles) counts[v.state] += 1;
  return counts;
}


/**
 * How the fleet list may be ordered (D-DR25).
 *
 * ── WHY A SORT CONTROL EXISTS AT ALL, WHEN THE OLD LIST HAD SORTABLE COLUMNS ─────────────────────
 * The fleet list used to be a seven-column `DataTable` docked across the bottom of the map, and its
 * headers sorted. A 320px rail cannot carry seven columns — D-DR17's lesson twice over — so the
 * columns went and the capability had to be kept somewhere or admitted as a loss. "Which truck has
 * the oldest fix" is the one a dispatcher actually asks, and it would have been the one lost, so the
 * orderings survive as four options in a select rather than as headers to click.
 *
 * ⚠ The state order is `MAP_STATES` — moving, stopped, parked, offline — and NOT alphabetical, which
 * would read "moving, offline, parked, stopped" and put the trucks nobody can see in the middle of
 * the ones that are driving.
 */
export type LiveMapSort = "unit" | "state" | "age" | "speed";

export const LIVE_MAP_SORTS: { value: LiveMapSort; label: string }[] = [
  { value: "unit", label: "Unit number" },
  { value: "state", label: "Status" },
  { value: "age", label: "Oldest fix first" },
  { value: "speed", label: "Fastest first" },
];

/**
 * A copy of the list in the chosen order.
 *
 * ⚠ It COPIES rather than sorting in place, because the array it is handed is the board's own and a
 * poll replaces that array every five seconds: sorting the source would mutate a value vue-query
 * hands out to every other reader, including the map's own feature collection.
 *
 * ⚠ Unit number sorts NUMERICALLY where it can. This fleet's units are "1207" and "204" as strings,
 * and a lexicographic sort puts 1207 before 204 — which reads as a bug in the list rather than as a
 * sorting rule, and is the reason `localeCompare` alone was not enough.
 */
export function sortVehicles(
  vehicles: readonly LiveMapVehicle[],
  sort: LiveMapSort,
): LiveMapVehicle[] {
  const byUnit = (a: LiveMapVehicle, b: LiveMapVehicle) =>
    a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true });
  const copy = [...vehicles];
  switch (sort) {
    case "state":
      // Within a status, unit order — so the list is stable to read rather than shuffling by whatever
      // order the board happened to return.
      return copy.sort(
        (a, b) => MAP_STATES.indexOf(a.state) - MAP_STATES.indexOf(b.state) || byUnit(a, b),
      );
    case "age":
      return copy.sort((a, b) => b.ageSeconds - a.ageSeconds || byUnit(a, b));
    case "speed":
      // ⚠ A truck with no speed reading is not a slow truck. `null` sorts last in a "fastest first"
      // list rather than being coerced to 0 and mixed in with the parked ones.
      return copy.sort(
        (a, b) => (b.position.speedMph ?? -1) - (a.position.speedMph ?? -1) || byUnit(a, b),
      );
    default:
      return copy.sort(byUnit);
  }
}
