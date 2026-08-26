/**
 * Fuel bought in a dearer state and hauled into a cheaper one — F13, the buy-quantity question.
 *
 * ── WHY THIS IS THE ONE SAVINGS CLAIM THAT CANNOT BE REFUTED ─────────────────────────────────────
 * Every other "you should have fuelled elsewhere" finding rests on a guess about where the truck was
 * going. F11's spike measured what that costs: constrain a cheaper-station recommendation to the road
 * the truck actually drove and 96% of the claimed saving disappears, because the rest is stations the
 * truck was never driving past. This finding has no such weakness. The truck's NEXT fill is a fact,
 * not a model: it proves where the truck went, that it got there, and what fuel cost when it arrived.
 *
 * The claim is therefore small and unarguable: *you bought 146 gallons in California at $6.62, drove to
 * Arizona where the same diesel was $5.18, and arrived with most of it still in the tank.*
 *
 * ── THE ARITHMETIC IS PRE-TAX, WHICH IS THE WHOLE REASON F10 CAME FIRST (D-FX11) ─────────────────
 * Under IFTA a gallon is taxed by the jurisdiction whose miles burn it, and the tax paid at the pump is
 * credited against exactly that liability — so moving a purchase from one state to another is very
 * nearly tax-neutral, and the tax component of a price difference is not a saving anybody can bank.
 * Scored on pump price this fleet's 90 days come to $9,978; scored on the price of the FUEL, with each
 * state's tax stripped out by `landedCostPerGal`'s rule, they come to $8,220. The difference — 21% — is
 * a tax rate that would have been owed either way. This module reports both and never adds them: the
 * pump figure is here only so a reader can see how much of a naive report is jurisdiction, not habit.
 *
 * ── HOW MANY GALLONS WERE STILL IN THE TANK: TWO ESTIMATORS, AND THE WEAKER ONE IS A FLOOR ───────
 * The first version of this analysis required a Samsara tank level and scored 9.8% of fill pairs. That
 * was the wrong gate. `fueling_time_basis = 'tank_confirmed'` is a claim about the TIMING of a fill and
 * it sits on 24% of rows; the question here is how much fuel was on board, and there is a second route
 * to that which almost every fill can answer:
 *
 *   TANK LEVEL (preferred) — `capacity × levelBeforePct`, capped at what the previous stop put in. A
 *     direct measurement. Available on the tank-confirmed fills.
 *   MILES BURNED (fallback) — `gallonsBought − milesSinceLast / baselineMpg`. The truck cannot have
 *     burned more than it drove; whatever it bought beyond that was still on board. This needs NO
 *     starting level, because the level it does not know is non-negative and that is all the bound
 *     requires. It is a LOWER bound, and deliberately so.
 *
 * Both were run against each other on the 1,262 production pairs that carry both. The bound exceeded
 * the measurement on **1.4%** of them — so it is a floor in practice as well as in algebra — and it is
 * a conservative one: mean 13.0 gallons against 68.5 measured, understating roughly fivefold. A total
 * mixing the two is therefore a floor, and every surface must say so rather than calling it "the cost".
 *
 * ⚠ `fuel_transactions.computed_mpg` MUST NOT be used for the burn. It equals `milesSinceLast /
 * gallons` on 95.7% of production rows, so feeding it back in reduces the burn estimate to "this fill's
 * gallons" — the fill-to-full assumption — which this fleet demonstrably violates: measured across
 * 1,419 fills on 240-gallon tanks, trucks arrive at 33% and buy only 78% of the empty space. The
 * estimator has to be independent of the fill, which is what `vehicles.baseline_mpg` is (validated
 * across 169 trucks against observed fuel-per-mile: 6.92 baseline against 7.08 observed, mean absolute
 * difference 0.52 mpg, and the small understatement pushes the bound DOWN, which is the safe way).
 */
import { dieselTaxAt } from "../fuelTax/taxTable.js";

/** One fill, with everything the two estimators need. A row of `fuel_buy_fills` satisfies this. */
export interface CarriedFuelFill {
  vehicleId: string;
  unit: string | null;
  /**
   * The instant, ISO. This is the ORDERING key and `tranDate` cannot replace it: a station-local
   * business date is a day, and two fills on one day would sort arbitrarily — which on a cross-border
   * day is precisely the pair this module is about.
   */
  fueledAt: string;
  /** Station-local business date. The tax table is read at this, not at the UTC instant. */
  tranDate: string | null;
  state: string | null;
  gallons: number;
  /** FUEL ONLY, `SpendLine.netAmount`'s convention — misc and sales tax on the same ticket are not fuel. */
  netAmount: number | null;
  /** Miles since the previous fill, from the odometer chain. */
  milesSinceLast: number | null;
  /** The truck's own baseline. NEVER `computed_mpg` — see the header. */
  baselineMpg: number | null;
  /** Tank level (%) immediately before this fill, or null when the fill's timing is not confirmed. */
  levelBeforePct: number | null;
  /** Usable capacity, already through `resolveCapacity` — never the raw entered figure. */
  tankCapacityGal: number | null;
  /**
   * False for a row returned only as CONTEXT — `fuel_buy_fills` reaches 14 days before the window so
   * every truck's first in-window fill has a predecessor to be paired with. A pair is scored on where
   * its ARRIVING fill lands, so a context row can be the `from` of a finding and never the `to`.
   * Absent is treated as in-window, so a caller assembling rows by hand does not silently score none.
   */
  inWindow?: boolean;
}

