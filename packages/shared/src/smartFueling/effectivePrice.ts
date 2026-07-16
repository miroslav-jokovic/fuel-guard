/**
 * Effective net price resolution — the ONE place that decides what $/gal the planner uses for a station,
 * now that prices come in two layers:
 *   GLOBAL posted retail (fuel_prices_posted; shared facts, e.g. Pilot's public page/download)
 *   PER-ORG net          (fuel_prices; the tenant's own feed — e.g. the Pilot daily email, already net)
 *
 * Precedence (each step only when the previous is unavailable):
 *   1. FRESH tenant net quote            -> basis "fresh",           not estimated, high confidence
 *   2. FRESH posted price − discount rule -> basis "posted_discount", estimated,     medium confidence
 *      (a real, current pump price; medium because the rule — not the pump — is the approximation)
 *   3. tenant net history median          -> basis "station_history" (via estimateStationPrice)
 *   4. corridor brand median              -> basis "brand"
 *   5. nothing                            -> basis "none" (solver treats as no-price / emergency-only)
 *
 * Currency safety: only USD/gal posted rows are usable — CAD/L rows (Canadian sites on Pilot's public
 * table) are REJECTED here rather than mis-ranked; they fall through to history/brand/none. Pure.
 */
import { estimateStationPrice, type PriceEstimate, type PriceSample } from "./priceHistory.js";
import { netFromPosted } from "./discount.js";
import type { DiscountRule } from "./types.js";

const HOUR = 3_600_000;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** A station's latest posted retail quote (from the global posted layer). */
export interface PostedQuote {
  price: number;
  currency: string; // "USD" | "CAD"
  unit: string; // "gal" | "L"
  observedAtMs: number;
}

export interface EffectivePriceInputs {
  /** Tenant net samples (fresh + history) for this station — same rows fuel_prices always supplied. */
  tenantSamples: PriceSample[];
  /** Latest posted retail for this station, if the global layer has one. */
  posted: PostedQuote | null;
  /** The org's discount rule for this station's brand (null/none -> posted used as-is). */
  discountRule: DiscountRule | null;
  brandMedian: number | null;
  nowMs: number;
  ttlHours: number;
  lookbackHours?: number;
}

/** True when the posted quote is usable for USD/gal planning and within freshness. */
function postedUsable(posted: PostedQuote | null, nowMs: number, ttlHours: number): posted is PostedQuote {
  return (
    posted != null &&
    posted.currency === "USD" &&
    posted.unit === "gal" &&
    Number.isFinite(posted.price) &&
    posted.price > 0 &&
    nowMs - posted.observedAtMs <= ttlHours * HOUR + 1
  );
}

export function resolveEffectivePrice(inp: EffectivePriceInputs): PriceEstimate {
  // 1. Fresh tenant net — delegate; a fresh quote wins inside estimateStationPrice.
  const tenantEstimate = estimateStationPrice(inp.tenantSamples, inp.nowMs, {
    ttlHours: inp.ttlHours,
    lookbackHours: inp.lookbackHours,
    brandMedian: inp.brandMedian,
  });
  if (tenantEstimate.basis === "fresh") return tenantEstimate;

  // 2. Fresh posted − rule beats tenant HISTORY (a current pump price beats an old one).
  if (postedUsable(inp.posted, inp.nowMs, inp.ttlHours)) {
    const net = netFromPosted(inp.posted.price, inp.discountRule);
    if (net != null && net > 0) {
      return { net: round3(net), estimated: true, confidence: "medium", basis: "posted_discount" };
    }
  }

  // 3–5. Tenant history median -> brand median -> none (already computed above).
  return tenantEstimate;
}
