import type { SupabaseClient } from "@supabase/supabase-js";
import { isTicket, type CalendarDay, type RoadsideCitationDisposition } from "@silvicom/shared";
import { writeAudit } from "../../../lib/audit.js";
import type { DbError } from "../read/inspectionsList.js";
import { DISPOSITION_COLS, newestActs, type DispositionRow } from "./read.js";

/**
 * What the court decided on one roadside ticket, recorded by a person from the court paper filed on the inspection
 * (IC4 second merge, R-ADJ2/R-ADJ3). Written to the append-only `inspection_citation_dispositions` (0495); the
 * newest row is the state, so a misread is answered by recording it again.
 *
 * Refused: a violation not on this inspection or with no ticket; a paper that is not a court result filed on THIS
 * inspection (a disposition says which paper it was read from, and the DataQs hand-off offers that paper); a
 * decision dated before the inspection or after today; and a record over a newer one than the page showed.
 */

export type DispositionOutcome =
  | { ok: true; id: string }
  | { ok: false; status: 404 | 409 | 422; code: string; message: string }
  | { error: DbError };

const refuse = (status: 404 | 409 | 422, code: string, message: string): DispositionOutcome => ({ ok: false, status, code, message });

export async function recordDisposition(
  admin: SupabaseClient,
  orgId: string,
  inspectionId: string,
  actorId: string,
  input: RoadsideCitationDisposition,
  today: CalendarDay,
): Promise<DispositionOutcome> {
  const [violation, paper, head, prior] = await Promise.all([
    admin.from("roadside_violations").select("id, citation_number").eq("org_id", orgId).eq("inspection_id", inspectionId)
      .eq("id", input.violationId).is("vanished_at", null).maybeSingle(),
    admin.from("documents").select("id").eq("org_id", orgId).eq("id", input.documentId).eq("subject_type", "roadside_inspection")
      .eq("subject_id", inspectionId).eq("kind", "court_disposition").eq("variant", "original").maybeSingle(),
    admin.from("roadside_inspections").select("inspection_date").eq("org_id", orgId).eq("id", inspectionId).maybeSingle(),
    admin.from("inspection_citation_dispositions").select(DISPOSITION_COLS).eq("org_id", orgId).eq("inspection_id", inspectionId).eq("violation_id", input.violationId),
  ]);
  for (const r of [violation, paper, head, prior]) if (r.error) return { error: r.error };
  const v = violation.data as { id: string; citation_number: string | null } | null;
  if (!v) return refuse(404, "not_found", "That violation is not on this inspection.");
  if (!isTicket(v.citation_number)) return refuse(422, "not_a_ticket", "That violation carries a warning, not a ticket; no court decided it.");
  if (!paper.data) return refuse(422, "not_a_court_paper", "Choose a court result filed on this inspection.");
  const inspectionDate = (head.data as { inspection_date: CalendarDay | null } | null)?.inspection_date ?? null;
  if (input.decidedOn > today) return refuse(422, "decided_later", "The day the court decided cannot be after today.");
  if (inspectionDate && input.decidedOn < inspectionDate) return refuse(422, "decided_earlier", "The court cannot have decided before the inspection.");
  const newest = newestActs((prior.data ?? []) as DispositionRow[]).get(input.violationId) ?? null;
  if ((newest?.id ?? null) !== input.basedOn) {
    return refuse(409, "changed", "Someone else recorded the court's result for this ticket since the page was loaded. Reload to see it.");
  }

  const { data, error } = await admin
    .from("inspection_citation_dispositions")
    .insert({
      org_id: orgId,
      inspection_id: inspectionId,
      violation_id: input.violationId,
      document_id: input.documentId,
      outcome_code: input.outcomeCode,
      amended_charge: input.outcomeCode === 2 ? input.amendedCharge! : null,
      court_name: input.courtName,
      decided_on: input.decidedOn,
      note: input.note?.trim() || null,
      recorded_by: actorId,
    })
    .select("id")
    .single();
  if (error) return { error };

  await writeAudit(admin, {
    orgId,
    actorId,
    action: "roadside.citation_disposition_recorded",
    entity: "roadside_inspection",
    entityId: inspectionId,
    meta: {
      dispositionId: data.id,
      violationId: input.violationId,
      citationNumber: v.citation_number,
      outcomeCode: input.outcomeCode,
      documentId: input.documentId,
      previous: newest ? { dispositionId: newest.id, outcomeCode: newest.outcome_code } : null,
    },
  });
  return { ok: true, id: data.id as string };
}
