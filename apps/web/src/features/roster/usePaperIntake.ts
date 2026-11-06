import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { PaperBatchResponse, PaperStackRegisterResponse } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { sha256Hex } from "@/composables/useCompliance";

/**
 * Scanned stacks of paper driver files, client side (DRIVER-PAPER-INTAKE-PLAN PI4).
 *
 * Upload is the reader intake's three steps: register (the API answers a signed upload, or that these
 * exact bytes are already on file), PUT the bytes straight to Storage (a 50 MB scan never passes
 * through the API), then tell the API the upload finished so the split is queued. The hash is taken
 * here, before the upload, so the worker can refuse bytes that are not the ones registered.
 *
 * The batch is polled every four seconds only while something is still moving — a stack uploading,
 * waiting or splitting, or a piece still being read — and not at all once everything has settled.
 */
const BUCKET = "paper-intake";
const KEY = ["compliance", "paper-intake"] as const;

export function usePaperBatch(batchId: Ref<string | null>) {
  return useQuery({
    queryKey: [...KEY, batchId] as const,
    enabled: computed(() => !!batchId.value),
    queryFn: async (): Promise<PaperBatchResponse> => {
      const res = await apiFetch<PaperBatchResponse>(`/api/compliance/paper-intake/batches/${batchId.value}`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the uploads.");
      return res.data;
    },
    refetchInterval: (query) => {
      const data = query.state.data as PaperBatchResponse | undefined;
      const moving = (data?.stacks ?? []).some(
        (s) => (s.status !== "split" && s.status !== "failed") || (s.reading?.pending ?? 0) > 0,
      );
      return moving ? 4_000 : false;
    },
  });
}

export function useUploadStack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, batchId }: { file: File; batchId: string }): Promise<{ stackId: string; duplicate: boolean }> => {
      const sha256 = await sha256Hex(await file.arrayBuffer());
      const reg = await apiFetch<PaperStackRegisterResponse>("/api/compliance/paper-intake/stacks", {
        method: "POST",
        body: { batchId, fileName: file.name, sha256, bytes: file.size },
      });
      if (!reg.ok || !reg.data) throw new Error(reg.error?.message ?? "Could not start the upload.");
      if (reg.data.duplicate || !reg.data.storagePath || !reg.data.token) return { stackId: reg.data.stackId, duplicate: true };
      const { error } = await supabase.storage
        .from(BUCKET)
        .uploadToSignedUrl(reg.data.storagePath, reg.data.token, file, { contentType: "application/pdf" });
      // A 409 means the object is already there — a retry of an upload that in fact succeeded.
      if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(error.message);
      const done = await apiFetch(`/api/compliance/paper-intake/stacks/${reg.data.stackId}/complete`, { method: "POST" });
      if (!done.ok) throw new Error(done.error?.message ?? "The upload finished but could not be queued.");
      return { stackId: reg.data.stackId, duplicate: false };
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** A five-minute signed URL to one piece's PDF. */
export async function fetchPieceUrl(stackId: string, partIndex: number): Promise<string> {
  const res = await apiFetch<{ url: string }>(`/api/compliance/paper-intake/stacks/${stackId}/parts/${partIndex}`);
  if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not open those pages.");
  return res.data.url;
}
