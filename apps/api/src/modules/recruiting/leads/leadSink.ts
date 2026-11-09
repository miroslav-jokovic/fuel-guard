import type { SupabaseClient } from "@supabase/supabase-js";
import { factsFor, leadFromPlatform, type LeadProjection, type LeadSink } from "@silvicom/shared";
import { readLeadVerdicts, recordLeadVerdicts } from "./verdicts.js";
import { ringNewLead, type ConfiguredRecipients } from "./leadNotify.js";
import { assignFromOpening } from "./leadAssignment.js";

/**
 * Recruiting's `LeadSink` (D-AD17; ADS-AGENT-BUILD-WORKFLOW.md D1): the one door every lead comes in by,
 * whatever brought it — a platform form through the ads module (B4), or a recruiter typing in a call.
 *
 * `ingest_lead` (0554) stores the lead once per (org, channel, ref) and says who else it may be; this adds
 * the verdicts. It THROWS when the store fails: the caller is a webhook or a backfill that must retry, and a
 * lead reported as accepted that was not stored is the one failure §4R's Lead intake row forbids ("0 lost").
 *
 * `accept` also rings `lead_new` on a lead stored for the first time (`leadNotify.ts`). That is here and not
 * in `ingestLead` because a lead a recruiter typed in goes through `ingestLead` too, and that person already
 * knows about it.
 *
 * LQ2b (Q-AD50 (a)): before ringing, a new platform lead is given its opening's recruiter
 * (`leadAssignment.ts`), and the ring goes to that one person. Like the ring, an assignment that fails never
 * fails the accept: the lead is stored by then, and a throw would have the job retry a lead the sink reads as a
 * duplicate — assigned to nobody AND rung to nobody. So a failed assignment is logged and the lead rings
 * everybody, as an unowned one does. A lead a recruiter typed in is not assigned here: the plan's rule is about
 * ad leads arriving with nobody watching, and who owns a typed-in lead was not part of the ruling.
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
  const asOf = isoDate(now);
  await recordLeadVerdicts(admin, orgId, result.lead_id, projection.opening_id, factsFor(projection.channel, projection.answers, asOf), asOf);
  return result;
}

export function recruitingLeadSink(
  admin: SupabaseClient,
  configured: ConfiguredRecipients,
  clock: () => Date = () => new Date(),
): LeadSink {
  return {
    async accept(orgId, lead) {
      const projection = leadFromPlatform(lead);
      const r = await ingestLead(admin, orgId, projection, clock());
      if (r.stored === "new") {
        const owner = await assignFromOpening(admin, orgId, r.lead_id, projection.opening_id).catch((err: unknown) => {
          console.error(`[lead-assign] org ${orgId}: lead ${r.lead_id} left unowned: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        });
        // LQ6 (Q-AD63 (a)): a lead whose own answer fails a hard requirement is stored, owned and listed, but rings
        // nobody — the person told us, after the form's intro stated the requirement. `unknown` still rings (D-LS3).
        if (!(await failsHardRequirement(admin, orgId, r.lead_id))) await ringNewLead(admin, orgId, r.lead_id, configured, owner);
      }
      return { stored: r.stored, ref: r.lead_id, contactable: projection.phone_e164 !== null || projection.email_lower !== null };
    },
  };
}

/**
 * Whether the lead's own answers already fail a hard requirement (`summariseLeadMatch().hardUnmet > 0`): the
 * reading the queue shows and the quality alert counts (`leadQuality.ts`), so the bells can never be quieter than
 * the queue is loud. A read that fails rings anyway — a missed bell costs more than a false one.
 */
export async function failsHardRequirement(admin: SupabaseClient, orgId: string, leadId: string): Promise<boolean> {
  try {
    return ((await readLeadVerdicts(admin, orgId, [leadId])).get(leadId)?.summary.hardUnmet ?? 0) > 0;
  } catch (err) {
    console.error(`[lead-notify] org ${orgId}: lead ${leadId} verdicts unreadable, ringing anyway: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
