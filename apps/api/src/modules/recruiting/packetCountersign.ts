import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENTS_BUCKET, carrierPlacementIds, formatDisplayDate, todayInZone } from "@silvicom/shared";
import { fileGeneratedDocument, insertQualificationRecord } from "../evidence/index.js";
import { displayNameFor } from "../../lib/memberLabels.js";
import { ensureDriverFiledApplication, filedAsPacket } from "./applicationPdf/file.js";
import { stampPacketCountersignature } from "./applicationPdf/packet/packetCountersignStamp.js";
import { carrierZone } from "./carrierClock.js";
import { representativeForPrint } from "./representatives.js";

/**
 * The carrier's countersignature on the filed packet (Q-HB1; HANDBOOK-SIGNING-PLAN.md §6, D-HB7..D-HB11).
 *
 * ── WHERE IT RUNS ──────────────────────────────────────────────────────────────────────────────
 * Only from the handbook countersign (`handbookSigning.ts`), inside its filing claim and BEFORE the
 * handbook's own `h4c` (D-HB7): one press, one Representative, the packet first. The handbook is filed
 * last, so after it nothing is countersigned (0387's PC024), and a filed handbook always has a
 * countersigned packet behind it.
 *
 * ── THE ORDER, EACH STEP SAFE TO RETRY ─────────────────────────────────────────────────────────
 * 1. The row (0387), naming the Representative, the office user, the carrier lines and the SHA-256 of
 *    the driver's filing. Unique per invitation: a retry finds the row and keeps ITS Representative.
 * 2. The countersigned copy: the driver's filed bytes, stamped (`packetCountersignStamp.ts`), filed
 *    with the ROW's id as the document id. `fileGeneratedDocument` is idempotent by that id, so a retry
 *    after a crash finds the copy rather than filing a second one.
 * 3. `document_id` written onto the row, once (0387 refuses a second write).
 * 4. D-HB11: a new `employment_application` record citing the copy. Evidence's DQ file and binder read
 *    the NEWEST record of a kind (`dqFile.ts` `matchRecord`), so this is how the auditor's binder gets
 *    the countersigned packet without evidence reading a recruiting table (`evidence -> recruiting` is
 *    not an allowed edge). The first record, citing the driver's filing, is never touched: corrections
 *    and additions are new rows. Its `reference` is the countersignature id, not the application id,
 *    because `ensureDriverFiledApplication` finds the driver's record by `reference = application id`.
 *
 * ⚠ The §391.21 summary (an application with no packet marks) has no carrier lines. Its row records
 * `placements = '{}'`, and its "copy" is the driver's filing itself, so no second document and no second
 * record is made for a stamp that drew nothing (D-HB10).
 *
 * ⚠ The service role bypasses RLS: every query below filters on `org_id` itself.
 */

export interface PacketCountersignError {
  code: "not_found" | "link_expired" | "representative_not_found" | "packet_changed" | "storage_failed" | "insert_failed";
  message: string;
}

export const isPacketCountersignError = (v: unknown): v is PacketCountersignError =>
  typeof v === "object" && v !== null && "code" in v && "message" in v;

interface CountersignRow {
  id: string;
  representative_id: string;
  recorded_by: string;
  placements: string[];
  source_sha256: string;
  document_id: string | null;
  signed_at: string;
}

const ROW_COLS = "id, representative_id, recorded_by, placements, source_sha256, document_id, signed_at";

export interface PrintableRepresentative {
  id: string;
  fullName: string;
  title: string;
  signature: Buffer | null;
}

async function existingRow(admin: SupabaseClient, orgId: string, invitationId: string): Promise<CountersignRow | null> {
  const { data } = await admin
    .from("application_packet_countersignatures")
    .select(ROW_COLS)
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  return (data as CountersignRow | null) ?? null;
}

/** Step 1: the row, made now or found from an earlier press whose filing did not finish. */
async function recordRow(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  invitationId: string,
  applicationId: string,
  representativeId: string,
  placements: string[],
  sourceSha256: string,
): Promise<CountersignRow | PacketCountersignError> {
  const { data, error } = await admin
    .from("application_packet_countersignatures")
    .insert({
      org_id: orgId,
      invitation_id: invitationId,
      application_id: applicationId,
      representative_id: representativeId,
      recorded_by: userId,
      placements,
      source_sha256: sourceSha256,
    })
    .select(ROW_COLS)
    .single();
  if (!error && data) return data as CountersignRow;
  const code = (error as { code?: string } | null)?.code;
  if (code === "23505") {
    const found = await existingRow(admin, orgId, invitationId);
    if (found) return found;
  }
  // 0387's PC021, the same lapse the handbook's HB021 reports: the office's "Extend the driver's link" cures it.
  if (code === "PC021") return { code: "link_expired", message: "The driver's application link has expired." };
  return { code: "insert_failed", message: "Could not record the carrier's countersignature on the packet." };
}

async function downloadFiling(admin: SupabaseClient, storagePath: string): Promise<Buffer | null> {
  const file = await admin.storage.from(DOCUMENTS_BUCKET).download(storagePath);
  return file.data ? Buffer.from(await file.data.arrayBuffer()) : null;
}

