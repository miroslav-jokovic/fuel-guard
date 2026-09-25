import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DOCUMENTS_BUCKET,
  roadTestPassed,
  validateRoadTest,
  type RoadTestExaminer,
  type RoadTestExaminerCreate,
  type RoadTestRecord,
  type RoadTestResult,
} from "@silvicom/shared";
import { fileGeneratedDocument, insertQualificationRecord } from "../evidence/index.js";
import { displayNameFor } from "../../lib/memberLabels.js";
import { carrierOf } from "./applicationPdf/sources.js";
import {
  roadTestCertificatePdf,
  roadTestFormPdf,
  type RoadTestDocumentInput,
} from "./applicationPdf/roadTest.js";

/**
 * Recording a §391.31 road test, and the examiners who give one — D2 (`ROAD-TEST-PLAN.md` RT3).
 *
 * ── WHAT RECORDING FILES ──────────────────────────────────────────────────────────────────────
 * Always the FORM (examination + evaluation), as a `documents` row of kind `road_test`: §391.31(g)
 * keeps the signed form whatever it says. On a pass (`roadTestPassed`, never re-decided here), also
 * the CERTIFICATE and one `qualification_records` row of kind `road_test` citing it — which is what
 * turns the checklist's step 13 green. A failed test files its form and nothing the fold counts, so
 * the step stays open and the file still shows the attempt.
 *
 * ── THE SIGNATURE IS THE OFFICE'S ACT ON THE EXAMINER'S BEHALF (Q-RT2) ───────────────────────
 * The owner ruled the examiner's signature is added once from the dashboard and printed on his tests.
 * So each filing records the examiner row AND the office user who recorded it — in `detail`, on the
 * printed page, and in the audit row the route writes. Who judged and who applied the signature stay
 * two facts.
 *
 * ⚠ The service role bypasses RLS: every read below filters on `org_id` itself.
 */

export interface RoadTestError {
  code: "not_found" | "invalid_request" | "storage_failed" | "insert_failed";
  message: string;
  issues?: Array<{ field: string; message: string }>;
}

/** No success shape here carries a `code`, so its presence is the whole test. */
export const isRoadTestError = (v: unknown): v is RoadTestError =>
  typeof v === "object" && v !== null && "code" in v && "message" in v;

const EXAMINER_COLS = "id, full_name, title, created_at";

/** The examiners who may sign today — retired ones stay in the table for the tests they signed. */
export async function listRoadTestExaminers(admin: SupabaseClient, orgId: string): Promise<RoadTestExaminer[]> {
  const { data } = await admin
    .from("road_test_examiners")
    .select(EXAMINER_COLS)
    .eq("org_id", orgId)
    .is("retired_at", null)
    .order("created_at", { ascending: true });
  return (data ?? []) as RoadTestExaminer[];
}

/** The PNG signature, magic-checked: a data URL that says PNG is not proof the bytes are one. */
function pngBytes(dataUrl: string): Buffer | null {
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes.length > 8 && bytes.subarray(0, 8).equals(magic) ? bytes : null;
}

export async function addRoadTestExaminer(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  body: RoadTestExaminerCreate,
): Promise<RoadTestExaminer | RoadTestError> {
  const png = pngBytes(body.signature_png);
  if (!png) return { code: "invalid_request", message: "The signature must be a PNG image." };
  const id = randomUUID();
  // The org's OWN folder — 0372's CHECK refuses any other, so this cannot drift from it silently.
  const path = `${orgId}/examiners/${id}.png`;
  const upload = await admin.storage.from(DOCUMENTS_BUCKET).upload(path, png, { contentType: "image/png", upsert: false });
  if (upload.error) return { code: "storage_failed", message: "Could not store the signature." };
  const { data, error } = await admin
    .from("road_test_examiners")
    .insert({ id, org_id: orgId, full_name: body.full_name.trim(), title: body.title.trim(), signature_path: path, created_by: userId })
    .select(EXAMINER_COLS)
    .single();
  if (error || !data) return { code: "insert_failed", message: "Could not add the examiner." };
  return data as RoadTestExaminer;
}

/** Retire, never delete (0372, RT010) — a filed test must still resolve the examiner it names. */
export async function retireRoadTestExaminer(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  examinerId: string,
): Promise<{ id: string } | RoadTestError> {
  const { data, error } = await admin
    .from("road_test_examiners")
    .update({ retired_at: new Date().toISOString(), retired_by: userId })
    .eq("org_id", orgId)
    .eq("id", examinerId)
    .is("retired_at", null)
    .select("id")
    .maybeSingle();
  if (error) return { code: "insert_failed", message: "Could not retire the examiner." };
  if (!data) return { code: "not_found", message: "That examiner is not on file." };
  return { id: examinerId };
}

interface DriverRow {
  full_name: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  cdl_number: string | null;
  cdl_state: string | null;
}

/**
 * The street line of where the applicant lives now, off their application draft by PATH.
 *
 * ⚠ `drivers` carries city/state/zip and no street, and the road test comes before the application is
 * FILED (it is given in the office, before the packet), so the draft is where the street is. Only
 * `address_history` is selected — never the payload (A11, D-APP16).
 */
