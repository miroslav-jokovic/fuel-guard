<script setup lang="ts">
import type { ChatSavedLine } from "@silvicom/shared";
import { AppButton as BaseButton, AppIconButton, QueryState } from "@silvicom/ui";
import { BookmarkIcon } from "@silvicom/ui/icons";
import ChatLineLink from "./ChatLineLink.vue";
import ChatStageHeader from "./ChatStageHeader.vue";
import { activityTarget } from "./chatActivity";

/**
 * Saved on the stage (CH6c-2; a rail item under Activity, `?saved=1`): the lines this person kept,
 * newest save first. A save is theirs alone (D-CHAT24) — nobody else, the compliance console included,
 * ever sees it. Pressing one opens it where it lives, by the same rule Activity's items do
 * (`activityTarget`); the bookmark takes it off the list. A retracted line, or one in a conversation
 * they have left, is not listed (0523 `chat_saved`).
 */
defineProps<{
  items: ChatSavedLine[];
  viewerId: string;
  titleOf: (threadId: string) => string | null;
  loading: boolean;
  error: Error | null;
  retrying: boolean;
  hasMore: boolean;
  loadingMore: boolean;
}>();
defineEmits<{ open: [query: Record<string, string>]; unsave: [messageId: string]; more: []; retry: []; back: [] }>();

</script>

<template>
  <section class="flex h-full min-h-0 flex-1 flex-col bg-surface" aria-label="Saved">
    <ChatStageHeader title="Saved" subtitle="Messages you kept for later. Only you see this list." glyph="saved" back-label="Back to conversations" @back="$emit('back')" />
    <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2 sm:px-4">
      <ul v-if="items.length" class="max-w-3xl">
        <li v-for="item in items" :key="item.message_id" class="flex items-start gap-1">
          <ChatLineLink :line="item" :viewer-id="viewerId" :title-of="titleOf" @open="$emit('open', activityTarget(item))" />
          <AppIconButton :icon="BookmarkIcon" label="Remove from Saved" pressed size="sm" class="mt-2" @click="$emit('unsave', item.message_id)" />
        </li>
      </ul>
      <div v-if="items.length && hasMore" class="max-w-3xl px-3 py-2">
        <BaseButton size="sm" variant="ghost" :disabled="loadingMore" @click="$emit('more')">{{ loadingMore ? "Loading…" : "Show earlier" }}</BaseButton>
      </div>
      <div v-if="!items.length" class="flex h-full items-center justify-center px-6 text-center text-sm text-ink-muted">
        <QueryState compact :loading="loading" :error="error" :retrying="retrying" loading-text="Loading your saved messages…" error-text="Could not load your saved messages." @retry="$emit('retry')">
          Nothing saved yet. Point at a message and press the bookmark to keep it here.
        </QueryState>
      </div>
    </div>
  </section>
</template>
