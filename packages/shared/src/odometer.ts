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

export function odometerAccuracy(rows: OdoRow[], by: "driver" | "vehicle", toleranceMiles = 5): OdoAccuracyRow[] {
  const groups = new Map<string, { label: string; fills: number; devs: number[]; mismatches: number }>();

  for (const r of rows) {
    const key = (by === "driver" ? r.driverId : r.vehicleId) ?? "__unattributed__";
    const label = (by === "driver" ? r.driverName : r.unit) ?? "Unattributed";
    const g = groups.get(key) ?? { label, fills: 0, devs: [], mismatches: 0 };
    g.fills += 1;
    if (r.entered != null && r.samsara != null) {
      const dev = Math.abs(r.entered - r.samsara);
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
