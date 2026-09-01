import type { SupabaseClient } from "@supabase/supabase-js";
import type { InspectionSubjectType } from "@silvicom/shared";
import { writeAudit } from "../../../lib/audit.js";
import { releaseEquipmentInspectionClaim } from "../../roster/index.js";
import { filedDocumentPath, retractFiledEvidence } from "../../evidence/index.js";
import { traced } from "./serviceError.js";
import type { ServiceError } from "./inspectors.js";

/**
 * Destroying a §396.17 report and everything it created (D-AVI29).
 *
 * ── THIS IS A HOLE IN THE EVIDENCE MODEL, DELIBERATELY CUT, BY THE OWNER ────────────────────────
 * `vehicle_inspections` is pinned in `RETENTION_FORBIDDEN` and frozen once final by 0280's trigger,
 * and `discardDraft` refuses a completed report by name: *"a completed inspection is a record and
 * cannot be deleted. Record a correction instead."* That reasoning has not changed and §396.21(b)
 * still wants the report kept fourteen months.
 *
 * The owner asked for this anyway, on 2026-09-01, for the case the rule does not cover: a truck
 * leaves the fleet, or a report was created against the wrong unit, and there is nothing to correct
 * because there is nothing that should exist. Refusing would have meant raw SQL against production
 * every time — which is what actually happened the day before this was written, and which leaves no
 * audit row, no org scoping and no chance of getting the projection right.
 *
 * So it exists, and it is built to be the SAFEST way to do the thing rather than the easiest:
 *
 *   · **admin only**, not `rolesThatManage("maintenance")` — a technician certifies inspections,
 *     they do not destroy the record of one;
 *   · **a reason is required** and is refused if blank, because "who deleted it and why" is the
 *     entire remaining value of a deleted record;
 *   · **the audit row is written FIRST**, before anything is destroyed, and carries the identifiers
 *     of every artefact about to go. A delete that half-succeeded still leaves a complete account of
 *     what was attempted. `audit_logs` is itself in `RETENTION_FORBIDDEN`, so that account outlives
 *     everything it describes;
 *   · **the equipment claim is given back** (0285) — see `releaseEquipmentInspectionClaim`.
 *
 * ── WHY NOT A TRANSACTION ──────────────────────────────────────────────────────────────────────
 * PostgREST has no multi-statement transaction, and an RPC would put this policy in SQL where none
 * of the guards above can reach it. So the order is chosen to fail SAFE instead: audit, then the
 * report (which is what makes it invisible to every reader), then the artefacts that are unreachable
 * once it is gone. A failure part-way leaves orphans that a person can find from the audit row — the
 * opposite order would leave a report pointing at a certification that no longer exists.
 */

export interface DeleteRecordInput {
  reason: string;
  actorId: string | null;
}

export interface DeletedRecord {
  id: string;
  itemsDeleted: number;
  certificationDeleted: boolean;
  documentDeleted: boolean;
  /** What the equipment's expiry is now — recomputed from whatever reports remain, not assumed null. */
  expiresOn: string | null;
  /** Null when the report predates 0285 and never recorded what it displaced, so nothing was restored. */
  identitySourceRestored: string | null;
}

interface ReportRow {
  id: string;
  status: string;
  subject_type: InspectionSubjectType;
  subject_id: string;
  inspected_on: string;
  document_id: string | null;
  certification_id: string | null;
  equipment_identity_source_before: string | null;
}

/** A reason that is only whitespace is not a reason. */
export const deleteReasonIsUsable = (reason: string): boolean => reason.trim().length >= 3;

