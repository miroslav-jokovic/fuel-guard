import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { BinderRequest, DocumentExportRequest, DqExportRow } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";

/**
 * Driver-qualification exports (DQ-BINDER-PLAN). Two shapes, one ledger.
 *
 * A binder is a background job, so requesting one returns immediately and the history list is what
 * tells you it finished. A single document is streamed straight back, because one document is a
 * question the dispatcher asked out loud and a queue would be a strange answer to it.
 */
const EXPORTS_KEY = ["compliance", "exports"] as const;

const API_URL = import.meta.env.VITE_API_URL ?? "";

/** The export history, newest first. Polls while anything is still being assembled. */
export function useExportsQuery() {
  return useQuery({
    queryKey: EXPORTS_KEY,
    queryFn: async (): Promise<DqExportRow[]> => {
      const res = await apiFetch<{ exports: DqExportRow[] }>("/api/compliance/exports");
      if (!res.ok) throw new Error(res.error?.message ?? "Could not load the export history.");
      return res.data?.exports ?? [];
    },
    // A binder takes a minute or two. Ten seconds is often enough to see it land without asking the
    // server a question it has already answered; polling stops as soon as nothing is in flight.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((e) => e.status === "queued" || e.status === "running")
        ? 10_000
        : false,
  });
}

export function useRequestBinder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BinderRequest): Promise<{ exportId: string }> => {
      const res = await apiFetch<{ exportId: string; jobId: string }>(
        "/api/compliance/exports/binder",
        { method: "POST", body: input },
      );
      if (!res.ok || !res.data)
        throw new Error(res.error?.message ?? "Could not start the binder.");
      return { exportId: res.data.exportId };
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: EXPORTS_KEY }),
  });
}

/**
 * Fetch the short-lived signed URL and open it. The bucket has no client policy at all, so this is
 * the only route to the bytes — and the API records the download against the export while it is at it.
 */
export async function openBinder(exportId: string): Promise<void> {
  const res = await apiFetch<{ url: string }>(`/api/compliance/exports/${exportId}/download`);
  if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not open the binder.");
  window.open(res.data.url, "_blank", "noopener");
}

/**
 * One requirement, stamped, downloaded. A POST that answers with a PDF rather than JSON, so it
 * cannot go through `apiFetch` — the bearer token is attached the same way, and the blob is handed
 * to the browser as a file.
 */
export function useExportDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DocumentExportRequest & { filename: string }): Promise<void> => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch(`${API_URL}/api/compliance/exports/document`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          driverId: input.driverId,
          requirementKey: input.requirementKey,
          asAt: input.asAt ?? null,
        }),
      });
      if (!res.ok) {
        // The failure path answers in JSON — "no scan is on file for the medical card" is the whole
        // point of the message, so it must reach the toast rather than becoming "Export failed".
        const payload = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(payload?.error?.message ?? "Could not release the document.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = input.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: EXPORTS_KEY }),
  });
}
