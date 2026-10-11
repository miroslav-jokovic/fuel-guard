<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { AppIcon } from "@silvicom/ui";
import { ArrowUpIcon } from "@silvicom/ui/icons";
import { QUESTION_MAX } from "@/stores/assistant";

/**
 * Where a question is written.
 *
 * ⚠ A raw `<textarea>`, not `AppTextarea`, and the difference is the job rather than the look.
 * `AppTextarea` is a form field: its own ring, a 96 px minimum height, a label above it. This is a
 * composer — one line that grows with what is typed, with the send button inside its frame, and the
 * frame (not the textarea) taking the focus ring. Re-styling the form primitive into that would
 * fight its classes; `class` loses to the utility it overrides, as the kebab menu learned.
 */
const props = defineProps<{ busy: boolean }>();
const emit = defineEmits<{ send: [question: string] }>();

const text = ref("");
const box = ref<HTMLTextAreaElement | null>(null);
const canSend = computed(() => !props.busy && text.value.trim().length > 0);
const nearLimit = computed(() => text.value.length > QUESTION_MAX - 100);

/** Grow with the text up to ~6 lines, then scroll inside. */
function fit() {
  const el = box.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}
watch(text, () => nextTick(fit));

function send() {
  if (!canSend.value) return;
  emit("send", text.value);
  text.value = "";
}

function onKeydown(e: KeyboardEvent) {
  // Enter sends; Shift+Enter is a new line. `isComposing`: an IME's Enter confirms a word, not the question.
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
}

/** Fill the box without sending — a suggestion the reader wants to adjust first. */
function prefill(q: string) {
  text.value = q;
  nextTick(() => box.value?.focus());
}

defineExpose({ focus: () => box.value?.focus(), prefill });
</script>

<template>
  <div>
    <form
      class="flex items-end gap-2 rounded-surface bg-surface p-1.5 pl-3 ring-1 ring-edge-control transition-shadow focus-within:ring-2 focus-within:ring-focus-ring"
      @submit.prevent="send"
    >
      <label for="assistant-question" class="sr-only">Your question</label>
      <textarea
        id="assistant-question"
        ref="box"
        v-model="text"
        rows="1"
        :maxlength="QUESTION_MAX"
        placeholder="Ask about fuel, MPG, idling or drivers…"
        class="block max-h-40 min-h-8 flex-1 resize-none border-0 bg-transparent py-1.5 text-base text-ink placeholder:text-ink-disabled focus:outline-none sm:text-sm"
        @keydown="onKeydown"
      />
      <button
        type="submit"
        :disabled="!canSend"
        :aria-label="busy ? 'Waiting for the answer' : 'Send question'"
        class="inline-flex size-8 shrink-0 items-center justify-center rounded-control bg-action-primary text-action-primary-foreground transition-colors hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-disabled"
      >
        <AppIcon :icon="ArrowUpIcon" class="size-4" aria-hidden="true" />
      </button>
    </form>
    <p class="mt-1.5 flex justify-between gap-3 px-1 text-2xs text-ink-muted">
      <span>Each question is answered on its own, so name the period and the driver or truck.</span>
      <span v-if="nearLimit" class="shrink-0 tabular-nums">{{ text.length }}/{{ QUESTION_MAX }}</span>
    </p>
  </div>
</template>
