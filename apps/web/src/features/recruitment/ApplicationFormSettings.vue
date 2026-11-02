<script setup lang="ts">
import { computed } from "vue";
import {
  ALWAYS_OFFERED_CAPTURE_SLOTS,
  APPLICATION_CAPTURE_SLOT_LABELS,
  WITHHOLDABLE_CAPTURE_SLOTS,
  defaultRequiredQuestions,
  requirableQuestions,
  type ApplicationCaptureSlot,
  type RecruitingSettings,
} from "@silvicom/shared";
import { AppButton as BaseButton, AppCheckbox, QueryState } from "@silvicom/ui";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useRecruitingSettings, useSaveRecruitingSettings } from "@/features/recruitment/useRecruitingSettings";

/**
 * Settings → Recruiting's "The application form" (HIRING-WORKFLOW-AUDIT §11 S2, 0550).
 *
 * Two lists, each derived from its catalogue and never typed here:
 *   · the carrier's questions an applicant must answer (D-RS1/D-RS2) — `requirableQuestions()`, so "If so,
 *     when?" (asked only after a yes) is never offered;
 *   · the documents the application asks for (D-RS6) — `WITHHOLDABLE_CAPTURE_SLOTS`; the licence and the
 *     medical card are listed as always asked.
 *
 * ⚠ A change applies to applicants the office SENDS from now on. An applicant already sent the form keeps
 * the questions they were sent with (D-RS3) — said under the list, because otherwise ticking a box and
 * seeing a current applicant unaffected reads as a bug.
 *
 * Null is "the standard set" and is a value: "Use the standard set" writes it (D-RS7). Writes on
 * `session.can("recruitment")`, what the settings PUT asks — the same gate as "Your hiring steps".
 */
const session = useSessionStore();
const toast = useToastStore();
const canManage = computed(() => session.can("recruitment"));
const settingsQ = useRecruitingSettings();
const save = useSaveRecruitingSettings();

const QUESTIONS = requirableQuestions().map((q) => ({ id: q.id, label: q.label }));
const STANDARD_QUESTIONS = defaultRequiredQuestions();
const DOCUMENTS = WITHHOLDABLE_CAPTURE_SLOTS.map((s) => ({ slot: s, label: APPLICATION_CAPTURE_SLOT_LABELS[s] }));
const ALWAYS_ASKED = ALWAYS_OFFERED_CAPTURE_SLOTS.map((s) => APPLICATION_CAPTURE_SLOT_LABELS[s]).join(", ");

const settings = computed(() => settingsQ.data.value?.settings);
const required = computed(() => new Set<string>(settings.value?.required_questions ?? STANDARD_QUESTIONS));
const offered = computed(() => new Set<string>(settings.value?.offered_document_slots ?? WITHHOLDABLE_CAPTURE_SLOTS));
const questionsStandard = computed(() => (settings.value?.required_questions ?? null) === null);
const documentsStandard = computed(() => (settings.value?.offered_document_slots ?? null) === null);

async function write(patch: Partial<Pick<RecruitingSettings, "required_questions" | "offered_document_slots">>): Promise<void> {
  const s = settings.value;
  if (!s) return;
  try {
    await save.mutateAsync({ ...s, ...patch });
  } catch (e) {
    toast.error("Could not save the change", e instanceof Error ? e.message : undefined);
  }
}

function setRequired(id: string, on: boolean): Promise<void> {
  const next = new Set(required.value);
  if (on) next.add(id);
  else next.delete(id);
  // In the definition's order, so a saved list reads the way the form asks it.
  return write({ required_questions: QUESTIONS.map((q) => q.id).filter((q) => next.has(q)) });
}

function setOffered(slot: ApplicationCaptureSlot, on: boolean): Promise<void> {
  const next = new Set(offered.value);
  if (on) next.add(slot);
  else next.delete(slot);
  return write({ offered_document_slots: WITHHOLDABLE_CAPTURE_SLOTS.filter((s) => next.has(s)) });
}
</script>

<template>
  <div class="space-y-6" data-testid="application-form-settings">
    <QueryState
      :loading="settingsQ.isLoading.value"
      :error="settingsQ.isError.value ? settingsQ.error.value : null"
      error-text="Could not load the application form settings."
      :retrying="settingsQ.isFetching.value"
      loading-text="Loading the application form settings…"
      compact
      @retry="settingsQ.refetch()"
    >
      <div class="space-y-2" data-testid="required-questions">
        <div class="flex items-baseline justify-between gap-4">
          <h3 class="text-sm font-semibold text-ink">Questions an applicant must answer</h3>
          <BaseButton
            v-if="canManage && !questionsStandard"
            size="sm"
            variant="ghost"
            :disabled="save.isPending.value"
            data-testid="questions-standard"
            @click="write({ required_questions: null })"
          >
            Use the standard set
          </BaseButton>
        </div>
        <p class="text-xs text-ink-secondary">
          The application cannot be sent until these are answered. The others stay optional, with an "I'd rather not say".
          A change applies to applications you send from now on; an applicant already sent the form keeps the questions they were sent.
        </p>
        <ul class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <li v-for="q in QUESTIONS" :key="q.id">
            <AppCheckbox
              :model-value="required.has(q.id)"
              :label="q.label"
              :disabled="!canManage || save.isPending.value"
              @update:model-value="(v: boolean) => setRequired(q.id, v)"
            />
          </li>
        </ul>
      </div>

      <div class="space-y-2 border-t border-edge pt-4" data-testid="offered-documents">
        <div class="flex items-baseline justify-between gap-4">
          <h3 class="text-sm font-semibold text-ink">Documents the application asks for</h3>
          <BaseButton
            v-if="canManage && !documentsStandard"
            size="sm"
            variant="ghost"
            :disabled="save.isPending.value"
            data-testid="documents-standard"
            @click="write({ offered_document_slots: null })"
          >
            Ask for every document
          </BaseButton>
        </div>
        <p class="text-xs text-ink-secondary">
          Untick a document you never need and the applicant is not asked for it. Always asked: {{ ALWAYS_ASKED }}.
          None of them is required; an applicant can bring any of them to the office.
        </p>
        <ul class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <li v-for="d in DOCUMENTS" :key="d.slot">
            <AppCheckbox
              :model-value="offered.has(d.slot)"
              :label="d.label"
              :disabled="!canManage || save.isPending.value"
              @update:model-value="(v: boolean) => setOffered(d.slot, v)"
            />
          </li>
        </ul>
      </div>
    </QueryState>
  </div>
</template>
