import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type {
  ApplicantOrientationVideos,
  OrientationVideo,
  OrientationVideoCreate,
  OrientationVideoUpdate,
  OrientationVideosSent,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { applicantChecklistKey } from "@/features/recruitment/useApplicantChecklist";
import { pipelineKey } from "@/features/recruitment/useEmployment";

/**
 * The orientation videos, the office's side (HW8a, 0538): the carrier's list in Settings → Recruiting,
 * and one applicant's videos with "Send the videos" on the step's drawer.
 *
 * A change to the list changes what every applicant's step measures (a new required video re-opens a
 * done step), so it invalidates the board and every checklist, not only the list.
 */

export const orientationVideosKey = ["recruitment", "orientation-videos"] as const;
const applicantVideosKey = (driverId: string) => ["recruitment", "orientation-videos", driverId] as const;

export function useOrientationVideos() {
  return useQuery({
    queryKey: orientationVideosKey,
    queryFn: async (): Promise<OrientationVideo[]> => {
      const res = await apiFetch<{ videos: OrientationVideo[] }>("/api/recruitment/orientation-videos");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the orientation videos.");
      return res.data.videos;
    },
  });
}

function useInvalidateVideos() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: orientationVideosKey });
    void qc.invalidateQueries({ queryKey: ["recruitment", "checklist"] });
    void qc.invalidateQueries({ queryKey: pipelineKey });
  };
}

export function useAddOrientationVideo() {
  const invalidate = useInvalidateVideos();
  return useMutation({
    mutationFn: async (input: OrientationVideoCreate): Promise<OrientationVideo> => {
      const res = await apiFetch<{ video: OrientationVideo }>("/api/recruitment/orientation-videos", { method: "POST", body: input });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not add the video.");
      return res.data.video;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateOrientationVideo() {
  const invalidate = useInvalidateVideos();
  return useMutation({
    mutationFn: async (v: { id: string; patch: OrientationVideoUpdate }): Promise<OrientationVideo> => {
      const res = await apiFetch<{ video: OrientationVideo }>(`/api/recruitment/orientation-videos/${v.id}`, { method: "PATCH", body: v.patch });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not change the video.");
      return res.data.video;
    },
    onSuccess: invalidate,
  });
}

export function useApplicantOrientationVideos(driverId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => applicantVideosKey(driverId.value)),
    enabled: computed(() => Boolean(driverId.value)),
    queryFn: async (): Promise<ApplicantOrientationVideos> => {
      const res = await apiFetch<ApplicantOrientationVideos>(`/api/recruitment/applicants/${driverId.value}/orientation-videos`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the applicant's videos.");
      return res.data;
    },
  });
}

export function useSendOrientationVideos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (driverId: string): Promise<OrientationVideosSent> => {
      const res = await apiFetch<OrientationVideosSent>(`/api/recruitment/applicants/${driverId}/orientation-videos/send`, { method: "POST" });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not send the videos.");
      return res.data;
    },
    onSuccess: (_r, driverId) => {
      void qc.invalidateQueries({ queryKey: applicantVideosKey(driverId) });
      void qc.invalidateQueries({ queryKey: applicantChecklistKey(driverId) });
      void qc.invalidateQueries({ queryKey: pipelineKey });
    },
  });
}
