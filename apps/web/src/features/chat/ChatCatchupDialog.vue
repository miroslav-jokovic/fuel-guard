<script setup lang="ts">
import { watch } from "vue";
import { CHAT_CATCHUP_DAILY_CAP } from "@silvicom/shared";
import { AppButton as BaseButton, BaseModal, QueryState } from "@silvicom/ui";
import { useChatCatchup } from "./useChatCatchup";

/**
 * "Catch me up" (OFFICE-CHAT-PLAN CH12): a summary of the lines in this conversation the reader has not
 * read yet. Each opening asks once (`useChatCatchup`); the summary says it was written by AI and from how
 * many lines, so nobody takes it for the lines themselves, and that asking marked nothing read (D-CHAT38)
 * — the "New" line is still where they left off. What is left of the day's catch-ups is the database's
 * count after this one (0549 `chat_catchup_record`), not one worked out here.
 */
const props = defineProps<{ threadId: string; open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const ask = useChatCatchup();
const run = () => ask.mutate(props.threadId);
watch(() => props.open, (open) => { if (open) { ask.reset(); run(); } }, { immediate: true });

const messages = (n: number) => `${n} unread message${n === 1 ? "" : "s"}`;
</script>

<template>
  <BaseModal :open="open" title="Catch me up" description="A short summary of what you have not read here yet." size="md" @close="emit('close')">
    <!-- ui-adoption: server-message — the API's sentence says WHICH failure it was: no model set up on this
         server (asking again will not help) or the summary could not be written (asking again may). -->
    <QueryState
      compact
      :loading="ask.isPending.value"
      :error="ask.isError.value ? ask.error.value : null"
      loading-text="Reading your unread messages…"
      @retry="run"
    >
      <template v-if="ask.data.value?.kind === 'limit'">
        <p class="text-sm text-ink" data-catchup-limit>
          You have used today's {{ CHAT_CATCHUP_DAILY_CAP }} catch-ups. Each one comes back 24 hours after you asked for it.
        </p>
      </template>
      <template v-else-if="ask.data.value?.kind === 'done'">
        <p v-if="ask.data.value.summary === null" class="text-sm text-ink" data-catchup-empty>You're up to date. Nothing here is unread.</p>
        <template v-else>
          <p class="whitespace-pre-wrap break-words text-sm text-ink" data-catchup-summary>{{ ask.data.value.summary }}</p>
          <p class="mt-3 text-xs text-ink-muted" data-catchup-note>
            Written by AI from {{ messages(ask.data.value.lines) }}. Check the messages before you act on it. Nothing was marked read.
          </p>
        </template>
        <p class="mt-1 text-xs text-ink-muted" data-catchup-left>{{ ask.data.value.left }} of {{ CHAT_CATCHUP_DAILY_CAP }} catch-ups left today.</p>
      </template>
    </QueryState>
    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">Close</BaseButton>
    </template>
  </BaseModal>
</template>
