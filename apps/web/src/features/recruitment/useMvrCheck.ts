import { computed, ref, type Ref } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { MVR_CHECK_WAIT_MS, type MvrCheckState } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { uploadHiringEvidenceScan } from "@/features/recruitment/useHiringEvidence";

/**
 * The AI check of a dropped driving record (HIRING-WORKFLOW-AUDIT §14, OF6b): upload the PDF as the driver's
 * MVR scan, ask the API to read it, then poll until the reader answers. The document id is kept, so the
 * record the recruiter then files cites the same bytes (`useRecordHiringAct`'s `documentId`).
 *
 * ⚠ The poll ends on its own after `MVR_CHECK_WAIT_MS`: a file the reader's intake refused (over ten pages,
 * a password) never produces a read, and a spinner with no end is a dead drawer. Then the panel says so and
 * the form below still records by hand.
 */
export function useMvrCheck(driverId: Ref<string>) {
  const documentId = ref<string | null>(null);
  const startedAt = ref<number | null>(null);

  const start = useMutation({
    mutationFn: async (file: File): Promise<string> => {
      const id = await uploadHiringEvidenceScan(driverId.value, "mvr", file);
      const res = await apiFetch<{ documentId: string }>(
        `/api/recruitment/applicants/${encodeURIComponent(driverId.value)}/mvr-check`,
        { method: "POST", body: { document_id: id } },
      );
      if (!res.ok) throw new Error(res.error?.message ?? "Could not start reading the record.");
      return id;
    },
    onSuccess: (id) => {
      documentId.value = id;
      startedAt.value = Date.now();
    },
  });

  const timedOut = ref(false);
  const check = useQuery({
    queryKey: computed(() => ["recruitment", "mvr-check", driverId.value, documentId.value] as const),
    enabled: computed(() => documentId.value !== null),
    queryFn: async (): Promise<MvrCheckState> => {
      const res = await apiFetch<MvrCheckState>(
        `/api/recruitment/applicants/${encodeURIComponent(driverId.value)}/mvr-check/${encodeURIComponent(documentId.value!)}`,
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not read the record's check.");
      if (res.data.status === "reading" && startedAt.value !== null && Date.now() - startedAt.value > MVR_CHECK_WAIT_MS) {
        timedOut.value = true;
      }
      return res.data;
    },
    refetchInterval: (q) => (q.state.data?.status === "reading" && !timedOut.value ? 2_500 : false),
  });

  function reset(): void {
    documentId.value = null;
    startedAt.value = null;
    timedOut.value = false;
  }

  return { start, check, documentId, timedOut, reset };
}
