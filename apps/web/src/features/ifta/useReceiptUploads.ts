/**
 * Driver-paid fuel uploads for IFTA (IFTA-PRECISION-PLAN IP8) — the browser half.
 *
 * The browser sends the file's BYTES and shows what the server answers; it never parses a row
 * itself. The preview and the import are the same server code run twice (`commit: false`, then
 * `commit: true`), so what the office reads before importing is exactly what lands.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  IFTA_RECEIPT_UPLOAD_MAX_BYTES,
  type IftaReceiptUploadResponse, type IftaReceiptUploadSummary,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

const uploadsKey = ["ifta_receipt_uploads"] as const;

/** The file as base64, without the `data:` prefix a FileReader adds. */
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function tooLarge(file: File): boolean {
  return file.size > IFTA_RECEIPT_UPLOAD_MAX_BYTES;
}

export function useReceiptUploadsQuery() {
  return useQuery({
    queryKey: uploadsKey,
    staleTime: 60_000,
    queryFn: async (): Promise<IftaReceiptUploadSummary[]> => {
      const r = await apiFetch<{ uploads: IftaReceiptUploadSummary[] }>("/api/ifta/receipt-uploads");
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the uploads");
      return r.data.uploads;
    },
  });
}

export interface UploadVars {
  fileName: string;
  contentBase64: string;
  commit: boolean;
  truckChoices: Record<string, string>;
}

/** Preview or import. An import refreshes the ledger, the state pages and the upload list. */
export function useReceiptUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: UploadVars): Promise<IftaReceiptUploadResponse> => {
      const r = await apiFetch<IftaReceiptUploadResponse>("/api/ifta/receipt-uploads", { method: "POST", body: vars });
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "The upload failed");
      return r.data;
    },
    onSuccess: (data) => {
      if (!data.committed) return;
      void qc.invalidateQueries({ queryKey: uploadsKey });
      void qc.invalidateQueries({ queryKey: ["ifta_period"] });
      void qc.invalidateQueries({ queryKey: ["ifta_jurisdiction"] });
    },
  });
}

export function useVoidReceiptUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; reason: string }): Promise<number> => {
      const r = await apiFetch<{ receiptsVoided: number }>(`/api/ifta/receipt-uploads/${vars.id}/void`, {
        method: "POST",
        body: { reason: vars.reason },
      });
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not undo the upload");
      return r.data.receiptsVoided;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: uploadsKey });
      void qc.invalidateQueries({ queryKey: ["ifta_period"] });
      void qc.invalidateQueries({ queryKey: ["ifta_jurisdiction"] });
    },
  });
}
