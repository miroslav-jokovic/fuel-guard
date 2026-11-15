<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { useChatPushPrivacy } from "./useChatPushPrivacy";

/**
 * Message text in notifications: shown or hidden, at the foot of the chat rail under Do not disturb
 * (INSTALLED-APP-PLAN IA-S4; the owner's ruling of 2026-11-15, Q-IA4 (a): each person's own switch).
 *
 * A locked phone shows a notification to whoever picks it up. Hidden, a notification says only who wrote —
 * "New message from Ana" — on every device the person has, and the line waits in Chat. The control says what
 * the other state would do BEFORE it is pressed, because "hidden" alone does not say hidden from whom.
 */
const privacy = useChatPushPrivacy();
const hidden = computed(() => privacy.state.data.value?.hide_text === true);
const note = ref<string | null>(null);

async function toggle() {
  note.value = null;
  try {
    await privacy.setHidden(!hidden.value);
  } catch (e) {
    note.value = e instanceof Error ? e.message : "Could not change the notification setting.";
  }
}
</script>

<template>
  <div v-if="privacy.state.isSuccess.value" class="shrink-0 border-t border-edge-subtle px-3 py-2.5 text-xs text-ink-muted">
    <p class="flex items-center justify-between gap-2">
      <span>Message text in notifications: {{ hidden ? "hidden" : "shown" }}</span>
      <BaseButton size="sm" variant="link" class="text-xs" :disabled="privacy.busy.value" @click="toggle">{{ hidden ? "Show" : "Hide" }}</BaseButton>
    </p>
    <p class="mt-1 text-ink-tertiary">
      {{ hidden
        ? "Notifications say only who wrote, on all your devices. Open Chat to read the message."
        : "A locked phone shows who wrote and the start of the message." }}
    </p>
    <p v-if="note" class="mt-1" role="status">{{ note }}</p>
  </div>
</template>
