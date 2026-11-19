import type { LeadQueueRow } from "./leadContract.js";

/**
 * A lead's standing: who to call first, and why, in words (ADS-PLATFORM-V2-PLAN V7b; Q-APX24 (a), recommended and
 * built around: an ordered standing with its reasons, no number). Pure, over what a queue row already carries —
 * the verdict summary (`leadMatch`), the number's line (V7a, `phone_lookups`), who else the person is (LR2,
 * `recruiting_lead_matches`) and the do-not-contact hold — so the web, the brief and any later reader say the same
 * thing about the same row. D-LS2: rules decide; no model, no weight.
 *
 * ── THREE STANDINGS, FIRST RULE THAT HOLDS WINS ─────────────────────────────────────────────────
 *   does_not_qualify  their own answer fails a hard requirement (`summary.hardUnmet > 0`) — the queue's existing
 *                     lane, the bells' existing silence (LQ6, Q-AD63 (a)). Still listed, still callable.
 *   check_first       something must be looked at before anybody dials: the person asked not to be contacted;
 *                     they already drive for this carrier (an active, un-archived driver matched by phone or
 *                     e-mail — the same reading `newLeadBell` stays silent on); Telnyx says the number cannot
 *                     ring; or there is nothing to call or write to.
 *   call              everything else.
 * A landline or an internet line is a REASON under `call`, never a demotion: Q-AD62 ruled the line type a flag,
 * and no lead of ours has yet shown that either one answers less often. Having applied before is a reason too —
 * the office should know, and it is no reason to call later.
 *
 * ── ORDER INSIDE A STANDING ──────────────────────────────────────────────────────────────────────
 * Fewer requirements still to check first (`summary.unknown`; a lead never matched — no opening — sorts after
 * every matched one, since nothing about them is known), then the caller's own order. The queue's keyset is by
 * arrival (`recruiting_lead_queue`), so this orders a PAGE; it never reorders across pages.
 */

export const LEAD_STANDINGS = ["call", "check_first", "does_not_qualify"] as const;
export type LeadStandingKind = (typeof LEAD_STANDINGS)[number];

export const LEAD_STANDING_LABELS: Record<LeadStandingKind, string> = {
  call: "Call",
  check_first: "Check first",
  does_not_qualify: "Does not qualify by their answer",
};

export interface LeadStanding {
  standing: LeadStandingKind;
  /** Office sentences, most important first. Empty for an ordinary lead to call. */
  reasons: string[];
}

export type LeadStandingInput = Pick<LeadQueueRow, "summary" | "phone_line" | "drivers" | "also" | "do_not_contact" | "phone_e164" | "email_lower">;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function leadStanding(row: LeadStandingInput): LeadStanding {
  const hardUnmet = row.summary?.hardUnmet ?? 0;
  if (hardUnmet > 0) {
    return { standing: "does_not_qualify", reasons: [`Said they miss ${plural(hardUnmet, "requirement", "requirements")}`] };
  }
  const check: string[] = [];
  if (row.do_not_contact) check.push("Asked not to be contacted");
  if (row.drivers.some((d) => d.status === "active" && !d.archived)) check.push("Already drives for you");
  if (row.phone_e164 !== null && row.phone_line?.valid === false) check.push("Telnyx says the number is not valid");
  if (row.phone_e164 === null && row.email_lower === null) check.push("Nothing to call or write to");
  if (check.length > 0) return { standing: "check_first", reasons: check };

  const reasons: string[] = [];
  if (row.phone_line?.line_type === "landline") reasons.push("Landline — cannot be texted");
  if (row.phone_line?.line_type === "voip") reasons.push("Internet line");
  if (row.also.length > 0) reasons.push("Applied before");
  if (row.drivers.length > 0) reasons.push("On file as a driver or applicant");
  return { standing: "call", reasons };
}

/** The page's order: standing, then fewer still to check (unmatched last), then the order the rows came in. */
export function compareLeadStanding(a: LeadStandingInput, b: LeadStandingInput): number {
  const rank = (r: LeadStandingInput) => LEAD_STANDINGS.indexOf(leadStanding(r).standing);
  const open = (r: LeadStandingInput) => (r.summary === null ? Number.POSITIVE_INFINITY : r.summary.unknown);
  return rank(a) - rank(b) || open(a) - open(b) || 0;
}
