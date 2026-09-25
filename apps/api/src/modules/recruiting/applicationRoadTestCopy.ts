import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENTS_BUCKET } from "@silvicom/shared";
import { writeAudit } from "../../lib/audit.js";
import { APPLICANT_COPY_TTL_SEC, type ApplicantCopy } from "./applicationCopy.js";
import { isIntakeError, resolveInvitation, type IntakeError } from "./applicationIntake.js";

/**
 * The driver's copy of their road-test certificate (§391.31(g); `ROAD-TEST-PLAN.md` RT4).
 *
 * ── WHY THE LINK SERVES IT ────────────────────────────────────────────────────────────────────
 * §391.31(g) is two sentences: the carrier keeps the original in the qualification file, and *"a copy
 * of the certificate shall be given to the person who was examined"*. RT3 filed the original. Until
 * this module the only way the second sentence was ever met was the office remembering to print it.
 * The applicant's link is the one channel this product already has to the person who was examined, and
 * `applicationCopy.ts` already hands them the application over it — so the certificate goes the same
 * way, with the same three bounds (a short-lived signed URL, the bytes never through this API, the
 * read audited). The argument for why the token is enough is that module's, and it holds here: the
 * certificate says less than the draft the same token already reads.
 *
 * ── THE CERTIFICATE, NEVER THE FORM ───────────────────────────────────────────────────────────
 * ⚠ RT3 files TWO documents of `documents.kind = 'road_test'` on every pass: the examination form,
 * which carries the examiner's nine ratings and remarks, and the certificate, which carries none of
 * them. Only the certificate is owed to the driver, and the ratings are the carrier's working record.
 * So this never looks in `documents` by kind — the two would be indistinguishable there. It follows the
 * `qualification_records` row RT3 writes on a pass, whose `document_id` is the certificate by
 * construction (`recordRoadTest`: the form's id is in `detail.form_document_id`, never in the column).
 *
 * ⚠ And only rows RT3 wrote (`detail.source = 'road_test'`). A `road_test` row recorded by hand on the
 * DQF page cites whatever the office scanned — the form, the certificate, or both stapled together —
 * and nothing about the row says which. Serving that to an unauthenticated link on the strength of a
 * kind would be the guess this module exists not to make. Those drivers get their copy from the office,
 * as every driver did before RT4.
 *
 * ── WHICH ONE ─────────────────────────────────────────────────────────────────────────────────
 * The latest by test date, then by filing. Rows are append-only (evidence), so a re-test is a second
 * row and the first certificate stays filed; the driver is owed the one that qualified them now.
 */

/** Filed on a pass by `recordRoadTest`, and the only rows whose `document_id` is known to be a certificate. */
const ROAD_TEST_SOURCE = "road_test";

export const ROAD_TEST_CERTIFICATE_FILENAME = "road-test-certificate.pdf";

const NO_CERTIFICATE: IntakeError = {
  code: "no_certificate",
  message: "There is no road-test certificate on file for you yet. The carrier issues it after you pass.",
};

const NOT_AVAILABLE: IntakeError = {
  code: "document_unavailable",
  message: "Your certificate could not be prepared just now. Try again in a moment, or ask the carrier for it.",
};

interface CertificateRow {
  id: string;
  document_id: string;
  occurred_on: string;
}

/**
 * The driver's latest certificate RT3 filed, or null.
 *
 * Exported for the link's own payload (`GET /:token`), which says whether there is one so the page
 * offers the button only when pressing it can work — the same query, so the two cannot disagree.
 */
export async function latestRoadTestCertificate(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<CertificateRow | null> {
  const { data } = await admin
    .from("qualification_records")
    .select("id, document_id, occurred_on")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .eq("kind", "road_test")
    .eq("detail->>source", ROAD_TEST_SOURCE)
    .not("document_id", "is", null)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);
  return ((data ?? []) as CertificateRow[])[0] ?? null;
}

export async function applicantRoadTestCertificate(
  admin: SupabaseClient,
  token: string,
  now: Date,
): Promise<ApplicantCopy | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;

  const record = await latestRoadTestCertificate(admin, invitation.org_id, invitation.driver_id);
  if (!record) return NO_CERTIFICATE;

  const { data: doc } = await admin
    .from("documents")
    .select("storage_path")
    .eq("org_id", invitation.org_id)
    .eq("id", record.document_id)
    .maybeSingle();
  const storagePath = (doc as { storage_path?: string } | null)?.storage_path;
  // The record cites a document this org does not hold. A broken invariant, not the driver's doing,
  // so it reads as "not just now" — never as a dead link, and never as "you have not passed".
  if (!storagePath) return NOT_AVAILABLE;

  const { data: signed, error } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, APPLICANT_COPY_TTL_SEC, { download: ROAD_TEST_CERTIFICATE_FILENAME });
  if (error || !signed?.signedUrl) return NOT_AVAILABLE;

  // ⚠ Awaited and its result ignored, for `applicationCopy.ts`'s reason: a driver is not refused the
  // copy the regulation says they are given because the audit table blinked, but the read does not go
  // out before the attempt to record it.
  await writeAudit(admin, {
    orgId: invitation.org_id,
    actorId: null,
    action: "road_test_certificate_downloaded",
    entity: "qualification_records",
    entityId: record.id,
    meta: { invitationId: invitation.id, documentId: record.document_id },
  });

  return { url: signed.signedUrl, filename: ROAD_TEST_CERTIFICATE_FILENAME, expiresInSeconds: APPLICANT_COPY_TTL_SEC };
}
