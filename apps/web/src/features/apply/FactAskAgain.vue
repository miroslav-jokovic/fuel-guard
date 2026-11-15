<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { AppButton as BaseButton, AppFormField as FormField, AppTextarea as BaseTextarea } from "@silvicom/ui";
import {
  ASK_AGAIN_QUESTION_MAX,
  askAgainIsOpen,
  canAskAgain,
  keyedEditPath,
  type ApplicationPath,
  type ApplicationReviewState,
} from "@silvicom/shared";
import { formatDateTime } from "@/lib/format";
import { askAgainNoticeText, useAskAgainListQuery, useAskApplicantAgain, useWithdrawAskAgain } from "./useAskAgainOffice";

/**
 * "Ask the applicant" under one answer of the facts card (APPLICATION-FIX-PLAN.md F5).
 *
 * ── WHEN IT IS OFFERED ────────────────────────────────────────────────────────────────────────
 * Only while the application is waiting for the office (`awaiting_review`) — the API's own window —
 * and only for an answer the applicant can still change on their link (`canAskAgain`, the shared rule
 * the API refuses by). An answer it may not ask about shows nothing: the office corrects those itself,
 * with the Edit beside them.
 *
 * ── WHAT IT SHOWS ─────────────────────────────────────────────────────────────────────────────
 * A question already waiting on this answer, in the office's words, with "Take it back"; the last
 * answered one, so the office sees the applicant replied; otherwise the way to ask.
 *
 * After a question is sent the row says what became of telling the applicant (`askAgainNoticeText`):
 * e-mailed and to where, or not, and then to text or call — an office that believed a notice went would
 * wait on an applicant who has no reason to open their link. No text message goes yet.
 *
 * The row is named by its KEY (`keyedEditPath`), as a correction is, so the question stays on its row
 * when the applicant adds or removes one above it.
 */
const props = defineProps<{
  invitationId: string;
  /** The answer's path as the card holds it (by place); sent by key. */
  path: ApplicationPath;
  /** The words above the answer — what the office is asking about. */
  label: string;
  state: ApplicationReviewState;
  payload: Record<string, unknown> | null;
  /** May this reader act on the application (the card's own `draftOpen`)? Without it the row only reports. */
  canAsk: boolean;
}>();

const id = toRef(props, "invitationId");
const list = useAskAgainListQuery(id);
const ask = useAskApplicantAgain(id);
const withdraw = useWithdrawAskAgain(id);

const keyed = computed(() => keyedEditPath(props.path, props.payload));
const mine = computed(() => (list.data.value ?? []).filter((q) => JSON.stringify(q.path) === JSON.stringify(keyed.value)));
const waiting = computed(() => mine.value.find(askAgainIsOpen) ?? null);
const answered = computed(() => [...mine.value].reverse().find((q) => q.answeredAt !== null) ?? null);
const offered = computed(() => props.canAsk && props.state === "awaiting_review" && canAskAgain(keyed.value));

const writing = ref(false);
const words = ref("");
const problem = ref<string | null>(null);
/** What became of the notice for the question just sent — said on the row until it is closed. */
const told = ref<string | null>(null);

async function send(): Promise<void> {
  problem.value = null;
  try {
    const asked = await ask.mutateAsync({ path: keyed.value, question: words.value.trim() });
    [writing.value, words.value, told.value] = [false, "", askAgainNoticeText(asked.notice)];
  } catch (e) {
    problem.value = (e as Error).message;
  }
}
async function takeBack(questionId: string): Promise<void> {
  problem.value = null;
  try {
    await withdraw.mutateAsync(questionId);
  } catch (e) {
    problem.value = (e as Error).message;
  }
}
</script>

<template>
  <div v-if="waiting || answered || offered || told" class="mt-1 space-y-2" data-ask-again>
    <div v-if="waiting" class="rounded-surface bg-surface-muted p-2 text-xs" data-ask-waiting>
      <p class="font-medium text-ink">Waiting for the applicant's answer</p>
      <p class="mt-0.5 whitespace-pre-line break-words text-ink-secondary">You asked: {{ waiting.question }}</p>
      <div v-if="canAsk" class="mt-1 flex justify-end">
        <BaseButton size="sm" variant="ghost" :disabled="withdraw.isPending.value" @click="takeBack(waiting.id)">Take it back</BaseButton>
      </div>
    </div>
    <p v-else-if="answered" class="text-2xs text-ink-tertiary" data-ask-answered>
      The applicant answered your question on {{ formatDateTime(answered.answeredAt!) }}: {{ answered.question }}
    </p>

    <template v-if="offered && !waiting">
      <div v-if="!writing" class="flex justify-end">
        <BaseButton size="sm" variant="ghost" @click="writing = true; problem = null">Ask the applicant</BaseButton>
      </div>
      <div v-else class="space-y-2 rounded-surface bg-surface-muted p-3">
        <FormField
          :label="`Your question about “${label}”`"
          hint="The applicant is e-mailed that a question is waiting — not your words, which they read on their own link. No text message is sent."
        >
          <template #default="f">
            <BaseTextarea v-bind="f" v-model="words" rows="2" :maxlength="ASK_AGAIN_QUESTION_MAX" data-ask-words />
          </template>
        </FormField>
        <div class="flex justify-end gap-2">
          <BaseButton size="sm" variant="ghost" @click="writing = false">Cancel</BaseButton>
          <BaseButton size="sm" variant="primary" :disabled="ask.isPending.value || words.trim() === ''" @click="send">Send the question</BaseButton>
        </div>
      </div>
    </template>
    <!-- Its own line, not part of the waiting block: said the moment the send answers, before the list is re-read. -->
    <p v-if="told" class="text-xs text-ink-secondary" role="status" data-ask-told>{{ told }}</p>
    <p v-if="problem" class="text-sm text-danger-700" role="alert">{{ problem }}</p>
  </div>
</template>
