import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DOCUMENTS_BUCKET, documentStoragePath,
  type CertificationCreateRequest, type CertificationListQuery,
  type DocumentListQuery, type DocumentRegisterRequest, type DocumentRegisterResponse, type DocumentRow,
  type QualificationRecordCreateRequest,
} from "@fuelguard/shared";

/**
 * Compliance master data service — certifications (§3.1 / §10.1), qualification records (§3.2) and
 * documents (DQ0). Thin data layer over Supabase: routes gate by role, RLS (0127 / 0129 / 0146) is
 * the PostgREST backstop, and the pure decision logic lives in @fuelguard/shared
 * (complianceContract). `compliance_items` and `master_documents` were retired by 0147.
 */

export type ServiceError = { error: string; code: string };
const err = (code: string, error: string): ServiceError => ({ error, code });

// ONE string literal, never concatenated (§7: concatenation widens to `string` and collapses
// PostgREST's parsed row type).
const CERT_COLUMNS =
  "id, subject_type, subject_id, kind, qualifier, training_type, identifier, issuing_authority, issued_at, effective_from, expires_at, training_provider_name, training_certified, superseded_by, superseded_at, document_id, notes, created_at";

/** Insert with automatic supersede — one RPC, one transaction (0127's insert_certification). */
export async function insertCertification(
  admin: SupabaseClient, orgId: string, userId: string, req: CertificationCreateRequest,
): Promise<{ id: string; supersededId: string | null } | ServiceError> {
  const { data, error } = await admin.rpc("insert_certification", {
    p_id: req.id, p_org_id: orgId,
    p_subject_type: req.subjectType, p_subject_id: req.subjectId,
    p_kind: req.kind, p_qualifier: req.qualifier ?? null,
    p_training_type: req.trainingType ?? null, p_identifier: req.identifier ?? null,
    p_issuing_authority: req.issuingAuthority ?? null,
    p_issued_at: req.issuedAt ?? null, p_effective_from: req.effectiveFrom ?? null,
    p_expires_at: req.expiresAt ?? null,
    p_training_provider_name: req.trainingProviderName ?? null,
    p_training_provider_address: req.trainingProviderAddress ?? null,
    p_training_materials: req.trainingMaterials ?? null,
    p_training_certified: req.trainingCertified ?? null,
    p_document_id: req.documentId ?? null, p_notes: req.notes ?? null,
    p_created_by: userId,
  });
  if (error) return err("insert_failed", error.message);
  const row = (Array.isArray(data) ? data[0] : data) as { id: string; superseded_id: string | null } | undefined;
  return { id: row?.id ?? req.id, supersededId: row?.superseded_id ?? null };
}

/** Current rows by default; the full supersede chain with includeHistory (the temporal model). */
export async function listCertifications(
  admin: SupabaseClient, orgId: string, q: CertificationListQuery,
): Promise<{ rows: unknown[] } | ServiceError> {
  let query = admin.from("certifications").select(CERT_COLUMNS)
    .eq("org_id", orgId).eq("subject_type", q.subjectType).eq("subject_id", q.subjectId);
  if (q.kind) query = query.eq("kind", q.kind);
  if (!q.includeHistory) query = query.is("superseded_by", null);
  const { data, error } = await query.order("effective_from", { ascending: false }).order("created_at", { ascending: false });
  if (error) return err("query_failed", error.message);
  return { rows: data ?? [] };
}

// ── qualification records (§3.2) — append-only ──────────────────────────────────────────
export async function insertQualificationRecord(
  admin: SupabaseClient, orgId: string, userId: string, req: QualificationRecordCreateRequest,
): Promise<{ id: string } | ServiceError> {
  const { error } = await admin.from("qualification_records").insert({
    id: req.id, org_id: orgId, driver_id: req.driverId, kind: req.kind,
    occurred_on: req.occurredOn, covers_until: req.coversUntil ?? null,
    result: req.result ?? null, performed_by: req.performedBy ?? null,
    reference: req.reference ?? null, document_id: req.documentId ?? null,
    detail: req.detail ?? {}, created_by: userId,
  });
  if (error) return err("insert_failed", error.message);
  return { id: req.id };
}

