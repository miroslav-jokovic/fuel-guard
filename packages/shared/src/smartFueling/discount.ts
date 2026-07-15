/**
 * Net-price derivation from a posted price + an org's discount rule (pure). For Silvicom the daily email is
 * already NET (flat deal), so this is mainly the productization seam + an EFS cross-check for other models.
 */
import type { DiscountRule } from "./types.js";

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Net $/gal from a posted price under a discount rule. Returns posted unchanged for `none`/unknown/missing. */
export function netFromPosted(posted: number | null | undefined, rule: DiscountRule | null | undefined): number | null {
  if (posted == null) return null;
  if (!rule || rule.type === "none") return round3(posted);
  const off = rule.centsOff / 100; // cents/gal -> $/gal
  switch (rule.type) {
    case "flat":
    case "retail_minus":
      return round3(posted - off); // discount off retail
    case "cost_plus":
      return round3(posted + off); // posted is cost; add fixed margin
    case "per_site":
      return round3(posted); // per-site nets are resolved from the price feed, not this rule
    default:
      return round3(posted);
  }
}
