import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENTS_BUCKET } from "@silvicom/shared";
import { derivedUuid } from "../../../../lib/derivedUuid.js";
import { fileGeneratedDocument } from "../../../evidence/index.js";
import { flowedDocumentPdf, type HandbookMarkPrint } from "../handbook/handbookPdf.js";
import { carrierOf, signatureMarkBytes } from "../sources.js";
import {
  DRUG_ALCOHOL_POLICY_DOCUMENT,
  DRUG_ALCOHOL_POLICY_PLACEMENT_ID,
  DRUG_ALCOHOL_POLICY_VERSION,
} from "./drugAlcoholPolicyText.js";

/**
 * The carrier's drug-and-alcohol policy as the driver is GIVEN it, and as it is FILED (DAP2,
 * HIRING-WORKFLOW-AUDIT-2026-10-31 §15.2, D-DAP2/D-DAP3).
 *
 * ── ONE SIGNATURE, TWO PAGES ──────────────────────────────────────────────────────────────────
 * The policy's last place, DRIVER SIGNATURE / DATE, is packet placement `p28` — the §382.601(d) receipt.
 * The driver signs it once, on the packet walk, and that one `application_packet_marks` row prints on the
 * packet's page 28 AND on the policy's last page. So the policy has no marks of its own to read: its
 * signature is the packet's, drawn with the packet's adoption.
 *
 * ── ⚠ A RECEIPT FOR ANOTHER TEXT PRINTS NOTHING ───────────────────────────────────────────────
 * A p28 mark names the version it was signed against (0565). Drawing it on a different text would put
 * the driver's signature under words they were never given — A-6's handbook rule. So a mark with another
 * version, or with none (every p28 before DAP2, D-DAP5), leaves the line blank on the reading copy and
 * files nothing; the packet's page 28 still carries it, as it always did.
 */

export interface PolicyReceipt {
  signedName: string;
  signedAt: string;
  /** The `dap-…` version the receipt was signed against; null on a p28 from before 0565. */
  policyVersion: string | null;
}

/** This link's p28 mark, if made. */
export async function policyReceipt(admin: SupabaseClient, orgId: string, invitationId: string): Promise<PolicyReceipt | null> {
  const { data } = await admin
    .from("application_packet_marks")
    .select("signed_name, signed_at, policy_version")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .eq("placement_id", DRUG_ALCOHOL_POLICY_PLACEMENT_ID)
    .maybeSingle();
  const row = data as { signed_name: string; signed_at: string; policy_version: string | null } | null;
  return row ? { signedName: row.signed_name, signedAt: row.signed_at, policyVersion: row.policy_version } : null;
}

/** Whether a receipt was signed for the text this process prints. */
export const receiptIsForThisText = (receipt: PolicyReceipt | null): receipt is PolicyReceipt =>
  receipt?.policyVersion === DRUG_ALCOHOL_POLICY_VERSION;

/**
 * The policy, with the receipt on its signature line when it was signed for this text.
 *
 * ⚠ ONE DRAWING FOR EVERY READER. The applicant's link, the filed copy and the office's blank preview
 * in Settings → Recruiting (`drugAlcoholPolicyPreview.ts`) all come through here, so the office reads the
 * pages the driver is given — the handbook preview's rule (A2's lesson). The preview passes no link,
 * which is what leaves the signature line blank, and a `band`, which only the office's copy carries
 * (`PreviewAudience.band`'s reason).
 */
