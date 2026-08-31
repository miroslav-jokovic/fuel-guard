import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  INSPECTION_CATALOGUE_VERSION,
  deriveInspectionOutcome,
  nextInspectionDueDate,
  type InspectionIssue,
  type InspectionOutcome,
  type InspectionSubjectType,
} from "@silvicom/shared";
import { fileGeneratedDocument, insertCertification } from "../../evidence/index.js";
import { getEquipmentIdentity, recordEquipmentInspectionExpiry } from "../../roster/index.js";
import { carrierCityStateZip, getCarrierIdentity } from "../../org/index.js";
import { renderInspectionReport, type InspectionRenderInput } from "./render/report.js";
import { getInspection } from "./inspections.js";
import { inspectorFor } from "./inspectors.js";
import type { ServiceError } from "./inspectors.js";

/**
 * Turning a draft into evidence (plan step A6, D-AVI3/D-AVI4/D-AVI6/D-AVI9).
 *
 * ── THE ORDER IS THE DESIGN ────────────────────────────────────────────────────────────────────
 * Everything that can REFUSE runs before anything that WRITES. A finalize that failed halfway would
 * otherwise leave a certification with no document, or a claimed equipment row behind a report still
 * marked draft — states no reader could interpret and no operator could fix. So: derive, refuse,
 * gather, render, then four writes in dependency order, each idempotent on replay.
 *
 * ── WHAT IT REFUSES, AND WHY EACH ONE IS A 400 RATHER THAN A SHRUG ─────────────────────────────
 *   · an unanswered component — §396.21(a)(5) wants the results described, and a blank describes
 *     nothing (D-AVI5). The catalogue seeds a complete draft, so this can only happen to a payload
 *     that went around the form.
 *   · an inspector without a §396.19 qualification covering the day — the report asserts they have
 *     one, and D-AVI6 says that assertion is derived. A4 checks it at draft creation too; this is
 *     the check that matters, because a qualification can lapse between the two.
 *   · an incomplete carrier record — §396.21(a)(2) requires the report to identify the motor
 *     carrier and §396.17(c)(2) requires the decal to carry its address. A blank block is not a
 *     tidier report, it is a non-compliant one. Names the fields and where to set them (0282).
 *
 * ── WHAT IT DOES NOT REFUSE, ON PURPOSE ────────────────────────────────────────────────────────
 * A PASS with no decal serial. Whether that should be refused is the plan's §6 Q7 and turns on a
 * fact nobody has established — whether the sticker always goes on before the truck moves. Guessing
 * "refuse" would hand the office a rule it may not be able to satisfy, and a blocked finalize is how
 * a workaround gets invented. Guessing "allow" costs nothing that Q7 cannot still change.
 */

export interface FinalizeRefusal {
  code:
    | "not_found"
    | "already_final"
    | "incomplete_components"
    | "inspector_not_qualified"
    | "carrier_incomplete"
    | "equipment_missing";
  error: string;
  /** Present for `incomplete_components`, so the form can point at the rows. */
  issues?: InspectionIssue[];
}

export interface FinalizeResult {
  id: string;
  outcome: InspectionOutcome;
  nextDueOn: string;
  documentId: string;
  certificationId: string;
  /** False when the report was already final and this call replayed it. */
  finalized: boolean;
}

const refuse = (code: FinalizeRefusal["code"], error: string, issues?: InspectionIssue[]): FinalizeRefusal =>
  issues ? { code, error, issues } : { code, error };

