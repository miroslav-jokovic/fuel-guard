import {
  analyzePolicyExceptions,
  avoidedBrandsLabel,
  avoidedStatesLabel,
  listStates,
  type ExceptionReport,
  type FuelPolicy,
  type SpendLine,
} from "@silvicom/shared";
import { usd3 } from "./format";

/**
 * The three policy reports, kept whole while nothing renders them (FUEL-C5, and C6 is what picks
 * them up).
 *
 * ── ⚠ WHY THIS FILE EXISTS AT ALL, GIVEN NOTHING IMPORTS IT ─────────────────────────────────────
 * C5's own wording: "the three policy tab bodies are KEPT IN THE TREE, UNMOUNTED, until C6 files
 * their findings — a report deleted before its replacement produces anything is a capability gap,
 * however brief."
 *
 * `ExceptionsTab.vue` is the body and survives on its own, still covered by `spendTabs.test.ts`. But
 * a body is not a report: what made each of the three MEAN something lived on the page, in the tab
 * strip that C5 removes — which title, which blurb, which policy list it reads, and the two extra
 * sentences the avoided-state report carries. Deleting the page section would have deleted those,
 * and every one of them is text this plan already paid for once:
 *
 * · The brand blurb prices the avoided networks against the rest of the fleet, per window.
 * · `stateBlurb` was rewritten off "CARB and fuel tax" — true of California and of no other state —
 *   onto the policy the org actually configured, because a report headed with a state list must not
 *   explain a state that is not in it.
 * · `stateNote` is the buy-minimum discipline check: average fill inside the avoided states against
 *   outside, which is the behaviour the policy asks for and the gap worth watching.
 *
 * So the configuration moves here as one function rather than dying with the markup that called it.
 * C6 imports this; until then it is dead code ON PURPOSE, and `policyReports.test.ts` is what keeps
 * "kept in the tree" from meaning "kept and quietly broken".
 *
 * ── WHY A FUNCTION AND NOT A CONSTANT ───────────────────────────────────────────────────────────
 * Two of the three reports do not exist for every carrier. "California" and "ONE9 & off-brand" were
 * literal strings beside an analyzer reading a hardcoded constant — true of one carrier and of no
 * other. Both halves come from `route_fuel_settings`, and an EMPTY list is a policy too: a carrier
 * who clears `avoid_states` is saying there is no state to avoid, and the honest answer is no report
 * rather than an empty one under a heading they did not choose. That is why this returns a list whose
 * LENGTH varies rather than a record with three fixed keys.
 */
export interface PolicyReport {
  /** Stable across renames — this is what a finding kind will key on in C6. */
  key: "avoided_brands" | "avoided_states" | "off_network";
  title: string;
  blurb: string;
  /** Filename stem for the CSV, and `ExceptionsTab`'s `slug` prop. */
  slug: string;
  /** Extra line under the tiles; only the avoided-state report has one. */
  note?: string | null;
  report: ExceptionReport;
}

export function policyReports(lines: readonly SpendLine[], policy: FuelPolicy): PolicyReport[] {
  const exceptions = analyzePolicyExceptions(lines, policy);
  const brandLabel = avoidedBrandsLabel(policy.avoidBrands);
  const stateLabel = avoidedStatesLabel(policy.avoidStates);
  const stateNames = listStates(policy.avoidStates);
  const fillSize = exceptions.avoidedStateFillSize;

  const out: PolicyReport[] = [];

  if (brandLabel) {
    out.push({
      key: "avoided_brands",
      title: `${brandLabel} and other off-brand sites`,
      blurb:
        `Networks your fuel policy says to avoid. Across this window they cost ` +
        `${usd3(exceptions.avoidedBrands.netPerGal)} a gallon against ` +
        `${usd3(exceptions.avoidedBrands.baselinePerGal)} for the rest of the fleet.`,
      slug: "off-brand",
      report: exceptions.avoidedBrands,
    });
  }

  if (stateLabel) {
    out.push({
      key: "avoided_states",
      title: stateLabel,
      // Written from the policy rather than about California: the WHY differs per state and we do not
      // know it, so the copy states the policy and the mechanism it asks for — which is what the
      // report actually measures.
      blurb:
        `Every gallon bought in ${stateNames} costs more — state fuel taxes, and in some of them a ` +
        `reformulated diesel — which is why the policy is to cross on as little fuel as possible.`,
      slug: "avoided-states",
      note:
        fillSize.inside == null || fillSize.outside == null
          ? null
          : `Average fill inside ${stateNames} is ${fillSize.inside.toFixed(0)} gallons against ` +
            `${fillSize.outside.toFixed(0)} elsewhere — the buy-minimum discipline the policy asks ` +
            `for, and the gap to watch.`,
      report: exceptions.avoidedStates,
    });
  }

  // No policy list to read, so this one exists for every carrier. An unidentified site is certainly
  // not a preferred one, so it counts here rather than being assumed compliant.
  out.push({
    key: "off_network",
    title: "Off the preferred network",
    blurb:
      "Fills outside Pilot and Flying J, including sites we could not identify — an unidentified " +
      "site is certainly not a preferred one, so it counts here rather than being assumed compliant.",
    slug: "off-network",
    report: exceptions.offNetwork,
  });

  return out;
}
