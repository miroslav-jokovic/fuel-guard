/**
 * The live map's read contract (LIVE-MAP-PLAN.md LM6, D-LM11).
 *
 * ── WHY THE BOARD IS AN API SHAPE AND NOT SIX TABLES IN A BROWSER BUNDLE ─────────────────────────
 * D-LM11. Answering "where is my fleet and what is it doing" from the browser would mean shipping
 * `vehicle_positions`, `vehicles`, `drivers`, `loads`, `load_stops` and the scoping rule into a
 * client — six table shapes and a permission decision, re-implemented next to the map. The board is
 * assembled server-side and the browser receives the answer. `vehicle_positions` is also RLS
 * deny-all by design (0341), so there is no PostgREST path to it even if somebody wanted one.
 *
 * ── EVERY FIELD A TRUCK'S MARKER NEEDS, AND NOTHING ELSE ─────────────────────────────────────────
 * No cost, no rate, no margin: `dispatch` and `accounting` are different sections and this is the
 * dispatch one (the LM-F ruling, applied at the source rather than hidden in a component).
 */
import type { VehicleMapState } from "./livemap.js";
import type { EngineState } from "./idleSessions.js";

/** Where a truck is, exactly as `vehicle_positions` holds it. */
export interface LiveMapPosition {
  lat: number;
  lng: number;
  /** Degrees clockwise from true north, `[0, 360)`. Null when the ping carried no bearing. */
  headingDegrees: number | null;
  speedMph: number | null;
  /** Samsara's own flag. Null when the ping carried no speed — absent is not "not from the ECU". */
  isEcuSpeed: boolean | null;
  /** The vendor's reverse-geocoded place name, verbatim. No external geocoder is in this path. */
  formattedLocation: string | null;
  /** Vendor `gps.time` — when the truck was THERE. */
  sampledAt: string;
  /** When we stored it. With `sampledAt` it separates "has not moved" from "the feed has stopped". */
  receivedAt: string | null;
}

export interface LiveMapDriver {
  id: string;
  name: string;
}

/**
 * What is in the tank, and when that was last true (`Q-LM20`, the owner's item 8).
 *
 * ── WHY IT IS A PAIR AND NOT A NUMBER ────────────────────────────────────────────────────────────
 * The two halves are inseparable, so the type makes them so. `68` beside a position measured six
 * seconds ago reads as a tank measured six seconds ago; on this fleet it is a day or more old for
 * about a third of the board and, for a quarter of the trucks whose POSITION is live, over an hour
 * (see `FUEL_FRESH_SECONDS` for the measurements). A number that looks live and is not is worse than
 * no number — the same argument D-LM10 and D-LM20 have already been paid for twice on this surface,
 * for the fix age and for speed.
 *
 * ⚠ `at` is the VENDOR's reading time, not ours. `samsara_fuel_at` is when the ECU reported the
 * level, which is the only clock that can say whether the figure still describes the truck; when we
 * happened to store it says nothing about the fuel.
 *
 * ⚠ A truck with no reading at all sends `null` rather than a percent of 0, and the difference is
 * the whole point: an empty tank and an unknown tank are opposite facts. 65 of 272 `vehicles` rows
 * have never carried a reading — though none of them is on the board today, because every one is
 * retired or has no position (measured 2026-09-17).
 */
export interface LiveMapFuel {
  /** Percent of tank, as the vendor reports it. Production range on this fleet: 3.0 – 100.0. */
  percent: number;
  /** Vendor reading time, ISO. Paired with `bounds.fuelFreshSeconds` to decide how it is presented. */
  at: string;
}

export interface LiveMapStop {
  seq: number | null;
  kind: string | null;
  name: string | null;
  city: string | null;
  state: string | null;
  appointmentStart: string | null;
  appointmentEnd: string | null;
  status: string | null;
  /**
   * Street and postal code (TRUCK-CARD-ROUTE-PLAN D-TC2), so the card can show the load's two ends as
   * addresses. Optional for the same reason as `source` below: the web and api deploy separately.
   */
  addressLine?: string | null;
  postalCode?: string | null;
}