/** Step 4 (D-HB11), once: the record citing the countersigned copy. */
async function recordCopy(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  driverId: string,
  invitationId: string,
  applicationId: string,
  row: CountersignRow,
  rep: PrintableRepresentative,
  documentId: string,
  driverFilingId: string,
  zone: string,
): Promise<PacketCountersignError | null> {
  const { data: already } = await admin
    .from("qualification_records")
    .select("id")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .eq("kind", "employment_application")
    .eq("reference", row.id)
    .limit(1);
  if (((already ?? []) as unknown[]).length > 0) return null;
  const inserted = await insertQualificationRecord(admin, orgId, userId, {
    id: randomUUID(),
    driverId,
    kind: "employment_application",
    occurredOn: todayInZone(new Date(row.signed_at), zone),
    coversUntil: null,
    result: "Countersigned",
    performedBy: `${rep.fullName}, ${rep.title}`,
    reference: row.id,
    documentId,
    detail: {
      source: "packet_countersign",
      hiring_step: "handbook",
      invitation_id: invitationId,
      application_id: applicationId,
      countersignature_id: row.id,
      driver_filing_document_id: driverFilingId,
      representative_id: rep.id,
      recorded_by: row.recorded_by,
      placements: row.placements,
    },
  });
  return "error" in inserted ? { code: "insert_failed", message: "Could not record the countersigned packet." } : null;
}

/** Steps 2 and 3: stamp and file the copy (or, for the summary, name the filing itself), then cite it on the row. */
async function fileCopy(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  role: string | null,
  driverId: string,
  row: CountersignRow,
  rep: PrintableRepresentative,
  bytes: Buffer,
  sha: string,
  driverFilingId: string,
  zone: string,
): Promise<string | PacketCountersignError> {
  // The row names the bytes it signs. A retry reading other bytes is a filing that changed under it,
  // which `file.ts` never does; stamping anyway would file a copy of a document nobody countersigned.
  if (row.source_sha256 !== sha) {
    return { code: "packet_changed", message: "The filed application changed since it was countersigned. Nothing was filed." };
  }
  let documentId = driverFilingId;
  if (row.placements.length > 0) {
    const appliedBy = (await displayNameFor(admin, row.recorded_by, orgId, row.recorded_by === userId ? role : null))
      ?? "an office user";
    const pdf = await stampPacketCountersignature(bytes, {
      placements: row.placements,
      signature: rep.signature,
      fullName: rep.fullName,
      title: rep.title,
      appliedBy,
      signedOn: formatDisplayDate(todayInZone(new Date(row.signed_at), zone)),
    });
    const filed = await fileGeneratedDocument(admin, orgId, {
      id: row.id, subjectType: "driver", subjectId: driverId, kind: "employment_application", uploadedBy: userId,
    }, pdf);
    if ("error" in filed) return { code: "storage_failed", message: "Could not file the countersigned application." };
    documentId = filed.documentId;
  }
  const { error } = await admin
    .from("application_packet_countersignatures")
    .update({ document_id: documentId })
    .eq("org_id", orgId)
    .eq("id", row.id)
    .is("document_id", null);
  if (error) return { code: "insert_failed", message: "Could not record the countersigned application." };
  return documentId;
}

/**
 * Countersign the driver's filed packet with `chosen`, or finish an earlier press that did not.
 * Returns the Representative who signed (the ROW's, on a retry) and the document the office now gets.
 */
export async function countersignPacket(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  role: string | null,
  driverId: string,
  invitationId: string,
  chosen: PrintableRepresentative,
): Promise<{ representative: PrintableRepresentative; documentId: string } | PacketCountersignError> {
  const { data: app } = await admin
    .from("driver_applications")
    .select("id")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  const applicationId = (app as { id?: string } | null)?.id ?? null;
  if (!applicationId) return { code: "not_found", message: "This applicant has no filed application." };

  const filing = await ensureDriverFiledApplication(admin, orgId, applicationId);
  const bytes = filing ? await downloadFiling(admin, filing.storagePath) : null;
  if (!filing || !bytes) return { code: "storage_failed", message: "Could not read the filed application to countersign it." };
  const sha = createHash("sha256").update(bytes).digest("hex");
  const placements = (await filedAsPacket(admin, orgId, invitationId)) ? carrierPlacementIds() : [];

  const row = await recordRow(admin, orgId, userId, invitationId, applicationId, chosen.id, placements, sha);
  if (isPacketCountersignError(row)) return row;
  const rep = row.representative_id === chosen.id ? chosen : await representativeForPrint(admin, orgId, row.representative_id);
  if (!rep) return { code: "representative_not_found", message: "That representative is not on file." };
  const zone = await carrierZone(admin, orgId);
  const documentId = row.document_id ?? await fileCopy(admin, orgId, userId, role, driverId, row, rep, bytes, sha,
    filing.documentId, zone);
  if (isPacketCountersignError(documentId)) return documentId;

  // ⚠ Runs on EVERY press, including one that finds the copy already filed: a press that died between
  // writing `document_id` and this record must be finished by the next one, not skipped by it.
  if (row.placements.length > 0) {
    const failed = await recordCopy(admin, orgId, userId, driverId, invitationId, applicationId, row, rep, documentId,
      filing.documentId, zone);
    if (failed) return failed;
  }
  return { representative: rep, documentId };
}
