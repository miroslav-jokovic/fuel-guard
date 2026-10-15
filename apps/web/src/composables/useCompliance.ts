import { computed, type Ref } from "vue";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type {
  DriverDispatchHold,
  CertificationCreateRequest,
  CertificationRow,
  ComplianceDocumentKind,
  DocumentRegisterRequest,
  DocumentRegisterResponse,
  DocumentRow,
  QualificationRecordCreateRequest,
  QualificationRecordRow,
  ComplianceOverviewResponse,
} from "@silvicom/shared";
import {
  DOCUMENTS_BUCKET,
  DOCUMENT_CONTENT_TYPES,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { uploadContentType } from "@/lib/fileFormat";
import { supabase } from "@/lib/supabase";

/**
 * Compliance (certifications) data layer. Reads and writes go through /api/compliance
 * (insert_certification auto-supersede, role-gated + audited); only the document upload PUTs
 * straight to Storage via a signed URL. Everything is keyed under ["compliance"] so a write
 * refreshes both the per-subject drawer and the fleet table.
 */
const CERTS_KEY = ["compliance", "certs"] as const;

/** Current certifications for one subject (driver or carrier) — reactive to the selection. */
export function useCertificationsQuery(subjectType: Ref<string>, subjectId: Ref<string | null>) {
  return useQuery({
    queryKey: [...CERTS_KEY, subjectType, subjectId] as const,
    enabled: computed(() => !!subjectId.value),
    queryFn: async (): Promise<CertificationRow[]> => {
      const id = subjectId.value;
      if (!id) return [];
      const res = await apiFetch<{ certifications: CertificationRow[] }>(
        `/api/compliance/certifications?subjectType=${subjectType.value}&subjectId=${id}`,
      );
      if (!res.ok) throw new Error(res.error?.message ?? "Failed to load certifications.");
      return res.data?.certifications ?? [];
    },
  });
}

/**
 * The full supersede chain for one driver — current rows AND everything they replaced. Separate from
 * `useCertificationsQuery` on purpose: the checklist must never accidentally count a superseded
 * medical card as evidence, so the two reads stay two reads.
 */
export function useCertificationHistoryQuery(subjectId: Ref<string | null>) {
  return useQuery({
    queryKey: [...CERTS_KEY, "history", subjectId] as const,
    enabled: computed(() => !!subjectId.value),
    queryFn: async (): Promise<CertificationRow[]> => {
      const id = subjectId.value;
      if (!id) return [];
      const res = await apiFetch<{ certifications: CertificationRow[] }>(
        `/api/compliance/certifications?subjectType=driver&subjectId=${id}&includeHistory=true`,
      );
      if (!res.ok)
        throw new Error(res.error?.message ?? "Could not load the certification history.");
      return res.data?.certifications ?? [];
    },
  });
}

/** The §391.51 event history for one driver (append-only — a correction is a new row). */
export function useQualificationRecordsQuery(driverId: Ref<string | null>) {
  return useQuery({
    queryKey: ["compliance", "qual-records", driverId] as const,
    enabled: computed(() => !!driverId.value),
    queryFn: async (): Promise<QualificationRecordRow[]> => {
      const id = driverId.value;
      if (!id) return [];
      const res = await apiFetch<{ records: QualificationRecordRow[] }>(
        `/api/compliance/qualification-records?driverId=${id}`,
      );
      if (!res.ok) throw new Error(res.error?.message ?? "Failed to load qualification records.");
      return res.data?.records ?? [];
    },
  });
}

/**
 * Is this driver held out of dispatch — the dispatch door's own answer, redacted for this reader by the
 * api (`dispatchHoldForReader`): a Med-Stop violation and its day reach a testing-record reader only
 * (MEDSTOP-PLAN §7A.15). The driver page's notice and the qualification file both read it, one query.
 */
export function useDispatchHoldQuery(driverId: Ref<string | null>) {
  return useQuery({
    queryKey: ["compliance", "dispatch-hold", driverId] as const,
    enabled: computed(() => !!driverId.value),
    queryFn: async (): Promise<DriverDispatchHold> => {
      const res = await apiFetch<DriverDispatchHold>(`/api/compliance/drivers/${driverId.value}/dispatch-hold`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Failed to load the dispatch hold.");
      return res.data;
    },
  });
}

/** Filed scans for one subject. Each carries a signed URL that lives about five minutes — never
 *  cache the URLs themselves anywhere, and never render one into a link the browser will keep. */
export function useDocumentsQuery(subjectType: Ref<string>, subjectId: Ref<string | null>) {
  return useQuery({
    queryKey: ["compliance", "documents", subjectType, subjectId] as const,
    enabled: computed(() => !!subjectId.value),
    queryFn: async (): Promise<DocumentRow[]> => {
      const id = subjectId.value;
      if (!id) return [];
      const res = await apiFetch<{ documents: DocumentRow[] }>(
        `/api/compliance/documents?subjectType=${subjectType.value}&subjectId=${id}`,
      );
      if (!res.ok) throw new Error(res.error?.message ?? "Failed to load documents.");
      return res.data?.documents ?? [];
    },
  });
}

/** Lowercase hex SHA-256 of the bytes — §390.32(c) integrity evidence, computed before the upload so
 *  the register records the hash of exactly what was sent. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface UploadDocumentInput {
  subjectType: DocumentRegisterRequest["subjectType"];
  subjectId: string;
  kind: ComplianceDocumentKind;
  file: File;
}

/** The fields every register request carries about the file itself, whichever route files it. */
export type DocumentFileFields = Pick<DocumentRegisterRequest, "id" | "contentType" | "sha256" | "bytes">;

/**
 * Register, then PUT. The bytes never pass through our API: it hands back a short-lived signed upload
 * URL and the browser sends the file straight to Storage, which is the same shape the driver app's
 * hazmat capture uses. Registration happens first on purpose — a scan in the bucket that no row
 * points at is an orphan the reconciler sweeps, whereas a row with no bytes is visible and fixable.
 *
 * `register` is the route's own call: the DQ file's `/api/compliance/documents`, or an inspection's
 * `/api/roadside-inspections/:id/documents` (IC2), each behind its own section's gate. The file's
 * type, hash and upload are decided here once, so the two cannot drift.
 */
export async function uploadDocumentFile(
  file: File,
  register: (fields: DocumentFileFields) => Promise<DocumentRegisterResponse>,
): Promise<{ documentId: string }> {
  const contentType = await uploadContentType(file, DOCUMENT_CONTENT_TYPES);
  if (!contentType) {
    throw new Error("Upload a PDF or an image (JPEG, PNG, WebP or HEIC).");
  }
  const bytes = await file.arrayBuffer();
  const signed = await register({
    id: crypto.randomUUID(),
    contentType,
    sha256: await sha256Hex(bytes),
    bytes: file.size,
  });

  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .uploadToSignedUrl(signed.storagePath, signed.token, file, { contentType });
  // A 409 means the object is already there — a retry of an upload that in fact succeeded.
  if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(error.message);

  return { documentId: signed.documentId };
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UploadDocumentInput): Promise<{ documentId: string }> =>
      uploadDocumentFile(input.file, async (fields) => {
        const body: DocumentRegisterRequest = {
          ...fields,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          kind: input.kind,
          page: 1,
          variant: "original",
        };
        const res = await apiFetch<DocumentRegisterResponse>("/api/compliance/documents", {
          method: "POST",
          body,
        });
        if (!res.ok || !res.data)
          throw new Error(res.error?.message ?? "Could not register the document.");
        return res.data;
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["compliance"] }),
  });
}

