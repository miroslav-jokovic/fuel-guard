import type { SupabaseClient } from "@supabase/supabase-js";
import { factsFor, leadFromPlatform, type LeadProjection, type LeadSink } from "@silvicom/shared";
import { readLeadVerdicts, recordLeadVerdicts } from "./verdicts.js";
import { ringNewLead, type ConfiguredRecipients } from "./leadNotify.js";
import { assignFromOpening } from "./leadAssignment.js";
import { suppressedPhones } from "../smsSuppressions.js";

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
 *
 * ── WHO A NEW LEAD RINGS (`newLeadBell`; LQ6, LR3, LR2 — ADS-AGENTS-AUDIT-2026-11-10 F-LR6, Q-AD74 (a)) ──
 * `lead_new` says "call this person". In this order, the first that holds decides:
 *   · nothing to dial (no usable phone, no e-mail)            → nobody (LR3);
 *   · the number is held from contact (`sms_suppressions`)    → nobody: the person asked not to be called, and
 *     the `lead_uncontacted` alarm already leaves them out for that reason (`leadUncontacted.ts`);
 *   · the person is a driver of this carrier today            → nobody: `ingest_lead` matched an active,
 *     un-archived driver by phone or e-mail. A terminated driver or a current applicant still rings — one is a
 *     rehire worth a call, the other is somebody the office is already working and should hear answered again;
 *   · their own answer fails a hard requirement               → nobody (LQ6, Q-AD63 (a));
 *   · an earlier lead is the same person                      → the usual people, told they answered AGAIN;
 *   · otherwise                                               → the usual `lead_new`.
 * In every case the lead is stored, owned, judged and listed: nothing here hides a row. A read that fails rings
 * anyway (`failsHardRequirement`'s rule, and the hold's below): a missed bell costs more than a false one, and
 * the queue still shows the hold beside the number before anybody dials.
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
      const contactable = projection.phone_e164 !== null || projection.email_lower !== null;
      if (r.stored === "new") {
        const owner = await assignFromOpening(admin, orgId, r.lead_id, projection.opening_id).catch((err: unknown) => {
          console.error(`[lead-assign] org ${orgId}: lead ${r.lead_id} left unowned: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        });
        // LQ6 (Q-AD63 (a)): a lead whose own answer fails a hard requirement is stored, owned and listed, but rings
        // nobody — the person told us, after the form's intro stated the requirement. `unknown` still rings (D-LS3).
        // LR3 (audit F-LR9): a lead with nothing to dial is also said by the road that stored it
        // (`alertNoContactDetail`) — the ads side's alert, since the fix is the form's.
        const bell = newLeadBell({
          contactable,
          held: contactable && (await numberIsHeld(admin, orgId, r.lead_id, projection.phone_e164)),
          matches: r.matches,
          failsHard: contactable && (await failsHardRequirement(admin, orgId, r.lead_id)),
        });
        if (bell !== "none") await ringNewLead(admin, orgId, r.lead_id, configured, owner, bell === "again");
      }
      return { stored: r.stored, ref: r.lead_id, contactable };
    },
  };
}

export type NewLeadBell = "none" | "new" | "again";

/** The header's table, as a pure function of what the sink already knows. */
export function newLeadBell(lead: { contactable: boolean; held: boolean; matches: LeadMatches | null | undefined; failsHard: boolean }): NewLeadBell {
  if (!lead.contactable || lead.held) return "none";
  if ((lead.matches?.drivers ?? []).some((d) => d.status === "active" && !d.archived)) return "none";
  if (lead.failsHard) return "none";
  return (lead.matches?.leads ?? []).length > 0 ? "again" : "new";
}

/** Whether the lead's phone is held from contact for this carrier, any reason. A read that fails says no. */
async function numberIsHeld(admin: SupabaseClient, orgId: string, leadId: string, phone: string | null): Promise<boolean> {
  if (phone === null) return false;
  try {
    return (await suppressedPhones(admin, orgId, [phone])).has(phone);
  } catch (err) {
    console.error(`[lead-notify] org ${orgId}: lead ${leadId} hold unreadable, ringing anyway: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
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
