/**
 * The IFTA return for one quarter, as the export carries it (IFTA-PRECISION-PLAN IP9).
 *
 * ── WHAT THE FILE IS FOR ─────────────────────────────────────────────────────────────────────────
 * The office asked for two grids: trucks down the side, states across the top, miles in one and fuel
 * in the other, totalled both ways. Those two grids are the evidence behind a return, and the return
 * itself (owed, paid at the pump, net, per state) is what the grids are for, so it leads the file.
 * Then every fill the gallons are made of, with where it came from (a card, a driver-paid upload,
 * McLeod), and the list of things worth a look before filing.
 *
 * ── ONE SET OF FIGURES, SO EVERY TOTAL TIES ──────────────────────────────────────────────────────
 * The return is computed HERE, from the same truck rows the two grids are made of, with the same
 * `computeIftaPosition` the page uses. So a state's column total in the miles grid IS the miles its
 * return line was priced on, by construction, not by two reads agreeing. Then the result is checked
 * against the page's own position (`ledgerPosition`, read through the ledger's RPC): a state where the
 * two differ is listed, never smoothed over. They read the same tables with the same predicates, so a
 * difference means the data moved between the two reads (a sync landed), and re-exporting clears it.
 *
 * ── NOTHING IS ROUNDED HERE ──────────────────────────────────────────────────────────────────────
 * Miles and gallons stay unrounded through the grids and their totals; the renderer rounds for
 * display only. A total summed from rounded cells drifts from the return line by up to half a mile per
 * truck, about 95 miles across the fleet in the worst case: a file whose columns do not add up to its
 * own first tab would be the one thing an auditor circles.
 */
import { computeIftaPosition, type IftaFuelPurchase, type IftaJurisdictionMiles, type IftaPosition } from "./position.js";
import { foldReceiptSources, type IftaReceiptRaw, type IftaReceiptSource } from "./receipts.js";
import { rateDateFor } from "./periodPosition.js";
import { milesFromMeters } from "../smartFueling/units.js";
import { PLAUSIBLE_FLEET_MPG } from "../fuelSpend/fleetEfficiency.js";

/** One truck's miles in one state for the quarter, summed over its months and devices. Samsara's metres. */
export interface IftaTruckStateMilesRaw {
  vehicleId: string;
  jurisdiction: string;
  taxableMeters: number;
  totalMeters: number;
}

/** One tractor card fill in the quarter, any state: the ledger's predicate (0256), uncut by state. */
export interface IftaQuarterFillRaw {
  id: string;
  vehicleId: string | null;
  state: string;
  businessDate: string;
  fueledAt: string | null;
  gallons: number;
  pricePerGal: number | null;
  totalCost: number | null;
  location: string | null;
}

export type IftaReturnSource = "card" | IftaReceiptSource;

export interface IftaReturnInput {
  year: number;
  quarter: number;
  truckMiles: readonly IftaTruckStateMilesRaw[];
  cardFills: readonly IftaQuarterFillRaw[];
  /** Every receipt source, BEFORE the duplicate rule: this module applies it, so it can list what it dropped. */
  receipts: readonly IftaReceiptRaw[];
  /** vehicle id → unit number, for every truck above. */
  units: Readonly<Record<string, string | null>>;
  /** The IFTA page's position for the same quarter, to tie against. Null skips the check. */
  ledger: IftaPosition | null;
}

/** One fill the gallons grid is made of. */
export interface IftaReturnFill {
  id: string;
  source: IftaReturnSource;
  vehicleId: string | null;
  truck: string;
  jurisdiction: string;
  day: string;
  /** Null on a receipt: McLeod's has no time of day, and an upload's time is local to a station. */
  fueledAt: string | null;
  gallons: number;
  pricePerGal: number | null;
  totalCost: number | null;
  location: string | null;
}

export interface IftaReturnTruck {
  /** Null on the one row holding fuel no truck is attached to. */
  vehicleId: string | null;
  truck: string;
  /** Per state, unrounded. A state the truck never drove in is absent, not zero. */
  taxableMiles: Record<string, number>;
  gallons: Record<string, number>;
  fills: Record<string, number>;
  totalTaxableMiles: number;
  /** Every mile, taxable or not (Samsara's total), all states. */
  totalMiles: number;
  totalGallons: number;
  /** Taxable miles ÷ gallons over the quarter. Null without both. */
  mpg: number | null;
}

