/**
 * Odometer-accuracy aggregation (owner concern: are drivers entering correct odometers?). Compares the
 * driver-entered odometer against the independent Samsara reading at the fill, grouped by driver or
 * vehicle. Pure + testable; the API loads the rows and the report renders the result.
 */

export interface OdoRow {
  driverId: string | null;
  driverName: string | null;
  vehicleId: string | null;
  unit: string | null;
  entered: number | null; // odometer the driver entered
  samsara: number | null; // Samsara odometer at the fill
  /** Learned/overridden per-vehicle calibration (dash − Samsara). 0 when unknown. */
  odometerOffset?: number | null;
}

export interface OdoAccuracyRow {
  key: string;
  label: string;
  fills: number; // total fills in scope
  checked: number; // fills where both entered + Samsara were present (verifiable)
  mismatches: number; // verifiable fills off by more than tolerance
  accuracyPct: number | null; // share of verifiable fills that were accurate
  avgDeviation: number | null; // avg |entered − Samsara| over verifiable fills
  maxDeviation: number | null;
}

const round = (n: number) => Math.round(n * 10) / 10;

// ── per-fill odometer mismatch listing (the browsable "which fills disagree" view) ──────────────
// The odometer-accuracy report below answers "how accurate is each driver/vehicle overall". This
// answers "show me the individual fills where the entered odometer disagrees with telematics" — the
// data behind the Odometer Mismatches tab. It never raises an anomaly; it's a human-review surface so
// systematic odometer padding (a single-axis masking move that stays below the theft-case threshold)
// is visible without polluting the case queue.

export interface OdoMismatchInput {
  id: string;
  fueledAt: string;
  vehicleId: string | null;
  unit: string | null;
  driverId: string | null;
  driverName: string | null;
  entered: number | null;
  samsara: number | null;
  /** Learned/overridden per-vehicle calibration (dash − Samsara). 0 when unknown. */
  odometerOffset?: number | null;
  /** How the fueling instant was determined (tank_confirmed | stop_estimated | reported | date_only). */
  timeBasis?: string | null;
  /** Samsara location confidence at the fill (gps_confirmed | in_state | mismatch | unknown). */
  locationConfidence?: string | null;
  /** ISO time the Samsara odometer reading was taken (the physical-fill anchor). null when unknown. */
  samsaraOdometerAt?: string | null;
  /** Where the Samsara odometer came from: 'obd' | 'gps' | 'reconstructed'. null when unknown. */
  samsaraOdometerSource?: string | null;
}

export interface OdoMismatchRow {
  id: string;
  fueledAt: string;
  vehicleId: string | null;
  unit: string | null;
  driverId: string | null;
  driverName: string | null;
  entered: number;
  samsara: number;
  offset: number;
  /** Signed calibrated difference: entered − (samsara + offset). Positive = entered reads high. */
  diff: number;
  absDiff: number;
  timeBasis: string | null;
  locationConfidence: string | null;
  samsaraOdometerAt: string | null;
  samsaraOdometerSource: string | null;
}

export interface OdoOffenderRow {
  key: string;
  label: string;
  mismatches: number;
  avgAbsDiff: number;
  maxAbsDiff: number;
}

export interface OdoMismatchReport {
  rows: OdoMismatchRow[];
  /** Drivers ranked by mismatch count — surfaces systematic padding. */
  offenders: OdoOffenderRow[];
  /** Fills with BOTH readings present (the verifiable denominator). */
  checked: number;
  toleranceMiles: number;
}

/**
 * List individual fills whose calibrated |entered − Samsara| exceeds the tolerance, largest-first, plus
 * a per-driver offender rollup. Applies the SAME per-vehicle offset the anomaly rule uses, so the tab
 * and the engine agree on what counts as a mismatch. Pure + testable.
 */
export function odometerMismatches(rows: OdoMismatchInput[], toleranceMiles = 10): OdoMismatchReport {
  const out: OdoMismatchRow[] = [];
  let checked = 0;
  for (const r of rows) {
    if (r.entered == null || r.samsara == null) continue;
    checked += 1;
    const offset = r.odometerOffset ?? 0;
    const diff = r.entered - (r.samsara + offset);
    if (Math.abs(diff) > toleranceMiles) {
      out.push({
        id: r.id,
        fueledAt: r.fueledAt,
        vehicleId: r.vehicleId,
        unit: r.unit,
        driverId: r.driverId,
        driverName: r.driverName,
        entered: r.entered,
        samsara: r.samsara,
        offset: round(offset),
        diff: round(diff),
        absDiff: round(Math.abs(diff)),
        timeBasis: r.timeBasis ?? null,
        locationConfidence: r.locationConfidence ?? null,
        samsaraOdometerAt: r.samsaraOdometerAt ?? null,
        samsaraOdometerSource: r.samsaraOdometerSource ?? null,
      });
    }
  }
  out.sort((a, b) => b.absDiff - a.absDiff || new Date(b.fueledAt).getTime() - new Date(a.fueledAt).getTime());

  const g = new Map<string, { label: string; devs: number[] }>();
  for (const m of out) {
    const key = m.driverId ?? "__unattributed__";
    const label = m.driverName ?? "Unattributed";
    const e = g.get(key) ?? { label, devs: [] };
    e.devs.push(m.absDiff);
    g.set(key, e);
  }
  const offenders = [...g.entries()]
    .map(([key, e]) => ({
      key,
      label: e.label,
      mismatches: e.devs.length,
      avgAbsDiff: round(e.devs.reduce((a, b) => a + b, 0) / e.devs.length),
      maxAbsDiff: round(Math.max(...e.devs)),
    }))
    .sort((a, b) => b.mismatches - a.mismatches || b.maxAbsDiff - a.maxAbsDiff);

  return { rows: out, offenders, checked, toleranceMiles };
}

export function odometerAccuracy(rows: OdoRow[], by: "driver" | "vehicle", toleranceMiles = 10): OdoAccuracyRow[] {
  const groups = new Map<string, { label: string; fills: number; devs: number[]; mismatches: number }>();

  for (const r of rows) {
    const key = (by === "driver" ? r.driverId : r.vehicleId) ?? "__unattributed__";
    const label = (by === "driver" ? r.driverName : r.unit) ?? "Unattributed";
    const g = groups.get(key) ?? { label, fills: 0, devs: [], mismatches: 0 };
    g.fills += 1;
    if (r.entered != null && r.samsara != null) {
      // Apply the learned per-vehicle calibration (dash − Samsara) — the SAME correction the anomaly
      // rule uses. Without it, every fill on a truck with a replaced cluster read as a "mismatch"
      // here even though the anomaly engine considered it fine.
      const expected = r.samsara + (r.odometerOffset ?? 0);
      const dev = Math.abs(r.entered - expected);
      g.devs.push(dev);
      if (dev > toleranceMiles) g.mismatches += 1;
    }
    groups.set(key, g);
  }

  return [...groups.entries()]
    .map(([key, g]) => {
      const checked = g.devs.length;
      return {
        key,
        label: g.label,
        fills: g.fills,
        checked,
        mismatches: g.mismatches,
        accuracyPct: checked ? round(((checked - g.mismatches) / checked) * 100) : null,
        avgDeviation: checked ? round(g.devs.reduce((a, b) => a + b, 0) / checked) : null,
        maxDeviation: checked ? round(Math.max(...g.devs)) : null,
      };
    })
    .sort((a, b) => b.mismatches - a.mismatches || (b.avgDeviation ?? 0) - (a.avgDeviation ?? 0));
}