export async function drugAlcoholPolicyPdf(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string | null,
  receipt: PolicyReceipt | null,
  band: string | null = null,
): Promise<Buffer> {
  // A receipt prints only on the link that made it, and only for the text it was signed against.
  const signedOn = invitationId !== null && receiptIsForThisText(receipt) ? invitationId : null;
  const marks = new Map<string, HandbookMarkPrint>();
  if (signedOn !== null && receipt) {
    marks.set(DRUG_ALCOHOL_POLICY_PLACEMENT_ID, { signedName: receipt.signedName, signedAt: receipt.signedAt });
  }
  const [carrier, driverSignature] = await Promise.all([
    carrierOf(admin, orgId),
    // The packet's adoption: p28 is a packet mark, so the policy prints the picture page 28 prints.
    signedOn !== null ? signatureMarkBytes(admin, orgId, signedOn, "signature", "packet") : Promise.resolve(null),
  ]);
  return flowedDocumentPdf(DRUG_ALCOHOL_POLICY_DOCUMENT, {
    carrier: { name: carrier.name },
    // The policy's place asks for a signature and a date and nothing else, so neither prints.
    driverName: receipt?.signedName ?? "",
    ssnLast4: null,
    marks,
    driverSignature,
    countersign: null,
    band,
  });
}

/**
 * The filed policy's document id, derived from the application it was filed with (`derivedUuid`'s
 * reason): a retried filing lands on the same row, and the driver's link finds the filed copy without a
 * column to point at it.
 */
export const filedPolicyDocumentId = (applicationId: string): string => derivedUuid(`drug-alcohol-policy:${applicationId}`);

export type PolicyFiling =
  | { filed: true; documentId: string; replay: boolean }
  | { filed: false; reason: "no_invitation" | "no_receipt" | "receipt_before_0565" | "signed_under_other_text" | "storage_failed" };

/**
 * File the signed policy on the driver, with the packet (D-DAP3). Idempotent: the row's id is derived
 * from the application, so a second call is a replay — checked first, so a replay renders nothing.
 *
 * ⚠ Called by `ensureDriverFiledApplication`, which is also the packet's retry: a policy whose filing
 * failed at submit heals the next time anybody opens the application.
 */
export async function fileDrugAlcoholPolicy(
  admin: SupabaseClient,
  application: { id: string; org_id: string; driver_id: string; invitation_id: string | null },
): Promise<PolicyFiling> {
  if (!application.invitation_id) return { filed: false, reason: "no_invitation" };
  const documentId = filedPolicyDocumentId(application.id);
  const { data: existing } = await admin
    .from("documents")
    .select("id")
    .eq("org_id", application.org_id)
    .eq("id", documentId)
    .maybeSingle();
  if (existing) return { filed: true, documentId, replay: true };

  const receipt = await policyReceipt(admin, application.org_id, application.invitation_id);
  // A §391.21 summary (no packet marks) never had a page 28 to sign.
  if (!receipt) return { filed: false, reason: "no_receipt" };
  // D-DAP5: a p28 made before 0565 named no text, so there is no policy it can be printed under.
  if (receipt.policyVersion === null) return { filed: false, reason: "receipt_before_0565" };
  if (!receiptIsForThisText(receipt)) return { filed: false, reason: "signed_under_other_text" };

  const pdf = await drugAlcoholPolicyPdf(admin, application.org_id, application.invitation_id, receipt);
  const filed = await fileGeneratedDocument(admin, application.org_id, {
    id: documentId,
    subjectType: "driver",
    subjectId: application.driver_id,
    kind: "drug_alcohol_policy",
    // The applicant's own signing produced it, as it produced the packet (`file.ts`'s reason).
    uploadedBy: null,
  }, pdf);
  if ("error" in filed) return { filed: false, reason: "storage_failed" };
  return { filed: true, documentId, replay: !filed.filed };
}

/** The filed policy's bytes for an application, or null when none is filed. */
export async function filedPolicyBytes(admin: SupabaseClient, orgId: string, applicationId: string): Promise<Buffer | null> {
  const { data: doc } = await admin
    .from("documents")
    .select("storage_path")
    .eq("org_id", orgId)
    .eq("id", filedPolicyDocumentId(applicationId))
    .maybeSingle();
  const path = (doc as { storage_path?: string } | null)?.storage_path;
  if (!path) return null;
  const file = await admin.storage.from(DOCUMENTS_BUCKET).download(path);
  return file.data ? Buffer.from(await file.data.arrayBuffer()) : null;
}
