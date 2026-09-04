import type { SupabaseClient } from "@supabase/supabase-js";
import { bucketBillingActivity, type ActivityPeriod, type SpendGrain } from "@silvicom/shared";
import { readBillingWindow } from "../mcleod/index.js";

/**
 * Weekly revenue and activity (W2) — what the fleet hauled and what it was priced at, by period.
 *
 * I/O only: one read, one call to `bucketBillingActivity`, which is where the rules live and where
 * they are mutation-tested. No arithmetic here.
 *
 * **Two predicates, both borrowed rather than restated.** A bill counts when the GL booked it
 * (`post_key` and `post_module = "BILL"` — D-MC12, the same predicate every other revenue figure on
 * this section uses, so the weekly view can never quietly disagree with the monthly one). And
 * revenue is `total_charges + other_charge` with excise tax excluded, for the reason it is excluded
 * everywhere: money collected for the government was never the carrier's earning.
 *
 * **The window is the caller's and the bucketing is by DELIVERY date.** `readBillingWindow` already
 * filters on `delivery_date`, so a period's loads are the loads that ran in it, not the loads
 * invoiced in it — McLeod's billing clock runs days behind the driving one (§5 measured a median of
 * 4.3 days, with 208 of July's settled movements having delivered in June).
 */

export interface BillingActivityResult {
  periods: ActivityPeriod[];
  grain: SpendGrain;
  /** What the caller asked for, so a page can say which span produced no periods at all. */
  window: { from: string; to: string };
  /** Bills the GL has not booked yet. Counted, excluded, and stated rather than silently dropped. */
  unpostedBills: number;
}

export async function getBillingActivity(
  admin: SupabaseClient,
  orgId: string,
  fromIso: string,
  toIso: string,
  grain: SpendGrain,
): Promise<BillingActivityResult> {
  const bills = await readBillingWindow(admin, orgId, fromIso, toIso);

  let unpostedBills = 0;
  const booked = [];
  for (const b of bills) {
    if (!b.post_key || b.post_module !== "BILL") {
      unpostedBills++;
      continue;
    }
    if (!b.delivery_date) continue;
    booked.push({
      delivery_date: String(b.delivery_date),
      revenue: Number(b.total_charges) + Number(b.other_charge ?? 0),
      distance: b.distance == null ? null : Number(b.distance),
    });
  }

  return {
    periods: bucketBillingActivity(booked, grain),
    grain,
    window: { from: fromIso, to: toIso },
    unpostedBills,
  };
}
