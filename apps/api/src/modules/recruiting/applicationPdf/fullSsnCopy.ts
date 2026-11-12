import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, rgb } from "pdf-lib";
import { DOCUMENTS_BUCKET, formatSsn, type DriverApplication } from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { writeAudit } from "../../../lib/audit.js";
import { open, secretAad } from "../../../lib/secretBox.js";
import { filedAsPacket } from "./file.js";
import { packetFieldFill } from "./packet/packetFieldValues.js";
import { drawFieldValues } from "./packet/packetFit.js";
import type { PlacedFieldValue } from "./packet/packetGrid.js";

/**
 * The filed packet with the SSN in full, on demand, for a holder of "See the full SSN" (Q-AM20 (a),
 * owner 2026-11-12).
 *
 * ── WHY ON DEMAND, AND WHY OVER THE STORED BYTES ──────────────────────────────────────────────
 * The stored packet is opened by everyone who may open the driver's documents, recruiters included, so
 * it prints the last four (`file.ts`). The whole number is printed only for its reader, and never
 * stored: a second stored copy is a second place for nine digits to leak from, and the evidence is
 * `driver_applications.ssn_sealed` and the stored bytes, both of which already exist (D-APP9's
 * derivative rule).
 *
 * It is drawn OVER the stored copy the office was handed — the countersigned one once there is one —
 * rather than re-rendered from the payload: everything else on the page stays exactly as filed and
 * signed, and only the four SSN places change. Each is covered above its rule and redrawn with the same
 * face and fitting the packet uses (`drawFieldValues`). ⚠ A grid cell's size is decided with its
 * siblings when the packet is first drawn, and here it is decided alone, so the nine digits may sit a
 * point larger or smaller than the masked four did. It is the same place, on the reader's copy only.
 * ⚠ The cover is visual: the masked four stay in the text layer beneath it. Text extraction of this copy
 * reads both; the page shows only the nine digits (checked by rendering it, which no unit test can do).
 *
 * Every read is audited (who, which application; never the number), like the card's Show.
 */

export interface FullSsnCopyError {
  code: "document_not_found" | "not_a_packet" | "last_four_only" | "storage_failed";
  message: string;
}
export const isFullSsnCopyError = (v: unknown): v is FullSsnCopyError =>
  typeof v === "object" && v !== null && "code" in v && "message" in v && !Buffer.isBuffer(v);

/** The packet's four SSN places (`packetFieldGeometry.ts`), found by placing a value and keeping those lines. */
function ssnPlaces(application: DriverApplication, text: string): PlacedFieldValue[] {
  const { placed } = packetFieldFill({ application, certifiedAt: "", markedAt: {}, signedName: "", ssn: text });
  return placed.filter((p) => /^p(01|04|15)\.ssn$/.test(p.line.id) || (p.line.cell?.tableId === "p12.identity" && p.line.cell.col === 4));
}

/** Cover what a place printed (above its rule, never the rule itself) and draw the nine digits there. */
export async function withFullSsn(stored: Uint8Array, application: DriverApplication, nine: string): Promise<Buffer> {
  const doc = await PDFDocument.load(stored);
  const places = ssnPlaces(application, formatSsn(nine));
  for (const p of places) {
    doc.getPage(p.line.page - 1).drawRectangle({
      x: p.line.x1 + 1.5, y: p.line.y + 0.8, width: p.line.x2 - p.line.x1 - 3, height: 13, color: rgb(1, 1, 1),
    });
  }
  await drawFieldValues(doc, places);
  return Buffer.from(await doc.save());
}

/** Which application a stored document is: the driver's filing (cited by its record) or the countersigned copy. */
async function applicationOfDocument(admin: SupabaseClient, orgId: string, documentId: string): Promise<string | null> {
  const { data: cited } = await admin
    .from("qualification_records")
    .select("reference")
    .eq("org_id", orgId)
    .eq("kind", "employment_application")
    .eq("document_id", documentId)
    .maybeSingle();
  const reference = (cited as { reference?: string | null } | null)?.reference;
  if (reference) return reference;
  const { data: copy } = await admin
    .from("application_packet_countersignatures")
    .select("application_id")
    .eq("org_id", orgId)
    .eq("document_id", documentId)
    .maybeSingle();
  return (copy as { application_id?: string | null } | null)?.application_id ?? null;
}

export async function fullSsnApplicationPdf(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  documentId: string,
  actorId: string,
): Promise<Buffer | FullSsnCopyError> {
  const notFound: FullSsnCopyError = { code: "document_not_found", message: "That signed application is not in this organization." };
  const applicationId = await applicationOfDocument(admin, orgId, documentId);
  if (!applicationId) return notFound;
  const [{ data: app }, { data: doc }] = await Promise.all([
    admin.from("driver_applications").select("id, invitation_id, payload, ssn_sealed").eq("org_id", orgId).eq("id", applicationId).maybeSingle(),
    admin.from("documents").select("storage_path").eq("org_id", orgId).eq("id", documentId).maybeSingle(),
  ]);
  const application = app as { id: string; invitation_id: string | null; payload: DriverApplication; ssn_sealed: string | null } | null;
  const stored = doc as { storage_path: string } | null;
  if (!application || !stored) return notFound;
  // The §391.21 summary an application from before the ceremony filed prints no SSN place at all.
  if (!(await filedAsPacket(admin, orgId, application.invitation_id))) return { code: "not_a_packet", message: "This application was filed before the carrier's packet, and it has no place for the number." };
  if (!application.ssn_sealed) {
    return { code: "last_four_only", message: "Only the last four digits were kept for this applicant, and the filed copy already shows them." };
  }
  const file = await admin.storage.from(DOCUMENTS_BUCKET).download(stored.storage_path);
  if (!file.data) return { code: "storage_failed", message: "The signed application could not be read. Try again." };

  const nine = open(env, application.ssn_sealed, secretAad(orgId, "driver_ssn"));
  const pdf = await withFullSsn(Buffer.from(await file.data.arrayBuffer()), application.payload, nine);
  await writeAudit(admin, {
    orgId, actorId, action: "application.ssn_viewed", entity: "driver_application", entityId: application.id,
    meta: { in: "filed_packet" },
  });
  return pdf;
}
