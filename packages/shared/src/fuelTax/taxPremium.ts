/**
 * How much of an exception's premium is a tax rate, and how much is the price of the fuel (F10).
 *
 * ── THE DEFECT THIS REMOVES ──────────────────────────────────────────────────────────────────────
 * The avoided-state tab has always reported one number: these fills cost $1.554/gal more than the
 * rest of the fleet's, so this many dollars of excess. That figure is true and it is not a finding,
 * because California levies $0.979/gal of fuel tax against a $0.334 fleet-wide average and a truck
 * that avoided California entirely would still owe most of the difference on the miles it drove
 * there. Measured on production over the default window: **$8,210 of the $19,858 California premium —
 * 41% — is a tax rate**. Presenting it as though a dispatcher could have avoided it is the same class
 * of error as the verdict band that added three overlapping reports together (L11): a number that is
 * arithmetically correct and points at the wrong person.
 *
 * ── BOTH HALVES ARE MEASURED OVER THE SAME GALLONS, WHICH IS THE WHOLE TRICK ─────────────────────
 * `preTaxPremium = pumpPremium − taxPremium` only holds if all three are computed over one
 * population. So the split restricts BOTH the selected fills and the baseline to gallons the tax
 * table could price, and reports its own pump premium over that subset rather than borrowing the
 * report's headline — which covers every gallon and would leave the three figures failing to add up
 * on screen by however much of the window went unpriced. This is B3 and L14's rule applied to a new
 * denominator, and it is the third time in this plan that a partial numerator met a full denominator.
 *
 * Weight-mile jurisdictions (Oregon) are excluded from both populations rather than counted at a tax
 * of zero. Their gallons genuinely carry no per-gallon tax, so including them would drag the baseline
 * down and inflate every other state's measured tax premium — small today at 1.05% of gallons, but
 * the property must not depend on that (the same argument `exceptionReport` makes for excluding the
 * selected fills from their own baseline). They are reported apart so the reader can see them.
 */
import { dieselTaxAt } from "./taxTable.js";

/** The fields of a fill this needs. `SpendLine` satisfies it. */
export interface TaxPremiumFill {
  gallons: number;
  netAmount: number | null;
  state: string | null;
  tranDate: string | null;
}

export interface DieselTaxSplit {
  /** Selected minus baseline, $/gal, over the priced gallons only. */
  pumpPremiumPerGal: number | null;
  /** The part of it that is the two populations' tax rates differing. */
  taxPremiumPerGal: number | null;
  /** The rest: what the fuel itself cost more, and the only part a buying decision moves. */
  preTaxPremiumPerGal: number | null;
  /** Purchase-state tax carried by the selected fills, $/gal. */
  taxPerGal: number | null;
  /** …and by the fills they are being compared against. */
  baselineTaxPerGal: number | null;
  /** `taxPremiumPerGal × measuredGallons` — the share of the report's excess that is a tax rate. */
  taxExcess: number | null;
  /** Selected gallons the table could price per gallon — the denominator of every figure above. */
  measuredGallons: number;
  /** `measuredGallons` over all the selected fills' gallons. Null when there are none. */
  measuredShare: number | null;
  /** Selected gallons in a jurisdiction that taxes by the mile instead (Oregon). */
  weightMileGallons: number;
  /** Selected gallons with no rate at all — an unknown state, or a date the table does not cover. */
  unpricedGallons: number;
  /** Every matrix quarter the figures drew on, and whether any of them is still provisional. */
  versions: readonly string[];
  provisional: boolean;
}

interface Bucket {
  gallons: number;
  net: number;
  tax: number;
}

const EMPTY: Bucket = { gallons: 0, net: 0, tax: 0 };

/**
 * Split the premium of `selected` over `baseline` into its tax and pre-tax halves.
 *
 * `baseline` is the comparison population — for an exception report, the fills that did NOT trip the
 * rule, exactly as `exceptionReport` computes its own baseline. Returns null when neither population
 * has a priced gallon, because a split with no denominator is not a weaker measurement, it is none.
 */
export function dieselTaxSplit(
  selected: readonly TaxPremiumFill[],
  baseline: readonly TaxPremiumFill[],
): DieselTaxSplit | null {
  const versions = new Set<string>();
  let provisional = false;
  let weightMileGallons = 0;
  let unpricedGallons = 0;
  let selectedGallons = 0;

  const accumulate = (fills: readonly TaxPremiumFill[], countUnpriced: boolean): Bucket => {
    let b = { ...EMPTY };
    for (const f of fills) {
      if (!(f.gallons > 0) || f.netAmount == null) continue;
      if (countUnpriced) selectedGallons += f.gallons;
      const rate = dieselTaxAt(f.state, f.tranDate);
      if (!rate) {
        if (countUnpriced) unpricedGallons += f.gallons;
        continue;
      }
      if (rate.basis !== "per_gallon") {
        if (countUnpriced) weightMileGallons += f.gallons;
        continue;
      }
      versions.add(rate.version);
      if (!rate.final) provisional = true;
      b = { gallons: b.gallons + f.gallons, net: b.net + f.netAmount, tax: b.tax + rate.pumpPerGal * f.gallons };
    }
    return b;
  };

  const hit = accumulate(selected, true);
  const rest = accumulate(baseline, false);
  if (hit.gallons === 0 && rest.gallons === 0) return null;

  const perGal = (b: Bucket, take: (b: Bucket) => number) => (b.gallons > 0 ? take(b) / b.gallons : null);
  const taxPerGal = perGal(hit, (b) => b.tax);
  const baselineTaxPerGal = perGal(rest, (b) => b.tax);
  const pumpPerGal = perGal(hit, (b) => b.net);
  const baselinePumpPerGal = perGal(rest, (b) => b.net);

  const pumpPremiumPerGal = pumpPerGal != null && baselinePumpPerGal != null ? pumpPerGal - baselinePumpPerGal : null;
  const taxPremiumPerGal = taxPerGal != null && baselineTaxPerGal != null ? taxPerGal - baselineTaxPerGal : null;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    pumpPremiumPerGal,
    taxPremiumPerGal,
    preTaxPremiumPerGal:
      pumpPremiumPerGal != null && taxPremiumPerGal != null ? pumpPremiumPerGal - taxPremiumPerGal : null,
    taxPerGal,
    baselineTaxPerGal,
    taxExcess: taxPremiumPerGal != null ? r2(taxPremiumPerGal * hit.gallons) : null,
    measuredGallons: Math.round(hit.gallons * 1000) / 1000,
    measuredShare: selectedGallons > 0 ? hit.gallons / selectedGallons : null,
    weightMileGallons: Math.round(weightMileGallons * 1000) / 1000,
    unpricedGallons: Math.round(unpricedGallons * 1000) / 1000,
    versions: [...versions].sort(),
    provisional,
  };
}
