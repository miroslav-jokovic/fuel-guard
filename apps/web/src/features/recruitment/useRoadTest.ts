import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type {
  RoadTestExaminer,
  RoadTestExaminerCreate,
  RoadTestRecord,
  RoadTestResult,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { applicantChecklistKey } from "@/features/recruitment/useApplicantChecklist";

/**
 * The road test's reads and writes (D2, `ROAD-TEST-PLAN.md` RT3). Everything goes through the
 * recruitment section's own door, because the compliance one gates on `roster` manage and a recruiter
 * does not hold it — D1's reason, unchanged.
 */
export const roadTestExaminersKey = ["recruitment", "road-test-examiners"] as const;

export function useRoadTestExaminers() {
  return useQuery({
    queryKey: roadTestExaminersKey,
    queryFn: async (): Promise<RoadTestExaminer[]> => {
      const res = await apiFetch<{ examiners: RoadTestExaminer[] }>("/api/recruitment/road-test-examiners");
      if (!res.ok) throw new Error(res.error?.message ?? "Could not load the examiners.");
      return res.data?.examiners ?? [];
    },
  });
}

export function useAddRoadTestExaminer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RoadTestExaminerCreate): Promise<RoadTestExaminer> => {
      const res = await apiFetch<{ examiner: RoadTestExaminer }>("/api/recruitment/road-test-examiners", {
        method: "POST",
        body: input,
      });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not add the examiner.");
      return res.data.examiner;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: roadTestExaminersKey }),
  });
}

export function useRecordRoadTest(driverId: Ref<string>) {
  const qc = useQueryClient();
  const id = computed(() => driverId.value);
  return useMutation({
    mutationFn: async (input: RoadTestRecord): Promise<RoadTestResult> => {
      const res = await apiFetch<RoadTestResult>(
        `/api/recruitment/applicants/${encodeURIComponent(id.value)}/road-test`,
        { method: "POST", body: input },
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not record the road test.");
      return res.data;
    },
    onSuccess: () => {
      // Evidence in the §391.51 file AND the thing that moves step 13 — `useHiringEvidence`'s reason.
      void qc.invalidateQueries({ queryKey: ["compliance"] });
      void qc.invalidateQueries({ queryKey: applicantChecklistKey(id.value) });
    },
  });
}

/** A PNG file as the data URL the examiner endpoint takes. The API checks the bytes are a PNG. */
export function pngDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}
