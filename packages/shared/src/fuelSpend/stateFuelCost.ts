/**
 * What the fleet actually paid per state, with the jurisdiction's tax taken out (F13b).
 *
 * ── WHY A DERIVED RANKING SITS BESIDE A CONFIGURED LIST ──────────────────────────────────────────
 * `route_fuel_settings.avoid_states` and `fuel_before_states` are typed by a person and then never
 * revisited. Measured on production 2026-08-26 over 671,617 gallons, that has aged in both directions
 * at once:
 *
 *   • `avoid_states = {CA}` is RIGHT — California ranks 1 of 39 on pre-tax price at +$0.901/gal.
 *   • `fuel_before_states = {MA}` governs nothing — 15 fills and ~1,600 gallons in ninety days, below
 *     any threshold at which a rule means anything.
 *   • The 2nd, 3rd and 4th dearest states are **NM, AZ and NV** — 86,000 gallons between them, in no
 *     list at all. That is the corridor the California-bound trucks refuel in.
 *
 * ── AND WHY IT DOES NOT REPLACE THE LIST ─────────────────────────────────────────────────────────
 * A carrier avoids a state for reasons a price cannot see: CARB, tolls, lane restrictions, a customer
 * who will not accept a truck that has been there. Silently overriding a human's list with a computed
 * one is the same class of error as a compliance report contradicting the planner (B4) — this ranks,
 * shows, and flags the divergence, and the configured list stays authoritative.
 *
 * ── THE RANK IS PRE-TAX, AND THAT CHANGES WHO IS ON IT ───────────────────────────────────────────
 * New Jersey pumps at $4.844 — near the top on the sign — and sits at $4.283 pre-tax, dead average,
 * because $0.561 of it is tax the carrier owes on the miles it drives there whichever state the diesel
 * was bought in. A pump-price ranking flags New Jersey and would have a dispatcher routing around a
 * tax rate. This is the same argument F10 made for the California premium, applied to a list.
 *
 * ⚠ THIS RANKS WHAT WE PAID, NOT WHAT FUEL COSTS THERE. A state where the fleet only ever stops at
 * expensive off-network sites looks dear for a reason that is the fleet's own doing. Separating the
 * two needs the station-level quoted price, which covers 27.8% of spend (F0) — so this is a decision
 * INPUT and every surface showing it has to say so rather than presenting it as a market fact.
 */
import { dieselTaxAt } from "../fuelTax/taxTable.js";

/** The fields a ranking needs. `CarriedFuelFill` and `SpendLine` both satisfy it. */
export interface StateFuelCostFill {
  tranDate: string | null;
  state: string | null;
  gallons: number;
  netAmount: number | null;
}

export interface StateFuelCost {
  state: string;
  fills: number;
  gallons: number;
  /** What was paid, per gallon. */
  pumpPerGal: number;
  /** The jurisdiction's own diesel tax, per gallon, weighted by this state's gallons. */
  taxPerGal: number;
  /** Pump less tax — the price of the fuel, and the only part comparable across states. */
  preTaxPerGal: number;
  /** `preTaxPerGal` minus the fleet's own pre-tax average. Positive is dear. */
  vsFleetPerGal: number;
  /** Below the volume floor: ranked but flagged, because a rule over four fills is not a rule. */
  thin: boolean;
}

export interface StateFuelCostReport {
  /** Dearest first. */
  states: StateFuelCost[];
  /** The pre-tax average these are measured against, over every priced gallon. */
  fleetPreTaxPerGal: number | null;
  gallons: number;
  /** Gallons the tax table could not price — reported, never treated as zero (D-FX7). */
  unpricedGallons: number;
  /** Gallons in a weight-mile jurisdiction, which has no per-gallon tax to strip. */
  weightMileGallons: number;
}

