import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoadTestCertificateCopy } from "@silvicom/shared";
import { writeAudit } from "../../lib/audit.js";
import type { RoadTestError } from "./roadTest.js";

/**
 * Has the driver had their copy of the road-test certificate? — G-10's half that the owner ruled in
 * (`ROAD-TEST-PLAN.md` §8, 2026-09-29; `APPLICATION-FLOW-V2-PLAN.md` Q-AW19).
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
 * §391.31(g) has the carrier keep the original AND give the driver a copy. RT4 made the second half
 * provable only for a driver who downloads it from their link — and the link offers it only once the
 * application is filed, so a driver tested and handed paper in the office left no trace that they
 * were given anything. The office now says so, and the step shows "copy given" on either fact.
 *
 * ── WHY AN AUDIT ROW, NOT A COLUMN ────────────────────────────────────────────────────────────
 * `qualification_records` is append-only evidence (a correction is a new row), so "copy given"
 * cannot be a field stamped onto the certificate's record, and a new table for one fact per
 * certificate would be a migration for what the download already records as an audit row. Both
 * facts therefore live in `audit_logs` — which is `RETENTION_FORBIDDEN`, so neither can age out from
 * under the step — keyed by the certificate's `qualification_records.id`. Measured 2026-09-29 against
 * production: this read is served by 0163's `action` index, 5.7 ms on the 5.06M-row org.
 *
 * ⚠ The service role bypasses RLS: both reads filter on `org_id` themselves.
 */

export const CERTIFICATE_DOWNLOADED = "road_test_certificate_downloaded";
export const CERTIFICATE_HANDED_OVER = "road_test_certificate_handed_over";

interface CertificateRecord {
  id: string;
  document_id: string | null;
}

/** RT3's pass rows for this driver — the only records that cite a certificate we issued. */
async function certificateRecords(admin: SupabaseClient, orgId: string, driverId: string): Promise<CertificateRecord[]> {
  const { data } = await admin
    .from("qualification_records")
    .select("id, document_id")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .eq("kind", "road_test")
    .eq("detail->>source", "road_test");
  // A row with no document cites nothing to hand over; dropped here rather than with `.not()`, which
  // the route tests' fixture deliberately does not model.
  return ((data ?? []) as CertificateRecord[]).filter((r) => r.document_id !== null);
}

/** Each certificate with its two facts, and the document it is — the write names the document. */
async function readCopies(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<Array<RoadTestCertificateCopy & { documentId: string }>> {
  const records = await certificateRecords(admin, orgId, driverId);
  if (records.length === 0) return [];
  const { data } = await admin
    .from("audit_logs")
    .select("entity_id, action, created_at")
    .eq("org_id", orgId)
    .eq("entity", "qualification_records")
    .in("entity_id", records.map((r) => r.id))
    .in("action", [CERTIFICATE_DOWNLOADED, CERTIFICATE_HANDED_OVER])
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as Array<{ entity_id: string; action: string; created_at: string }>;
  // Ascending, so the first match is the FIRST time — when the driver first had it.
  const first = (id: string, action: string) => rows.find((r) => r.entity_id === id && r.action === action)?.created_at ?? null;
  return records.map((r) => {
    const downloadedAt = first(r.id, CERTIFICATE_DOWNLOADED);
    const handedOverAt = first(r.id, CERTIFICATE_HANDED_OVER);
    return { recordId: r.id, documentId: r.document_id!, given: downloadedAt !== null || handedOverAt !== null, downloadedAt, handedOverAt };
  });
}

const publicShape = ({ documentId: _documentId, ...copy }: RoadTestCertificateCopy & { documentId: string }): RoadTestCertificateCopy => copy;

/** One entry per filed certificate of this driver's, in no particular order. */
export async function roadTestCertificateCopies(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<RoadTestCertificateCopy[]> {
  return (await readCopies(admin, orgId, driverId)).map(publicShape);
}

/**
 * The office says it handed the driver a paper copy. Idempotent: a second press finds the first
 * row and writes nothing, so the log holds when it happened once, not how many times it was clicked.
 *
 * ⚠ Unlike the download (`applicationRoadTestCopy.ts`, which ignores a failed audit write so the
 * driver is never refused their copy), a failed write here IS a failure: the audit row is the whole
 * record, and answering "done" without it would show "copy given" with nothing behind it.
 */
export async function recordPaperCopyGiven(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  driverId: string,
  recordId: string,
): Promise<RoadTestCertificateCopy | RoadTestError> {
  const existing = (await readCopies(admin, orgId, driverId)).find((c) => c.recordId === recordId);
  if (!existing) return { code: "not_found", message: "That road-test certificate is not on file for this driver." };
  if (existing.handedOverAt) return publicShape(existing);

  const written = await writeAudit(admin, {
    orgId,
    actorId: userId,
    action: CERTIFICATE_HANDED_OVER,
    entity: "qualification_records",
    entityId: recordId,
    meta: { driverId, documentId: existing.documentId },
  });
  if (!written) return { code: "insert_failed", message: "Could not record that the copy was given. Try again." };
  // The server's clock at the write stands in for the row's own `created_at` until the next read,
  // which reports the row.
  return { ...publicShape(existing), given: true, handedOverAt: new Date().toISOString() };
}