export type IftaReturnIssueKind =
  | "fleet_mpg"
  | "ledger_disagrees"
  | "jurisdiction_unpriced"
  | "miles_without_fuel"
  | "truck_mpg_implausible"
  | "fuel_without_truck"
  | "duplicate_dropped";

export interface IftaReturnIssue {
  kind: IftaReturnIssueKind;
  truck: string | null;
  jurisdiction: string | null;
  day: string | null;
  /** The miles or gallons the line is about, unrounded; null when it is about neither. */
  figure: number | null;
  detail: string;
}

export interface IftaReturnReport {
  year: number;
  quarter: number;
  position: IftaPosition;
  /** The grids' columns: every state with miles or fuel, alphabetical. */
  jurisdictions: string[];
  /** The grids' rows: by unit number, the no-truck row last. */
  trucks: IftaReturnTruck[];
  columnTotals: { taxableMiles: Record<string, number>; gallons: Record<string, number> };
  fills: IftaReturnFill[];
  issues: IftaReturnIssue[];
}

export const NO_TRUCK_LABEL = "No truck";

const code = (s: string) => s.trim().toUpperCase();
const byUnit = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const add = (rec: Record<string, number>, k: string, v: number) => { rec[k] = (rec[k] ?? 0) + v; };
const fmt = (n: number, digits = 0) => n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** A ledger line may differ from the file's by its own rounding and no more. */
const TIE_MILES = 1;
const TIE_GALLONS = 0.1;

const ISSUE_ORDER: readonly IftaReturnIssueKind[] = [
  "fleet_mpg", "ledger_disagrees", "jurisdiction_unpriced", "miles_without_fuel",
  "truck_mpg_implausible", "fuel_without_truck", "duplicate_dropped",
];

function receiptFill(r: IftaReceiptRaw, truck: (id: string | null) => string): IftaReturnFill {
  return {
    id: `receipt:${r.source}:${r.externalId}`,
    source: r.source,
    vehicleId: r.vehicleId,
    truck: r.vehicleId ? truck(r.vehicleId) : `${NO_TRUCK_LABEL} (unit ${r.unitAsFiled} as filed)`,
    jurisdiction: code(r.jurisdiction),
    day: r.receiptDate,
    fueledAt: null,
    gallons: r.gallons,
    pricePerGal: r.pricePerGal ?? null,
    totalCost: r.totalCost ?? null,
    location: r.location ?? null,
  };
}

/** The grids: one row per truck that drove or bought fuel, plus the no-truck row when there is any. */
function truckRows(input: IftaReturnInput, fills: IftaReturnFill[], truck: (id: string | null) => string): IftaReturnTruck[] {
  const rows = new Map<string | null, IftaReturnTruck>();
  const row = (vehicleId: string | null) => {
    let r = rows.get(vehicleId);
    if (!r) {
      r = {
        vehicleId, truck: vehicleId ? truck(vehicleId) : NO_TRUCK_LABEL, taxableMiles: {}, gallons: {}, fills: {},
        totalTaxableMiles: 0, totalMiles: 0, totalGallons: 0, mpg: null,
      };
      rows.set(vehicleId, r);
    }
    return r;
  };
  for (const m of input.truckMiles) {
    const r = row(m.vehicleId);
    const taxable = milesFromMeters(m.taxableMeters);
    add(r.taxableMiles, code(m.jurisdiction), taxable);
    r.totalTaxableMiles += taxable;
    r.totalMiles += milesFromMeters(m.totalMeters);
  }
  for (const f of fills) {
    const r = row(f.vehicleId);
    add(r.gallons, f.jurisdiction, f.gallons);
    add(r.fills, f.jurisdiction, 1);
    r.totalGallons += f.gallons;
  }
  for (const r of rows.values()) {
    r.mpg = r.vehicleId && r.totalGallons > 0 && r.totalTaxableMiles > 0 ? r.totalTaxableMiles / r.totalGallons : null;
  }
  return [...rows.values()].sort((a, b) =>
    a.vehicleId == null ? 1 : b.vehicleId == null ? -1 : byUnit(a.truck, b.truck),
  );
}

