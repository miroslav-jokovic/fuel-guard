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
import type { LiveMapBoard, LiveMapVehicle, VehicleMapState } from "@silvicom/shared";

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
export const STATE_COLOR_CLASS: Record<VehicleMapState, string> = {
  moving: "text-success-600",
  stopped: "text-info-500",
  parked: "text-neutral-600",
  offline: "text-neutral-500",
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
 * A fix's age in words (D-LM10 — shown per truck, never hidden behind the marker).
 *
 * ⚠ It formats the number the SERVER computed and never re-derives one. The board states its own
 * `generatedAt` and every `ageSeconds` on it was measured against that single clock; a component
 * subtracting `sampledAt` from the browser's `Date.now()` would be a second answer, wrong by
 * whatever the two clocks disagree by, on the same screen as the first.
 */
export function formatAge(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

/**
 * The legend's sentence for the `offline` bound, built from what the response said it was.
 *
 * The board sends `bounds` precisely so no component holds a second copy of the numbers (LM6). A
 * legend reading "offline after 15 minutes" from a literal is telling the user something the
 * response can already prove, and it is wrong the first day somebody retunes the bound.
 */
export function offlineBoundSentence(bounds: LiveMapBoard["bounds"]): string {
  const minutes = Math.round(bounds.offlineBoundSeconds / 60);
  return `No fix for over ${minutes} min`;
}

/** The same, for the `stopped`/`parked` seam, which is a cadence rather than a stopwatch (D-LM9b). */
export function engineOnBoundSentence(bounds: LiveMapBoard["bounds"]): string {
  return `Not moving, heard from within ${bounds.engineOnBoundSeconds}s`;
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
