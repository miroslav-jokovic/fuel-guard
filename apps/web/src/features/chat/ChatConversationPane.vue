<script setup lang="ts">
import { computed, ref } from "vue";
import { chatTitle, type ChatConversationResponse } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import { mergeLines, type PendingLine } from "./useChat";
import { lineKey, useChatScroll } from "./earlierPages";
import ChatComposer from "./ChatComposer.vue";
import ChatEarlierButton from "./ChatEarlierButton.vue";
import ChatMessageBubble from "./ChatMessageBubble.vue";
import ChatPendingBubble from "./ChatPendingBubble.vue";

/**
 * One open conversation: its lines, oldest at the top, and the composer. The newest page comes first;
 * "Show earlier messages" asks the page's container for the one above (CH6a).
 *
 * Your own lines sit on the right. A line you sent that the server has not confirmed reads "Sending…";
 * one it refused keeps its text with Retry, so nothing typed is ever lost (D-CHAT2's optimistic send).
 * "Seen" appears under your newest line in a direct conversation once the other person's read
 * boundary has passed it — the receipt dispatch asked for in 0096, now from `read_seq`.
 *
 * Each server line is a `ChatMessageBubble` — Edit and Remove on your own, "Message removed" in a
 * retracted line's place — the bubble a channel post and a reply use too (CH5c).
 */
const props = defineProps<{
  data: ChatConversationResponse;
  viewerId: string;
  pending: PendingLine[];
  sending: boolean;
  /** The page above is being fetched, or could not be. */
  earlierLoading?: boolean;
  earlierFailed?: boolean;
}>();
defineEmits<{
  send: [body: string];
  retry: [line: PendingLine];
  edit: [messageId: string, body: string];
  remove: [messageId: string];
  back: [];
  earlier: [];
}>();

const lines = computed(() => mergeLines(props.data.messages, props.pending, props.data.conversation.thread_id));
const title = computed(() => chatTitle(props.data.conversation));
const memberNames = computed(() =>
  props.data.members.filter((m) => m.user_id !== props.viewerId).map((m) => m.name ?? "Someone").join(", "),
);

/** The other side's furthest read position, for "Seen" in a direct conversation. */
const othersReadSeq = computed(() =>
  Math.max(0, ...props.data.members.filter((m) => m.user_id !== props.viewerId).map((m) => m.read_seq)),
);
const myLastSeq = computed(() => {
  const mine = props.data.messages.filter((m) => m.sender_user_id === props.viewerId);
  return mine.length ? mine[mine.length - 1]!.seq : null;
});

const scroller = ref<HTMLElement | null>(null);
useChatScroll(scroller, () => [
  props.data.conversation.thread_id,
  lines.value[0] && lineKey(lines.value[0]),
  lines.value.at(-1) && lineKey(lines.value.at(-1)!),
]);
</script>

<template>
  <section class="flex h-full min-h-0 flex-col" :aria-label="title">
    <header class="flex items-center gap-2 border-b border-edge-subtle px-4 py-3">
      <!-- A phone shows the list OR the conversation (ChatPage); this is the way back. -->
      <BaseButton size="sm" variant="ghost" class="lg:hidden" @click="$emit('back')">Back</BaseButton>
      <div class="min-w-0">
        <h2 class="truncate text-sm font-semibold text-ink">{{ title }}</h2>
        <p v-if="data.conversation.kind !== 'direct'" class="truncate text-xs text-ink-muted">{{ memberNames }}</p>
      </div>
    </header>

    <div ref="scroller" class="flex-1 space-y-2 overflow-y-auto px-4 py-3" aria-live="polite">
      <ChatEarlierButton
        v-if="data.before_seq"
        noun="messages"
        :loading="earlierLoading ?? false"
        :failed="earlierFailed ?? false"
        @load="$emit('earlier')"
      />
      <p v-if="lines.length === 0" class="py-8 text-center text-sm text-ink-muted">No messages yet. Say hello.</p>

      <template v-for="l in lines" :key="lineKey(l)">
        <ChatMessageBubble
          v-if="l.kind === 'server'"
          :message="l.message"
          :viewer-id="viewerId"
          :show-sender="data.conversation.kind !== 'direct'"
          @edit="(id: string, body: string) => $emit('edit', id, body)"
          @remove="(id: string) => $emit('remove', id)"
        >
          <template #stamp>
            <span v-if="data.conversation.kind === 'direct' && l.message.seq === myLastSeq && othersReadSeq >= l.message.seq">· Seen</span>
          </template>
        </ChatMessageBubble>

        <ChatPendingBubble v-else :line="l.line" @retry="(line: PendingLine) => $emit('retry', line)" />
      </template>
    </div>

    <ChatComposer @send="(body: string) => $emit('send', body)" />
  </section>
</template>
