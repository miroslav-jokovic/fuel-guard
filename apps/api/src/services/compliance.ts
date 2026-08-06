import type { SupabaseClient } from "@supabase/supabase-js";
import type { CertificationCreateRequest, CertificationListQuery, QualificationRecordCreateRequest } from "@fuelguard/shared";

/**
 * Compliance master data service — the CERTIFICATIONS slice (PLAN §3.1 / §10.1, M1). Thin data
 * layer over Supabase: routes gate by role, RLS (0127) is the PostgREST backstop, and the pure
 * decision logic lives in @fuelguard/shared (complianceContract). qualification_records /
 * documents / compliance_items attach here with the rest of M1.
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