export interface LiveMapLoad {
  id: string;
  /** The carrier's own reference, which is what a dispatcher says out loud. */
  ref: string | null;
  status: string;
  /**
   * Where the load came from (`tms` = McLeod) and McLeod's own movement code, so the map words the
   * status with `loadBoardState`, exactly as the Loads board does. Optional because the web and api
   * services deploy separately: a map served against an api from before 2026-09-28 gets neither, and
   * still has a word for the status.
   */
  source?: string | null;
  externalStatus?: string | null;
  /**
   * The first stop not behind the truck (`nextStopOnRoute`): neither finished in the driver app nor
   * departed in McLeod. Null when every stop is behind it or none was recorded.
   */
  nextStop: LiveMapStop | null;
  /**
   * The load's two ends (D-TC2): the first pickup and the last delivery by McLeod's sequence, chosen by
   * `boardStops` — the Loads board's own rule, so the two surfaces cannot name a different pickup.
   * `extraStops` counts the stops between and beside them. Optional: an api from before 2026-10-09
   * sends none, and the card then shows the next stop alone, as it did.
   */
  pickup?: LiveMapStop | null;
  delivery?: LiveMapStop | null;
  extraStops?: number;
}

export interface LiveMapVehicle {
  vehicleId: string;
  unitNumber: string;
  /** From `vehicles.assigned_driver_id`. Null for a truck with nobody on it — 67 of 235 in production. */
  driver: LiveMapDriver | null;
  position: LiveMapPosition;
  /** `deriveVehicleState`, computed once here so the map and any other reader cannot disagree. */
  state: VehicleMapState;
  /**
   * The ECU's own engine state behind `state` (D-LM29), Samsara's spelling. Null when the feed has
   * not reported one, in which case `state` fell back to the ping-rate inference.
   */
  engineState: EngineState | null;
  /**
   * The roster has this truck in the shop (`vehicles.status = 'maintenance'`, McLeod's `S`). It stays
   * on the board — Q-LM8a ruled a dispatcher wants to see a shop truck on a map — but it is said, so a
   * truck parked for 40 days at the shop is not read as a truck that went missing (LS3).
   */
  inShop: boolean;
  /** Age of the FIX in seconds. D-LM10 — shown per truck, never hidden behind the marker. */
  ageSeconds: number;
  /**
   * The tank, with the time it was read. Null when this truck has never reported one.
   *
   * ⚠ Its age is its OWN and is never inherited from the fix. A truck can be fixed six seconds ago
   * and last have reported fuel five days ago — 35 of the 146 live-fix trucks on this fleet are more
   * than an hour apart on the two (2026-09-17).
   */
  fuel: LiveMapFuel | null;
  /**
   * The load this truck is hauling now (`isLoadOnTruck`: for McLeod, movement `P`, D-MCC12), or null.
   * Null on every truck until the Board VM's first sync, which is normal, not an error.
   */
  load: LiveMapLoad | null;
}

/**
 * Whose trucks the caller is looking at.
 *
 * `mine` does not exist yet and the board says `all` for everybody — see `scopeReason`. D-LM3 scopes
 * a dispatcher by the LOAD's dispatcher, which needs `movement.dispatcher_user_id` resolved through
 * `tms_dispatchers`; McLeod has not granted `VIEW CHANGE TRACKING`, the table does not exist, and
 * D-LM18 therefore ships the board fleet-wide. The tempting substitute was measured and rejected:
 * `tractor.dispatcher` agrees with the load's actual dispatcher on **56%** of the live board.
 */
export type LiveMapScope = "all" | "mine";

/**
 * The bounds the board's states were computed with, sent so a client can label its own legend
 * without a second copy of the numbers. A UI that hard-coded "offline after 15 minutes" would be
 * telling the user something this response can already prove.
 */
