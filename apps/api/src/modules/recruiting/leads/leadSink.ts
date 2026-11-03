import type { SupabaseClient } from "@supabase/supabase-js";
import { leadFromPlatform, type LeadProjection, type LeadSink } from "@silvicom/shared";
import { recordLeadVerdicts } from "./verdicts.js";

/**
 * Recruiting's `LeadSink` (D-AD17; ADS-AGENT-BUILD-WORKFLOW.md D1): the one door every lead comes in by,
 * whatever brought it — a platform form through the ads module (B4), or a recruiter typing in a call.
 *
 * `ingest_lead` (0554) stores the lead once per (org, channel, ref) and says who else it may be; this adds
 * the verdicts. It THROWS when the store fails: the caller is a webhook or a backfill that must retry, and a
 * lead reported as accepted that was not stored is the one failure §4R's Lead intake row forbids ("0 lost").
 */

export interface LeadMatches {
  leads: Array<{ id: string; channel: string; status: string; received_at: string }>;
  drivers: Array<{ id: string; status: string; archived: boolean }>;
}
export interface IngestResult {
  lead_id: string;
  stored: "new" | "duplicate";
  matches: LeadMatches;
}

/** Today's calendar date in UTC, the `asOf` leadMatch needs (it holds no clock of its own). */
export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

export async function ingestLead(
  admin: SupabaseClient,
  orgId: string,
  projection: LeadProjection,
  now: Date,
): Promise<IngestResult> {
  const { data, error } = await admin.rpc("ingest_lead", { p_org: orgId, p_lead: projection });
  if (error || !data) throw new Error(`ingest_lead failed: ${error?.message ?? "no answer"}`);
  const result = data as IngestResult;
  // Also on a duplicate: a retry after a crash between the store and the verdicts heals them, and a retry
  // after both is a no-op (`recordLeadVerdicts`).
  await recordLeadVerdicts(admin, orgId, result.lead_id, projection.opening_id, projection.answers, isoDate(now));
  return result;
}

export function recruitingLeadSink(admin: SupabaseClient, clock: () => Date = () => new Date()): LeadSink {
  return {
    async accept(orgId, lead) {
      const r = await ingestLead(admin, orgId, leadFromPlatform(lead), clock());
      return { stored: r.stored, ref: r.lead_id };
    },
  };
}
