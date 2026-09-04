/**
 * Distance driven, per vehicle, over any period — differenced from odometer READINGS (W3).
 *
 * **The vendor decided the method, not us.** Samsara's own "calculating distance traveled" guide
 * ranks the sources: `obdOdometerMeters` from the engine ECU is "the most accurate";
 * `gpsDistanceMeters` is the fallback where the ECU exposes no odometer; `gpsOdometerMeters` — a GPS
 * distance added to a manually-entered starting value — is the last resort. All three are
 * **cumulative counters in metres**, and Samsara publishes **no distance-over-range endpoint**: the
 * documented method is to read the history and subtract the first reading from the last. So that is
 * what this does, and the ordering of sources it trusts is theirs.
 *
 * **Why the collector stages readings and this file does the arithmetic** (D-FLEET9). An odometer
 * reading is a fact the source asserts: at 23:58:12 the counter read 412,850,113 metres. A day's
 * distance is not — it is a subtraction between two of those facts across a boundary somebody chose.
 * If the collector stored "miles on 3 July" it would have decided the day boundary, the timezone and
 * the period inside an extraction layer, and every later question about a week, a fortnight or a
 * custom range would be a schema change instead of a different subtraction. The collector keeps
 * readings; this computes distance between any two of them.
 *
 * **What it refuses, and why each refusal is not caution but correctness:**
 *
 *  · **A negative delta is never a distance.** An ECU odometer that goes backwards means the counter
 *    reset, the gateway moved to another truck, or the ECU was replaced. `Math.abs` would turn a
 *    hardware event into a plausible mileage figure; a zero would claim the truck stood still. Both
 *    are worse than saying so.
 *  · **A delta beyond `MAX_PERIOD_MILES` per day is refused** on the same reasoning the fuel rollup
 *    refuses an implausible fill interval (`MAX_INTERVAL_MILES` = 2,500). A truck does not cover
 *    2,500 miles in a day, so a figure that says it did is a broken counter, and a broken counter
 *    that reads plausibly is exactly what a per-mile denominator must not absorb.
 *  · **One reading is not a period.** Distance needs two ends. A vehicle with a single reading in
 *    the window gets `null` and a reason, never zero — a truck that reported once is not a truck
 *    that did not move (D-FIN10).
 *
 * Pure. No clock, no I/O; the period is a parameter (D-FLEET6).
 */

/** One odometer reading, exactly as the collector staged it from Samsara. */
export interface VehicleOdometerReading {
  vehicleId: string;
  /** ISO instant the counter was read. The source's own stamp, never re-derived. */
  readingAt: string;
  /** The cumulative counter, in metres, as Samsara reports it. */
  meters: number;
  /** Which counter it came from — Samsara's own ranking, best first. */
  source: OdometerCounter;
}

/**
 * Samsara's ranking, best first: the ECU, then GPS distance, then GPS-plus-manual-offset.
 *
 * Named COUNTER rather than source because `samsara/core.ts` already has an `OdometerSource`, and it
 * means something else: how WE resolved a reading for fuel reconciliation, including a value we
 * reconstructed ourselves. This is which of the vendor's three cumulative counters a number came
 * from — a fact about Samsara, not about our inference. Two vocabularies, two names.
 */
export const ODOMETER_COUNTERS = ["obd", "gps_distance", "gps_odometer"] as const;
export type OdometerCounter = (typeof ODOMETER_COUNTERS)[number];

export interface VehicleDistance {
  vehicleId: string;
  /** Miles between the first and last reading in the period. Null when it cannot be measured. */
  miles: number | null;
  /** The two readings the figure is a difference of, so it can be checked rather than trusted. */
  fromAt: string | null;
  toAt: string | null;
  /** Which counter both readings came from. Null when there is no figure. */
  source: OdometerCounter | null;
  /** Why there is no figure. Null when there is one. */
  reason: string | null;
}

/** A truck does not cover this in a day. Beyond it the counter is broken, not the truck fast. */
export const MAX_PERIOD_MILES_PER_DAY = 2_500;