export interface LiveMapBounds {
  stoppedSpeedMph: number;
  engineOnBoundSeconds: number;
  offlineBoundSeconds: number;
  /**
   * Past this many seconds a fuel reading is presented with its age rather than on its own
   * (`FUEL_FRESH_SECONDS`). Here for the same reason as the three above: the client that decides how
   * to word a stale reading must read the line from the response, not hold a second copy of it.
   */
  fuelFreshSeconds: number;
}

export interface LiveMapUntracked {
  vehicleId: string;
  unitNumber: string;
}

export interface LiveMapBoard {
  /** The instant every `state` and `ageSeconds` was computed against. One clock for the whole board. */
  generatedAt: string;
  scope: LiveMapScope;
  /** Plain-sentence reason for the scope. The banner D-LM3 requires — never a silent fake scope. */
  scopeReason: string;
  bounds: LiveMapBounds;
  vehicles: LiveMapVehicle[];
  /**
   * Trucks in the fleet the board CANNOT draw: not retired, but no position has ever been stored —
   * in practice a truck with no Samsara gateway fitted yet (LS3; 12 of 193 on 2026-09-22). They were
   * silently absent from the census before; a count that is short without saying so is the thing the
   * owner compared against Samsara and found wrong.
   */
  untracked: LiveMapUntracked[];
  /**
   * PostgREST caps every response at 1,000 rows regardless of `.limit()`, and this fleet is ~200 — so
   * this is false today and is here because the day it is true, a board that silently dropped a
   * quarter of the fleet would look exactly like a board with fewer trucks on it.
   */
  truncated: boolean;
}

/** A fuel stop the planner chose on the part of a load's route still ahead (TRUCK-CARD-ROUTE-PLAN D-TC4). */
export interface LiveMapRouteFuelStop {
  name: string | null;
  brand: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  exit: string | null;
  lat: number;
  lng: number;
  /** Miles ahead of the truck (or of the pickup, when the truck is off the route). */
  milesAhead: number;
}

/** One end of a load's route: where its first or last stop is, and what McLeod calls the place. */
export interface LiveMapRouteEnd {
  lat: number;
  lng: number;
  name: string | null;
  /** `pickup` or `dropoff`, as the stop records it. */
  kind: string | null;
}

/**
 * `GET /api/livemap/loads/:id/route` (D-TC3, D-TC6): the load's route pickup → delivery, split where the
 * truck stands on it, and the fuel stops the planner places on the part ahead. No prices: the map is
 * `dispatch` view, and money is another section's (LM-F).
 */
export interface LiveMapLoadRoute {
  loadId: string;
  /** Already driven: start → the truck's point on the line. Empty when the truck is off the route. */
  covered: { lat: number; lng: number }[];
  /** Still ahead: the truck's point → delivery. The whole line when the truck is off it. */
  ahead: { lat: number; lng: number }[];
  /** The whole route, pickup → delivery. */
  distanceMiles: number;
  durationHours: number;
  /** Where the truck is against the line. `offRouteMiles` is null when there is no position for it. */
  truckOnRoute: boolean;
  coveredMiles: number;
  offRouteMiles: number | null;
  fuelStops: LiveMapRouteFuelStop[];
  /**
   * The route's two ends as McLeod locates them — the first and last stop by sequence, not the line's
   * snapped ends — for the start and end pins (2026-10-09, the owner's "pins like Google Maps").
   * Optional: an api from before them sends neither, and the map draws the line without pins.
   */
  start?: LiveMapRouteEnd;
  end?: LiveMapRouteEnd;
  /** Why there are no fuel stops, or what the planner had to do — one sentence, or null. */
  fuelNote: string | null;
  /** A hazmat-marked load routed WITHOUT hazmat restrictions: no cleared record supplies its classes yet. */
  hazmatNotApplied: boolean;
}