export async function listQualificationRecords(
  admin: SupabaseClient, orgId: string, driverId: string, kind?: string,
): Promise<{ rows: unknown[] } | ServiceError> {
  let query = admin.from("qualification_records")
    .select("id, driver_id, kind, occurred_on, covers_until, result, performed_by, reference, document_id, detail, created_at")
    .eq("org_id", orgId).eq("driver_id", driverId);
  if (kind) query = query.eq("kind", kind);
  const { data, error } = await query.order("occurred_on", { ascending: false });
  if (error) return err("query_failed", error.message);
  return { rows: data ?? [] };
}

// ── documents (DQ0) — register → signed upload → batch signed read ────────────────────────

/** Signed-read TTL. Five minutes is long enough to render a page and short enough that a leaked URL
 *  in a log or a screenshot has expired before anyone finds it — the hazmat path's value (D20). */
export const DOCUMENT_URL_TTL_SEC = 300;

const DOCUMENT_COLUMNS =
  "id, subject_type, subject_id, kind, content_type, bytes, sha256, page, variant, captured_at, created_at, storage_path, derived_from";

/**
 * Register a document and hand back a signed upload URL. The bytes never touch this process.
 *
 * Deliberately NOT carrying `hazmat_documents`' MAX_BOL_PAGES cap: that cap exists because every
 * registered hazmat page becomes two vision-model calls, and no extraction runs here. A driver's
 * qualification file legitimately accumulates documents for as long as they are employed, and a cap
 * on it would fail the exact §391.51 retention it is supposed to serve. The per-request bound
 * (page ≤ 50, one file per call) is in the schema.
 */
export async function registerDocument(
  admin: SupabaseClient, orgId: string, userId: string, req: DocumentRegisterRequest,
): Promise<DocumentRegisterResponse | ServiceError> {
  const storagePath = documentStoragePath(orgId, req.subjectType, req.subjectId, req.id, req.contentType);
  const { data: signed, error: signErr } = await admin.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(storagePath);
  if (signErr || !signed) return err("sign_failed", signErr?.message ?? "Failed to sign upload URL.");
  // Idempotent replay: a retry after a dropped response re-signs and leaves the row alone.
  const { error } = await admin.from("documents").upsert({
    id: req.id, org_id: orgId,
    subject_type: req.subjectType, subject_id: req.subjectId, kind: req.kind,
    storage_path: storagePath, content_type: req.contentType,
    bytes: req.bytes ?? null, sha256: req.sha256, page: req.page, variant: req.variant,
    captured_at: req.capturedAt ?? null, uploaded_by: userId,
  }, { onConflict: "id", ignoreDuplicates: true });
  if (error) return err("insert_failed", error.message);
  return { documentId: req.id, storagePath, uploadUrl: signed.signedUrl, token: signed.token };
}

type DocumentDbRow = {
  id: string; subject_type: string; subject_id: string; kind: string;
  content_type: string; bytes: number | null; sha256: string; page: number; variant: string;
  captured_at: string | null; created_at: string; storage_path: string;
  derived_from: string | null;
};

/**
 * Every ORIGINAL for one subject, each with a short-lived signed URL — and its derivatives folded
 * into `thumbUrl`/`normalizedUrl` (plan B4) rather than returned as sibling rows. One row per filed
 * document keeps every consumer honest: a thumb is a rendering of evidence, not evidence, and a
 * list that returned both would eventually see a thumb counted as a filed scan.
 */
export async function listDocuments(
  admin: SupabaseClient, orgId: string, q: DocumentListQuery,
): Promise<{ rows: DocumentRow[] } | ServiceError> {
  let query = admin.from("documents").select(DOCUMENT_COLUMNS)
    .eq("org_id", orgId).eq("subject_type", q.subjectType).eq("subject_id", q.subjectId);
  if (q.kind) query = query.eq("kind", q.kind);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return err("query_failed", error.message);
  const docs = (data ?? []) as DocumentDbRow[];
  return { rows: await signDocumentRows(admin, docs) };
}

