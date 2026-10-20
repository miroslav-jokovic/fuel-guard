import type { SupabaseClient } from "@supabase/supabase-js";
import {
  citationStanding,
  courtPaperFiledAt,
  type CalendarDay,
  type RoadsideDataqsApprove,
  type RoadsideDataqsFiled,
} from "@silvicom/shared";
import { writeAudit } from "../../../lib/audit.js";
import { decisionRow, readLatestAttribution } from "../read/inspectionAttribution.js";
import type { DbError } from "../read/inspectionsList.js";
import { readInspectionCitations } from "./read.js";

/**
 * A DataQs request for a ticket the court decided in the driver's favour (IC4 second merge, R-ADJ2; `dataqs_cases`,
 * 0495). We never file it: a person approves it here under DataQs's 18 USC 1001 certification, files it in DataQs
 * themselves, and records the RDR number DataQs gave it.
 *
 * ── WHAT MUST BE TRUE BEFORE A PERSON MAY ATTEST ────────────────────────────────────────────────
 * The ticket's standing is `file_ready` — a dismissal or different charge recorded, FMCSA showing no result, the
 * inspection inside SMS's 24 months — read through `citationStanding`, the rule the page and the inbox read, so
 * nothing is approved that the page would not offer. The disposition is the one the page showed. And who was
 * driving is a decision, not a reading (D-IC7: "a guessed driver never reaches a draft"): a person's or the
 * officer's report's, the one the page showed. The request records which, so the attestation says what it was
 * made over.
 */

export type DataqsOutcome =
  | { ok: true; id: string }
  | { ok: false; status: 404 | 409 | 422; code: string; message: string }
  | { error: DbError };

const refuse = (status: 404 | 409 | 422, code: string, message: string): DataqsOutcome => ({ ok: false, status, code, message });

async function ticketStanding(admin: SupabaseClient, orgId: string, inspectionId: string, violationId: string, today: CalendarDay) {
  const read = await readInspectionCitations(admin, orgId, inspectionId);
  if ("error" in read) return read;
  const ticket = read.tickets.find((t) => t.violationId === violationId);
  if (!ticket) return { missing: true as const };
  return { ticket, standing: citationStanding(ticket, courtPaperFiledAt(read.courtPapers), read.filing.inspectionDate, today) };
}

export async function approveDataqsRequest(
  admin: SupabaseClient,
  orgId: string,
  inspectionId: string,
  actorId: string,
  input: RoadsideDataqsApprove,
  today: CalendarDay,
): Promise<DataqsOutcome> {
  const [found, latest] = await Promise.all([
    ticketStanding(admin, orgId, inspectionId, input.violationId, today),
    readLatestAttribution(admin, orgId, inspectionId),
  ]);
  if ("error" in found) return { error: found.error };
  if ("error" in latest) return { error: latest.error };
  if ("missing" in found) return refuse(404, "not_found", "That ticket is not on this inspection.");
  const st = found.standing;
  if (st.kind !== "file_ready") {
    return refuse(409, "not_ready", "This ticket has no DataQs request to prepare now. Reload to see where it stands.");
  }
  if (st.disposition.id !== input.dispositionId) {
    return refuse(409, "changed", "The court's result for this ticket was recorded again since the page was loaded. Reload to see it.");
  }
  const decision = decisionRow(latest);
  if (!decision) return refuse(422, "driver_unconfirmed", "Confirm who was driving first: a request is never filed on Samsara's reading alone.");
  if (decision.id !== input.attributionId) {
    return refuse(409, "driver_changed", "Who was driving was decided again since the page was loaded. Reload to see it.");
  }

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("dataqs_cases")
    .insert({
      org_id: orgId,
      inspection_id: inspectionId,
      violation_id: input.violationId,
      disposition_id: st.disposition.id,
      rdr_type: "inspection_citation_with_associated_violation",
      state: "approved",
      narrative: input.narrative,
      attribution_id: decision.id,
      attested_by: actorId,
      attested_at: now,
      acted_by: actorId,
    })
    .select("id")
    .single();
  if (error) return { error };

  await writeAudit(admin, {
    orgId,
    actorId,
    action: "roadside.dataqs_approved",
    entity: "roadside_inspection",
    entityId: inspectionId,
    meta: { caseId: data.id, violationId: input.violationId, citationNumber: found.ticket.citationNumber, dispositionId: st.disposition.id, attributionId: decision.id },
  });
  return { ok: true, id: data.id as string };
}

export async function recordDataqsFiled(
  admin: SupabaseClient,
  orgId: string,
  inspectionId: string,
  actorId: string,
  input: RoadsideDataqsFiled,
  today: CalendarDay,
): Promise<DataqsOutcome> {
  const found = await ticketStanding(admin, orgId, inspectionId, input.violationId, today);
  if ("error" in found) return { error: found.error };
  if ("missing" in found) return refuse(404, "not_found", "That ticket is not on this inspection.");
  const st = found.standing;
  if (st.kind !== "file_approved" || st.dataqs.id !== input.caseId) {
    return refuse(409, "changed", "This request is no longer the approved one. Reload to see where it stands.");
  }
  if (input.filedOn > today) return refuse(422, "filed_later", "The day it was filed cannot be after today.");

  // The read carries the approval but not the driver decision it was made over; the row does.
  const approved = await admin.from("dataqs_cases").select("attribution_id, attested_by").eq("org_id", orgId).eq("id", input.caseId).maybeSingle();
  if (approved.error) return { error: approved.error };
  const a = approved.data as { attribution_id: string; attested_by: string } | null;
  if (!a) return refuse(409, "changed", "This request is no longer the approved one. Reload to see where it stands.");

  const { data, error } = await admin
    .from("dataqs_cases")
    .insert({
      org_id: orgId,
      inspection_id: inspectionId,
      violation_id: input.violationId,
      disposition_id: st.dataqs.dispositionId,
      rdr_type: "inspection_citation_with_associated_violation",
      state: "filed",
      narrative: st.dataqs.narrative,
      attribution_id: a.attribution_id,
      attested_by: a.attested_by,
      attested_at: st.dataqs.attestedAt,
      rdr_number: input.rdrNumber,
      filed_on: input.filedOn,
      acted_by: actorId,
    })
    .select("id")
    .single();
  if (error) return { error };

  await writeAudit(admin, {
    orgId,
    actorId,
    action: "roadside.dataqs_filed",
    entity: "roadside_inspection",
    entityId: inspectionId,
    meta: { caseId: data.id, approvedCaseId: input.caseId, violationId: input.violationId, citationNumber: found.ticket.citationNumber, rdrNumber: input.rdrNumber },
  });
  return { ok: true, id: data.id as string };
}