/** Which estimator produced `carriedGallons`. Never merged in a figure without being named. */
export type CarriedBasis = "tank_level" | "miles_burned";

export interface CarriedFuelSide {
  date: string | null;
  state: string | null;
  /** What was paid per gallon at the pump. */
  perGal: number;
  /** …less that state's diesel tax: the price of the fuel itself, which is the comparable part. */
  preTaxPerGal: number;
}

export interface CarriedFuelFinding {
  vehicleId: string;
  unit: string | null;
  /** Where the fuel was bought, and where it was still on board. */
  from: CarriedFuelSide & { gallonsBought: number };
  to: CarriedFuelSide;
  carriedGallons: number;
  basis: CarriedBasis;
  /** carried × (from.preTaxPerGal − to.preTaxPerGal). The figure a decision can act on. */
  excess: number;
  /**
   * The same thing scored on pump price. Present ONLY so a surface can show how much of a naive
   * report is a jurisdiction's tax rate rather than a buying habit. Never summed with `excess`.
   */
  pumpExcess: number;
  /** Which IFTA matrix quarters priced the two ends. */
  taxVersions: readonly string[];
}

export interface CarriedBasisTotals {
  pairs: number;
  gallons: number;
  excess: number;
}

export interface CarriedFuelReport {
  findings: CarriedFuelFinding[];
  /**
   * ── THE DENOMINATOR, BROKEN OUT, BECAUSE MOST OF IT IS NOT A GAP ─────────────────────────────
   * "43.8% of pairs produced a finding" reads as 56% missing data, and it is not. Of the pairs that
   * produce nothing, almost all produce nothing because there is nothing to find: the truck stayed in
   * one state, or it drove from a cheaper state to a dearer one, which is the direction the policy
   * wants. Measured on production, only 9 of 5,239 pairs could not be evaluated at all.
   */
  pairs: number;
  /** Both fills in one state — no cross-border decision was taken. */
  sameState: number;
  /** Travelling from cheaper fuel to dearer: the right way round, so never a finding. */
  towardDearer: number;
  /** A jurisdiction or a date the tax table cannot price (D-FX7 — not zero, unknown). */
  unpriceable: number;
  /** Neither a confirmed tank level nor miles-and-baseline-mpg. The only genuine blind spot. */
  noBasis: number;
  byBasis: Record<CarriedBasis, CarriedBasisTotals>;
  gallons: number;
  /**
   * Total pre-tax excess. A FLOOR, not a measurement: every `miles_burned` pair contributes a lower
   * bound, and on the pairs carrying both estimators that bound understates roughly fivefold.
   */
  excess: number;
  /** The same total on pump price — for the comparison only. Never added to `excess`. */
  pumpExcess: number;
}

export interface CarriedFuelOptions {
  /**
   * Two fills further apart than this are not one leg of one trip, so the tank-level estimator must
   * not attribute the second's contents to the first. The miles estimator is self-limiting (a long
   * gap means large miles, which drives the bound to zero), so this mostly guards the sensor path.
   */
  maxLegHours?: number;
}

const DEFAULT_MAX_LEG_HOURS = 7 * 24;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Gallons of `from`'s purchase still on board on arrival at `to`, and which estimator said so.
 *
 * The tank level wins when it is available: it is a measurement rather than a bound. It is capped at
 * what the previous stop actually put in, because fuel bought before that stop is not this pair's
 * decision — without the cap, a truck that arrived at `from` nearly full would have its whole tank
 * attributed to a purchase that contributed a fraction of it.
 */
function carriedGallons(
  from: CarriedFuelFill,
  to: CarriedFuelFill,
  withinLeg: boolean,
): { gallons: number; basis: CarriedBasis } | null {
  if (withinLeg && to.levelBeforePct != null && to.tankCapacityGal != null && to.tankCapacityGal > 0) {
    const onBoard = (to.tankCapacityGal * to.levelBeforePct) / 100;
    return { gallons: Math.min(onBoard, from.gallons), basis: "tank_level" };
  }
  if (to.milesSinceLast != null && to.milesSinceLast > 0 && to.baselineMpg != null && to.baselineMpg > 0) {
    // The truck cannot have burned more than it drove. Whatever `from` put in beyond that was still
    // there — with no reference to the level at `from`, which is exactly why this covers the fleet.
    return { gallons: Math.max(0, from.gallons - to.milesSinceLast / to.baselineMpg), basis: "miles_burned" };
  }
  return null;
}

