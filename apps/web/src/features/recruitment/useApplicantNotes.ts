import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { ApplicantActivityItem, ApplicantLastNote, ApplicantNote } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { pipelineKey } from "@/features/recruitment/useEmployment";

/**
 * The office's notes on an applicant and the activity list derived from the record (§9 P10, 0535).
 *
 * ⚠ Adding a note invalidates the PIPELINE too: the board's row says "last note: 2 d ago · {name}",
 * and a note written here that left the board saying "3 d ago" would tell the next recruiter nobody
 * has spoken to this person since. It invalidates the activity as well — "Added a note" is one of its
 * lines.
 */
const notesKey = (driverId: string) => ["recruitment", "notes", driverId] as const;
const activityKey = (driverId: string) => ["recruitment", "activity", driverId] as const;

export function useApplicantNotesQuery(driverId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => notesKey(driverId.value)),
    enabled: computed(() => Boolean(driverId.value)),
    queryFn: async (): Promise<ApplicantNote[]> => {
      const res = await apiFetch<{ notes: ApplicantNote[] }>(`/api/recruitment/applicants/${driverId.value}/notes`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the notes.");
      return res.data.notes;
    },
  });
}

export function useApplicantActivityQuery(driverId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => activityKey(driverId.value)),
    enabled: computed(() => Boolean(driverId.value)),
    queryFn: async (): Promise<ApplicantActivityItem[]> => {
      const res = await apiFetch<{ activity: ApplicantActivityItem[] }>(`/api/recruitment/applicants/${driverId.value}/activity`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the activity.");
      return res.data.activity;
    },
  });
}

function useInvalidateNotes() {
  const qc = useQueryClient();
  return (driverId: string) => {
    void qc.invalidateQueries({ queryKey: notesKey(driverId) });
    void qc.invalidateQueries({ queryKey: activityKey(driverId) });
    void qc.invalidateQueries({ queryKey: pipelineKey });
  };
}

export function useAddApplicantNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: async (v: { driverId: string; body: string }): Promise<ApplicantNote> => {
      const res = await apiFetch<{ note: ApplicantNote }>(`/api/recruitment/applicants/${v.driverId}/notes`, {
        method: "POST",
        body: { body: v.body },
      });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not save the note.");
      return res.data.note;
    },
    onSuccess: (_n, v) => invalidate(v.driverId),
  });
}

export function usePinApplicantNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: async (v: { driverId: string; noteId: string; pinned: boolean }): Promise<void> => {
      const res = await apiFetch(`/api/recruitment/applicants/${v.driverId}/notes/${v.noteId}/pin`, {
        method: "POST",
        body: { pinned: v.pinned },
      });
      if (!res.ok) throw new Error(res.error?.message ?? "Could not pin the note.");
    },
    onSuccess: (_r, v) => invalidate(v.driverId),
  });
}

/**
 * The board's line: "Last note: 2 d ago · Dana". Whole days, floored — a note from this morning reads
 * "today", which is what a recruiter scanning for who has gone quiet needs to see.
 */
export function lastNoteLine(note: ApplicantLastNote, now: Date = new Date()): string {
  const days = Math.max(0, Math.floor((now.getTime() - Date.parse(note.created_at)) / 86_400_000));
  return `Last note: ${days === 0 ? "today" : `${days} d ago`} · ${note.author_name}`;
}
