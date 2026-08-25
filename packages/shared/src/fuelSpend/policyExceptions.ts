/**
 * Did the fleet fuel where the policy says to? (WP5, plan §4.3–4.5)
 *
 * `route_fuel_settings` already carries the policy — `avoid_states = {CA}`, `avoid_brands = {one9}`,
 * `preferred_brands = {pilot, flying_j}` — and until now nothing measured compliance with it. These are
 * the three exception reports, and each one costs real money on the real data:
 *
 *   • ONE9 / avoid-brand — not ONE dyed gallon in the five 2026-07/08 statements captured a cent of
 *     discount, against $0.53–0.61/gal on Pilot and Flying J, while also carrying the highest posted
 *     price. Usage repeats per unit (754 hit ONE9 three times in two days), so it groups by unit.
 *   • California — $6.78/gal against $5.21 fleet-wide, ~$9,200 of premium over five weeks. Fill SIZE is
 *     reported beside it because the policy is "cross CA on as little fuel as possible", and average CA
 *     fill has crept 76.7 → 91.3 gal against a ~121 gal fleet average. A price report alone would call
 *     that compliant.
 *   • Off-network — anything outside the preferred family. Small in gallons, extreme per gallon
 *     ($7.007/gal at TA Express Olancha), which is exactly the shape a $-sorted list buries and a
 *     $/gal-sorted list surfaces.
 *
 * ── THE BASELINE IS THE SAME PERIOD'S OTHER FUEL ─────────────────────────────────────────────────
 * "Excess" is measured against what the rest of the fleet paid over the SAME lines, not a fixed price.
 * Diesel moved 32% across the window these reports cover; against a fixed baseline every CA fill in a
 * rising market looks like an incident.
 */
import { isTractorFuel, totalsOf, type SpendLine } from "./types.js";

export interface ExceptionFill {
  line: SpendLine;
  netPerGal: number;
  /** $/gal above the period's baseline. Negative means it beat the baseline. */
  premiumPerGal: number;
  /** premiumPerGal × gallons — what this fill cost above buying the same gallons at the baseline. */
  excess: number;
  discountPerGal: number | null;
}

export interface ExceptionGroup {
  key: string;
  lines: number;
  gallons: number;
  spend: number;
  netPerGal: number;
  excess: number;
}

export interface ExceptionReport {
  /** What the rest of the fleet's tractor fuel cost over the same lines, $/gal. */
  baselinePerGal: number | null;
  lines: number;
  gallons: number;
  spend: number;
  netPerGal: number | null;
  /**
   * Discount per gallon over the fills that HAVE a posted price, or null when none of them do.
   *
   * Null is the ordinary case here, not an edge: these reports select the fills that went off the
   * preferred network, and an off-network site is precisely one the Pilot price report does not
   * cover. Read against every gallon this used to resolve to `−netPerGal` and print a large negative
   * dollar figure under the label "Discount captured". `discountMeasuredShare` says how much of these
   * gallons it covers, so a consumer can state the scope instead of implying there is none.
   */
  discountPerGal: number | null;
  /** Share of these fills' gallons carrying a posted price — the denominator of `discountPerGal`. */
  discountMeasuredShare: number | null;
  /** Total paid above the baseline for these gallons. */
  excess: number;
  /** Share of all tractor gallons in the input. */
  gallonShare: number | null;
  fills: ExceptionFill[];
  byUnit: ExceptionGroup[];
  bySite: ExceptionGroup[];
}

