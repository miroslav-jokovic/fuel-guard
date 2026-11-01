<script setup lang="ts">
import type { ChatSavedLine } from "@silvicom/shared";
import { AppAvatar, AppButton as BaseButton, AppIconButton, QueryState } from "@silvicom/ui";
import { BookmarkIcon } from "@silvicom/ui/icons";
import ChatBody from "./ChatBody.vue";
import ChatStageHeader from "./ChatStageHeader.vue";
import { activityTarget } from "./chatActivity";
import { chatRowTime } from "./chatTime";

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

/** Where it was said: "# Loads", a group's name, or the person a direct conversation is with. */
function place(item: ChatSavedLine, titleOf: (id: string) => string | null): string {
  if (item.kind === "channel") return `# ${item.subject?.trim() || "a channel"}`;
  return item.subject?.trim() || titleOf(item.thread_id) || (item.kind === "direct" ? "a conversation" : "a group");
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-1 flex-col bg-surface" aria-label="Saved">
    <ChatStageHeader title="Saved" subtitle="Messages you kept for later. Only you see this list." glyph="saved" back-label="Back to conversations" @back="$emit('back')" />
    <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2 sm:px-4">
      <ul v-if="items.length" class="max-w-3xl">
        <li v-for="item in items" :key="item.message_id" class="flex items-start gap-1">
          <BaseButton type="button" size="row" block variant="ghost" class="min-w-0 flex-1 px-3 py-2.5" @click="$emit('open', activityTarget(item))">
            <span class="flex w-full min-w-0 gap-3 text-left">
              <AppAvatar :label="item.sender_name" :identity="item.sender_user_id" size="sm" />
              <span class="block min-w-0 flex-1">
                <span class="flex items-baseline justify-between gap-2">
                  <span class="truncate text-sm font-medium text-ink">{{ item.sender_name ?? "Someone" }} <span class="font-normal text-ink-muted">in {{ place(item, titleOf) }}</span></span>
                  <time class="shrink-0 text-2xs tabular-nums text-ink-tertiary" :datetime="item.created_at">{{ chatRowTime(item.created_at) }}</time>
                </span>
                <span class="mt-0.5 line-clamp-2 block text-sm break-words text-ink-secondary">
                  <ChatBody :body="item.body ?? ''" :viewer-id="viewerId" />
                </span>
              </span>
            </span>
          </BaseButton>
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
