import { computed, type Ref } from "vue";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type {
  CertificationCreateRequest, CertificationRow,
  DocumentKind, DocumentRegisterRequest, DocumentRegisterResponse, DocumentRow,
  QualificationRecordRow,
} from "@fuelguard/shared";
import { DOCUMENTS_BUCKET, DOCUMENT_CONTENT_TYPES, type DocumentContentType } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";

/**
 * Compliance (certifications) data layer. Writes go through /api/compliance (insert_certification
 * auto-supersede, role-gated + audited); the roster read goes direct via PostgREST (RLS-scoped),
 * matching useDrivers. Everything is keyed under ["compliance"] so a write refreshes both the
 * per-subject drawer and the roster status.
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

export interface DriverCertRow {
  subject_id: string;
  kind: string;
  qualifier: string | null;
  training_type: string | null;
  issued_at: string | null;
  expires_at: string | null;
}

/** Every current driver certification for the org, in one read — powers the roster status column. */
export function useAllDriverCertsQuery() {
  return useQuery({
    queryKey: ["compliance", "driver-certs"] as const,
    queryFn: async (): Promise<DriverCertRow[]> => {
      const { data, error } = await supabase
        .from("certifications")
        .select("subject_id, kind, qualifier, training_type, issued_at, expires_at")
        .eq("subject_type", "driver")
        .is("superseded_by", null);
      if (error) throw new Error(error.message);
      return (data ?? []) as DriverCertRow[];
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
async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface UploadDocumentInput {
  subjectType: "driver" | "tractor" | "trailer" | "load" | "organization";
  subjectId: string;
  kind: DocumentKind;
  file: File;
}

/**
 * Register, then PUT. The bytes never pass through our API: it hands back a short-lived signed upload
 * URL and the browser sends the file straight to Storage, which is the same shape the driver app's
 * hazmat capture uses. Registration happens first on purpose — a scan in the bucket that no row
 * points at is an orphan the reconciler sweeps, whereas a row with no bytes is visible and fixable.
 */
export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UploadDocumentInput): Promise<{ documentId: string }> => {
      const contentType = input.file.type as DocumentContentType;
      if (!(DOCUMENT_CONTENT_TYPES as readonly string[]).includes(contentType)) {
        throw new Error("Upload a PDF or an image (JPEG, PNG, WebP or HEIC).");
      }
      const bytes = await input.file.arrayBuffer();
      const body: DocumentRegisterRequest = {
        id: crypto.randomUUID(),
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        kind: input.kind,
        contentType,
        sha256: await sha256Hex(bytes),
        bytes: input.file.size,
        page: 1,
        variant: "original",
      };
      const res = await apiFetch<DocumentRegisterResponse>("/api/compliance/documents", { method: "POST", body });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not register the document.");

      const { error } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .uploadToSignedUrl(res.data.storagePath, res.data.token, input.file, { contentType });
      // A 409 means the object is already there — a retry of an upload that in fact succeeded.
      if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(error.message);

      return { documentId: res.data.documentId };
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["compliance"] }),
  });
}

export function useCreateCertification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CertificationCreateRequest): Promise<{ id: string; supersededId: string | null }> => {
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
