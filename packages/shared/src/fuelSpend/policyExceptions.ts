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
import { dieselTaxSplit, type DieselTaxSplit } from "../fuelTax/taxPremium.js";
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
  /**
   * How much of `excess` is the jurisdictions' tax rates rather than the price of the fuel (F10).
   *
   * The premium these reports have always shown is a pump-price premium, and for an avoided-state
   * report a large part of it is the state's own tax rate — which the carrier owes on the miles it
   * drives there whether it buys the fuel there or not. Measured on production, 41% of the California
   * premium is exactly that. Null when no gallon in either population could be priced; a consumer
   * must state `measuredShare` beside any figure taken from here.
   */
  taxSplit: DieselTaxSplit | null;
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
    // The SAME two populations the excess above is measured between — the selected fills against the
    // ones that broke no rule — so the tax half and the pump half describe one comparison and not two.
    taxSplit: dieselTaxSplit(hit, rest),
    fills: [...fills].sort((a, b) => b.excess - a.excess),
    byUnit: group(fills, (l) => l.unit),
    bySite: group(fills, (l) => (l.site ? `${l.site} ${l.city ?? ""} ${l.state ?? ""}`.trim() : (l.city ?? null))),
  };
}

/**
 * What the carrier holds itself to (C8, D-FUI10). Every field is nullable and NEVER defaulted.
 *
 * ⚠ This is the one part of the policy that has no sensible fallback, and 0325 says why at length:
 * every other setting on `route_fuel_settings` is a PLANNING input the router must have an answer for,
 * so a default beats a failure. A target is a management commitment. Defaulting `onNetworkPct` to 90
 * would measure a carrier against a threshold nobody in their office chose, and "12 points below
 * target" would be a sentence this product made up — worse than no target rather than better.
 *
 * Two floors and a ceiling, kept apart because the direction is the thing that inverts a variance if
 * it is guessed. `varianceToTarget` takes the direction explicitly for the same reason.
 */
export interface FuelTargets {
  /** FLOOR, 0-100: at least this share of gallons at brands the policy prefers. */
  onNetworkPct: number | null;
  /** FLOOR, 0-100: at least this share of the available discount actually captured. */
  discountCapturePct: number | null;
  /** CEILING, gallons: at most this many bought in `avoidStates`. */
  avoidedStateGal: number | null;
}

/** No target is set until somebody sets one. There is deliberately no "default target". */
export const NO_FUEL_TARGETS: FuelTargets = {
  onNetworkPct: null,
  discountCapturePct: null,
  avoidedStateGal: null,
};

export type TargetDirection = "floor" | "ceiling";

export interface TargetVariance {
  target: number;
  actual: number;
  /**
   * How far the RIGHT side of the line this is — positive is met with room to spare, negative is
   * missed by that much, in BOTH directions.
   *
   * One sign convention for a floor and a ceiling is the whole point: `actual - target` reads as
   * "good" for on-network share and as "bad" for avoided-state gallons, and a reader who forgets
   * which they are looking at gets the colour backwards. Here the sign always means the same thing.
   */
  delta: number;
  met: boolean;
}

/**
 * Grade a figure against its target, or `null` when there is no target to grade it against.
 *
 * Null is the ordinary case until somebody fills the settings form in, and it means "render this
 * figure the way it rendered before C8" — not zero, and not met.
 */
export function varianceToTarget(
  actual: number | null | undefined,
  target: number | null | undefined,
  direction: TargetDirection,
): TargetVariance | null {
  if (target == null || actual == null || !Number.isFinite(actual) || !Number.isFinite(target)) return null;
  const delta = direction === "floor" ? actual - target : target - actual;
  return { target, actual, delta, met: delta >= 0 };
}

export interface FuelPolicy {
  avoidStates: readonly string[];
  avoidBrands: readonly string[];
  preferredBrands: readonly string[];
  /**
   * Whether the planner tops the tank off at every stop — `route_fuel_settings.always_fill_full`.
   *
   * Read by the compliance side for one reason: when it is TRUE, `fillPolicy.ts`'s min-drawdown rule
   * never runs, so `fill_cap_pct` and the minimum purchase are DORMANT and judging fills against them
   * would be a report contradicting the planner reading the same table (B4's shape). What the surface
   * does instead is price the setting — F13's carried-fuel figure is what leaving it on costs.
   */
  alwaysFillFull: boolean;
  /** The standards the carrier set for itself. All-null until they do. */
  targets: FuelTargets;
}

/**
 * The policy for an org that has configured none — NOT the policy for every org.
 *
 * This was the analyzer's only policy until F3: every caller took the default, so the compliance report
 * measured `{CA}` and `{one9}` for a carrier whose `route_fuel_settings` said something else, while the
 * route planner reading the same table avoided the states it was actually told to. Use
 * `fuelPolicyFromSettings` with the org's row; this stays as its fallback.
 */
