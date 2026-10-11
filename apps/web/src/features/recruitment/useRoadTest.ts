import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type {
  RoadTestCertificateCopy,
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

/**
 * Retires an examiner (Q-AW42's register). A retirement and not a delete, because the forms and
 * certificates they signed print their name and signature from the row: it stays, stamped
 * `retired_at`, and leaves the list the office picks from. There is no un-retire in the api.
 */
export function useRetireRoadTestExaminer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const res = await apiFetch(`/api/recruitment/road-test-examiners/${encodeURIComponent(id)}/retire`, {
        method: "POST",
        body: {},
      });
      if (!res.ok) throw new Error(res.error?.message ?? "Could not retire the examiner.");
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
      // A pass is a new certificate, and a certificate nobody has had yet (G-10).
      void qc.invalidateQueries({ queryKey: roadTestCopiesKey(id.value) });
    },
  });
}

/**
 * Whether the driver has had their copy of each certificate (G-10, Q-AW19, owner 2026-09-29): a
 * download from their link, or the office saying it handed over paper. Keyed under the driver, so the
 * paper-copy press refreshes exactly this answer.
 */
export const roadTestCopiesKey = (driverId: string) => ["recruitment", "road-test-copies", driverId] as const;

export function useRoadTestCertificateCopies(driverId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => roadTestCopiesKey(driverId.value)),
    queryFn: async (): Promise<RoadTestCertificateCopy[]> => {
      const res = await apiFetch<{ copies: RoadTestCertificateCopy[] }>(
        `/api/recruitment/applicants/${encodeURIComponent(driverId.value)}/road-test/copies`,
      );
      if (!res.ok) throw new Error(res.error?.message ?? "Could not load whether the certificate was given.");
      return res.data?.copies ?? [];
    },
  });
}

export function useRecordPaperCopy(driverId: Ref<string>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (recordId: string): Promise<RoadTestCertificateCopy> => {
      const res = await apiFetch<{ copy: RoadTestCertificateCopy }>(
        `/api/recruitment/applicants/${encodeURIComponent(driverId.value)}/road-test/${encodeURIComponent(recordId)}/paper-copy`,
        { method: "POST", body: {} },
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not record that the copy was given.");
      return res.data.copy;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: roadTestCopiesKey(driverId.value) }),
  });
}

/**
 * A PNG as the data URL the examiner and Representative endpoints take. The API checks the bytes
 * are a PNG. Since Q-AW45 it is the pad's drawing (a Blob), no longer an uploaded file.
 */
export function pngDataUrl(png: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the signature."));
    reader.readAsDataURL(png);
  });
}
