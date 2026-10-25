<script setup lang="ts">
import { computed, ref } from "vue";
import { CHAT_BODY_MAX } from "@silvicom/shared";
import { AppButton as BaseButton, AppTextarea as BaseTextarea } from "@silvicom/ui";

/**
 * The box a line is written in — a conversation's, a channel's, a reply's (CH2, CH5c). Enter sends,
 * Shift+Enter breaks the line: Teams' and Slack's default. The text clears when it is handed over;
 * from there the caller's optimistic send keeps it on screen until the server has it.
 */
const props = withDefaults(defineProps<{ placeholder?: string; label?: string; action?: string }>(), {
  placeholder: "Type a message — Enter to send, Shift+Enter for a new line",
  label: "Message",
  action: "Send",
});
const emit = defineEmits<{ send: [body: string] }>();

const draft = ref("");
const over = computed(() => draft.value.length > CHAT_BODY_MAX);
function submit() {
  const body = draft.value.trim();
  if (!body || over.value) return;
  emit("send", body);
  draft.value = "";
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  }
}
</script>

<template>
  <form class="border-t border-edge-subtle p-3" @submit.prevent="submit">
    <BaseTextarea v-model="draft" :rows="2" :placeholder="props.placeholder" :aria-label="props.label" @keydown="onKey" />
    <div class="mt-2 flex items-center justify-between gap-2">
      <span class="text-xs" :class="over ? 'text-danger-text' : 'text-ink-muted'">
        <template v-if="over">{{ draft.length - CHAT_BODY_MAX }} characters too long</template>
      </span>
      <BaseButton type="submit" variant="primary" :disabled="!draft.trim() || over">{{ props.action }}</BaseButton>
    </div>
  </form>
</template>
