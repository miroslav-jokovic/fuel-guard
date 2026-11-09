import { z } from "zod";
import { recordId } from "../recordId.js";

/**
 * Which stages an ad lead reached, and when — the seam between recruiting and ads that Q-AD34 asked for
 * (ADS-AGENT-PLAN §9; ruled 2026-11-05 by the orchestrator: a recruiting-owned interface, injected). D-AD17
 * lets ads reach recruiting only through interfaces recruiting implements (`AdBriefSource`, `LeadSink`);
 * this is the third. Recruiting implements it over its own rows (`recruiting/leads/leadOutcomes.ts`), the
 * composition root hands it in, and ads never reads a recruiting table. The Analyst's cohort report reads it
 * now; B6's outcome feed will read the same interface when it is built.
 *
 * ── ONLY WHAT IS RECORDED, UNDER ITS TRUE NAME (Q-AD37, ruled 2026-11-05: (b)+(c)) ───────────────
 * A stage is here only if a row records it:
 *   contacted               the lead's first contact, attempted or reached (`recruiting_contacts`)
 *   qualified               a recruiter's positive verdict after a reached call (`recruiting_lead_closures`,
 *                           kind `qualified`; 0578, Q-AD64 (a)) — D-AD14's "a recruiter's confirmation"
 *   not_qualified           a recruiter closed the lead for a named requirement (`recruiting_lead_closures`,
 *                           kind `closed`, status `not_qualified`); the same act writes a verified verdict
 *   converted               a recruiter made the lead an applicant (`lead_conversions`)
 *   applied                 that applicant filed the application (`driver_applications.certified_at`)
 *   hired                   that applicant was hired (`drivers.hire_date`, set only by `hire_applicant`)
 *   lost_before_conversion  a recruiter closed the lead for any other reason — not interested, unreachable,
 *                           wrong number, duplicate, out of area, spam (`recruiting_lead_closures`, status `lost`)
 *   lost_after_conversion   the application ended without a hire (`applicant_dispositions`)
 *
 * `qualified` and `lost_before_conversion` had NO writer until 0578 (LQ5a, 2026-11-09) and were carried as
 * `not_recorded`, never 0, so the brief could not say "no lead was ever qualified" about a figure nobody
 * measured. `UNRECORDED_LEAD_STAGES` is now empty; the machinery stays, so a future stage without a writer is
 * carried the same way rather than as a zero. Every reader — the cohort fold, the brief, the outcome feed, the
 * settings screen — learns the lists from here (Q-AD39, 0570/0580: the database CHECK is held to this list).
 */
export const LEAD_OUTCOME_STAGES = [
  "contacted", "qualified", "not_qualified", "converted", "applied", "hired", "lost_before_conversion", "lost_after_conversion",
] as const;
export type LeadOutcomeStage = (typeof LEAD_OUTCOME_STAGES)[number];

export const UNRECORDED_LEAD_STAGES = [] as const;
export type UnrecordedLeadStage = (typeof UNRECORDED_LEAD_STAGES)[number];

/** The marker a stage with no writer carries wherever a count would stand. */
export const NOT_RECORDED = "not_recorded" as const;

const instant = z.iso.datetime({ offset: true });

export const leadOutcomeSchema = z.object({
  lead_id: recordId(),
  /** The ads campaign the lead came from (`recruiting_leads.campaign_ref`, as the platform named it). */
  campaign_id: z.string().trim().min(1).max(200),
  /**
   * Which platform the lead came from and the platform's own id for it (`recruiting_leads.channel` /
   * `external_ref`, as `leadFromPlatform` stored them). The outcome feed (B6) sends a stage back under that id
   * (Meta's `user_data.lead_id`); Q-AD39 added both, add-only, ruled 2026-11-06.
   */
  provider: z.string().trim().min(1).max(40),
  platform_lead_ref: z.string().trim().min(1).max(200),
  /** When the lead arrived: the platform's time when it gave one, else when we received it. */
  arrived_at: instant,
  /** When each recorded stage was first reached; a stage not reached is absent. */
  reached: z.partialRecord(z.enum(LEAD_OUTCOME_STAGES), instant),
}).strict();
export type LeadOutcome = z.infer<typeof leadOutcomeSchema>;

/** Recruiting implements this (D-AD17); ads is handed it at the composition root. */
export interface LeadOutcomes {
  /** Every lead that came from an ad campaign and arrived at or after `since` (an ISO instant), this org's only. */
  outcomesSince(orgId: string, since: string): Promise<LeadOutcome[]>;
}
