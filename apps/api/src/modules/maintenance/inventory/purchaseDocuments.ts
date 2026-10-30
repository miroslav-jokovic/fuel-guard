import type { SupabaseClient } from "@supabase/supabase-js";
import { shouldDerive, type DocumentRegisterResponse, type DocumentRow, type PurchaseDocumentRegisterRequest } from "@silvicom/shared";
import { writeAudit } from "../../../lib/audit.js";
import type { Env } from "../../../env.js";
import { dispatchJob } from "../../../queue/dispatch.js";
import { listDocuments, registerDocument, signDocumentDownload } from "../../evidence/index.js";
import { traced } from "../inspections/serviceError.js";
import type { ServiceError } from "./types.js";

/**
 * An equipment bill's paper — the PDF or the phone photo of the invoice (M10b, 0530). Filed in
 * `documents` against subject `equipment_purchase` as kind `equipment_invoice`, only through
 * `evidence`'s `registerDocument` (`maintenance -> evidence`): bucket, hash, signed upload and the
 * five-minute signed read are the DQ file's own (0146). `inspections/documents/inspectionDocuments.ts`
 * is the same door for a roadside ticket, and this file follows it line for line where it can.
 *
 * ── THE BILL MUST BE OURS ─────────────────────────────────────────────────────────────────────
 * `documents.subject_id` has no FK (polymorphic, 0146), so each route asks first that the bill is this
 * org's, and the download that the document is THIS bill's — a document id alone would otherwise let a
 * shop reader fetch any of the carrier's papers, a medical card included, through this route.
 *
 * A superseded bill still takes its paper and still shows it: the scan is of the paper that was sent,
 * which a typo in the total did not change. Append-only like every document — a wrong file is
 * answered by filing the right one.
 */

const NOT_FOUND: ServiceError = { error: "That bill is not on file.", code: "not_found" };
const NOT_FOUND_DOCUMENT: ServiceError = { error: "That paper is not on file for this bill.", code: "not_found" };

async function billIsOurs(admin: SupabaseClient, orgId: string, purchaseId: string): Promise<boolean | ServiceError> {
  const { data, error } = await admin.from("equipment_purchases").select("id").eq("org_id", orgId).eq("id", purchaseId).maybeSingle();
  if (error) return traced("purchaseDocuments", "db_error", "Could not load the bill", error);
  return Boolean(data);
}

export async function listPurchaseDocuments(
  admin: SupabaseClient,
  orgId: string,
  purchaseId: string,
): Promise<DocumentRow[] | ServiceError> {
  const ours = await billIsOurs(admin, orgId, purchaseId);
  if (ours !== true) return ours === false ? NOT_FOUND : ours;
  const out = await listDocuments(admin, orgId, { subjectType: "equipment_purchase", subjectId: purchaseId });
  if ("code" in out) return traced("listPurchaseDocuments", "db_error", "Could not load the paper", out);
  return out.rows;
}

/** Register one file and hand back the signed upload; the browser PUTs the bytes straight to Storage. */
export async function registerPurchaseDocument(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  purchaseId: string,
  actorId: string,
  input: PurchaseDocumentRegisterRequest,
): Promise<DocumentRegisterResponse | ServiceError> {
  const ours = await billIsOurs(admin, orgId, purchaseId);
  if (ours !== true) return ours === false ? NOT_FOUND : ours;

  const out = await registerDocument(admin, orgId, actorId, {
    ...input,
    subjectType: "equipment_purchase",
    subjectId: purchaseId,
    kind: "equipment_invoice",
    page: 1,
    variant: "original",
  });
  if ("code" in out) return traced("registerPurchaseDocument", "db_error", "Could not file the paper", out);

  await writeAudit(admin, {
    orgId,
    actorId,
    action: "maintenance.purchase_document_registered",
    entity: "equipment_purchases",
    entityId: purchaseId,
    meta: { documentId: out.documentId, sha256: input.sha256, bytes: input.bytes ?? null },
  });
  // Swallowed like the DQ file's: a missing thumbnail must not fail a filing (B8's backfill catches it).
  if (shouldDerive(input.contentType)) {
    await dispatchJob(admin, env, "document_derive", {
      orgId,
      payload: { documentId: out.documentId },
      dedupKey: `document_derive:${out.documentId}`,
      requestedBy: actorId,
    }).catch(() => undefined);
  }
  return out;
}

export async function signPurchaseDocumentDownload(
  admin: SupabaseClient,
  orgId: string,
  purchaseId: string,
  documentId: string,
  actorId: string,
): Promise<{ url: string; filename: string } | ServiceError> {
  const ours = await billIsOurs(admin, orgId, purchaseId);
  if (ours !== true) return ours === false ? NOT_FOUND : ours;
  const out = await signDocumentDownload(admin, orgId, documentId);
  if ("code" in out) return out.code === "not_found" ? NOT_FOUND_DOCUMENT : traced("signPurchaseDocumentDownload", "db_error", "Could not open the paper", out);
  if (out.subjectType !== "equipment_purchase" || out.subjectId !== purchaseId) return NOT_FOUND_DOCUMENT;
  await writeAudit(admin, {
    orgId,
    actorId,
    action: "maintenance.purchase_document_downloaded",
    entity: "equipment_purchases",
    entityId: purchaseId,
    meta: { documentId, filename: out.filename },
  });
  return { url: out.url, filename: out.filename };
}
