import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadContactInput, LeadStatus } from "@silvicom/shared";

/**
 * Writing down a call, text or email a person made to a lead (D2a) — the first writer of
 * `recruiting_contacts` (0553). The row is evidence (D-RA12: contacts are evidence, a lead is not), so it is
 * append-only and a correction is a second row; nothing here sends anything (D-LS6).
 *
 * ── THE ORDER ─────────────────────────────────────────────────────────────────────────────────────
 *  1. Read the lead, org-scoped. A purged lead is refused: its details were deleted on request, and a note
 *     typed against the tombstone would put them back where `purge_lead` cannot reach (the row is append-only).
 *  2. Insert the contact.
 *  3. Move `new → contacted`, on the condition that the lead is still `new`. The contact goes FIRST because
 *     the other failure is the worse one: a lead marked contacted with no record of anybody contacting it
 *     would drop out of `lead_uncontacted` (D2c) silently, where a contact on a lead still `new` is visible
 *     and the next contact moves it. The condition is what keeps a later status from being walked back: a
 *     lead already qualified, converted or lost takes the contact and keeps its status, and a conversion
 *     landing between steps 1 and 3 is not overwritten.
 *
 * ⚠ Every contact moves a `new` lead, a `no_answer` included: the status answers "has anybody tried", which
 * is what the uncontacted alarm asks. Whether they were reached is the row's `outcome`.
 */

export type LeadContactOutcome =
  | { kind: "logged"; contact_id: string; status: LeadStatus }
  | { kind: "refused"; status: number; code: string; message: string };

export async function logLeadContact(
  admin: SupabaseClient,
  orgId: string,
  actor: { userId: string; name: string },
  leadId: string,
  input: LeadContactInput,
  now: Date,
): Promise<LeadContactOutcome> {
  const { data, error } = await admin
    .from("recruiting_leads").select("id, status, purged_at").eq("org_id", orgId).eq("id", leadId).maybeSingle();
  if (error) throw new Error(`Could not read the lead: ${error.message}`);
  const lead = data as { id: string; status: LeadStatus; purged_at: string | null } | null;
  if (!lead) return { kind: "refused", status: 404, code: "not_found", message: "Lead not found" };
  if (lead.purged_at) {
    return { kind: "refused", status: 409, code: "lead_purged", message: "This lead's details were deleted, so nothing more can be recorded on it." };
  }

  const { data: contact, error: ce } = await admin
    .from("recruiting_contacts")
    .insert({
      org_id: orgId, lead_id: leadId, direction: input.direction, method: input.method, outcome: input.outcome,
      note: input.note, created_by: actor.userId, created_by_name: actor.name, contacted_at: now.toISOString(),
    })
    .select("id")
    .single();
  if (ce) throw new Error(`Could not record the contact: ${ce.message}`);

  const { data: moved, error: me } = await admin
    .from("recruiting_leads")
    .update({ status: "contacted", updated_at: now.toISOString() })
    .eq("org_id", orgId).eq("id", leadId).eq("status", "new")
    .select("status");
  if (me) throw new Error(`Could not mark the lead contacted: ${me.message}`);
  // No row moved means the lead was past `new`, or another request moved it first; the contact stands either way.
  const status = (moved as Array<{ status: LeadStatus }> | null)?.[0]?.status ?? lead.status;
  return { kind: "logged", contact_id: (contact as { id: string }).id, status };
}