/** Where this file and the IFTA page disagree on a state's miles or gallons. */
function ledgerIssues(ledger: IftaPosition | null, position: IftaPosition): IftaReturnIssue[] {
  if (!ledger) return [];
  const page = new Map(ledger.jurisdictions.map((j) => [j.jurisdiction, j]));
  const ours = new Map(position.jurisdictions.map((j) => [j.jurisdiction, j]));
  const codes = [...new Set([...page.keys(), ...ours.keys()])].sort();
  return codes.flatMap((j): IftaReturnIssue[] => {
    const p = page.get(j);
    const o = ours.get(j);
    const pm = p?.taxableMiles ?? 0, om = o?.taxableMiles ?? 0;
    const pg = p?.gallonsPurchased ?? 0, og = o?.gallonsPurchased ?? 0;
    if (Math.abs(pm - om) <= TIE_MILES && Math.abs(pg - og) <= TIE_GALLONS) return [];
    return [{
      kind: "ledger_disagrees", truck: null, jurisdiction: j, day: null, figure: null,
      detail:
        `The IFTA page shows ${fmt(pm)} taxable miles and ${fmt(pg, 1)} gal here; this file adds up to ${fmt(om)} ` +
        `and ${fmt(og, 1)}. Both read the same records, so new data arrived between the two reads. Export again.`,
    }];
  });
}

function truckIssues(trucks: IftaReturnTruck[]): IftaReturnIssue[] {
  return trucks.flatMap((t): IftaReturnIssue[] => {
    if (!t.vehicleId) return [];
    if (t.totalGallons === 0 && Math.round(t.totalTaxableMiles) > 0) {
      return [{
        kind: "miles_without_fuel", truck: t.truck, jurisdiction: null, day: null, figure: t.totalTaxableMiles,
        detail:
          `Drove ${fmt(t.totalTaxableMiles)} taxable miles and bought no fuel we have a record of. Usually a ` +
          "driver-paid receipt not uploaded yet, or a card fill charged to another truck.",
      }];
    }
    if (t.mpg != null && (t.mpg < PLAUSIBLE_FLEET_MPG.low || t.mpg > PLAUSIBLE_FLEET_MPG.high)) {
      return [{
        kind: "truck_mpg_implausible", truck: t.truck, jurisdiction: null, day: null, figure: t.mpg,
        detail:
          `${fmt(t.totalTaxableMiles)} taxable miles on ${fmt(t.totalGallons, 1)} gal is ${t.mpg.toFixed(2)} mpg, ` +
          (t.mpg > PLAUSIBLE_FLEET_MPG.high
            ? "more than a tractor gets: some of its fuel is missing (a receipt, or a fill on another truck)."
            : "less than a tractor gets: fuel on this truck that it did not burn, or miles Samsara did not see."),
      }];
    }
    return [];
  });
}

function fuelIssues(fills: IftaReturnFill[], dropped: IftaReceiptRaw[], truck: (id: string | null) => string): IftaReturnIssue[] {
  const noTruck = fills.filter((f) => f.vehicleId == null).map((f): IftaReturnIssue => ({
    kind: "fuel_without_truck", truck: f.truck, jurisdiction: f.jurisdiction, day: f.day, figure: f.gallons,
    detail: f.source === "card"
      ? "A card fill with no truck on it. Its gallons count in the state's credit and in no truck's MPG."
      : "A receipt whose unit matches none of our trucks. Its gallons count in the state's credit and in no truck's MPG.",
  }));
  const dupes = dropped.map((r): IftaReturnIssue => ({
    // The truck it was matched on, not the unit as filed: the fuel app's file names no unit at all.
    kind: "duplicate_dropped", truck: r.vehicleId ? truck(r.vehicleId) : r.unitAsFiled, jurisdiction: code(r.jurisdiction), day: r.receiptDate, figure: r.gallons,
    detail:
      `Not counted (${SOURCE_LABEL[r.source]}): a card fill or a better-documented receipt on the same truck, ` +
      "state and day already carries these gallons.",
  }));
  return [...noTruck, ...dupes];
}

/** How each source reads in the file. */
export const SOURCE_LABEL: Record<IftaReturnSource, string> = {
  card: "Fuel card",
  fuel_app: "Driver-paid, uploaded from the fuel app",
  mcleod_export: "Driver-paid, uploaded from a McLeod export",
  mcleod: "Driver-paid, keyed in McLeod",
};

