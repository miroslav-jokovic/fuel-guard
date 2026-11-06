import { isRecordId, OUTCOME_STAGES, type LeadOutcome, type OutcomeStage } from "@silvicom/shared";

/**
 * The outcome feed's pure half (B6; D-AD14; Q-AD39, ruled 2026-11-06): which stage events a lead's recorded
 * outcomes make, and the Conversions API event each one becomes. No clock of its own, no database.
 *
 * ── WHAT META SAYS, READ 2026-11-06 ──────────────────────────────────────────────────────────────
 *   · A CRM ("Conversion Leads") event is `{ event_name, event_time, user_data: { lead_id }, action_source:
 *     "system_generated", custom_data: { lead_event_source, event_source: "crm" } }`; `lead_id` is the 15–17 digit
 *     Meta lead id, sent unhashed. https://developers.facebook.com/documentation/ads-commerce/conversions-api/guides/conversions-api-crm-for-platforms
 *   · "The `event_time` can be up to 7 days before you send an event", and if any event in a request is older,
 *     "we return an error for the entire request and process no events". The CRM guide: "backfill … up to 7 days";
 *     events before the lead's own time "may be discarded".
 *     https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event
 *   · 28 days is NOT a send limit: the CRM guide asks for a stage reached "within 28 days of leads being
 *     generated" as the stage to OPTIMISE for (D-AD14's 1–40 % rule). A stage reached later is still sent.
 *     https://developers.facebook.com/docs/marketing-api/conversions-api/conversion-leads-integration
 *   · `event_id` dedups "the same `event_id` and `event_name`", keeping the first, within 48 hours
 *     (server-event page). So Meta's own dedup is a short net. OUR ledger's unique
 *     `(org_id, provider, source_event_ref)` is the one that holds for good.
 *
 * ── OUR READINGS, FOR L4 TO CHECK AGAINST THE SANDBOX ────────────────────────────────────────────
 *   · `lead_id` is sent as a STRING: a 17-digit id exceeds JavaScript's exact integers (2^53 ≈ 9.0e15), and
 *     Meta's sample prints a number. Whether the endpoint accepts the string is the sandbox's answer.
 *   · `event_id` = `<our lead id>:<stage>` (accepted by the orchestrator 2026-11-06), not a stage row's id. A
 *     stage is "first reached", and the earliest contact row can change when an earlier contact is back-dated.
 *     A row-based id would then change and send the stage twice.
 *   · `event_name` is our stage name as it stands (`converted`, never "qualified": Q-AD37). The CRM guide
 *     uses free names ("my lead stage") that the advertiser maps in Events Manager.
 *
 * D-AD14: the event carries nothing beyond the lead id and the stage. No hashed contact field is sent
 * (Q-AD8 keeps that for counsel).
 */

export const CAPI_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
/** Who Meta is told the leads' stages come from (`custom_data.lead_event_source`, the CRM's name). */
export const LEAD_EVENT_SOURCE = "Silvicom 360";
/** Meta's limit on one request ("up to 1,000 events in `data`", using-the-api page). */
export const CAPI_MAX_BATCH = 1000;

export const outcomeEventRef = (leadId: string, stage: OutcomeStage): string => `${leadId}:${stage}`;

/** One stage a lead reached, as the ledger holds it, plus the time it is sent with (not a ledger column). */
export interface OutcomeCandidate {
  source_event_ref: string;
  provider: "meta";
  platform_lead_ref: string;
  stage: OutcomeStage;
  /** Our campaign when the lead names one we hold (`campaign_ref` is a record id for an ad lead), else null. */
  campaign_id: string | null;
  /** When the stage was reached, never before the lead arrived (the CRM guide: earlier events "may be discarded"). */
  event_time: string;
}

/**
 * Every recorded stage of every Meta lead, one candidate each. Only the stages a row records (`OUTCOME_STAGES`,
 * derived from Q-AD37's list), so a `not_recorded` stage can never be a candidate. A lead from another platform
 * is not Meta's to hear about.
 */
export function outcomeCandidates(outcomes: readonly LeadOutcome[]): OutcomeCandidate[] {
  const out: OutcomeCandidate[] = [];
  for (const o of outcomes) {
    if (o.provider !== "meta") continue;
    for (const stage of OUTCOME_STAGES) {
      const at = o.reached[stage];
      if (at === undefined) continue;
      const event_time = new Date(Math.max(Date.parse(at), Date.parse(o.arrived_at))).toISOString();
      out.push({
        source_event_ref: outcomeEventRef(o.lead_id, stage), provider: "meta", platform_lead_ref: o.platform_lead_ref,
        stage, campaign_id: isRecordId(o.campaign_id) ? o.campaign_id : null, event_time,
      });
    }
  }
  return out;
}

/** Older than Meta takes: sending it would refuse the whole request, so it is recorded as skipped instead. */
export const tooOldToSend = (eventTime: string, now: Date): boolean => now.getTime() - Date.parse(eventTime) > CAPI_MAX_AGE_MS;

export interface CapiEvent {
  event_name: OutcomeStage;
  event_time: number;
  event_id: string;
  action_source: "system_generated";
  user_data: { lead_id: string };
  custom_data: { event_source: "crm"; lead_event_source: string };
}

export function capiEvent(c: Pick<OutcomeCandidate, "source_event_ref" | "platform_lead_ref" | "stage" | "event_time">): CapiEvent {
  return {
    event_name: c.stage,
    event_time: Math.floor(Date.parse(c.event_time) / 1000),
    event_id: c.source_event_ref,
    action_source: "system_generated",
    user_data: { lead_id: c.platform_lead_ref },
    custom_data: { event_source: "crm", lead_event_source: LEAD_EVENT_SOURCE },
  };
}
