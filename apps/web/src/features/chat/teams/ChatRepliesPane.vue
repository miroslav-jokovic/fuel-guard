<script setup lang="ts">
import { computed, ref } from "vue";
import type { ChatPost, ChatPostPage } from "@silvicom/shared";
import { AppButton as BaseButton, QueryState } from "@silvicom/ui";
import ChatComposer from "../ChatComposer.vue";
import ChatEarlierButton from "../ChatEarlierButton.vue";
import ChatMessageBubble from "../ChatMessageBubble.vue";
import ChatPendingBubble from "../ChatPendingBubble.vue";
import { mergeLines, type PendingLine } from "../useChat";
import { lineKey, useChatScroll } from "../earlierPages";

/**
 * One post's replies (OFFICE-CHAT-PLAN CH5c, D-CHAT19): the post at the top, its replies under it,
 * oldest first, and the box for a reply. One level deep, as Teams: a reply is answered by replying to
 * the post. A removed post takes no new reply (0518, CH011), so its box is not offered.
 */
const props = defineProps<{
  post: ChatPost;
  threadId: string;
  page: ChatPostPage | undefined;
  loading: boolean;
  error: Error | null;
  viewerId: string;
  pending: PendingLine[];
  /** The page above is being fetched, or could not be (CH6a). */
  earlierLoading?: boolean;
  earlierFailed?: boolean;
}>();
const emit = defineEmits<{
  send: [body: string];
  retry: [line: PendingLine];
  edit: [messageId: string, body: string];
  remove: [messageId: string];
  close: [];
  refetch: [];
  earlier: [];
}>();

const lines = computed(() => mergeLines(props.page?.posts ?? [], props.pending, props.threadId, props.post.id));

const scroller = ref<HTMLElement | null>(null);
useChatScroll(scroller, () => [props.post.id, lines.value[0] && lineKey(lines.value[0]), lines.value.at(-1) && lineKey(lines.value.at(-1)!)]);
</script>

<template>
  <section class="flex h-full min-h-0 flex-col" aria-label="Replies">
    <header class="flex items-center justify-between gap-2 border-b border-edge-subtle px-4 py-3">
      <h2 class="text-sm font-semibold text-ink">Replies</h2>
      <BaseButton size="sm" variant="ghost" @click="emit('close')">Close</BaseButton>
    </header>

    <div ref="scroller" class="flex-1 space-y-2 overflow-y-auto px-4 py-3" aria-live="polite">
      <ChatMessageBubble
        :message="post"
        :viewer-id="viewerId"
        :show-sender="true"
        @edit="(id: string, body: string) => emit('edit', id, body)"
        @remove="(id: string) => emit('remove', id)"
      />
      <div class="border-t border-edge-subtle" role="separator" />
      <QueryState
        v-if="!page"
        compact
        :loading="loading && !error"
        :error="error"
        :retrying="loading"
        loading-text="Loading the replies…"
        error-text="Could not load the replies."
        @retry="emit('refetch')"
      />
      <template v-else>
        <ChatEarlierButton v-if="page.before_seq" noun="replies" :loading="earlierLoading ?? false" :failed="earlierFailed ?? false" @load="emit('earlier')" />
        <p v-if="lines.length === 0" class="py-4 text-center text-sm text-ink-muted">No replies yet.</p>
        <template v-for="l in lines" :key="lineKey(l)">
          <ChatMessageBubble
            v-if="l.kind === 'server'"
            :message="l.message"
            :viewer-id="viewerId"
            :show-sender="true"
            @edit="(id: string, body: string) => emit('edit', id, body)"
            @remove="(id: string) => emit('remove', id)"
          />
          <ChatPendingBubble v-else :line="l.line" @retry="(line: PendingLine) => emit('retry', line)" />
        </template>
      </template>
    </div>

    <ChatComposer v-if="!post.deleted_at" placeholder="Reply — Enter to send, Shift+Enter for a new line" label="Reply" action="Reply" @send="(body: string) => emit('send', body)" />
    <p v-else class="border-t border-edge-subtle p-3 text-sm text-ink-muted">This post was removed, so it takes no new replies.</p>
  </section>
</template>
