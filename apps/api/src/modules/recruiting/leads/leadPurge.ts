import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "../../../lib/audit.js";

/**
 * Deleting a lead's personal details on request (2026-11-03 lead-path audit H2) — the reader of 0558's
 * `purge_lead`, which empties the lead and leaves an anonymous tombstone (its header has why a tombstone and
 * not a delete: the channel would re-import the person, and the contacts are evidence).
 *
 * ── THE ORDER ─────────────────────────────────────────────────────────────────────────────────────
 *  1. Read the lead, org-scoped, before anything is emptied — with `same_person`, its phone and email are
 *     what find the person's other leads, and after the purge they are gone.
 *  2. Purge the lead asked for. Its refusals are 0558's, mapped to a sentence, never re-derived here.
 *  3. With `same_person`, every other lead of this carrier with that phone or email that is not purged yet.
 *     One that became an applicant is skipped and NAMED (purge the applicant for that), never failed: the
 *     person asked for their details to go, and the rest still can.
 *  4. One `recruitment.lead_purged` audit row per lead emptied: ids and counts, never a detail.
 */

const REFUSALS: Record<string, { status: number; code: string; message: string }> = {
  RL040: { status: 404, code: "not_found", message: "Lead not found" },
  RL041: { status: 409, code: "became_applicant", message: "This lead became an applicant. Delete the applicant instead; that removes the lead with them." },
  RL042: { status: 403, code: "forbidden", message: "Only an admin can delete a lead's details." },
};

export interface LeadPurgeResult {
  purged: string[];
  already: string[];
  /** Other leads of the same person that became applicants: purge the applicant for those. */
  skipped_applicants: string[];
}

export type LeadPurgeOutcome = { ok: true; result: LeadPurgeResult } | { ok: false; status: number; code: string; message: string };

type PurgeAnswer = { purged: boolean; already: boolean; verdicts_deleted: number; contacts_kept: number };

export async function purgeLead(
  admin: SupabaseClient,
  ask: { orgId: string; actorId: string; leadId: string; samePerson: boolean },
): Promise<LeadPurgeOutcome> {
  const { data, error } = await admin
    .from("recruiting_leads").select("id, phone_e164, email_lower").eq("org_id", ask.orgId).eq("id", ask.leadId).maybeSingle();
  if (error) throw new Error(`Could not read the lead: ${error.message}`);
  const lead = data as { id: string; phone_e164: string | null; email_lower: string | null } | null;
  if (!lead) return { ok: false, ...REFUSALS.RL040! };

  const others = ask.samePerson ? await samePersonLeads(admin, ask.orgId, lead) : [];
  const result: LeadPurgeResult = { purged: [], already: [], skipped_applicants: [] };
  for (const id of [lead.id, ...others]) {
    const { data: answer, error: pe } = await admin.rpc("purge_lead", { p_org: ask.orgId, p_lead: id, p_actor: ask.actorId });
    if (pe) {
      const code = (pe as { code?: string }).code ?? "";
      if (id !== lead.id && code === "RL041") {
        result.skipped_applicants.push(id);
        continue;
      }
      const refusal = REFUSALS[code];
      if (refusal && id === lead.id) return { ok: false, ...refusal };
      throw new Error(`purge_lead failed: ${pe.message}`);
    }
    const a = answer as PurgeAnswer;
    if (a.already) {
      result.already.push(id);
      continue;
    }
    result.purged.push(id);
    await writeAudit(admin, {
      orgId: ask.orgId, actorId: ask.actorId, action: "recruitment.lead_purged", entity: "recruiting_leads", entityId: id,
      meta: { verdictsDeleted: a.verdicts_deleted, contactsKept: a.contacts_kept, ...(id === lead.id ? {} : { samePersonAs: lead.id }) },
    });
  }
  return { ok: true, result };
}

/** This carrier's other not-yet-purged leads with the same phone or email (D-LS10: phone or email only). */
async function samePersonLeads(admin: SupabaseClient, orgId: string, lead: { id: string; phone_e164: string | null; email_lower: string | null }): Promise<string[]> {
  const ids = new Set<string>();
  for (const [col, value] of [["phone_e164", lead.phone_e164], ["email_lower", lead.email_lower]] as const) {
    if (!value) continue;
    const { data, error } = await admin
      .from("recruiting_leads").select("id").eq("org_id", orgId).eq(col, value).is("purged_at", null).neq("id", lead.id).limit(200);
    if (error) throw new Error(`Could not read the person's other leads: ${error.message}`);
    for (const r of (data ?? []) as Array<{ id: string }>) ids.add(r.id);
  }
  return [...ids];
}
