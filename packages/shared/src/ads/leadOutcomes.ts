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
 *   contacted              the lead's first contact, attempted or reached (`recruiting_contacts`)
 *   converted              a recruiter made the lead an applicant (`lead_conversions`) — NOT "qualified":
 *                          converting is the only deliberate act on a lead the product records
 *   applied                that applicant filed the application (`driver_applications.certified_at`)
 *   hired                  that applicant was hired (`drivers.hire_date`, set only by `hire_applicant`)
 *   lost_after_conversion  the application ended without a hire (`applicant_dispositions`)
 *
 * Two stages a recruiter would name have NO writer anywhere, and are carried as `not_recorded`, never 0:
 *   qualified               D-AD14's "a recruiter's confirmation" — nothing records that confirmation
 *   lost_before_conversion  a lead closed before it became an applicant — nothing records the close
 * A 0 would be a figure the fold did not measure; the brief would then say no lead was ever qualified.
 * Recording them is recruiting's backlog (Q-AD37 (a), needs a migration); when it lands, a stage moves from
 * the second list to the first and every reader learns it from here.
 */

export const LEAD_OUTCOME_STAGES = ["contacted", "converted", "applied", "hired", "lost_after_conversion"] as const;
export type LeadOutcomeStage = (typeof LEAD_OUTCOME_STAGES)[number];

export const UNRECORDED_LEAD_STAGES = ["qualified", "lost_before_conversion"] as const;
export type UnrecordedLeadStage = (typeof UNRECORDED_LEAD_STAGES)[number];

/** The marker a stage with no writer carries wherever a count would stand. */
export const NOT_RECORDED = "not_recorded" as const;

const instant = z.iso.datetime({ offset: true });

export const leadOutcomeSchema = z.object({
  lead_id: recordId(),
  /** The ads campaign the lead came from (`recruiting_leads.campaign_ref`, as the platform named it). */
  campaign_id: z.string().trim().min(1).max(200),
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
