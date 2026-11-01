<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton, AppCard as BaseCard, AppTextarea, QueryState } from "@silvicom/ui";
import { APPLICANT_NOTE_MAX_LENGTH, formatDisplayDateTime, type ApplicantNote } from "@silvicom/shared";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useAddApplicantNote, useApplicantNotesQuery, usePinApplicantNote } from "@/features/recruitment/useApplicantNotes";

/**
 * The office's notes on one applicant (HIRING-WORKFLOW-AUDIT-2026-10-31 §8.2, §9 P10; the table is 0535).
 *
 * ⚠ **Append-only, and the panel says so by having nothing to edit.** No edit, no delete: 0535 refuses
 * both (AN010/AN011), because what the office knew and when is only worth reading if nobody could have
 * rewritten it. A correction is a new note. The one change a note takes is the pin — one note held at
 * the top of the applicant, the server unpinning the other (`set_applicant_note_pinned`).
 *
 * Writing and pinning are hidden from anybody without `recruitment` manage — the same gate the API's
 * `requireSection("recruitment")` reads (SP5: the org's answer, `session.can`), so a viewer is not
 * offered a button the server will refuse.
 */
const props = defineProps<{ driverId: string }>();

const session = useSessionStore();
const toast = useToastStore();
const canWrite = computed(() => session.can("recruitment"));
const notesQ = useApplicantNotesQuery(computed(() => props.driverId));
const add = useAddApplicantNote();
const pin = usePinApplicantNote();

const draft = ref("");
const ready = computed(() => draft.value.trim().length > 0 && draft.value.trim().length <= APPLICANT_NOTE_MAX_LENGTH);

async function submit(): Promise<void> {
  if (!ready.value) return;
  try {
    await add.mutateAsync({ driverId: props.driverId, body: draft.value });
    draft.value = "";
    toast.success("Note added");
  } catch (e) {
    toast.error("Could not add the note", e instanceof Error ? e.message : undefined);
  }
}

async function togglePin(note: ApplicantNote): Promise<void> {
  try {
    await pin.mutateAsync({ driverId: props.driverId, noteId: note.id, pinned: !note.pinned });
  } catch (e) {
    toast.error(note.pinned ? "Could not unpin the note" : "Could not pin the note", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <BaseCard>
    <h3 class="text-sm font-semibold text-ink">Notes</h3>
    <p class="mt-1 text-sm text-ink-muted">
      What the office knows about this applicant. Notes are kept as written — to correct one, add a new note.
    </p>

    <div v-if="canWrite" class="mt-4 space-y-2">
      <AppTextarea
        v-model="draft"
        :rows="3"
        :maxlength="APPLICANT_NOTE_MAX_LENGTH"
        aria-label="Add a note"
        placeholder="Called 10/30, sends the SSN card Monday"
      />
      <BaseButton variant="primary" :disabled="!ready || add.isPending.value" @click="submit">Add a note</BaseButton>
    </div>

    <div class="mt-4">
      <QueryState
        :loading="notesQ.isLoading.value"
        :error="notesQ.isError.value ? notesQ.error.value : null"
        :retrying="notesQ.isFetching.value"
        loading-text="Loading the notes…"
        error-text="Could not load the notes."
        compact
        @retry="notesQ.refetch()"
      >
        <p v-if="(notesQ.data.value ?? []).length === 0" class="text-sm text-ink-muted">No notes yet.</p>
        <ul v-else class="space-y-2">
          <li
            v-for="note in notesQ.data.value"
            :key="note.id"
            class="rounded-surface bg-surface-muted p-3"
            data-test="note"
          >
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <p class="text-xs text-ink-muted">
                <span v-if="note.pinned" class="font-medium text-ink">Pinned · </span>
                {{ note.author_name }} · {{ formatDisplayDateTime(note.created_at) }}
              </p>
              <BaseButton v-if="canWrite" size="sm" variant="ghost" :disabled="pin.isPending.value" @click="togglePin(note)">
                {{ note.pinned ? "Unpin" : "Pin to top" }}
              </BaseButton>
            </div>
            <p class="mt-1 whitespace-pre-line text-sm text-ink-secondary">{{ note.body }}</p>
          </li>
        </ul>
      </QueryState>
    </div>
  </BaseCard>
</template>