export const DEFAULT_FUEL_POLICY: FuelPolicy = {
  avoidStates: ["CA"],
  avoidBrands: ["one9"],
  preferredBrands: ["pilot", "flying_j"],
  // Matches `DEFAULT_ROUTE_FUEL_SETTINGS.alwaysFillFull` — min-drawdown is opt-in per org, not the
  // default — so the two halves of the product start from the same assumption about an unconfigured
  // carrier rather than from two.
  alwaysFillFull: true,
  // ⚠ Not a default — the ABSENCE of one. An unconfigured carrier has no target, and inventing one
  // here would put the product's opinion behind every variance figure in the section.
  targets: NO_FUEL_TARGETS,
};

/** The `route_fuel_settings` columns the compliance side reads, as PostgREST returns them. */
export interface FuelPolicyRow {
  avoid_states?: string[] | null;
  avoid_brands?: string[] | null;
  preferred_brands?: string[] | null;
  always_fill_full?: boolean | null;
  target_on_network_pct?: number | string | null;
  target_discount_capture_pct?: number | string | null;
  target_avoided_state_gal?: number | string | null;
}

/**
 * Read an org's `route_fuel_settings` row as a policy.
 *
 * ── NULL AND EMPTY ARE DIFFERENT ANSWERS, AND `resolveRouteFuelConfig` MERGES THEM ───────────────
 * The planner's resolver treats an empty array as "unset" and substitutes the default, which is right
 * for routing — a planner with no preferred brands can plan nothing. It is wrong for a compliance
 * report: a carrier who deliberately clears `avoid_states` is saying *there is no state we avoid*, and
 * handing them a California exception report back is the same class of error as ignoring the column in
 * the first place. So this mapper keeps the distinction:
 *
 *   column is null / absent  →  never configured  →  the default applies
 *   column is []             →  configured empty  →  no report; the policy is that there is no rule
 *
 * Values are also normalised on the way in — states upper-cased, brand slugs lower-cased — because the
 * settings form takes free text and `analyzePolicyExceptions` matches with a `Set`, where "Ca" simply
 * never fires and reports a clean period rather than a broken filter.
 */
export function fuelPolicyFromSettings(row: FuelPolicyRow | null | undefined): FuelPolicy {
  const list = (v: string[] | null | undefined, fallback: readonly string[], norm: (s: string) => string) =>
    v == null ? [...fallback] : v.map((x) => norm(x.trim())).filter(Boolean);
  return {
    avoidStates: list(row?.avoid_states, DEFAULT_FUEL_POLICY.avoidStates, (s) => s.toUpperCase()),
    avoidBrands: list(row?.avoid_brands, DEFAULT_FUEL_POLICY.avoidBrands, (s) => s.toLowerCase()),
    preferredBrands: list(row?.preferred_brands, DEFAULT_FUEL_POLICY.preferredBrands, (s) => s.toLowerCase()),
    // A boolean has no empty-versus-null distinction to preserve: absent means unconfigured, and an
    // unconfigured carrier gets the planner's own default rather than a second opinion.
    alwaysFillFull: row?.always_fill_full ?? DEFAULT_FUEL_POLICY.alwaysFillFull,
    // ⚠ NOT run through the null-means-default rule above. For the lists, null means "never
    // configured" and the default applies; for a target, null means there ISN'T one and there is
    // nothing to fall back to. PostgREST returns `numeric` as a string, so each is coerced once here
    // rather than at every call site that wants to compare it to a percentage.
    targets: {
      onNetworkPct: num(row?.target_on_network_pct),
      discountCapturePct: num(row?.target_discount_capture_pct),
      avoidedStateGal: num(row?.target_avoided_state_gal),
    },
  };
}

/** A `numeric` column as a number, or null — never NaN, which would compare false against everything. */
function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface PolicyExceptions {
  avoidedBrands: ExceptionReport;
  avoidedStates: ExceptionReport;
  offNetwork: ExceptionReport;
  /**
   * Every fill breaking ANY of the three rules, counted once.
   *
   * ── WHY THE THREE CANNOT BE ADDED ──────────────────────────────────────────────────────────────
   * The reports select overlapping populations: a ONE9 fill in California is off-brand, in an avoided
   * state and off the preferred network, and appears with its full excess in all three. Summing them
   * triples it. The server-rendered report's verdict band — the one line of the document guaranteed to
   * be read — did exactly that, and a document is forwarded and quoted back.
   *
   * This is the union, scored against the fills that broke no rule at all, so it is both correct and a
   * stricter baseline than any of the three has on its own.
   */
  offPolicy: ExceptionReport;
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

  const isAvoidedBrand = (l: SpendLine) => l.brand != null && avoidBrand.has(l.brand);
  const isAvoidedState = (l: SpendLine) => l.state != null && avoidState.has(l.state);
  const isOffNetwork = (l: SpendLine) => l.brand == null || !preferred.has(l.brand);

  return {
    avoidedBrands: exceptionReport(lines, isAvoidedBrand),
    avoidedStates: exceptionReport(lines, isAvoidedState),
    offPolicy: exceptionReport(lines, (l) => isAvoidedBrand(l) || isAvoidedState(l) || isOffNetwork(l)),
    // An unresolved brand counts as off-network: it is certainly not a preferred site, and treating
    // "we could not identify it" as compliant is how off-network spend stayed invisible.
    offNetwork: exceptionReport(lines, isOffNetwork),
    avoidedStateFillSize: { inside: avgFill(inside), outside: avgFill(outside) },
  };
}
