<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { CHAT_BODY_MAX } from "@silvicom/shared";
import { AppButton as BaseButton, AppIcon, AppTextarea as BaseTextarea } from "@silvicom/ui";
import { PaperAirplaneIcon } from "@silvicom/ui/icons";
import { useBottomChrome } from "@/composables/bottomChrome";

/**
 * The box a line is written in — a conversation's, a channel's, a reply's (CH2, CH5c; CHAT-REDESIGN-PLAN
 * D-CHATUI8). One field that grows from a line to eight and then scrolls, with Send inside it. Enter
 * sends, Shift+Enter breaks the line, and a composition in progress (an IME) never sends: Teams' and
 * Slack's default. The text clears when it is handed over; from there the caller's optimistic send
 * keeps it on screen until the server has it. The counter appears only inside the last tenth of the
 * limit, because a limit nobody is near is noise.
 *
 * The form registers as bottom chrome (D-CHATUI14): the Ask AI launcher parks bottom-right, over
 * exactly where Send sits on a page that fills the window, and `bottomChrome.ts`'s rule is that a bar
 * says how tall it is and the launcher keeps itself above the tallest.
 */
const props = withDefaults(defineProps<{ placeholder?: string; label?: string; action?: string; threadKey?: string | null }>(), {
  placeholder: "Message",
  label: "Message",
  action: "Send",
  threadKey: null,
});
const emit = defineEmits<{ send: [body: string] }>();

const draft = ref("");
const field = ref<{ $el: HTMLTextAreaElement } | null>(null);
const form = ref<HTMLElement | null>(null);
useBottomChrome(form);

const over = computed(() => draft.value.length > CHAT_BODY_MAX);
const remaining = computed(() => CHAT_BODY_MAX - draft.value.length);
const nearLimit = computed(() => draft.value.length >= CHAT_BODY_MAX * 0.9);

/** Eight lines of `text-sm` plus the field's padding, then the field scrolls. */
const MAX_HEIGHT = 8 * 20 + 20;
function grow() {
  const el = field.value?.$el;
  if (!el || typeof el.scrollHeight !== "number") return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
}
watch(draft, grow, { flush: "post" });
// A different conversation is a different draft: the field empties and shrinks with it.
watch(() => props.threadKey, () => { draft.value = ""; });

function submit() {
  const body = draft.value.trim();
  if (!body || over.value) return;
  emit("send", body);
  draft.value = "";
  field.value?.$el.focus();
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  }
}
</script>

<template>
  <form ref="form" class="shrink-0 px-2 pt-1 pb-2 sm:px-4 sm:pb-3" @submit.prevent="submit">
    <div
      class="relative max-w-3xl rounded-surface bg-surface ring-1 ring-inset focus-within:ring-2"
      :class="over ? 'ring-danger-600 focus-within:ring-danger-600' : 'ring-edge-strong focus-within:ring-focus-ring'"
    >
      <BaseTextarea
        ref="field"
        v-model="draft"
        :rows="1"
        :placeholder="props.placeholder"
        :aria-label="props.label"
        class="min-h-0! resize-none bg-transparent! py-2.5 pr-12 ring-0! focus:ring-0!"
        @keydown="onKey"
      />
      <BaseButton type="submit" size="icon" variant="primary" class="absolute right-1.5 bottom-1.5" :aria-label="props.action" :title="props.action" :disabled="!draft.trim() || over">
        <AppIcon :icon="PaperAirplaneIcon" class="size-4" aria-hidden="true" />
      </BaseButton>
    </div>
    <p class="mt-1 flex max-w-3xl justify-between gap-2 text-2xs text-ink-tertiary">
      <span>Enter to send · Shift+Enter for a new line</span>
      <span v-if="nearLimit" class="tabular-nums" :class="over ? 'text-danger-text' : ''" aria-live="polite">
        <template v-if="over">{{ -remaining }} characters too long</template>
        <template v-else>{{ remaining }} left</template>
      </span>
    </p>
  </form>
</template>
