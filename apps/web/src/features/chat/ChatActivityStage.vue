<script setup lang="ts">
import type { ChatActivityItem } from "@silvicom/shared";
import { AppButton as BaseButton, QueryState } from "@silvicom/ui";
import ChatBody from "./ChatBody.vue";
import ChatStageHeader from "./ChatStageHeader.vue";
import { activityLine, activityTarget } from "./chatActivity";
import { chatRowTime } from "./chatTime";

/**
 * Activity on the stage (OFFICE-CHAT-PLAN D-CHAT25; CHAT-REDESIGN-PLAN §6: a rail item above Chats):
 * what named you and what answered your posts, newest first. A line says who, what and where, with the
 * words under it; an unread one is bold with a dot (D-CHATUI5's quiet emphasis, no red). Pressing one
 * opens the line where it lives — the conversation, the channel, or the post's thread. Older items
 * come a page at a time. The page marks the list read when it is shown (`ChatPage`).
 */
defineProps<{
  items: ChatActivityItem[];
  viewerId: string;
  titleOf: (threadId: string) => string | null;
  loading: boolean;
  error: Error | null;
  retrying: boolean;
  hasMore: boolean;
  loadingMore: boolean;
}>();
defineEmits<{ open: [query: Record<string, string>]; more: []; retry: []; back: [] }>();
</script>

<template>
  <section class="flex h-full min-h-0 flex-1 flex-col bg-surface" aria-label="Activity">
    <ChatStageHeader title="Activity" subtitle="Mentions of you and replies to your posts" glyph="activity" back-label="Back to conversations" @back="$emit('back')" />
    <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2 sm:px-4">
      <ul v-if="items.length" class="max-w-3xl">
        <li v-for="item in items" :key="item.message_id">
          <BaseButton type="button" size="row" block variant="ghost" class="px-3 py-2.5" @click="$emit('open', activityTarget(item))">
            <span class="block w-full min-w-0 text-left">
              <span class="flex items-baseline justify-between gap-2">
                <span class="flex min-w-0 items-center gap-2">
                  <span v-if="item.unread" class="size-2 shrink-0 rounded-full bg-brand-accent-strong" aria-hidden="true" />
                  <span class="truncate text-sm" :class="item.unread ? 'font-semibold text-ink' : 'font-medium text-ink-secondary'">
                    {{ activityLine(item, titleOf) }}<span v-if="item.unread" class="sr-only">, unread</span>
                  </span>
                </span>
                <time class="shrink-0 text-2xs tabular-nums text-ink-tertiary" :datetime="item.created_at">{{ chatRowTime(item.created_at) }}</time>
              </span>
              <span class="mt-0.5 line-clamp-2 block text-sm break-words text-ink-muted" :class="item.unread ? 'pl-4' : ''">
                <ChatBody :body="item.body ?? ''" :viewer-id="viewerId" />
              </span>
            </span>
          </BaseButton>
        </li>
      </ul>
      <div v-if="items.length && hasMore" class="max-w-3xl px-3 py-2">
        <BaseButton size="sm" variant="ghost" :disabled="loadingMore" @click="$emit('more')">{{ loadingMore ? "Loading…" : "Show earlier" }}</BaseButton>
      </div>
      <div v-if="!items.length" class="flex h-full items-center justify-center px-6 text-center text-sm text-ink-muted">
        <QueryState compact :loading="loading" :error="error" :retrying="retrying" loading-text="Loading Activity…" error-text="Could not load Activity." @retry="$emit('retry')">
          Nothing yet. When somebody mentions you or replies to your post, it shows here.
        </QueryState>
      </div>
    </div>
  </section>
</template>
