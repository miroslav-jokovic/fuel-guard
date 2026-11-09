import type { LeadFacts } from "../leadMatch.js";

/**
 * What Indeed Apply's screener answers say (LQ7; the listener is the Indeed Apply step, after this). The
 * carrier's screeners today (Joanna, 2026-11-06): years of OTR experience, willing to stay out 3 weeks, hazmat.
 *
 * ── MAPPED BY QUESTION ID, NEVER BY PROMPT TEXT (D-TS9's rule, generalised) ──────────────────────
 * `INDEED_SCREENER_IDS` names the question ids our Job Sync posting will carry (the posting is built from our
 * catalogue, so the ids are ours). An answer under an id not listed is left in `unmapped`, for a person to see.
 *
 * ── Q-AD67: "YEARS OF OTR" IS NOT "YEARS OF CLASS A" ─────────────────────────────────────────────
 * Ruled rec (a) 2026-11-09: the screener is changed to ask Class A years when the posting is built from our
 * catalogue; until then an OTR-years answer is kept `unmapped`, not read as Class A experience — the rules
 * would otherwise judge a fact the person was not asked.
 *
 * ── "3 WEEKS" IS 21 DAYS ─────────────────────────────────────────────────────────────────────────
 * Indeed screeners are yes/no or a number. The home-time screener is yes/no ("willing to stay on the road for
 * 3 weeks?"), so a yes is `willing_days_out = HOME_TIME_SCREENER_DAYS` and a no is 0 — the person said how
 * long, not how short. The posting's question text and this constant are one fact: both come from the
 * opening's `home_time.min_days_out` when the Job Sync posting is built (that step reads it from here).
 */
export const INDEED_SCREENER_IDS = {
  class_a_held: "class_a_held",
  class_a_years: "class_a_years",
  hazmat_endorsement: "hazmat_endorsement",
  home_time_ok: "home_time_ok",
} as const;
export const HOME_TIME_SCREENER_DAYS = 21;

const yesNo = (v: string | undefined): boolean | null => {
  const t = (v ?? "").trim().toLowerCase();
  return t === "yes" || t === "y" || t === "true" ? true : t === "no" || t === "n" || t === "false" ? false : null;
};

export interface IndeedFactsResult { facts: LeadFacts; unmapped: string[] }

export function indeedFacts(answers: Record<string, string>, daysOut: number = HOME_TIME_SCREENER_DAYS): IndeedFactsResult {
  const facts: LeadFacts = {};
  const unmapped: string[] = [];
  for (const [id, raw] of Object.entries(answers)) {
    switch (id) {
      case INDEED_SCREENER_IDS.class_a_held: {
        const v = yesNo(raw);
        if (v !== null) facts.class_a_held = { value: v, evidence: "self_reported" };
        else unmapped.push(id);
        break;
      }
      case INDEED_SCREENER_IDS.hazmat_endorsement: {
        const v = yesNo(raw);
        if (v !== null) facts.hazmat_endorsement = { value: v, evidence: "self_reported" };
        else unmapped.push(id);
        break;
      }
      case INDEED_SCREENER_IDS.home_time_ok: {
        const v = yesNo(raw);
        if (v !== null) facts.willing_days_out = { value: v ? daysOut : 0, evidence: "self_reported" };
        else unmapped.push(id);
        break;
      }
      case INDEED_SCREENER_IDS.class_a_years: {
        // A whole number of years; "5+" and "5 or more" read as 5 with no upper bound.
        const m = /^\s*(\d{1,2})\s*(\+|or more)?\s*(years?)?\s*$/i.exec(raw);
        if (m) {
          const n = Number(m[1]);
          facts.class_a_years = { value: m[2] ? { lower: n, upper: null, upperInclusive: false } : { lower: n, upper: n, upperInclusive: true }, evidence: "self_reported" };
        } else unmapped.push(id);
        break;
      }
      default:
        unmapped.push(id);
    }
  }
  return { facts, unmapped };
}