export async function deleteInspectionRecord(
  admin: SupabaseClient,
  orgId: string,
  id: string,
  input: DeleteRecordInput,
): Promise<DeletedRecord | ServiceError> {
  if (!deleteReasonIsUsable(input.reason)) {
    return { error: "Say why this record is being deleted — it is the only part of it that survives.", code: "reason_required" };
  }

  const loaded = await admin
    .from("vehicle_inspections")
    .select("id, status, subject_type, subject_id, inspected_on, document_id, certification_id, equipment_identity_source_before")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (loaded.error) return traced("deleteInspectionRecord.load", "db_error", "Could not load the inspection", loaded.error);
  if (!loaded.data) return { error: "Inspection not found", code: "not_found" };
  const report = loaded.data as unknown as ReportRow;

  const items = await admin
    .from("vehicle_inspection_items")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("inspection_id", id);
  const itemCount = items.count ?? 0;

  const pathOrError = await filedDocumentPath(admin, orgId, report.document_id);
  if (pathOrError !== null && typeof pathOrError !== "string") return { error: pathOrError.error, code: pathOrError.code };
  const storagePath = pathOrError;

  // ── the account, before the act ──────────────────────────────────────────────────────────────
  await writeAudit(admin, {
    orgId,
    actorId: input.actorId,
    action: "maintenance.inspection_record_deleted",
    entity: "vehicle_inspections",
    entityId: id,
    meta: {
      reason: input.reason.trim(),
      status: report.status,
      inspectedOn: report.inspected_on,
      subjectType: report.subject_type,
      subjectId: report.subject_id,
      itemsDeleted: itemCount,
      documentId: report.document_id,
      certificationId: report.certification_id,
      storagePath: storagePath ?? null,
      identitySourceToRestore: report.equipment_identity_source_before,
    },
  });

  // ── the act, ordered so a half-failure leaves findable orphans rather than dangling pointers ──
  const gone = await admin.from("vehicle_inspections").delete().eq("org_id", orgId).eq("id", id);
  if (gone.error) return traced("deleteInspectionRecord.report", "delete_failed", "Could not delete the inspection", gone.error);

  // `documents` and `certifications` belong to `evidence`, and `check-table-access.mjs` says so out
  // loud — this module may not delete from them directly. `retractFiledEvidence` is that module's
  // door for the one deletion RETENTION_FORBIDDEN permits.
  const retracted = await retractFiledEvidence(admin, orgId, {
    documentId: report.document_id,
    certificationId: report.certification_id,
  });
  if ("code" in retracted) {
    return { error: `${retracted.error} — the report is gone; see the audit entry for what remains`, code: retracted.code };
  }

  const projection = await reprojectEquipment(admin, orgId, report);
  if ("code" in projection) return projection;

  return {
    id,
    itemsDeleted: itemCount,
    certificationDeleted: retracted.certificationDeleted,
    documentDeleted: retracted.documentDeleted,
    ...projection,
  };
}

/**
 * What the truck should say now, derived from the reports that REMAIN.
 *
 * Deleting one of several must leave the date the survivors justify, so the newest remaining PASS is
 * read rather than the expiry being assumed null. The claim is only given back when nothing is left
 * to protect: while another final report stands, `identity_source` must keep saying 'manual' or the
 * next sweep overwrites a date the office still owns.
 */
async function reprojectEquipment(
  admin: SupabaseClient,
  orgId: string,
  report: ReportRow,
): Promise<Pick<DeletedRecord, "expiresOn" | "identitySourceRestored"> | ServiceError> {
  const remaining = await admin
    .from("vehicle_inspections")
    .select("next_due_on")
    .eq("org_id", orgId)
    .eq("subject_type", report.subject_type)
    .eq("subject_id", report.subject_id)
    .eq("status", "final")
    .eq("outcome", "pass")
    .order("next_due_on", { ascending: false })
    .limit(1);
  if (remaining.error) {
    return traced("deleteInspectionRecord.remaining", "db_error", "Could not recheck the vehicle's other inspections", remaining.error);
  }
  const survivor = (remaining.data ?? [])[0] as { next_due_on: string | null } | undefined;
  const expiresOn = survivor?.next_due_on ?? null;

  // Only release the claim when this report was the last one holding it, and only to a value this
  // report actually recorded (0285). Null on either count means leave `identity_source` alone.
  const restore = survivor || !report.equipment_identity_source_before ? null : report.equipment_identity_source_before;

  // Nothing to write at all when the row never carried a projection — a draft never made one, and
  // writing null over a date another system owns would be this function inventing a fact.
  if (report.status !== "final") return { expiresOn, identitySourceRestored: null };

  const released = await releaseEquipmentInspectionClaim(
    admin,
    orgId,
    report.subject_type,
    report.subject_id,
    expiresOn,
    restore,
  );
  if ("code" in released) return { error: released.error, code: released.code };
  return { expiresOn, identitySourceRestored: restore };
}
