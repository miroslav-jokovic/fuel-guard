import type { SupabaseClient } from "@supabase/supabase-js";
import { isTicket, type RoadsideCitationAction } from "@silvicom/shared";
import { writeAudit } from "../../../lib/audit.js";
import type { DbError } from "../read/inspectionsList.js";
import { CITATION_ACTION_COLS, newestActs, type CitationActionRow } from "./read.js";

/**
 * The safety office's act on one roadside ticket (IC4, R-ADJ1; Q-IC2 (a)): asked the court for its certified
 * result, with a day to follow up — or the ticket was not contested. Written to the append-only
 * `inspection_citation_actions` (0489); the newest row is the state.
 *
 * Refused: a violation that is not on this inspection, or carries no ticket (a warning); and an act over a newer
 * one than the page showed (`basedOn`), so two people never overwrite each other unseen.
 */

export type CitationActOutcome =
  | { ok: true; id: string }
  | { ok: false; status: 404 | 409 | 422; code: string; message: string }
  | { error: DbError };

const refuse = (status: 404 | 409 | 422, code: string, message: string): CitationActOutcome => ({ ok: false, status, code, message });

export async function actOnCitation(
  admin: SupabaseClient,
  orgId: string,
  inspectionId: string,
  actorId: string,
  input: RoadsideCitationAction,
): Promise<CitationActOutcome> {
  const [violation, acts] = await Promise.all([
    admin.from("roadside_violations").select("id, citation_number").eq("org_id", orgId).eq("inspection_id", inspectionId)
      .eq("id", input.violationId).is("vanished_at", null).maybeSingle(),
    admin.from("inspection_citation_actions").select(CITATION_ACTION_COLS).eq("org_id", orgId).eq("inspection_id", inspectionId).eq("violation_id", input.violationId),
  ]);
  if (violation.error) return { error: violation.error };
  if (acts.error) return { error: acts.error };
  const v = violation.data as { id: string; citation_number: string | null } | null;
  if (!v) return refuse(404, "not_found", "That violation is not on this inspection.");
  if (!isTicket(v.citation_number)) return refuse(422, "not_a_ticket", "That violation carries a warning, not a ticket; there is no court result to obtain.");
  const newest = newestActs((acts.data ?? []) as CitationActionRow[]).get(input.violationId) ?? null;
  if ((newest?.id ?? null) !== input.basedOn) {
    return refuse(409, "changed", "Someone else recorded something about this ticket since the page was loaded. Reload to see it.");
  }

  const { data, error } = await admin
    .from("inspection_citation_actions")
    .insert({
      org_id: orgId,
      inspection_id: inspectionId,
      violation_id: input.violationId,
      action: input.action,
      follow_up_on: input.action === "requested_from_court" ? input.followUpOn : null,
      note: input.note?.trim() || null,
      acted_by: actorId,
    })
    .select("id")
    .single();
  if (error) return { error };

  await writeAudit(admin, {
    orgId,
    actorId,
    action: input.action === "requested_from_court" ? "roadside.citation_requested" : "roadside.citation_not_contested",
    entity: "roadside_inspection",
    entityId: inspectionId,
    meta: { actId: data.id, violationId: input.violationId, citationNumber: v.citation_number, previous: newest ? { actId: newest.id, action: newest.action } : null },
  });
  return { ok: true, id: data.id as string };
}
