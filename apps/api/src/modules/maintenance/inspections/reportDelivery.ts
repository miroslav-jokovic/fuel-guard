import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENTS_BUCKET, type InspectionSubjectType } from "@silvicom/shared";
import { getEquipmentIdentity } from "../../roster/index.js";
import { getPrintProfile } from "./printProfiles.js";
import { carrierCityStateZip, getCarrierIdentity } from "../../org/index.js";
import { renderInspectionReport, type InspectionRenderInput } from "./render/report.js";
import { getInspection } from "./inspections.js";
import { inspectorFor, type ServiceError } from "./inspectors.js";

/**
 * Handing the report to a printer — the filed one, and the preview of one that is not filed yet.
 *
 * ── A FINAL REPORT SERVES ITS STORED BYTES, NEVER A FRESH RENDER ───────────────────────────────
 * The filed PDF is the evidence: `documents.sha256` is a claim about those exact bytes, and
 * §390.32(c) wants a filed document reproducible. Re-rendering on the way to a printer would hand
 * out a document that had never been hashed — and one that would quietly change the day the
 * catalogue, the template or the renderer moved. This is also why D-AVI7's revision risk is bounded:
 * a Keller reissue re-measures the map for FUTURE reports and cannot touch a filed one.
 */

export interface DeliveredReport {
  pdf: Buffer;
  filename: string;
}

export async function renderStoredReport(
  admin: SupabaseClient,
  orgId: string,
  inspectionId: string,
): Promise<DeliveredReport | ServiceError> {
  const loaded = await getInspection(admin, orgId, inspectionId);
  if (loaded && "code" in loaded) return loaded;
  if (!loaded) return { error: "Inspection not found", code: "not_found" };
  const documentId = loaded.report.document_id as string | null;
  if (loaded.report.status !== "final" || !documentId) {
    return { error: "This inspection has not been certified yet. Use the preview instead.", code: "not_final" };
  }

  const doc = await admin
    .from("documents")
    .select("storage_path")
    .eq("org_id", orgId)
    .eq("id", documentId)
    .maybeSingle();
  if (doc.error || !doc.data) return { error: "The filed report could not be found", code: "not_found" };

  const { data, error } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .download((doc.data as { storage_path: string }).storage_path);
  if (error || !data) return { error: "The filed report could not be read", code: "storage_failed" };

  const unit = String(loaded.report.subject_id).slice(0, 8);
  return {
    pdf: Buffer.from(await data.arrayBuffer()),
    filename: `annual-inspection-${unit}-${loaded.report.inspected_on}.pdf`,
  };
}

/**
 * The D-AVI14 preview: what the page WOULD look like, through the same renderer and the same map.
 *
 * Tolerant where finalize is strict, and deliberately so — the whole point is to see the page before
 * it is signed, so a missing carrier address or an unqualified inspector shows up as a gap ON THE
 * PAGE rather than as an error instead of one. Nothing here is stored, and the DRAFT mark says the
 * page certifies nothing.
 */
export async function buildPreviewInput(
  admin: SupabaseClient,
  orgId: string,
  inspectionId: string,
): Promise<{ pdf: Buffer } | ServiceError> {
  const built = await buildRenderInput(admin, orgId, inspectionId);
  if ("code" in built) return built;
  return { pdf: await renderInspectionReport(built.input, { draft: true }) };
}

/**
 * Gather what a render needs, tolerantly.
 *
 * Deliberately more forgiving than finalize: the whole point of a preview is to SEE the page before
 * it is signed, so a missing carrier address or an unqualified inspector shows up as a gap on the
 * page rather than as an error instead of one. Finalize is where those become refusals.
 */
async function buildRenderInput(
  admin: SupabaseClient,
  orgId: string,
  inspectionId: string,
): Promise<{ input: InspectionRenderInput; inspectedOn: string } | ServiceError> {
  const loaded = await getInspection(admin, orgId, inspectionId);
  if (loaded && "code" in loaded) return loaded;
  if (!loaded) return { error: "Inspection not found", code: "not_found" };
  const { report, items } = loaded;
  const subjectType = report.subject_type as InspectionSubjectType;

  const [carrier, equipment, inspector] = await Promise.all([
    getCarrierIdentity(admin, orgId),
    getEquipmentIdentity(admin, orgId, subjectType, report.subject_id),
    inspectorFor(admin, orgId, report.inspector_id, report.inspected_on),
  ]);

  const carrierOk = !("code" in carrier);
  const equipmentOk = equipment !== null && !("code" in equipment);
  const inspectorOk = inspector !== null && !("code" in inspector);
  const method = (report.vehicle_identification_method ?? "vin") as InspectionRenderInput["identificationMethod"];

  return {
    inspectedOn: report.inspected_on,
    input: {
      subjectType,
      unitNumber: equipmentOk ? equipment.unitNumber : null,
      inspectedOn: report.inspected_on,
      decalSerial: (report.decal_serial as string | null) ?? null,
      inspectorName: inspectorOk ? inspector.full_name : "",
      inspectorQualified: inspectorOk ? inspector.qualified : false,
      carrierName: carrierOk ? carrier.name : "",
      carrierAddress: carrierOk ? carrier.addressLine1 : null,
      carrierCityStateZip: carrierOk ? carrierCityStateZip(carrier) : null,
      identificationMethod: method,
      identificationValue:
        (report.vehicle_identification_value as string | null) ??
        (equipmentOk ? (method === "plate" ? equipment.plate : equipment.vin) : null),
      inspectionAgencyLocation: (report.inspection_agency_location as string | null) ?? null,
      otherConditions: (report.other_conditions as string | null) ?? null,
      items: items.map((i) => ({ key: i.key, result: i.result, repairedAt: i.repairedAt })),
      outcome: (report.outcome as "pass" | "fail" | null) ?? null,
    },
  };
}

/**
 * The values-only render for a pre-printed pad (D-AVI8).
 *
 * Rendered fresh rather than served from `documents`, and that is not an inconsistency with the
 * stored-bytes rule above: the FILED report is the evidence and is served exactly as filed. This is
 * a different artefact for a different piece of paper — the same values, positioned for a form
 * somebody else printed, through a calibration belonging to the printer rather than to the report.
 */
export async function renderOverlayReport(
  admin: SupabaseClient,
  orgId: string,
  inspectionId: string,
  profileId: string | null,
): Promise<DeliveredReport | ServiceError> {
  const built = await buildRenderInput(admin, orgId, inspectionId);
  if ("code" in built) return built;

  let offset = { x: 0, y: 0 };
  if (profileId) {
    const profile = await getPrintProfile(admin, orgId, profileId);
    if (profile && "code" in profile) return profile;
    if (!profile) return { error: "That printer setup no longer exists", code: "not_found" };
    offset = { x: profile.offset_x_pt, y: profile.offset_y_pt };
  }

  const pdf = await renderInspectionReport(built.input, { background: "none", offset });
  return { pdf, filename: `annual-inspection-overlay-${built.inspectedOn}.pdf` };
}
