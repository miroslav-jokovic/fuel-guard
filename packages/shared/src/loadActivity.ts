import { boardStops, compareLoadsOnTruck, isLoadOnTruck, loadBoardState } from "./loadBoard.js";
import type { LoadStatus } from "./loadsContract.js";

/**
 * When a load was picked up and delivered, and how long a driver or truck has gone without one
 * (LOADS-ACTIVITY-PLAN.md D-LA1, D-LA4, D-LA5, D-LA7). Pure, with the clock passed in, so the Loads
 * list, the API's delivered window and the activity read all answer from one definition.
 *
 * ── WHICH TIME IS "DELIVERED" (D-LA1) ────────────────────────────────────────────────────────────
 * The last delivery stop's McLeod departure (`load_stops.actual_departure_at`): filled on 762 of 762
 * delivered loads on 2026-10-19. The driver app's `completed_at` on that stop stands in only when
 * McLeod has none (a load McLeod never sent). Two columns that look like the answer are not:
 *
 *   · `loads.completed_at` is null on EVERY McLeod load. Only the driver app writes it.
 *   · `loads.external_closed_at` is McLeod closing the movement for billing, a median 24.7 hours
 *     after the truck left and up to three weeks later (p95 21.8 days). It is the office's day, not the
 *     delivery's.
 *
 * ── A TIME KEYED AHEAD (D-LA4) ───────────────────────────────────────────────────────────────────
 * 16 stops on 2026-10-19 carried a McLeod "actual" time later than the moment of reading. Dispatchers
 * key an arrival ahead, e.g. 0136753 "departed" 10/21 13:00, exactly its appointment. Such a time is
 * neither dropped nor believed: `enteredAhead` says so, and activity counts it as now. A driver whose
 * stop is dated tomorrow has a load in hand and is not idle.
 */

export interface ActivityStop {
  seq: number;
  kind: "pickup" | "dropoff";
  /** McLeod's departure, verbatim. */
  actual_departure_at?: string | null;
  /** The driver app's completion. */
  completed_at?: string | null;
}

const stopLeftAt = (s: ActivityStop | null): string | null => s?.actual_departure_at ?? s?.completed_at ?? null;

/** When the truck left the first pickup, by `seq`. Null until it has. */
export function loadPickedUpAt(stops: readonly ActivityStop[]): string | null {
  return stopLeftAt(boardStops(stops).pickup);
}

/** When the truck left the last delivery, by `seq` (D-LA1). Null until it has. */
export function loadDeliveredAt(stops: readonly ActivityStop[]): string | null {
  return stopLeftAt(boardStops(stops).delivery);
}

/** Is this recorded time later than now: keyed ahead in McLeod, not yet happened (D-LA4)? */
export function isEnteredAhead(at: string | null | undefined, nowMs: number): boolean {
  return at != null && Date.parse(at) > nowMs;
}

export interface ActivityLoad {
  id: string;
  ref: string;
  status: LoadStatus;
  source: string;
  /** McLeod's loaded flag. `false` is an empty move (D-LA5); null means McLeod did not say. */
  loaded: boolean | null;
  driver_id: string | null;
  co_driver_id: string | null;
  vehicle_id: string | null;
  dispatcher_external_id: string | null;
  stops: readonly ActivityStop[];
}

/** One driver's or one truck's activity, as the Activity view lists it (D-LA7). */
export interface ActivitySummary {
  subjectId: string;
  /** The load on the truck now (`isLoadOnTruck`), else null. An empty move counts: the truck is working. */
  currentLoad: { id: string; ref: string; empty: boolean } | null;
  /** A planned next load (Upcoming on the board) that is not on the truck yet. */
  plannedLoad: { id: string; ref: string } | null;
  lastPickupAt: string | null;
  lastDeliveryAt: string | null;
  /** True when either time above was keyed ahead in McLeod (D-LA4). */
  enteredAhead: boolean;
  /**
   * Whole days without a load: 0 while one is on the truck, else days since the last delivery (capped at
   * now). Null when nothing has been delivered in the window read: the view then says "none since …",
   * because a number would claim history the mirror does not hold.
   */
  daysWithoutLoad: number | null;
  /** The truck and dispatcher of the subject's latest load, so the page's fleet scope can place it. */
  vehicleId: string | null;
  dispatcherId: string | null;
}

