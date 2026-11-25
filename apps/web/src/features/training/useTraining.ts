import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  TRAINING_MEDIA_MAX_BYTES,
  type TrainingAssign,
  type TrainingAssignmentRow,
  type TrainingCourseCreate,
  type TrainingCourseSummary,
  type TrainingQuestionInput,
  type TrainingQuestionView,
  type TrainingReach,
  type TrainingSendOutcome,
  type TrainingVersionUpdate,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { sha256Hex } from "@/composables/useCompliance";

/**
 * The office's Training page against `/api/training` (SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS §8–§9).
 * Every read and write is the API's: the tables are deny-all to a browser (0648, D-TR3).
 *
 * Keys share the `training` prefix, so a write invalidates by prefix and the three tabs never show
 * each other stale: a publish changes what Send offers, a send changes Progress.
 */
const ROOT = ["training"] as const;
const CATALOGUE = [...ROOT, "catalogue"] as const;
const ASSIGNMENTS = [...ROOT, "assignments"] as const;

async function call<T>(path: string, init: { method?: string; body?: object } = {}, what = "The training change could not be saved. Try again."): Promise<T> {
  const r = await apiFetch<T>(`/api/training${path}`, init);
  if (!r.ok) throw new Error(r.error?.message ?? what);
  return r.data as T;
}

export function useTrainingCatalogue() {
  return useQuery({
    queryKey: CATALOGUE,
    queryFn: async () => (await call<{ courses: TrainingCourseSummary[] }>("/catalogue", {}, "Could not load the training videos.")).courses,
    // A version being prepared for phones changes state on the worker; look again until none is.
    refetchInterval: (q) => ((q.state.data ?? []).some((c) => c.lessons.some((l) => l.versions.some((v) => v.state === "processing"))) ? 5000 : false),
  });
}

export function useTrainingAssignments(enabled: Ref<boolean> = computed(() => true)) {
  return useQuery({
    queryKey: ASSIGNMENTS,
    queryFn: async () => (await call<{ assignments: TrainingAssignmentRow[] }>("/assignments", {}, "Could not load who was sent training.")).assignments,
    enabled,
  });
}

/** How each picked driver can be reached (D-TR11). Asked of the API, which alone knows consent. */
export function useTrainingReach(driverIds: Ref<string[]>) {
  return useQuery({
    queryKey: computed(() => [...ROOT, "reach", [...driverIds.value].sort()]),
    queryFn: async () => (await call<{ reach: Record<string, TrainingReach> }>("/reach", { method: "POST", body: { driverIds: driverIds.value } })).reach,
    enabled: computed(() => driverIds.value.length > 0),
  });
}

export function useTrainingQuestions(versionId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => [...ROOT, "questions", versionId.value]),
    queryFn: async () => (await call<{ questions: TrainingQuestionView[] }>(`/versions/${versionId.value}/questions`)).questions,
    enabled: computed(() => !!versionId.value),
  });
}

/**
 * A link to watch a version in the office, to mark chapters against (`GET /versions/:id/preview`).
 * Signed for an hour; asked for again after 50 minutes so an open drawer never holds a dead link.
 */
export function useTrainingPreview(versionId: Ref<string | null>, ready: Ref<boolean>) {
  return useQuery({
    queryKey: computed(() => [...ROOT, "preview", versionId.value]),
    queryFn: async () => call<{ url: string; durationMs: number }>(`/versions/${versionId.value}/preview`, {}, "The video could not be opened."),
    enabled: computed(() => !!versionId.value && ready.value),
    staleTime: 50 * 60_000,
    refetchInterval: 50 * 60_000,
  });
}

/** One write, then every Training read looks again. */
function useWrite<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: ROOT }) });
}

export const useCreateCourse = () => useWrite((b: TrainingCourseCreate) => call<{ id: string }>("/courses", { method: "POST", body: b }));
export const useCreateLesson = () => useWrite((b: { courseId: string; title: string }) => call<{ id: string }>("/lessons", { method: "POST", body: b }));
export const useUpdateVersion = () => useWrite(({ id, ...b }: TrainingVersionUpdate & { id: string }) => call(`/versions/${id}`, { method: "PATCH", body: b }));
export const usePublishVersion = () => useWrite((id: string) => call<{ withdrew: string | null }>(`/versions/${id}/publish`, { method: "POST" }));
export const useWithdrawVersion = () => useWrite((id: string) => call(`/versions/${id}/withdraw`, { method: "POST" }));
export const useSaveQuestion = () =>
  useWrite(({ versionId, id, ...b }: TrainingQuestionInput & { versionId: string; id: string | null }) =>
    call(`/versions/${versionId}/questions${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", body: b }),
  );
export const useDeleteQuestion = () => useWrite(({ versionId, id }: { versionId: string; id: string }) => call(`/versions/${versionId}/questions/${id}`, { method: "DELETE" }));
export const useSendTraining = () => useWrite(async (b: TrainingAssign) => (await call<{ sent: TrainingSendOutcome[] }>("/assignments", { method: "POST", body: b })).sent);
export const useResendTraining = () => useWrite(async (id: string) => (await call<{ sent: TrainingSendOutcome }>(`/assignments/${id}/resend`, { method: "POST" })).sent);
export const useCancelTraining = () => useWrite((id: string) => call(`/assignments/${id}/revoke`, { method: "POST" }));

/** Why a picked file cannot be a film, in words; null when it may be sent. */
export function filmRefusal(file: File): string | null {
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > TRAINING_MEDIA_MAX_BYTES) return `${file.name} is larger than 100 MB. Export it smaller first.`;
  if (!/\.mp4$/i.test(file.name) && file.type !== "video/mp4") return `${file.name} is not an MP4 video.`;
  return null;
}

export type PutBytes = (url: string, file: File) => Promise<void>;
const putBytes: PutBytes = async (url, file) => {
  const res = await fetch(url, { method: "PUT", headers: { "content-type": "video/mp4" }, body: file });
  if (!res.ok) throw new Error(`${file.name} did not finish uploading. Try it again.`);
};

/**
 * An upload is three steps (§8.3): ask for a place (a new version and a signed URL), put the bytes
 * straight into Storage (a 100 MB film never passes through the API), then confirm — which queues the
 * worker that makes the 360/540/720p versions and the poster.
 */
export function useUploadFilm(put: PutBytes = putBytes) {
  return useWrite(async ({ lessonId, file }: { lessonId: string; file: File }) => {
    const refusal = filmRefusal(file);
    if (refusal) throw new Error(refusal);
    const sha256 = await sha256Hex(await file.arrayBuffer());
    const place = await call<{ versionId: string; uploadUrl: string }>("/uploads", { method: "POST", body: { lessonId, fileName: file.name, bytes: file.size, sha256 } });
    await put(place.uploadUrl, file);
    await call(`/versions/${place.versionId}/uploaded`, { method: "POST" });
    return place.versionId;
  });
}
