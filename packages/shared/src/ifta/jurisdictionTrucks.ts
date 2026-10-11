/**
 * One jurisdiction's quarter, truck by truck — the drill-down behind a row of the IFTA ledger.
 *
 * ── WHY THIS IS A SECOND SHAPE AND NOT A FILTER OF THE FIRST ─────────────────────────────────────
 * The ledger's read (`ifta_period_jurisdictions`, 0256) sums every truck into one row per
 * jurisdiction, because a return is filed per jurisdiction. "Which trucks drove in Texas, how far,
 * and where did they buy fuel there" is the question an auditor asks of that row, and the stored
 * rows already answer it — miles per truck per month (0255), fills per truck (`fuel_transactions`).
 * So the API returns both halves raw, and this module does the only arithmetic: metres to miles
 * with the same `milesFromMeters` the ledger uses (D-IF1), and gallons summed from the same fills
 * the ledger's "Gallons bought" sums — so the drill-down's totals and the row it opened from are
 * one figure, not two that happen to agree.
 */
import { milesFromMeters } from "../smartFueling/units.js";
import type { IftaReceiptRaw } from "./receipts.js";

/** One truck's miles in `GET /api/ifta/period/jurisdiction`. Units are Samsara's, unconverted. */
export interface IftaJurisdictionTruckRaw {
  vehicleId: string;
  /** Null when the vehicle row has no unit number — shown as such, never dropped. */
  unitNumber: string | null;
  taxableMeters: number;
  totalMeters: number;
  /** Months of the quarter in which Samsara reported this truck in the jurisdiction (1–3). */
  months: number;
}

/** One tractor fill bought in the jurisdiction during the quarter. */
export interface IftaJurisdictionFillRaw {
  id: string;
  /** Null for a fill no truck is attached to. It is in the ledger's total, so it is kept. */
  vehicleId: string | null;
  /** Null on a receipt keyed in McLeod, which has a date and no time of day. */
  fueledAt: string | null;
  /** Station-local date — the basis the quarter is cut on (0247). */
  businessDate: string | null;
  gallons: number;
  pricePerGal: number | null;
  totalCost: number | null;
  location: string | null;
  /**
   * Absent on a card fill. `mcleod_receipt`: keyed by hand in McLeod (IP6) — no price, station or time.
   * `uploaded_receipt`: a driver-paid fill the office uploaded (IP8), with whatever its file carried.
   */
  source?: "card" | "mcleod_receipt" | "uploaded_receipt";
}

export interface IftaJurisdictionTrucksResponse {
  jurisdiction: string;
  year: number;
  quarter: number;
  trucks: IftaJurisdictionTruckRaw[];
  fills: IftaJurisdictionFillRaw[];
  /** Unit numbers for trucks that bought fuel here but reported no miles here. */
  units: Record<string, string | null>;
  /** Receipts for this jurisdiction — keyed in McLeod (IP6) and uploaded (IP8) — duplicates already dropped. */
  receipts?: IftaReceiptRaw[];
  /** How many receipts the duplicate rule dropped — said on the page, never silent. */
  receiptDuplicates?: number;
}

export interface IftaJurisdictionTruck {
  /** Null on the one row holding fills that no truck is attached to. */
  vehicleId: string | null;
  unitNumber: string | null;
  taxableMiles: number;
  totalMiles: number;
  /** This truck's share of the jurisdiction's TAXABLE miles, 0–1; null when the jurisdiction has none. */
  share: number | null;
  months: number;
  gallonsBought: number;
  spent: number;
  /** Newest first. */
  fills: IftaJurisdictionFillRaw[];
}