function group(fills: readonly ExceptionFill[], key: (l: SpendLine) => string | null): ExceptionGroup[] {
  const m = new Map<string, ExceptionFill[]>();
  for (const f of fills) {
    const k = key(f.line);
    if (k == null) continue;
    const b = m.get(k);
    if (b) b.push(f);
    else m.set(k, [f]);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return [...m.entries()]
    .map(([k, fs]) => {
      const t = totalsOf(fs.map((f) => f.line));
      return { key: k, lines: fs.length, gallons: t.gallons, spend: t.net, netPerGal: t.netPerGal ?? 0, excess: r2(fs.reduce((a, f) => a + f.excess, 0)) };
    })
    .sort((a, b) => b.excess - a.excess);
}

/**
 * Score the fills a predicate selects against the ones it does not.
 *
 * The baseline deliberately EXCLUDES the selected fills. Including them lets a large exception drag the
 * baseline toward itself and shrink its own measured cost — with California at 3% of gallons the
 * difference is small, but the property should not depend on the exception staying small.
 */
export function exceptionReport(lines: readonly SpendLine[], selects: (l: SpendLine) => boolean): ExceptionReport {
  const fuel = lines.filter(isTractorFuel);
  const hit = fuel.filter(selects);
  const rest = fuel.filter((l) => !selects(l));
  const restT = totalsOf(rest);
  const hitT = totalsOf(hit);
  const allGallons = totalsOf(fuel).gallons;
  const baseline = restT.netPerGal;
  const r2 = (n: number) => Math.round(n * 100) / 100;

  const fills: ExceptionFill[] = hit.map((l) => {
    const netPerGal = l.netAmount! / l.gallons;
    const premiumPerGal = baseline == null ? 0 : netPerGal - baseline;
    return {
      line: l,
      netPerGal,
      premiumPerGal,
      excess: r2(premiumPerGal * l.gallons),
      discountPerGal: l.retailAmount == null ? null : (l.retailAmount - l.netAmount!) / l.gallons,
    };
  });

  return {
    baselinePerGal: baseline,
    lines: hit.length,
    gallons: hitT.gallons,
    spend: hitT.net,
    netPerGal: hitT.netPerGal,
    discountPerGal: hitT.discountPerGal,
    discountMeasuredShare: hitT.retailShare,
    excess: r2(fills.reduce((a, f) => a + f.excess, 0)),
    gallonShare: allGallons > 0 ? hitT.gallons / allGallons : null,
    fills: [...fills].sort((a, b) => b.excess - a.excess),
    byUnit: group(fills, (l) => l.unit),
    bySite: group(fills, (l) => (l.site ? `${l.site} ${l.city ?? ""} ${l.state ?? ""}`.trim() : (l.city ?? null))),
  };
}

export interface FuelPolicy {
  avoidStates: readonly string[];
  avoidBrands: readonly string[];
  preferredBrands: readonly string[];
}

/** Mirrors the `route_fuel_settings` defaults, so a report works before an org has customised them. */
export const DEFAULT_FUEL_POLICY: FuelPolicy = {
  avoidStates: ["CA"],
  avoidBrands: ["one9"],
  preferredBrands: ["pilot", "flying_j"],
};

export interface PolicyExceptions {
  avoidedBrands: ExceptionReport;
  avoidedStates: ExceptionReport;
  offNetwork: ExceptionReport;
  /** Average fill size inside vs outside the avoided states — the buy-minimum discipline check. */
  avoidedStateFillSize: { inside: number | null; outside: number | null };
}

export function analyzePolicyExceptions(
  lines: readonly SpendLine[],
  policy: FuelPolicy = DEFAULT_FUEL_POLICY,
): PolicyExceptions {
  const avoidBrand = new Set(policy.avoidBrands);
  const avoidState = new Set(policy.avoidStates);
  const preferred = new Set(policy.preferredBrands);

  const fuel = lines.filter(isTractorFuel);
  const inside = fuel.filter((l) => l.state != null && avoidState.has(l.state));
  const outside = fuel.filter((l) => l.state == null || !avoidState.has(l.state));
  const avgFill = (ls: SpendLine[]) => (ls.length ? totalsOf(ls).gallons / ls.length : null);

  return {
    avoidedBrands: exceptionReport(lines, (l) => l.brand != null && avoidBrand.has(l.brand)),
    avoidedStates: exceptionReport(lines, (l) => l.state != null && avoidState.has(l.state)),
    // An unresolved brand counts as off-network: it is certainly not a preferred site, and treating
    // "we could not identify it" as compliant is how off-network spend stayed invisible.
    offNetwork: exceptionReport(lines, (l) => l.brand == null || !preferred.has(l.brand)),
    avoidedStateFillSize: { inside: avgFill(inside), outside: avgFill(outside) },
  };
}
