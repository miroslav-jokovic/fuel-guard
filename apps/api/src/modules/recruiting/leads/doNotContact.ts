import type { SupabaseClient } from "@supabase/supabase-js";
import { isSuppressed, liftManualSuppression, suppressNumber } from "../smsSuppressions.js";

/**
 * "This person asked us not to contact them" (2026-11-03 lead-path audit H3). Before this, a lead who said
 * so on a call had nowhere to be recorded: `recruiting_contacts.outcome = 'declined'` means they declined
 * the job, and blocks nothing. The same person submitting the form again arrived as a fresh row, with no
 * sign of what they had said — and the TCPA reads revocation as "by any reasonable means" (since
 * 2025-04-11), a phone call included.
 *
 * The record is the number's, not the lead row's: a `manual` hold in `sms_suppressions` (0376), the list
 * every text path already asks first (`isSuppressed`). So one act covers every place the number turns up —
 * this lead, a re-submission, another channel's lead, and the applicant the lead became — and the queue
 * shows it on each (`leadQueue.ts`, `do_not_contact`). When the lead was converted, the hold names that
 * applicant, so their record shows it too (`applicantActivity.ts` reads suppressions by driver).
 *
 * ⚠ PHONE ONLY. A lead with only an email cannot be held here: email has no suppression list yet
 * (RECRUITER-AUTOMATION-PLAN 12.2, NEW). That is refused in words, not accepted and dropped.
 * ⚠ The hold also refuses a later "yes, text me" on the application page (C2d2's rule for any live
 * suppression) until the office lifts it — deliberately: a person who said "do not contact me" should
 * not start receiving texts because a link was sent to them.
 */

export type DoNotContactOutcome =
  | { kind: "held"; newly: boolean; applicant_id: string | null }
  | { kind: "lifted"; lifted: number; stop_remains: boolean }
  | { kind: "refused"; status: number; code: string; message: string };

async function leadPhone(admin: SupabaseClient, orgId: string, leadId: string): Promise<{ phone: string | null } | null> {
  const { data, error } = await admin
    .from("recruiting_leads").select("id, phone_e164").eq("org_id", orgId).eq("id", leadId).maybeSingle();
  if (error) throw new Error(`Could not read the lead: ${error.message}`);
  const row = data as { id: string; phone_e164: string | null } | null;
  return row ? { phone: row.phone_e164 } : null;
}

const NOT_FOUND = { kind: "refused", status: 404, code: "not_found", message: "Lead not found" } as const;
const NO_PHONE = {
  kind: "refused", status: 422, code: "no_phone",
  message: "This lead has no phone number to hold. An email address cannot be marked do-not-contact yet.",
} as const;

export async function markDoNotContact(admin: SupabaseClient, orgId: string, leadId: string): Promise<DoNotContactOutcome> {
  const lead = await leadPhone(admin, orgId, leadId);
  if (!lead) return NOT_FOUND;
  if (!lead.phone) return NO_PHONE;
  const { data, error } = await admin
    .from("lead_conversions").select("driver_id").eq("org_id", orgId).eq("lead_id", leadId).maybeSingle();
  if (error) throw new Error(`Could not read the lead's conversion: ${error.message}`);
  const applicant = (data as { driver_id: string } | null)?.driver_id ?? null;
  const newly = await suppressNumber(admin, orgId, applicant, lead.phone, "manual");
  return { kind: "held", newly, applicant_id: applicant };
}

export async function liftDoNotContact(admin: SupabaseClient, orgId: string, leadId: string, now: Date): Promise<DoNotContactOutcome> {
  const lead = await leadPhone(admin, orgId, leadId);
  if (!lead) return NOT_FOUND;
  if (!lead.phone) return NO_PHONE;
  const lifted = await liftManualSuppression(admin, orgId, lead.phone, now);
  return { kind: "lifted", lifted, stop_remains: await isSuppressed(admin, orgId, lead.phone) };
}