/** What each kind of line in "needs a look" is, as the Excel tab and the PDF both print it. */
export const ISSUE_LABEL: Record<IftaReturnIssueKind, string> = {
  fleet_mpg: "Fleet MPG",
  ledger_disagrees: "Differs from the IFTA page",
  jurisdiction_unpriced: "No tax rate",
  miles_without_fuel: "Miles, no fuel",
  truck_mpg_implausible: "Truck MPG",
  fuel_without_truck: "Fuel, no truck",
  duplicate_dropped: "Duplicate not counted",
};

export function buildIftaReturnReport(input: IftaReturnInput): IftaReturnReport {
  const truck = (id: string | null) => (id ? input.units[id]?.trim() || `Vehicle ${id.slice(0, 8)}` : NO_TRUCK_LABEL);
  const split = foldReceiptSources(
    input.receipts,
    input.cardFills.map((f) => ({ id: f.id, vehicleId: f.vehicleId, state: f.state, businessDate: f.businessDate, gallons: f.gallons })),
  );

  const fills: IftaReturnFill[] = [
    ...input.cardFills.filter((f) => f.gallons > 0).map((f): IftaReturnFill => ({
      id: f.id, source: "card", vehicleId: f.vehicleId, truck: truck(f.vehicleId), jurisdiction: code(f.state),
      day: f.businessDate, fueledAt: f.fueledAt, gallons: f.gallons, pricePerGal: f.pricePerGal,
      totalCost: f.totalCost, location: f.location,
    })),
    ...split.kept.filter((r) => r.gallons > 0).map((r) => receiptFill(r, truck)),
  ].sort((a, b) =>
    (a.vehicleId == null ? 1 : 0) - (b.vehicleId == null ? 1 : 0)
    || byUnit(a.truck, b.truck) || a.day.localeCompare(b.day) || (a.fueledAt ?? "").localeCompare(b.fueledAt ?? "")
    || a.id.localeCompare(b.id),
  );

  const rateDate = rateDateFor(input);
  const miles: IftaJurisdictionMiles[] = input.truckMiles.map((m) => ({
    jurisdiction: m.jurisdiction, taxableMeters: m.taxableMeters, totalMeters: m.totalMeters, taxPaidLiters: 0,
  }));
  const purchases: IftaFuelPurchase[] = fills.map((f) => ({
    jurisdiction: f.jurisdiction, gallons: f.gallons, tranDate: rateDate,
    ...(f.source === "card" ? {} : { source: f.source === "mcleod" ? ("mcleod_receipt" as const) : ("uploaded_receipt" as const) }),
  }));
  const position = computeIftaPosition(miles, purchases, rateDate);

  const trucks = truckRows(input, fills, truck);
  const columnTotals = { taxableMiles: {} as Record<string, number>, gallons: {} as Record<string, number> };
  for (const t of trucks) {
    for (const [j, v] of Object.entries(t.taxableMiles)) add(columnTotals.taxableMiles, j, v);
    for (const [j, v] of Object.entries(t.gallons)) add(columnTotals.gallons, j, v);
  }
  const jurisdictions = [...new Set([...Object.keys(columnTotals.taxableMiles), ...Object.keys(columnTotals.gallons)])].sort();

  const issues: IftaReturnIssue[] = [
    ...(position.mpg.concern
      ? [{ kind: "fleet_mpg" as const, truck: null, jurisdiction: null, day: null, figure: position.mpg.fleetMpg, detail: position.mpg.concern }]
      : []),
    ...ledgerIssues(input.ledger, position),
    ...position.unpriced.map((j): IftaReturnIssue => ({
      kind: "jurisdiction_unpriced", truck: null, jurisdiction: j, day: null, figure: null,
      detail: "Our tax table has no per-gallon diesel rate here, so this state's line carries miles and fuel and no tax.",
    })),
    ...truckIssues(trucks),
    ...fuelIssues(fills, split.duplicates, truck),
  ].sort((a, b) =>
    ISSUE_ORDER.indexOf(a.kind) - ISSUE_ORDER.indexOf(b.kind)
    || byUnit(a.truck ?? "", b.truck ?? "") || (a.day ?? "").localeCompare(b.day ?? ""),
  );

  return { year: input.year, quarter: input.quarter, position, jurisdictions, trucks, columnTotals, fills, issues };
}
