import type { SupabaseClient } from "@supabase/supabase-js";
import { sectionManagerIds } from "../../org/index.js";

/**
 * A new lead's owner, from its opening (ADS-LEAD-QUALITY-PLAN LQ2b; 0574; Q-AD50 (a)).
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────────────────
 * A lead for an opening that names a recruiter is that recruiter's (`recruiting_leads.assigned_to`, 0553 —
 * written for the first time here). It is asked of the access matrix at the moment the lead arrives: a
 * recruiter whose `recruitment: manage` grant was taken away since the opening named them is NOT assigned,
 * and the lead rings everybody, as an opening with no recruiter does. Nobody has to remember to edit the
 * opening when a person changes role (CLAUDE.md, "Deriving beats restating").
 *
 * ── ONLY AN UNOWNED LEAD ─────────────────────────────────────────────────────────────────────────
 * The UPDATE carries `assigned_to is null`, so a lead somebody already took is never taken back, and a
 * webhook retried after the assignment is a no-op. The caller runs this only for a lead stored NEW: a
 * duplicate delivery of a known lead keeps whoever owns it.
 *
 * Returns the owner, or null when the lead stays everybody's.
 */
export async function assignFromOpening(admin: SupabaseClient, orgId: string, leadId: string, openingId: string | null): Promise<string | null> {
  if (!openingId) return null;
  const { data, error } = await admin.from("recruiting_openings").select("recruiter_id").eq("org_id", orgId).eq("id", openingId).maybeSingle();
  if (error) throw new Error(`Could not read the lead's opening: ${error.message}`);
  const recruiter = (data as { recruiter_id: string | null } | null)?.recruiter_id ?? null;
  if (!recruiter) return null;
  if (!(await sectionManagerIds(admin, orgId, "recruitment")).includes(recruiter)) return null;
  const { data: updated, error: uErr } = await admin
    .from("recruiting_leads").update({ assigned_to: recruiter }).eq("org_id", orgId).eq("id", leadId).is("assigned_to", null)
    .select("assigned_to").maybeSingle();
  if (uErr) throw new Error(`Could not assign the lead: ${uErr.message}`);
  return (updated as { assigned_to: string } | null)?.assigned_to ?? null;
}
