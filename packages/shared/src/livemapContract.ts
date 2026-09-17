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
}

export interface LiveMapLoad {
  id: string;
  /** The carrier's own reference, which is what a dispatcher says out loud. */
  ref: string | null;
  status: string;
  /** The earliest stop still to be worked. Null when every stop is done or none was recorded. */
  nextStop: LiveMapStop | null;
}

export interface LiveMapVehicle {
  vehicleId: string;
  unitNumber: string;
  /** From `vehicles.assigned_driver_id`. Null for a truck with nobody on it — 67 of 235 in production. */
  driver: LiveMapDriver | null;
  position: LiveMapPosition;
  /** `deriveVehicleState`, computed once here so the map and any other reader cannot disagree. */
  state: VehicleMapState;
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
  /** Null for every truck until LM12 turns the loads feed on. That is normal, not an error. */
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

export interface LiveMapBoard {
  /** The instant every `state` and `ageSeconds` was computed against. One clock for the whole board. */
  generatedAt: string;
  scope: LiveMapScope;
  /** Plain-sentence reason for the scope. The banner D-LM3 requires — never a silent fake scope. */
  scopeReason: string;
  bounds: LiveMapBounds;
  vehicles: LiveMapVehicle[];
  /**
   * PostgREST caps every response at 1,000 rows regardless of `.limit()`, and this fleet is ~200 — so
   * this is false today and is here because the day it is true, a board that silently dropped a
   * quarter of the fleet would look exactly like a board with fewer trucks on it.
   */
  truncated: boolean;
}