async function streetOnDraft(admin: SupabaseClient, orgId: string, driverId: string): Promise<string | null> {
  const { data: invites } = await admin
    .from("application_invitations")
    .select("id")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const invitationId = ((invites ?? []) as Array<{ id: string }>)[0]?.id;
  if (!invitationId) return null;
  const { data } = await admin
    .from("application_drafts")
    .select("address_history:payload->address_history")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  const history = (data as { address_history?: unknown } | null)?.address_history;
  if (!Array.isArray(history)) return null;
  const current = (history.find((a) => a && typeof a === "object" && !(a as { to?: unknown }).to) ?? history[0]) as
    | { line1?: unknown }
    | undefined;
  return typeof current?.line1 === "string" && current.line1.trim() ? current.line1.trim() : null;
}

async function examinerForPrint(
  admin: SupabaseClient,
  orgId: string,
  examinerId: string,
): Promise<{ fullName: string; title: string; signature: Buffer | null } | null> {
  const { data } = await admin
    .from("road_test_examiners")
    .select("full_name, title, signature_path")
    .eq("org_id", orgId)
    .eq("id", examinerId)
    .is("retired_at", null)
    .maybeSingle();
  const row = data as { full_name: string; title: string; signature_path: string } | null;
  if (!row) return null;
  // A missing file costs the picture, never the test: the renderer prints the typed name instead.
  const file = await admin.storage.from(DOCUMENTS_BUCKET).download(row.signature_path);
  const signature = file.data ? Buffer.from(await file.data.arrayBuffer()) : null;
  return { fullName: row.full_name, title: row.title, signature };
}

async function gather(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  role: string | null,
  driverId: string,
  body: RoadTestRecord,
): Promise<RoadTestDocumentInput | RoadTestError> {
  const [{ data: driverRow }, { data: vehicleRow }, examiner] = await Promise.all([
    admin
      .from("drivers")
      .select("full_name, phone, city, state, postal_code, cdl_number, cdl_state")
      .eq("org_id", orgId)
      .eq("id", driverId)
      .maybeSingle(),
    admin
      .from("vehicles")
      .select("unit_number, make, year")
      .eq("org_id", orgId)
      .eq("id", body.vehicle_id)
      .maybeSingle(),
    examinerForPrint(admin, orgId, body.examiner_id),
  ]);
  const driver = driverRow as DriverRow | null;
  if (!driver) return { code: "not_found", message: "That applicant is not in this organization." };
  const vehicle = vehicleRow as { unit_number: string; make: string | null; year: number | null } | null;
  if (!vehicle) return { code: "invalid_request", message: "That truck is not on this carrier's roster." };
  if (!examiner) return { code: "invalid_request", message: "That examiner is not on file." };

  return {
    carrier: await carrierOf(admin, orgId),
    driver: {
      fullName: driver.full_name,
      address: {
        line1: await streetOnDraft(admin, orgId, driverId),
        city: driver.city,
        state: driver.state,
        zip: driver.postal_code,
      },
      phone: driver.phone,
      licenceNumber: driver.cdl_number,
      licenceState: driver.cdl_state,
    },
    // "2021 FRHT #1432": the carrier's form writes a power unit as year, make and unit number.
    powerUnit: [vehicle.year, vehicle.make, `#${vehicle.unit_number}`].filter(Boolean).join(" "),
    record: body,
    examiner,
    recordedBy: (await displayNameFor(admin, userId, orgId, role)) ?? "an office user",
  };
}

export async function recordRoadTest(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  role: string | null,
  driverId: string,
  body: RoadTestRecord,
  today: string,
): Promise<RoadTestResult | RoadTestError> {
  const issues = validateRoadTest(body, today);
  if (issues.length > 0) return { code: "invalid_request", message: issues[0]!.message, issues };

  const input = await gather(admin, orgId, userId, role, driverId, body);
  if (isRoadTestError(input)) return input;

  const file = async (pdf: Buffer) =>
    fileGeneratedDocument(admin, orgId, {
      id: randomUUID(), subjectType: "driver", subjectId: driverId, kind: "road_test", uploadedBy: userId,
    }, pdf);

  const form = await file(await roadTestFormPdf(input));
  if ("error" in form) return { code: "storage_failed", message: "Could not file the road-test form." };

  const passed = roadTestPassed(body);
  if (!passed) return { passed, formDocumentId: form.documentId, certificateDocumentId: null, recordId: null };

  const certificate = await file(await roadTestCertificatePdf(input));
  if ("error" in certificate) return { code: "storage_failed", message: "Could not file the certificate." };

  const recordId = randomUUID();
  const inserted = await insertQualificationRecord(admin, orgId, userId, {
    id: recordId,
    driverId,
    kind: "road_test",
    occurredOn: body.tested_on,
    coversUntil: null,
    result: "Passed",
    performedBy: `${input.examiner.fullName}, ${input.examiner.title}`,
    reference: null,
    documentId: certificate.documentId,
    detail: {
      source: "road_test",
      hiring_step: "road_test",
      examiner_id: body.examiner_id,
      recorded_by: userId,
      form_document_id: form.documentId,
      vehicle_id: body.vehicle_id,
      trailer_type: body.trailer_type,
      miles: body.miles,
      general_performance: body.general_performance,
      items: body.items,
    },
  });
  if ("error" in inserted) return { code: "insert_failed", message: "Could not record the road test." };
  return { passed, formDocumentId: form.documentId, certificateDocumentId: certificate.documentId, recordId };
}
