/**
 * One jurisdiction's quarter, truck by truck — the drill-down behind a row of the IFTA ledger.
 *
 * ── WHY THIS IS A SECOND SHAPE AND NOT A FILTER OF THE FIRST ─────────────────────────────────────
 * The ledger's read (`ifta_period_jurisdictions`, 0256) sums every truck into one row per
 * jurisdiction, because a return is filed per jurisdiction. "Which trucks drove in Texas, and how
 * far" is the question an auditor asks of that row, and the stored rows already answer it — they are
 * per truck per month (0255). So the API returns the per-truck sums in Samsara's units, and this
 * module does the only arithmetic: metres to miles with the same `milesFromMeters` the ledger uses
 * (D-IF1), so a drill-down's total and the row it opened from are one conversion of one sum.
 */
import { milesFromMeters } from "../smartFueling/units.js";

/** One truck in `GET /api/ifta/period/jurisdiction`. Units are Samsara's, unconverted. */
export interface IftaJurisdictionTruckRaw {
  vehicleId: string;
  /** Null when the vehicle row has no unit number — shown as such, never dropped. */
  unitNumber: string | null;
  taxableMeters: number;
  totalMeters: number;
  /** Months of the quarter in which Samsara reported this truck in the jurisdiction (1–3). */
  months: number;
}

export interface IftaJurisdictionTrucksResponse {
  jurisdiction: string;
  year: number;
  quarter: number;
  trucks: IftaJurisdictionTruckRaw[];
}

export interface IftaJurisdictionTruck {
  vehicleId: string;
  unitNumber: string | null;
  taxableMiles: number;
  totalMiles: number;
  /** This truck's share of the jurisdiction's TAXABLE miles, 0–1; null when the jurisdiction has none. */
  share: number | null;
  months: number;
}

export interface IftaJurisdictionTrucks {
  trucks: IftaJurisdictionTruck[];
  taxableMiles: number;
  totalMiles: number;
}

/**
 * Converts, shares and orders the trucks — most taxable miles first, the order a reader checking a
 * jurisdiction's figure wants. Totals are summed from the unrounded miles, then each figure is
 * rounded to a whole mile for display, the precision the ledger shows.
 */
export function iftaJurisdictionTrucks(raw: IftaJurisdictionTruckRaw[]): IftaJurisdictionTrucks {
  const converted = raw.map((t) => ({
    vehicleId: t.vehicleId,
    unitNumber: t.unitNumber,
    taxable: milesFromMeters(t.taxableMeters),
    total: milesFromMeters(t.totalMeters),
    months: t.months,
  }));
  const taxable = converted.reduce((acc, t) => acc + t.taxable, 0);
  const total = converted.reduce((acc, t) => acc + t.total, 0);
  const trucks = converted
    .map((t) => ({
      vehicleId: t.vehicleId,
      unitNumber: t.unitNumber,
      taxableMiles: Math.round(t.taxable),
      totalMiles: Math.round(t.total),
      share: taxable > 0 ? t.taxable / taxable : null,
      months: t.months,
    }))
    .sort(
      (a, b) =>
        b.taxableMiles - a.taxableMiles ||
        String(a.unitNumber ?? "").localeCompare(String(b.unitNumber ?? ""), undefined, { numeric: true }),
    );
  return { trucks, taxableMiles: Math.round(taxable), totalMiles: Math.round(total) };
}
