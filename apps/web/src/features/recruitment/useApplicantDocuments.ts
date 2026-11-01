import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type {
  ApplicantDocument,
  ApplicantDocumentUpload,
  ApplicantDocumentUploadResponse,
  PromotedCaptureSlot,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { uploadDocumentFile } from "@/composables/useCompliance";

/**
 * The applicant's papers, and the office's upload beside them (HIRING-WORKFLOW-AUDIT §9 P9).
 *
 * ⚠ The upload is `uploadDocumentFile` — the same register-then-PUT every document in the product
 * takes, so the file's type, hash and signed PUT are decided once — with the register pointed at the
 * recruitment door instead of `/api/compliance/documents`. `useUploadDocument` hard-wires the compliance
 * route, which refuses a recruiter (`roster: view`); the door and why it exists are in
 * `apps/api/src/modules/recruiting/applicantDocuments.ts`.
 */
const documentsKey = (driverId: string) => ["recruitment", "applicant-documents", driverId] as const;

export function useApplicantDocumentsQuery(driverId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => documentsKey(driverId.value)),
    enabled: computed(() => Boolean(driverId.value)),
    // The rows carry five-minute URLs: never served from a cache older than a minute.
    staleTime: 60_000,
    queryFn: async (): Promise<ApplicantDocument[]> => {
      const res = await apiFetch<{ documents: ApplicantDocument[] }>(`/api/recruitment/applicants/${driverId.value}/documents`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the documents.");
      return res.data.documents;
    },
  });
}

export interface ApplicantDocumentUploadInput {
  driverId: string;
  slot: PromotedCaptureSlot;
  file: File;
}

export function useUploadApplicantDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ApplicantDocumentUploadInput) =>
      uploadDocumentFile(input.file, async (fields) => {
        const body: ApplicantDocumentUpload = {
          document_id: fields.id,
          slot: input.slot,
          content_type: fields.contentType,
          sha256: fields.sha256,
          bytes: fields.bytes ?? null,
        };
        const res = await apiFetch<ApplicantDocumentUploadResponse>(`/api/recruitment/applicants/${input.driverId}/documents`, {
          method: "POST",
          body,
        });
        if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not add the document.");
        return { documentId: res.data.documentId, storagePath: res.data.storagePath, uploadUrl: res.data.uploadUrl, token: res.data.token };
      }),
    onSuccess: (_r, input) => {
      void qc.invalidateQueries({ queryKey: documentsKey(input.driverId) });
      // The driver's own file lists the same rows.
      void qc.invalidateQueries({ queryKey: ["compliance"] });
    },
  });
}