const METRES_PER_MILE = 1609.344;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Distance per vehicle over `[fromIso, toIso)`.
 *
 * **The period's ends are BOUNDING readings, not readings inside it**, and getting that wrong is a
 * silent undercount rather than an error. A week runs Monday 00:00 to the next Monday 00:00; if the
 * collector keeps one reading near the end of each day, the readings strictly *inside* that week run
 * from Monday evening to Sunday evening — six days of driving reported as seven days' worth. So the
 * opening odometer is **the last reading at or before `fromIso`** and the closing is **the last at or
 * before `toIso`**, which is the same thing an odometer on the dashboard would show at those two
 * moments. Callers must therefore hand in readings from BEFORE the period as well; the service reads
 * a week back for exactly that reason.
 *
 * Readings are grouped by vehicle and, within a vehicle, by SOURCE: an ECU counter and a GPS counter
 * have different origins — one starts at the engine's life, the other at the gateway's install — so
 * subtracting one from the other produces a number with no meaning. The best source that can answer
 * the period wins, in Samsara's own order.
 */
export function distanceByVehicle(
  readings: readonly VehicleOdometerReading[],
  fromIso: string,
  toIso: string,
): VehicleDistance[] {
  const byVehicle = new Map<string, Map<OdometerCounter, VehicleOdometerReading[]>>();
  for (const r of readings) {
    if (r.readingAt > toIso) continue;
    if (!Number.isFinite(r.meters)) continue;
    let sources = byVehicle.get(r.vehicleId);
    if (!sources) {
      sources = new Map();
      byVehicle.set(r.vehicleId, sources);
    }
    const list = sources.get(r.source);
    if (list) list.push(r);
    else sources.set(r.source, [r]);
  }

  const out: VehicleDistance[] = [];
  for (const [vehicleId, sources] of byVehicle) {
    out.push(measure(vehicleId, sources, fromIso, toIso));
  }
  return out.sort((a, b) => (a.vehicleId < b.vehicleId ? -1 : a.vehicleId > b.vehicleId ? 1 : 0));
}

/** The last reading at or before an instant — what the dashboard would have read at that moment. */
function readingAt(sorted: readonly VehicleOdometerReading[], instant: string): VehicleOdometerReading | null {
  let found: VehicleOdometerReading | null = null;
  for (const r of sorted) {
    if (r.readingAt > instant) break;
    found = r;
  }
  return found;
}

function measure(
  vehicleId: string,
  sources: Map<OdometerCounter, VehicleOdometerReading[]>,
  fromIso: string,
  toIso: string,
): VehicleDistance {
  let lastReason = "No odometer readings for this vehicle in the period.";
  for (const source of ODOMETER_COUNTERS) {
    const list = sources.get(source);
    if (!list || list.length === 0) continue;
    const sorted = [...list].sort((a, b) => (a.readingAt < b.readingAt ? -1 : a.readingAt > b.readingAt ? 1 : 0));
    const first = readingAt(sorted, fromIso);
    const last = readingAt(sorted, toIso);
    if (!first || !last || first.readingAt === last.readingAt) {
      lastReason = first
        ? `No ${source} reading after the period started — a distance needs two ends.`
        : `No ${source} reading at or before the period started — the opening odometer is unknown.`;
      continue;
    }

    const metres = last.meters - first.meters;
    if (metres < 0) {
      lastReason = `The ${source} counter went backwards over this period — it reset, or the gateway moved to another truck.`;
      continue;
    }
    const miles = round1(metres / METRES_PER_MILE);
    const days = Math.max(
      1,
      (Date.parse(last.readingAt) - Date.parse(first.readingAt)) / 86_400_000,
    );
    if (miles > MAX_PERIOD_MILES_PER_DAY * days) {
      lastReason = `The ${source} counter moved ${miles.toLocaleString()} miles in ${round1(days)} day(s), which no truck does — the reading is not trustworthy.`;
      continue;
    }
    return { vehicleId, miles, fromAt: first.readingAt, toAt: last.readingAt, source, reason: null };
  }
  return { vehicleId, miles: null, fromAt: null, toAt: null, source: null, reason: lastReason };
}

/**
 * The fleet's distance for the period — the sum of the vehicles that could be measured, and the
 * count of those that could not.
 *
 * The unmeasured count is returned rather than swallowed for the reason G10 exists: a denominator
 * missing part of the fleet produces a per-mile figure that reads low on miles and high on cost, and
 * looks entirely plausible. A caller that cannot say how many trucks are behind its total has no
 * business printing a rate from it.
 */
export function fleetDistance(distances: readonly VehicleDistance[]): {
  miles: number;
  measuredVehicles: number;
  unmeasuredVehicles: number;
} {
  let miles = 0;
  let measured = 0;
  let unmeasured = 0;
  for (const d of distances) {
    if (d.miles == null) unmeasured++;
    else {
      miles = round1(miles + d.miles);
      measured++;
    }
  }
  return { miles, measuredVehicles: measured, unmeasuredVehicles: unmeasured };
}
