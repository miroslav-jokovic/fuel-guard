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