const DAY_MS = 86_400_000;
const latest = (a: string | null, b: string | null): string | null => (!a ? b : !b ? a : Date.parse(b) > Date.parse(a) ? b : a);

/**
 * Activity per subject (a driver or a truck). `subjectsOf` names who a load counts for. For drivers
 * that is BOTH seats (D-LA2), for trucks the vehicle. A canceled load counts for nobody. An empty move
 * (D-LA5) can be the current load but is never a pickup or a delivery.
 */
export function summarizeActivity(
  loads: readonly ActivityLoad[],
  subjectIds: readonly string[],
  subjectsOf: (load: ActivityLoad) => readonly (string | null)[],
  nowMs: number,
): Map<string, ActivitySummary> {
  const out = new Map<string, ActivitySummary>(
    subjectIds.map((id) => [id, {
      subjectId: id, currentLoad: null, plannedLoad: null, lastPickupAt: null, lastDeliveryAt: null,
      enteredAhead: false, daysWithoutLoad: null, vehicleId: null, dispatcherId: null,
    }]),
  );
  const latestAt = new Map<string, string>();
  // The load each subject's `currentLoad` came from: two on one truck resolve by the board's rule.
  const currentOf = new Map<string, ActivityLoad>();

  for (const load of loads) {
    if (load.status === "canceled") continue;
    const pickedUp = load.loaded === false ? null : loadPickedUpAt(load.stops);
    const delivered = load.loaded === false || load.status !== "delivered" ? null : loadDeliveredAt(load.stops);
    const onTruck = isLoadOnTruck(load);
    const planned = !onTruck && loadBoardState(load).queue === "upcoming";
    const touched = latest(latest(pickedUp, delivered), onTruck || planned ? new Date(nowMs).toISOString() : null);

    for (const id of new Set(subjectsOf(load))) {
      const row = id ? out.get(id) : undefined;
      if (!row) continue;
      const held = currentOf.get(row.subjectId);
      if (onTruck && (!held || compareLoadsOnTruck(load, held) < 0)) {
        currentOf.set(row.subjectId, load);
        row.currentLoad = { id: load.id, ref: load.ref, empty: load.loaded === false };
      }
      if (planned && (!row.plannedLoad || load.ref < row.plannedLoad.ref)) row.plannedLoad = { id: load.id, ref: load.ref };
      row.lastPickupAt = latest(row.lastPickupAt, pickedUp);
      row.lastDeliveryAt = latest(row.lastDeliveryAt, delivered);
      // The latest load names the subject's truck and dispatcher, for the page's fleet scope.
      if (touched && (!latestAt.has(row.subjectId) || Date.parse(touched) >= Date.parse(latestAt.get(row.subjectId)!))) {
        latestAt.set(row.subjectId, touched);
        row.vehicleId = load.vehicle_id;
        row.dispatcherId = load.dispatcher_external_id;
      }
    }
  }

  for (const row of out.values()) {
    row.enteredAhead = isEnteredAhead(row.lastPickupAt, nowMs) || isEnteredAhead(row.lastDeliveryAt, nowMs);
    if (row.currentLoad) row.daysWithoutLoad = 0;
    else if (row.lastDeliveryAt) row.daysWithoutLoad = Math.max(0, Math.floor((nowMs - Date.parse(row.lastDeliveryAt)) / DAY_MS));
  }
  return out;
}

/**
 * How far back the activity read looks for deliveries (D-LA7). A driver idle longer than this reads
 * "none since …", not a number. Two months answers every question the owner asked ("multiple days")
 * with room to spare, and keeps the read to roughly 1,500 deliveries at this carrier's pace.
 */
export const ACTIVITY_LOOKBACK_DAYS = 60;

/** `GET /api/dispatch/activity` (D-LA7). Times are ISO instants. */
export interface LoadActivityResponse {
  asOf: string;
  /** The read's lookback start (`ACTIVITY_LOOKBACK_DAYS` before `asOf`). */
  windowFrom: string;
  /** The earliest delivery the read holds: the start of what "none since" can honestly claim. */
  historyFrom: string | null;
  drivers: (ActivitySummary & { name: string | null; hosStatus: string | null })[];
  trucks: (ActivitySummary & { unit: string | null })[];
}