/**
 * The fleet picture behind the queue (D-DQ6). Ranked server-side by the same function the driver file
 * uses, so the queue and the file cannot disagree about what is due.
 */
export function useComplianceOverviewQuery() {
  return useQuery({
    queryKey: ["compliance", "overview"] as const,
    queryFn: async (): Promise<ComplianceOverviewResponse> => {
      const res = await apiFetch<ComplianceOverviewResponse>("/api/compliance/overview");
      if (!res.ok || !res.data)
        throw new Error(res.error?.message ?? "Could not load the qualification queue.");
      return res.data;
    },
    // Expiry dates move once a day at most; polling a compliance rollup would be a fleet-wide
    // recomputation for an answer that has not changed.
    staleTime: 5 * 60_000,
  });
}

/** A §391.51 event — append-only, so a correction is a new row rather than an edit. */
export function useCreateQualificationRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: QualificationRecordCreateRequest): Promise<{ id: string }> => {
      const res = await apiFetch<{ id: string }>("/api/compliance/qualification-records", {
        method: "POST",
        body: input,
      });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not save the record.");
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["compliance"] }),
  });
}

export function useCreateCertification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: CertificationCreateRequest,
    ): Promise<{ id: string; supersededId: string | null }> => {
      const res = await apiFetch<{ id: string; supersededId: string | null }>(
        "/api/compliance/certifications",
        { method: "POST", body: input },
      );
      if (!res.ok) throw new Error(res.error?.message ?? "Failed to save the certification.");
      return res.data as { id: string; supersededId: string | null };
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["compliance"] }),
  });
}
