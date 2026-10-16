import type { SupabaseClient } from "@supabase/supabase-js";
import {
  organizationTimezone,
  repairSettled,
  repairUnitName,
  todayInZone,
  type RoadsideRepairCertificationDto,
  type RoadsideRepairCertifyRequest,
} from "@silvicom/shared";
import { writeAudit } from "../../../lib/audit.js";
import { derivedUuid } from "../../../lib/derivedUuid.js";
import { labelOf, memberLabels } from "../../../lib/memberLabels.js";
import { fileGeneratedDocument } from "../../evidence/index.js";
import { readWorkOrderRecords } from "../../fleetpal/index.js";
import { getCarrierIdentity } from "../../org/index.js";
import { readInspectionRepairs } from "../read/inspectionRepairs.js";
import type { DbError } from "../read/inspectionsList.js";
import { renderRepairRecord, type RepairRecordUnit } from "./renderRecord.js";

/**
 * Safety certifies that a roadside inspection's vehicle violations were corrected (INSPECTION-CHALLENGE-PLAN
 * IC11 B2, D-IC14; 49 CFR 396.9(d)(3)(i); Q-IC13: maintenance names each repair, safety certifies the report).
 *
 * ── ONLY OVER A SETTLED RECORD, AND THE ONE THE PAGE SHOWED ──────────────────────────────────────
 * Every violated unit must be settled (`repairSettled`: a person named its repair, or the officer recorded
 * it repaired at the scene) — the certification says EVERY violation was corrected. And `basedOn` must be
 * exactly the units' newest rows: a repair re-read or re-decided after the page loaded is refused
 * (409 `changed`), so nobody certifies a record they did not see.
 *
 * ── THE RECORD FIRST, THEN THE SIGNATURE ─────────────────────────────────────────────────────────
 * The rendered record (Q-IC12 (a)) is filed before the certification row, which names it (0485's
 * `document_id` is NOT NULL): a certification never exists without its record. Both ids are derived from
 * what is certified, by whom and on which day, so a retried click files onto the same rows instead of a
 * second copy (`derivedUuid`); a different title or a moved record is a new act.
 *
 * The signer is the signed-in person, their name frozen as the product shows it; the date is the carrier's
 * calendar day the server sees. Only the title is the person's to give.
 */

export type CertifyOutcome =
  | { ok: true; data: RoadsideRepairCertificationDto }
  | { ok: false; status: 404 | 409 | 422; code: string; message: string }
  | { error: DbError | { message: string } };

const refuse = (status: 404 | 409 | 422, code: string, message: string): CertifyOutcome => ({ ok: false, status, code, message });

export async function certifyRepairs(
  admin: SupabaseClient,
  orgId: string,
  inspectionId: string,
  actorId: string,
  input: RoadsideRepairCertifyRequest,
  now: Date = new Date(),
): Promise<CertifyOutcome> {
  const repairs = await readInspectionRepairs(admin, orgId, inspectionId);
  if ("error" in repairs) return repairs;
  if (repairs.length === 0) return refuse(404, "not_found", "This inspection has no vehicle violation to certify.");
  if (!repairs.every(repairSettled)) {
    return refuse(422, "not_settled", "Every unit's repair must be recorded before the report can be certified.");
  }
  const current = repairs.map((r) => r.basedOn).sort();
  if (JSON.stringify(current) !== JSON.stringify([...new Set(input.basedOn)].sort())) {
    return refuse(409, "changed", "The repair record changed since the page loaded. Reload to see it before certifying.");
  }

  const [insp, org] = await Promise.all([
    admin
      .from("roadside_inspections")
      .select("report_number, report_state, inspection_date, level, location_desc")
      .eq("org_id", orgId)
      .eq("id", inspectionId)
      .is("vanished_at", null)
      .maybeSingle(),
    admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle(),
  ]);
  if (insp.error) return { error: insp.error };
  if (org.error) return { error: org.error };
  if (!insp.data) return refuse(404, "not_found", "Roadside inspection not found");
  const carrier = await getCarrierIdentity(admin, orgId);
  if ("code" in carrier) return { error: { message: carrier.error } };

  const zone = organizationTimezone(org.data?.operating_hours);
  const signedOn = todayInZone(now, zone);
  const signerName = labelOf((await memberLabels(admin, orgId, [actorId])).get(actorId));
  // A signature needs a name: the profile's, never one typed here (0485).
  if (!signerName) return refuse(422, "no_name", "Your account has no name on it. Add your name to your profile, then certify.");
  const title = input.signerTitle.trim();
  const id = derivedUuid(`roadside-repair-certification:${inspectionId}:${current.join(",")}:${actorId}:${signedOn}:${title}`);
  const documentId = derivedUuid(`${id}:document`);

  let records;
  try {
    records = await readWorkOrderRecords(admin, orgId, repairs.flatMap((r) => (r.decision?.workOrder ? [r.decision.workOrder.workOrderId] : [])));
  } catch (e) {
    return { error: { message: e instanceof Error ? e.message : String(e) } };
  }
  const units: RepairRecordUnit[] = repairs.map((r) => ({
    name: repairUnitName(r),
    violations: r.violations,
    settlement: r.decision ? (r.decision.outcome === "accepted" ? "accepted" : "outside") : "at_scene",
    decidedBy: r.decision?.decidedBy ?? null,
    decidedAt: r.decision?.decidedAt ?? null,
    note: r.decision?.note ?? null,
    workOrderRef: r.decision?.workOrder?.reference ?? r.decision?.workOrder?.workOrderId ?? null,
    workOrder: r.decision?.workOrder ? records.orders.get(r.decision.workOrder.workOrderId) ?? null : null,
  }));
  const certifiedAt = now.toISOString();
  const pdf = await renderRepairRecord({
    carrier: { name: carrier.name, dotNumber: carrier.dotNumber },
    inspection: {
      reportNumber: insp.data.report_number, reportState: insp.data.report_state, inspectionDate: insp.data.inspection_date,
      level: insp.data.level, location: insp.data.location_desc,
    },
    units,
    fleetpalAsOf: records.asOf,
    certification: { id, signerName, signerTitle: title, signedOn, certifiedAt },
    timeZone: zone,
  });
  const filed = await fileGeneratedDocument(
    admin,
    orgId,
    { id: documentId, subjectType: "roadside_inspection", subjectId: inspectionId, kind: "roadside_repair_record", uploadedBy: actorId, capturedAt: signedOn },
    pdf,
  );
  if ("code" in filed) return { error: { message: filed.error } };

  const { error } = await admin.from("inspection_repair_certifications").insert({
    id,
    org_id: orgId,
    inspection_id: inspectionId,
    certified_by: actorId,
    signer_name: signerName,
    signer_title: title,
    signed_on: signedOn,
    repairs: repairs.map((r) => ({ unitId: r.unitId, repairId: r.basedOn })),
    document_id: filed.documentId,
  });
  // 23505: the same act retried — its record and its row are already there.
  if (error && error.code !== "23505") return { error };
  if (!error) {
    await writeAudit(admin, {
      orgId,
      actorId,
      action: "roadside.repair_certified",
      entity: "roadside_inspection",
      entityId: inspectionId,
      meta: { certificationId: id, documentId: filed.documentId, sha256: filed.sha256, signerTitle: title, signedOn, repairs: current },
    });
  }
  return {
    ok: true,
    data: { id, signerName, signerTitle: title, signedOn, certifiedAt, documentId: filed.documentId, current: true },
  };
}
