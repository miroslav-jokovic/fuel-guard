/**
 * Landed cost per gallon — the pump price with the tax taken apart from the fuel (F10).
 *
 * ── WHAT A BUYING DECISION CAN ACTUALLY MOVE ─────────────────────────────────────────────────────
 * A carrier comparing two truck stops in two states is comparing two numbers that differ for two
 * unrelated reasons: the vendor charges what it charges, and the jurisdiction levies what it levies.
 * Only the first is a purchasing decision. Under IFTA the second is very nearly a wash — a gallon is
 * taxed by the state whose miles burn it, and the tax paid at the pump is credited against exactly
 * that liability — so a recommendation that scores stations on pump price is partly scoring them on a
 * tax the carrier owes either way. That is why D-FX11 held F11 and F13 until this file existed.
 *
 *     preTaxPerGal   = pump price − purchase-state tax        ← the vendor's own price; comparable
 *     burnTaxPerGal  = Σ share × the burn jurisdiction's rate ← owed wherever the fuel was bought
 *     landedPerGal   = preTaxPerGal + burnTaxPerGal
 *
 * Measured on production over the default 90-day window (2026-08-26, tractor diesel, 674,333 of
 * 681,494 gallons priced): California's fuel cost $1.554/gal more than the rest of the fleet's, of
 * which **$0.643 is California's own tax rate and $0.912 is the price of the fuel**. Of the $19,858
 * California premium the exception tab reports, $8,210 — 41% — is a tax rate, and a truck that bought
 * those gallons in Nevada and drove them through California would still owe most of it.
 *
 * ── THE APPORTIONMENT IS A PARAMETER, AND TODAY IT DEFAULTS TO A KNOWN-WRONG ANSWER ──────────────
 * `burnTaxPerGal` needs to know where the gallons were BURNED, which this product cannot yet see
 * (Q-FX4: no table pairs miles with a jurisdiction, and trucks cross a state line on 90.1% of
 * consecutive-fill pairs, so interpolating between fuel stops would invent precision over ~1,500
 * miles). So the default apportionment says the fuel was burned where it was bought — deliberately,
 * visibly, and named in the type — and every surface calls what it shows PURCHASE-STATE TAX rather
 * than IFTA-net. When Samsara-derived mileage lands, a real apportionment is a second argument at one
 * call site and nothing else here changes. That is the entire point of the shape.
 *
 * ── WHY LANDED IS NOT ALWAYS THE PUMP PRICE, EVEN UNDER THE DEFAULT ──────────────────────────────
 * It cancels to the pump price in 46 of the 48 jurisdictions, by construction. Kentucky and Virginia
 * are the exceptions: both levy a SURCHARGE that is not collected at the pump and is billed on the
 * quarterly return over the gallons burned there. A truck that buys and burns in Kentucky pays
 * $0.220/gal at the pump and owes $0.105/gal more on the return — so its landed cost is 10½ cents
 * above the price on the sign, and no surface in this product has ever said so.
 */
import { dieselTaxAt, type DieselTaxBasis } from "./taxTable.js";

/** One fill, reduced to what landed cost needs. A `SpendLine` satisfies this shape. */
export interface LandedCostFill {
  gallons: number;
  /** FUEL ONLY, before misc and sales tax on the same ticket — `SpendLine.netAmount`'s convention. */
  netAmount: number | null;
  /** Purchase state, two-letter. */
  state: string | null;
  /** Station-local business date, YYYY-MM-DD — the date the rate is read at. */
  tranDate: string | null;
}

/** Where a fill's gallons were burned. Shares are fractions of the fill and should sum to 1. */
export interface BurnShare {
  state: string;
  share: number;
}

/**
 * How to attribute a fill's gallons to burn jurisdictions. Pure by contract — it may not read a
 * clock, a network or a database, because everything in this module has to be reproducible from the
 * row and the tax table alone.
 */
export type BurnApportionment = (fill: LandedCostFill) => readonly BurnShare[];

/**
 * The default, and it is an assumption rather than a measurement: the fuel was burned in the state it
 * was bought in. Named so that a call site passing nothing is visibly taking it, and so that grepping
 * for the name finds every place that will change when jurisdiction miles arrive.
 */
export const PURCHASE_STATE_APPORTIONMENT: BurnApportionment = (fill) =>
  fill.state ? [{ state: fill.state, share: 1 }] : [];

export interface LandedCost {
  /** What was paid per gallon at the pump — `netAmount / gallons`. */
  pumpPerGal: number;
  /** The purchase state's tax inside that pump price. */
  purchaseTaxPerGal: number;
  /** Pump price less the purchase-state tax: the price of the fuel itself, comparable across states. */
  preTaxPerGal: number;
  /** The burn jurisdictions' rates under the apportionment, weighted by share. */
  burnTaxPerGal: number;
  /** The part of `burnTaxPerGal` that is a return-billed surcharge, never seen at any pump. */
  burnSurchargePerGal: number;
  /** `preTaxPerGal + burnTaxPerGal`. */
  landedPerGal: number;
  /** Which quarter's matrix priced the PURCHASE, and whether IFTA has finalised it. */
  version: string;
  final: boolean;
  /** `weight_mile` means the jurisdiction levies nothing per gallon — read it before comparing. */
  basis: DieselTaxBasis;
}

/**
 * The landed cost of one fill, or null when it cannot be measured — which is every fill with no
 * gallons, no amount, or a state/date the tax table cannot price. Null is not zero and must never be
 * summed as though it were (D-FX7); a caller totalling these reports the share of gallons it covered.
 */
export function landedCostPerGal(
  fill: LandedCostFill,
  apportionment: BurnApportionment = PURCHASE_STATE_APPORTIONMENT,
): LandedCost | null {
  if (!(fill.gallons > 0) || fill.netAmount == null) return null;
  const purchase = dieselTaxAt(fill.state, fill.tranDate);
  if (!purchase) return null;

  let burnTax = 0;
  let burnSurcharge = 0;
  for (const { state, share } of apportionment(fill)) {
    // A share whose jurisdiction cannot be priced makes the whole figure a guess dressed as a number,
    // so the fill goes back as unmeasured rather than as a landed cost missing one of its states.
    const burn = dieselTaxAt(state, fill.tranDate);
    if (!burn) return null;
    burnTax += share * (burn.pumpPerGal + burn.returnSurchargePerGal);
    burnSurcharge += share * burn.returnSurchargePerGal;
  }

  const pumpPerGal = fill.netAmount / fill.gallons;
  const preTaxPerGal = pumpPerGal - purchase.pumpPerGal;
  return {
    pumpPerGal,
    purchaseTaxPerGal: purchase.pumpPerGal,
    preTaxPerGal,
    burnTaxPerGal: burnTax,
    burnSurchargePerGal: burnSurcharge,
    landedPerGal: preTaxPerGal + burnTax,
    version: purchase.version,
    final: purchase.final,
    basis: purchase.basis,
  };
}
