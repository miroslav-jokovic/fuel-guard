import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { DOCUMENTS_BUCKET } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { sha256Hex } from "@/composables/useCompliance";

/**
 * `/api/recruitment/psp-imports` — filing a PSP record the carrier already bought (PSP-PLAN P14).
 *
 * Deliberately NOT `useUploadDocument` plus `useCreateQualificationRecord`, which between them write
 * the same two rows. That pair posts to `/api/compliance/*`, which gates on `rolesThatManage("fleet")`
 * — and a recruiter has `fleet: view`, so the role the Recruitment section exists for could not file
 * the evidence it is responsible for. The import endpoints gate on the recruitment section instead,
 * compose the `psp_report` kind server-side (the kind is what carries the §391.53(a)(1) read
 * restriction), and record the provenance no generic write would.
 */

export interface PspImportInput {
  driverId: string;
  file: File;
  /** The date the record was pulled from the portal, off the PDF's own header. */
  obtainedOn: string;
  reference: string | null;
  note: string | null;
}

interface RegisterResponse {
  documentId: string;
  uploadUrl: string;
  token: string;
  storagePath: string;
}

export function useImportPspRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PspImportInput): Promise<{ recordId: string; documentId: string }> => {
      if (input.file.type !== "application/pdf") {
        throw new Error("A PSP record is a PDF. Upload the file the portal produced.");
      }
      const bytes = await input.file.arrayBuffer();

      // Register first, then PUT, then file. Same order as every other document path: a scan in the
      // bucket that no row points at is an orphan the reconciler sweeps, whereas a row citing bytes
      // that never arrived is a citation to nothing.
      const registered = await apiFetch<RegisterResponse>("/api/recruitment/psp-imports/document", {
        method: "POST",
        body: {
          driver_id: input.driverId,
          document_id: crypto.randomUUID(),
          sha256: await sha256Hex(bytes),
          bytes: input.file.size,
        },
      });
      if (!registered.ok || !registered.data) {
        throw new Error(registered.error?.message ?? "Could not register the PSP report.");
      }

      const { error } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .uploadToSignedUrl(registered.data.storagePath, registered.data.token, input.file, {
          contentType: "application/pdf",
        });
      // A 409 means the object is already there — a retry of an upload that in fact succeeded.
      if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(error.message);

      const filed = await apiFetch<{ recordId: string; documentId: string }>("/api/recruitment/psp-imports", {
        method: "POST",
        body: {
          driver_id: input.driverId,
          document_id: registered.data.documentId,
          obtained_on: input.obtainedOn,
          // The attestation is the whole legal basis for the filing (D-PSP9), so the form cannot
          // submit without it and this is never defaulted here.
          consent_obtained: true,
          reference: input.reference,
          note: input.note,
        },
      });
      if (!filed.ok || !filed.data) {
        throw new Error(filed.error?.message ?? "Could not file the PSP record.");
      }
      return filed.data;
    },
    // By prefix: the record lands in the driver's qualification file, so the file, its documents and
    // the fleet queue that counts them are all now stale.
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["compliance"] }),
  });
}