/**
 * A signed URL that DOWNLOADS (plan B6). `<a download>` is ignored cross-origin — Firefox navigates,
 * Safari honours it same-origin only, Chrome strips the filename — so the attachment disposition has
 * to come from the server: Supabase's `download` option sets `Content-Disposition: attachment` with
 * the filename we choose, and a plain link then downloads in every browser with no fetch and no
 * 25 MB blob in memory. Filename: `{driver-last-name}-{kind}-{date}.{ext}` — what a folder of
 * released documents needs to stay sortable.
 */
export async function signDocumentDownload(
  admin: SupabaseClient, orgId: string, documentId: string,
): Promise<{ url: string; filename: string; kind: string } | ServiceError> {
  const { data, error } = await admin.from("documents")
    .select("id, subject_type, subject_id, kind, content_type, storage_path, captured_at, created_at, variant")
    .eq("org_id", orgId).eq("id", documentId).maybeSingle();
  if (error) return err("query_failed", error.message);
  const doc = data as (Pick<DocumentDbRow, "subject_type" | "subject_id" | "kind" | "content_type" | "storage_path" | "captured_at" | "created_at" | "variant"> & { id: string }) | null;
  if (!doc) return err("not_found", "That document is not on file.");

  let namePart = doc.subject_type;
  if (doc.subject_type === "driver") {
    const { data: d } = await admin.from("drivers").select("full_name")
      .eq("org_id", orgId).eq("id", doc.subject_id).maybeSingle();
    const last = ((d as { full_name?: string } | null)?.full_name ?? "").trim().split(/\s+/).pop();
    if (last) namePart = last.toLowerCase().replace(/[^a-z0-9-]/g, "");
  }
  const ext = doc.content_type === "application/pdf" ? "pdf" : (doc.content_type.split("/")[1] ?? "bin");
  const date = (doc.captured_at ?? doc.created_at).slice(0, 10);
  const filename = `${namePart}-${doc.kind}-${date}.${ext}`;

  const { data: signed, error: signErr } = await admin.storage.from(DOCUMENTS_BUCKET)
    .createSignedUrl(doc.storage_path, DOCUMENT_URL_TTL_SEC, { download: filename });
  if (signErr || !signed) return err("sign_failed", signErr?.message ?? "Could not sign the download.");
  return { url: signed.signedUrl, filename, kind: doc.kind };
}

/** ONE batch Storage call for the whole set — originals AND derivatives, unchanged TTL — never one
 *  round trip per row (D20). Signing failures degrade a single row to `url: null` rather than
 *  failing the page — the metadata is still the answer to "is this document on file", which is what
 *  a §391.51 review actually asks. */
async function signDocumentRows(admin: SupabaseClient, docs: DocumentDbRow[]): Promise<DocumentRow[]> {
  const byPath = new Map<string, string>();
  if (docs.length > 0) {
    const { data: signed } = await admin.storage.from(DOCUMENTS_BUCKET)
      .createSignedUrls(docs.map((d) => d.storage_path), DOCUMENT_URL_TTL_SEC);
    for (const s of signed ?? []) if (s.signedUrl && s.path) byPath.set(s.path, s.signedUrl);
  }
  const derivativeUrl = (originalId: string, variant: string): string | null => {
    const d = docs.find((x) => x.derived_from === originalId && x.variant === variant);
    return d ? (byPath.get(d.storage_path) ?? null) : null;
  };
  return docs
    .filter((d) => d.variant === "original")
    .map((d) => ({
      id: d.id,
      subjectType: d.subject_type as DocumentRow["subjectType"],
      subjectId: d.subject_id,
      kind: d.kind,
      contentType: d.content_type,
      bytes: d.bytes,
      sha256: d.sha256,
      page: d.page,
      variant: d.variant,
      capturedAt: d.captured_at,
      createdAt: d.created_at,
      url: byPath.get(d.storage_path) ?? null,
      thumbUrl: derivativeUrl(d.id, "thumb"),
      normalizedUrl: derivativeUrl(d.id, "normalized"),
    }));
}
