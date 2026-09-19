import { useMutation, useQueryClient } from "@tanstack/vue-query";
import {
  DOCUMENTS_BUCKET,
  DOCUMENT_CONTENT_TYPES,
  type DocumentContentType,
  type HiringRecordedActStep,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { sha256Hex } from "@/composables/useCompliance";
import { applicantChecklistKey } from "@/features/recruitment/useApplicantChecklist";

/**
 * `/api/recruitment/applicants/:id/records/:step` — recording an act performed elsewhere (D1, D-HM6).
 *
 * Deliberately NOT `useUploadDocument` plus `useCreateQualificationRecord`, for `usePspImport`'s
 * reason verbatim: that pair posts to `/api/compliance/*`, which gates on `rolesThatManage("roster")`
 * — and a recruiter has `roster: view`, so the role the Recruitment section exists for could not file
 * the evidence its own checklist says it owes. These endpoints gate on the recruitment section, then
 * on the kind's §382.401(a) reader test, and compose the kind server-side from the step.
 */

export interface HiringEvidenceInput {
  driverId: string;
  step: HiringRecordedActStep;
  /** The date on the record itself, not the day it was typed in. */
  occurredOn: string;
  result: string | null;
  performedBy: string | null;
  reference: string | null;
  /** Optional: an act is recordable before its printout is to hand. */
  file: File | null;
}

interface RegisterResponse {
  documentId: string;
  uploadUrl: string;
  token: string;
  storagePath: string;
}

export interface HiringEvidenceResult {
  recordId: string;
  documentId: string | null;
  kind: string;
}

export function useRecordHiringAct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: HiringEvidenceInput): Promise<HiringEvidenceResult> => {
      const base = `/api/recruitment/applicants/${encodeURIComponent(input.driverId)}/records/${input.step}`;
      let documentId: string | null = null;

      if (input.file) {
        const contentType = input.file.type as DocumentContentType;
        if (!(DOCUMENT_CONTENT_TYPES as readonly string[]).includes(contentType)) {
          throw new Error("Upload a PDF or an image (JPEG, PNG, WebP or HEIC).");
        }
        const bytes = await input.file.arrayBuffer();

        // Register first, then PUT, then file — the order every document path in this product uses.
        // A scan in the bucket that no row points at is an orphan the reconciler sweeps; a row citing
        // bytes that never arrived is a citation to nothing.
        const registered = await apiFetch<RegisterResponse>(`${base}/document`, {
          method: "POST",
          body: {
            document_id: crypto.randomUUID(),
            sha256: await sha256Hex(bytes),
            bytes: input.file.size,
            content_type: contentType,
          },
        });
        if (!registered.ok || !registered.data) {
          throw new Error(registered.error?.message ?? "Could not register the scan.");
        }

        const { error } = await supabase.storage
          .from(DOCUMENTS_BUCKET)
          .uploadToSignedUrl(registered.data.storagePath, registered.data.token, input.file, {
            contentType,
          });
        // A 409 means the object is already there — a retry of an upload that in fact succeeded.
        if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(error.message);
        documentId = registered.data.documentId;
      }

      const filed = await apiFetch<HiringEvidenceResult>(base, {
        method: "POST",
        body: {
          occurred_on: input.occurredOn,
          document_id: documentId,
          result: input.result,
          performed_by: input.performedBy,
          reference: input.reference,
        },
      });
      if (!filed.ok || !filed.data) {
        throw new Error(filed.error?.message ?? "Could not record it.");
      }
      return filed.data;
    },
    onSuccess: (_result, input) => {
      // Two prefixes, because the row is two things at once. It is evidence in the driver's §391.51
      // file — `["compliance"]` covers the records, the documents and the fleet queue that counts
      // them — and it is the thing that moves a step of the HIRE, which is folded server-side and
      // would otherwise keep reporting "Waiting on you" over a record that is now on file.
      void qc.invalidateQueries({ queryKey: ["compliance"] });
      void qc.invalidateQueries({ queryKey: applicantChecklistKey(input.driverId) });
    },
  });
}