export interface IftaJurisdictionTrucks {
  trucks: IftaJurisdictionTruck[];
  taxableMiles: number;
  totalMiles: number;
  gallonsBought: number;
  spent: number;
  /** Card fills only; receipts are counted in `receiptCount`. */
  fillCount: number;
  /** Receipts (keyed in McLeod or uploaded), and their gallons — both already inside `gallonsBought`. */
  receiptCount: number;
  receiptGallons: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Joins the two halves by truck, converts, and orders — most taxable miles first, then most gallons,
 * which puts a truck that only fuelled here (a border-town stop) below every truck that drove here.
 * Totals are summed from unrounded figures and rounded once, the precision the ledger shows.
 */
export function iftaJurisdictionTrucks(
  raw: IftaJurisdictionTruckRaw[],
  cardFills: IftaJurisdictionFillRaw[] = [],
  units: Record<string, string | null> = {},
  receipts: IftaReceiptRaw[] = [],
): IftaJurisdictionTrucks {
  // A receipt joins its truck's fills as a row of its own kind, so a truck whose only fuel here was
  // keyed in McLeod — unit 512, every quarter — is a truck that bought fuel here. One McLeod unit
  // matches none of our trucks: it goes on the no-truck row, its unit named, because its gallons are
  // in the ledger row's total too.
  const fills: IftaJurisdictionFillRaw[] = [
    ...cardFills,
    ...receipts.map((r) => ({
      id: `receipt:${r.source}:${r.externalId}`,
      vehicleId: r.vehicleId,
      fueledAt: null,
      businessDate: r.receiptDate,
      gallons: r.gallons,
      pricePerGal: r.pricePerGal ?? null,
      totalCost: r.totalCost ?? null,
      location: r.vehicleId ? (r.location ?? null) : `McLeod unit ${r.unitAsFiled}, matched to no truck`,
      source: r.source === "mcleod" ? ("mcleod_receipt" as const) : ("uploaded_receipt" as const),
    })),
  ];
  const taxable = raw.reduce((acc, t) => acc + milesFromMeters(t.taxableMeters), 0);
  const total = raw.reduce((acc, t) => acc + milesFromMeters(t.totalMeters), 0);

  const fillsBy = new Map<string | null, IftaJurisdictionFillRaw[]>();
  for (const f of fills) fillsBy.set(f.vehicleId, [...(fillsBy.get(f.vehicleId) ?? []), f]);
  const fuelOf = (id: string | null) => {
    const when = (f: IftaJurisdictionFillRaw) => f.fueledAt ?? f.businessDate ?? "";
    const list = [...(fillsBy.get(id) ?? [])].sort((a, b) => when(b).localeCompare(when(a)));
    return {
      fills: list,
      gallonsBought: r1(list.reduce((acc, f) => acc + f.gallons, 0)),
      spent: r2(list.reduce((acc, f) => acc + (f.totalCost ?? 0), 0)),
    };
  };

  const drove = raw.map((t) => {
    const tx = milesFromMeters(t.taxableMeters);
    return {
      vehicleId: t.vehicleId as string | null,
      unitNumber: t.unitNumber,
      taxableMiles: Math.round(tx),
      totalMiles: Math.round(milesFromMeters(t.totalMeters)),
      share: taxable > 0 ? tx / taxable : null,
      months: t.months,
      ...fuelOf(t.vehicleId),
    };
  });
  const seen = new Set(raw.map((t) => t.vehicleId));
  const fuelledOnly = [...fillsBy.keys()]
    .filter((id): id is string => id != null && !seen.has(id))
    .map((id) => ({
      vehicleId: id as string | null,
      unitNumber: units[id] ?? null,
      taxableMiles: 0,
      totalMiles: 0,
      share: taxable > 0 ? 0 : null,
      months: 0,
      ...fuelOf(id),
    }));

  const byUnit = (a: { unitNumber: string | null }, b: { unitNumber: string | null }) =>
    String(a.unitNumber ?? "").localeCompare(String(b.unitNumber ?? ""), undefined, { numeric: true });
  const trucks: IftaJurisdictionTruck[] = [...drove, ...fuelledOnly].sort(
    (a, b) => b.taxableMiles - a.taxableMiles || b.gallonsBought - a.gallonsBought || byUnit(a, b),
  );
  // Fills with no truck LAST, as their own row: they are in the ledger's "Gallons bought", so leaving
  // them out would make this page's total disagree with the row it was opened from.
  if (fillsBy.has(null)) {
    trucks.push({ vehicleId: null, unitNumber: null, taxableMiles: 0, totalMiles: 0, share: null, months: 0, ...fuelOf(null) });
  }

  return {
    trucks,
    taxableMiles: Math.round(taxable),
    totalMiles: Math.round(total),
    gallonsBought: r1(fills.reduce((acc, f) => acc + f.gallons, 0)),
    spent: r2(fills.reduce((acc, f) => acc + (f.totalCost ?? 0), 0)),
    fillCount: cardFills.length,
    receiptCount: receipts.length,
    receiptGallons: r1(receipts.reduce((acc, r) => acc + r.gallons, 0)),
  };
}
