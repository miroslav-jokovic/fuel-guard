<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { ChatPost, ChatPostPage } from "@silvicom/shared";
import { AppButton as BaseButton, QueryState } from "@silvicom/ui";
import ChatComposer from "../ChatComposer.vue";
import ChatMessageBubble from "../ChatMessageBubble.vue";
import ChatPendingBubble from "../ChatPendingBubble.vue";
import { mergeLines, type PendingLine } from "../useChat";

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
}>();
const emit = defineEmits<{
  send: [body: string];
  retry: [line: PendingLine];
  edit: [messageId: string, body: string];
  remove: [messageId: string];
  close: [];
  refetch: [];
}>();

const lines = computed(() => mergeLines(props.page?.posts ?? [], props.pending, props.threadId, props.post.id));

const scroller = ref<HTMLElement | null>(null);
watch(
  () => [props.post.id, lines.value.length],
  async () => {
    await nextTick();
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
  },
  { immediate: true },
);
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
        <p v-if="page.before_seq" class="text-center text-xs text-ink-muted">Earlier replies are not shown yet.</p>
        <p v-if="lines.length === 0" class="py-4 text-center text-sm text-ink-muted">No replies yet.</p>
        <template v-for="l in lines" :key="l.kind === 'server' ? l.message.id : l.line.message_id">
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