/** Pump price and the price of the fuel underneath it, or null when the state-day cannot be priced. */
function side(fill: CarriedFuelFill): (CarriedFuelSide & { version: string }) | null {
  if (!(fill.gallons > 0) || fill.netAmount == null) return null;
  const tax = dieselTaxAt(fill.state, fill.tranDate);
  if (!tax) return null;
  const perGal = fill.netAmount / fill.gallons;
  return { date: fill.tranDate, state: fill.state, perGal, preTaxPerGal: perGal - tax.pumpPerGal, version: tax.version };
}

const emptyTotals = (): CarriedBasisTotals => ({ pairs: 0, gallons: 0, excess: 0 });

/**
 * Score every consecutive pair of fills, per truck, in time order.
 *
 * Pure: no clock, no I/O. The ordering is the caller's `fueledAt` strings, compared as ISO instants —
 * which is why the row shape insists on the instant rather than the business date.
 */
export function analyzeCarriedFuel(
  fills: readonly CarriedFuelFill[],
  options: CarriedFuelOptions = {},
): CarriedFuelReport {
  const maxLegMs = (options.maxLegHours ?? DEFAULT_MAX_LEG_HOURS) * 3_600_000;
  const byVehicle = new Map<string, CarriedFuelFill[]>();
  for (const f of fills) {
    const list = byVehicle.get(f.vehicleId);
    if (list) list.push(f);
    else byVehicle.set(f.vehicleId, [f]);
  }

  const findings: CarriedFuelFinding[] = [];
  const byBasis: Record<CarriedBasis, CarriedBasisTotals> = { tank_level: emptyTotals(), miles_burned: emptyTotals() };
  let pairs = 0, sameState = 0, towardDearer = 0, unpriceable = 0, noBasis = 0;

  for (const list of byVehicle.values()) {
    const ordered = [...list].sort((a, b) => a.fueledAt.localeCompare(b.fueledAt));
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const from = ordered[i]!;
      const to = ordered[i + 1]!;
      // A pair belongs to the window its ARRIVING fill lands in. Without this the 14-day lookback
      // would drag findings from before the window into the report, and a reader comparing two
      // windows would see the earlier one's legs counted twice.
      if (to.inWindow === false) continue;
      pairs += 1;

      if (from.state != null && to.state != null && from.state === to.state) { sameState += 1; continue; }
      const a = side(from);
      const b = side(to);
      if (!a || !b) { unpriceable += 1; continue; }
      // Cheaper to dearer is the direction the policy asks for. Nothing was carried the wrong way, so
      // there is nothing to find — and reporting it as a zero would put 2,437 empty rows on a queue.
      if (a.preTaxPerGal <= b.preTaxPerGal) { towardDearer += 1; continue; }

      const withinLeg = new Date(to.fueledAt).getTime() - new Date(from.fueledAt).getTime() <= maxLegMs;
      const carried = carriedGallons(from, to, withinLeg);
      if (!carried) { noBasis += 1; continue; }
      if (!(carried.gallons > 0)) { continue; }

      const excess = r2(carried.gallons * (a.preTaxPerGal - b.preTaxPerGal));
      findings.push({
        vehicleId: from.vehicleId,
        unit: from.unit ?? to.unit,
        from: { date: a.date, state: a.state, perGal: a.perGal, preTaxPerGal: a.preTaxPerGal, gallonsBought: from.gallons },
        to: { date: b.date, state: b.state, perGal: b.perGal, preTaxPerGal: b.preTaxPerGal },
        carriedGallons: r3(carried.gallons),
        basis: carried.basis,
        excess,
        pumpExcess: r2(carried.gallons * (a.perGal - b.perGal)),
        taxVersions: a.version === b.version ? [a.version] : [a.version, b.version].sort(),
      });
      const t = byBasis[carried.basis];
      t.pairs += 1;
      t.gallons = r3(t.gallons + carried.gallons);
      t.excess = r2(t.excess + excess);
    }
  }

  findings.sort((x, y) => y.excess - x.excess);
  return {
    findings,
    pairs,
    sameState,
    towardDearer,
    unpriceable,
    noBasis,
    byBasis,
    gallons: r3(byBasis.tank_level.gallons + byBasis.miles_burned.gallons),
    excess: r2(byBasis.tank_level.excess + byBasis.miles_burned.excess),
    pumpExcess: r2(findings.reduce((s, f) => s + f.pumpExcess, 0)),
  };
}
