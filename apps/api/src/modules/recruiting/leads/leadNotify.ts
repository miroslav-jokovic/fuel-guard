import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdsAlertCategory, AdsLeadCallAlert, NotificationSeverity } from "@silvicom/shared";
import { notify } from "../../messaging/index.js";
import { sectionManagerIds } from "../../org/index.js";

/**
 * `lead_new` (workflow D2b): a person answered an ad, and the first call is worth most in the first minutes.
 *
 * Who hears it: the carrier's list (`alerts.recipients.lead_new`, handed in because that setting is the ads
 * module's), else everybody who holds recruitment manage, derived from the access matrix so a role granted
 * or taken away on the Permissions page changes this too. View-only holders are left out: this asks a person
 * to pick up the phone, and they could not record it (D2a's door is manage).
 *
 * ⚠ NO ASSIGNEE TIER. The plan says "the assigned recruiter", but nothing writes `assigned_to` yet and a lead
 * stored a moment ago cannot have one. `lead_uncontacted` (D2c) is the alert an assignee can matter to.
 *
 * ⚠ A FAILURE HERE NEVER FAILS THE INGEST (`notify()`'s rule). The lead is stored by now, and a throw would
 * have the job retry a lead the sink then reads as a duplicate, which rings nobody either. So a lost ring
 * stays lost here; the lead is still in the queue, and `lead_uncontacted` is the second chance.
 *
 * The bell item and its push name no person: a phone's lock screen is not hiring's audience. The lead's id
 * rides on it, and the deep link arrives with the queue screen (E4).
 */

export type ConfiguredRecipients = (orgId: string, category: AdsAlertCategory) => Promise<string[]>;

type LeadAlert = { category: AdsLeadCallAlert; title: string; body: string; severity: NotificationSeverity };

async function recipients(admin: SupabaseClient, orgId: string, category: LeadAlert["category"], configured: ConfiguredRecipients): Promise<string[]> {
  const chosen = await configured(orgId, category);
  return chosen.length > 0 ? chosen : sectionManagerIds(admin, orgId, "recruitment");
}

/** The dedupe key of a lead's alert: one bell item per lead per category, per person. */
export const leadAlertKey = (category: LeadAlert["category"], leadId: string): string => `${category}:${leadId}`;

export async function ringLead(admin: SupabaseClient, orgId: string, leadId: string, alert: LeadAlert, configured: ConfiguredRecipients): Promise<void> {
  try {
    const users = await recipients(admin, orgId, alert.category, configured);
    if (users.length === 0) console.error(`[lead-notify] org ${orgId}: lead ${leadId} has nobody to tell — nobody holds recruitment manage`);
    await Promise.all(users.map((userId) => notify(admin, {
      orgId, userId, ...alert, entityType: "recruiting_leads", entityId: leadId, dedupeKey: leadAlertKey(alert.category, leadId),
    })));
  } catch (err) {
    console.error(`[lead-notify] org ${orgId}: lead ${leadId} rang nobody: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * `lead_new`. With an owner (LQ2b, Q-AD50 (a): the opening's recruiter, already checked against the access
 * matrix by `leadAssignment.ts`), only the owner is rung — a lead everybody is told about is a lead nobody in
 * particular calls. Without one, the carrier's list or the recruitment managers, as before. The escalation
 * (`lead_uncontacted`) still goes to the whole list: it is the second chance when the owner did not call.
 */
export const ringNewLead = (admin: SupabaseClient, orgId: string, leadId: string, configured: ConfiguredRecipients, owner: string | null = null): Promise<void> =>
  ringLead(admin, orgId, leadId, owner
    ? { category: "lead_new", title: "New lead for your opening", severity: "info", body: "A new lead for an opening you own is waiting for your first call." }
    : { category: "lead_new", title: "New ad lead", severity: "info", body: "A new lead is in the queue, waiting for a first contact." },
  owner ? async () => [owner] : configured);