/**
 * Gallons below which a state is marked `thin`.
 *
 * A state the fleet barely visits produces a price from a handful of stops, and a policy built on it
 * is a policy about noise — Massachusetts at 15 fills is the live example. Two thousand gallons is
 * roughly sixteen fills at this fleet's average, which is the least that can carry an average.
 */
export const THIN_STATE_GALLONS = 2000;

interface Acc {
  fills: number;
  gallons: number;
  net: number;
  tax: number;
}

/**
 * Rank the states in these fills by what their fuel cost, tax stripped out.
 *
 * Weight-mile jurisdictions (Oregon) are excluded from the ranking rather than shown at zero tax:
 * their pump price genuinely carries no per-gallon tax because the tax arrives on a different bill,
 * so a pre-tax figure for them is not comparable with anybody else's. Their gallons are reported.
 */
export function rankStatesByFuelCost(fills: readonly StateFuelCostFill[]): StateFuelCostReport {
  const acc = new Map<string, Acc>();
  let unpricedGallons = 0;
  let weightMileGallons = 0;

  for (const f of fills) {
    if (!(f.gallons > 0) || f.netAmount == null) continue;
    const rate = dieselTaxAt(f.state, f.tranDate);
    if (!rate) { unpricedGallons += f.gallons; continue; }
    if (rate.basis !== "per_gallon") { weightMileGallons += f.gallons; continue; }
    const a = acc.get(rate.state) ?? { fills: 0, gallons: 0, net: 0, tax: 0 };
    a.fills += 1;
    a.gallons += f.gallons;
    a.net += f.netAmount;
    a.tax += rate.pumpPerGal * f.gallons;
    acc.set(rate.state, a);
  }

  const gallons = [...acc.values()].reduce((s, a) => s + a.gallons, 0);
  const netTotal = [...acc.values()].reduce((s, a) => s + a.net, 0);
  const taxTotal = [...acc.values()].reduce((s, a) => s + a.tax, 0);
  const fleetPreTaxPerGal = gallons > 0 ? (netTotal - taxTotal) / gallons : null;

  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const states = [...acc.entries()]
    .map(([state, a]) => {
      const preTaxPerGal = (a.net - a.tax) / a.gallons;
      return {
        state,
        fills: a.fills,
        gallons: r3(a.gallons),
        pumpPerGal: a.net / a.gallons,
        taxPerGal: a.tax / a.gallons,
        preTaxPerGal,
        vsFleetPerGal: fleetPreTaxPerGal == null ? 0 : preTaxPerGal - fleetPreTaxPerGal,
        thin: a.gallons < THIN_STATE_GALLONS,
      };
    })
    .sort((x, y) => y.preTaxPerGal - x.preTaxPerGal);

  return {
    states,
    fleetPreTaxPerGal,
    gallons: r3(gallons),
    unpricedGallons: r3(unpricedGallons),
    weightMileGallons: r3(weightMileGallons),
  };
}

/**
 * The states a price-only reading would put on an avoid list, and which of them the org already has.
 *
 * `dearer` is capped and excludes thin states, because the point is a short list somebody can act on
 * rather than a ranking they must read. `unlisted` is the finding: dear states carrying real volume
 * that no policy mentions.
 */
export function policyDivergence(
  report: StateFuelCostReport,
  configured: readonly string[],
  limit = 5,
): { dearer: StateFuelCost[]; unlisted: StateFuelCost[]; listedButCheap: string[] } {
  const set = new Set(configured.map((s) => s.trim().toUpperCase()));
  const dearer = report.states.filter((s) => !s.thin && s.vsFleetPerGal > 0).slice(0, limit);
  return {
    dearer,
    unlisted: dearer.filter((s) => !set.has(s.state)),
    // A configured state that this window cannot show as dear — either genuinely cheap, or too thin
    // to tell. Never presented as "remove it": a list has reasons a price does not see.
    listedButCheap: [...set].filter((code) => {
      const found = report.states.find((s) => s.state === code);
      return found == null || found.thin || found.vsFleetPerGal <= 0;
    }),
  };
}
