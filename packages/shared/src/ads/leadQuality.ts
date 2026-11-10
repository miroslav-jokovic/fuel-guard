import type { AdsLeadQuality } from "./settingsContract.js";

/**
 * What a campaign's leads turned out to be once people called them (ADS-LEAD-QUALITY-PLAN LQ3; Q-AD51 (a)).
 * Recruiting reads its own tables and hands these counts across (`LeadQuality`, injected — the Q-AD34
 * `LeadOutcomes` pattern, D-AD17: ads never reads a recruiting table); `leadQualityBreaches` is the pure verdict.
 *
 * ── WHAT EACH COUNT IS ───────────────────────────────────────────────────────────────────────────
 *   · leads           ad leads of this campaign that arrived in the window;
 *   · attempted       of those, leads with at least one recorded contact (`recruiting_contacts`);
 *   · wrong_number    of those, leads with a contact whose outcome is `wrong_number`;
 *   · reached         of those, leads with a contact whose outcome is `reached`;
 *   · not_qualified   leads with at least one HARD requirement judged `does_not_meet` (`lead_match_verdicts`):
 *                     the person's own answer plainly below the opening (no Class A; "less than 1 year"
 *                     against 2). `unknown` never counts — for a Meta lead age and the disqualifiers are
 *                     unknown by design (leadMatch.ts), and unknown is the next question, not a failure;
 *   · median_first_attempt_minutes  from arrival to the first contact, over attempted leads; null if none.
 *
 * ── THE TWO RULES ────────────────────────────────────────────────────────────────────────────────
 * Each waits for `min_attempted` of ITS OWN whole: before that a share is noise. Wrong numbers are a share of
 * ATTEMPTED leads (an untried number is not known to be wrong), so that rule waits for that many attempts.
 * Not-qualified is a share of ALL the window's leads (a verdict needs no call), so it waits for that many LEADS.
 * Shares are compared as whole percents, at-or-above the threshold.
 *
 * ── WHY NOT ONE GATE ON ATTEMPTS (LR1, ADS-AGENTS-AUDIT-2026-11-10 F-LR2) ────────────────────────
 * Until 2026-11-10 both rules waited for attempts. LQ6 then stopped ringing a lead whose own answer fails a
 * hard requirement (`leadSink.ts`) — rightly — so nobody calls those leads, and a campaign delivering nothing
 * else never reached ten attempts: the alert was blind to exactly the campaign it exists for. One setting still
 * holds the sample size; what it counts follows the rule's denominator.
 */
export interface LeadQualityCounts {
  campaign_id: string;
  leads: number;
  attempted: number;
  wrong_number: number;
  reached: number;
  not_qualified: number;
  median_first_attempt_minutes: number | null;
}

export interface LeadQuality {
  /** Per ads campaign, every ad lead of this org that arrived at or after `since` (an ISO instant). */
  qualitySince(orgId: string, since: string): Promise<LeadQualityCounts[]>;
}

export const LEAD_QUALITY_RULES = ["wrong_numbers", "not_qualified"] as const;
export type LeadQualityRule = (typeof LEAD_QUALITY_RULES)[number];

export interface LeadQualityBreach {
  campaign_id: string;
  rule: LeadQualityRule;
  /** Whole percent measured, and the threshold it reached. */
  measured_pct: number;
  threshold_pct: number;
  /** The counts behind the share, for the alert's words. */
  part: number;
  whole: number;
}

/** How many days of arrivals the alert judges: recent enough to be this campaign's present, long enough to count. */
export const LEAD_QUALITY_WINDOW_DAYS = 14;

const pct = (part: number, whole: number): number => (whole === 0 ? 0 : Math.round((part / whole) * 100));

export function leadQualityBreaches(rows: readonly LeadQualityCounts[], t: AdsLeadQuality): LeadQualityBreach[] {
  if (!t.enabled) return [];
  const out: LeadQualityBreach[] = [];
  for (const r of rows) {
    const wrong = pct(r.wrong_number, r.attempted);
    if (r.attempted >= t.min_attempted && wrong >= t.wrong_number_pct) out.push({ campaign_id: r.campaign_id, rule: "wrong_numbers", measured_pct: wrong, threshold_pct: t.wrong_number_pct, part: r.wrong_number, whole: r.attempted });
    const notQ = pct(r.not_qualified, r.leads);
    if (r.leads >= t.min_attempted && notQ >= t.not_qualified_pct) out.push({ campaign_id: r.campaign_id, rule: "not_qualified", measured_pct: notQ, threshold_pct: t.not_qualified_pct, part: r.not_qualified, whole: r.leads });
  }
  return out;
}

/** The median of whole minutes, or null for none (the brief and the alert say "no call yet"). */
export function medianMinutes(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}