export async function finalizeInspection(
  admin: SupabaseClient,
  orgId: string,
  inspectionId: string,
  finalizedBy: string | null,
): Promise<FinalizeResult | FinalizeRefusal | ServiceError> {
  const loaded = await getInspection(admin, orgId, inspectionId);
  if (loaded && "code" in loaded) return loaded;
  if (!loaded) return refuse("not_found", "Inspection not found");
  const { report, items } = loaded;

  // A replay answers with what was already filed rather than erroring: from the caller's side the
  // request succeeded the first time, and a second click on a slow page must not read as a failure.
  if (report.status === "final") {
    return {
      id: report.id,
      outcome: report.outcome as InspectionOutcome,
      nextDueOn: String(report.next_due_on),
      documentId: String(report.document_id),
      certificationId: String(report.certification_id),
      finalized: false,
    };
  }

  const subjectType = report.subject_type as InspectionSubjectType;

  // ── refuse, in the order a person would want to hear about it ────────────────────────────────
  const derived = deriveInspectionOutcome(
    items.map((i) => ({ key: i.key, result: i.result, repairedAt: i.repairedAt })),
    subjectType,
    report.inspected_on,
  );
  if (!derived.ok) {
    return refuse(
      "incomplete_components",
      "This report cannot be certified yet: some components have no result, or carry a repair date that does not belong to this inspection.",
      derived.issues,
    );
  }

  const inspector = await inspectorFor(admin, orgId, report.inspector_id, report.inspected_on);
  if (inspector && "code" in inspector) return inspector;
  if (!inspector) return refuse("inspector_not_qualified", "That inspector is no longer on the register.");
  if (!inspector.qualified) {
    return refuse(
      "inspector_not_qualified",
      `${inspector.full_name} has no §396.19 qualification covering ${report.inspected_on}. The report asserts that they do, so it cannot be certified under their name.`,
    );
  }

  const carrier = await getCarrierIdentity(admin, orgId);
  if ("code" in carrier) return { error: carrier.error, code: carrier.code };
  if (!carrier.complete) {
    return refuse(
      "carrier_incomplete",
      `§396.21(a)(2) requires the report to identify the motor carrier, and the decal must carry the address where it is kept. Missing: ${carrier.missing.join(", ")}. Set it under Settings → Carrier.`,
    );
  }

  const equipment = await getEquipmentIdentity(admin, orgId, subjectType, report.subject_id);
  if (equipment && "code" in equipment) return { error: equipment.error, code: equipment.code };
  if (!equipment) return refuse("equipment_missing", "The vehicle this report is about is no longer on the roster.");

  // ── render ───────────────────────────────────────────────────────────────────────────────────
  const identificationMethod = (report.vehicle_identification_method ?? "vin") as InspectionRenderInput["identificationMethod"];
  const renderInput: InspectionRenderInput = {
    subjectType,
    unitNumber: equipment.unitNumber,
    inspectedOn: report.inspected_on,
    decalSerial: (report.decal_serial as string | null) ?? null,
    inspectorName: inspector.full_name,
    // Read from the register, never passed in as a claim (D-AVI6).
    inspectorQualified: inspector.qualified,
    carrierName: carrier.name,
    carrierAddress: carrier.addressLine1,
    carrierCityStateZip: carrierCityStateZip(carrier),
    identificationMethod,
    identificationValue:
      (report.vehicle_identification_value as string | null) ??
      (identificationMethod === "plate" ? equipment.plate : equipment.vin),
    inspectionAgencyLocation: (report.inspection_agency_location as string | null) ?? null,
    otherConditions: (report.other_conditions as string | null) ?? null,
    items: items.map((i) => ({ key: i.key, result: i.result, repairedAt: i.repairedAt })),
    outcome: derived.outcome,
  };
  const pdf = await renderInspectionReport(renderInput);

  // ── write, in dependency order ───────────────────────────────────────────────────────────────
  // The document id is DERIVED from the inspection id so a retried finalize files onto the same row
  // rather than producing a second copy of the same report.
  const documentId = deterministicChildId(inspectionId, "document");
  const filed = await fileGeneratedDocument(
    admin,
    orgId,
    {
      id: documentId,
      subjectType: subjectType === "tractor" ? "tractor" : "trailer",
      subjectId: report.subject_id,
      kind: "annual_inspection",
      uploadedBy: finalizedBy,
      capturedAt: report.inspected_on,
    },
    pdf,
  );
  if ("code" in filed) return { error: filed.error, code: filed.code };

  const nextDueOn = nextInspectionDueDate(report.inspected_on);
  const certificationId = deterministicChildId(inspectionId, "certification");
  const certification = await insertCertification(admin, orgId, finalizedBy, {
    id: certificationId,
    subjectType,
    subjectId: report.subject_id,
    kind: "annual_inspection",
    identifier: (report.decal_serial as string | null) ?? null,
    issuingAuthority: carrier.name,
    issuedAt: report.inspected_on,
    effectiveFrom: report.inspected_on,
    // Only a PASS carries an expiry: a failed inspection certifies nothing, and an `expiresAt` on it
    // would make the compliance surface read as covered until next year.
    expiresAt: derived.outcome === "pass" ? nextDueOn : report.inspected_on,
    documentId: filed.documentId,
    notes: derived.outcome === "fail" ? `Failed: ${derived.openDefects.join(", ")}` : null,
  });
  if ("code" in certification) return { error: certification.error, code: certification.code };

  // The projection, and the claim that stops the McLeod sweep replacing it (D-AVI9). Only for a
  // PASS — projecting a failed inspection's date would say the truck is good until next year.
  if (derived.outcome === "pass") {
    const projected = await recordEquipmentInspectionExpiry(admin, orgId, subjectType, report.subject_id, nextDueOn);
    if ("code" in projected) return { error: projected.error, code: projected.code };
  }

  const stamped = await admin
    .from("vehicle_inspections")
    .update({
      status: "final",
      outcome: derived.outcome,
      next_due_on: nextDueOn,
      document_id: filed.documentId,
      certification_id: certification.id,
      finalized_at: new Date().toISOString(),
      finalized_by: finalizedBy,
      catalogue_version: INSPECTION_CATALOGUE_VERSION,
    })
    .eq("org_id", orgId)
    .eq("id", inspectionId)
    .eq("status", "draft");
  if (stamped.error) return { error: "Could not finalize the inspection", code: "update_failed" };

  return {
    id: inspectionId,
    outcome: derived.outcome,
    nextDueOn,
    documentId: filed.documentId,
    certificationId: certification.id,
    finalized: true,
  };
}

/**
 * A stable uuid for a child row of one inspection.
 *
 * Derived rather than random so a retried finalize lands on the SAME document and certification —
 * both of those tables key their idempotency on a caller-supplied id, and a `randomUUID()` here
 * would file a second copy of the same report every time somebody clicked twice.
 */
function deterministicChildId(inspectionId: string, role: "document" | "certification"): string {
  // A v5-shaped uuid derived by hashing, rather than a dependency for one function. The version and
  // variant nibbles are forced so the result is a VALID uuid — Postgres rejects one that is not, and
  // a malformed id here would fail at the insert rather than at the hash.
  const hex = createHash("sha256").update(`${inspectionId}:${role}`).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}
