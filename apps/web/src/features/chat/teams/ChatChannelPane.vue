<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { ChatPostPage, ChatTeamChannel } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import ChatComposer from "../ChatComposer.vue";
import ChatMessageBubble from "../ChatMessageBubble.vue";
import ChatPendingBubble from "../ChatPendingBubble.vue";
import { chatRowTime } from "../chatTime";
import { mergeLines, type PendingLine } from "../useChat";

/**
 * One open channel (OFFICE-CHAT-PLAN CH5c, D-CHAT19): its top-level posts, oldest at the top, each
 * with how many replies it has and when the last came; and the box for a new post. A post's replies
 * open beside it (`ChatRepliesPane`) — the channel shows the conversation's shape, the reply pane one
 * post's thread, as Teams does.
 *
 * Posting, editing and removing are the conversation's own acts: a channel IS a conversation
 * (D-CHAT18), so the same optimistic send and the same bubble serve it.
 */
const props = defineProps<{
  channel: ChatTeamChannel;
  teamName: string;
  page: ChatPostPage;
  viewerId: string;
  pending: PendingLine[];
  openPostId: string | null;
}>();
const emit = defineEmits<{
  send: [body: string];
  retry: [line: PendingLine];
  edit: [messageId: string, body: string];
  remove: [messageId: string];
  replies: [postId: string];
  leave: [];
  back: [];
}>();

const lines = computed(() => mergeLines(props.page.posts, props.pending, props.channel.thread_id));

const scroller = ref<HTMLElement | null>(null);
watch(
  () => [props.channel.thread_id, lines.value.length],
  async () => {
    await nextTick();
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
  },
  { immediate: true },
);
</script>

<template>
  <section class="flex h-full min-h-0 flex-col" :aria-label="`${channel.name}, ${teamName}`">
    <header class="flex items-center gap-2 border-b border-edge-subtle px-4 py-3">
      <BaseButton size="sm" variant="ghost" class="lg:hidden" @click="emit('back')">Back</BaseButton>
      <div class="min-w-0 flex-1">
        <h2 class="truncate text-sm font-semibold text-ink"># {{ channel.name }}</h2>
        <p class="truncate text-xs text-ink-muted">{{ teamName }}<template v-if="channel.visibility === 'private'"> · private channel</template></p>
      </div>
      <!-- General is the team: leaving it is leaving the team, from the rail (0519). -->
      <BaseButton v-if="!channel.general" size="sm" variant="ghost" @click="emit('leave')">Leave channel</BaseButton>
    </header>

    <div ref="scroller" class="flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
      <p v-if="page.before_seq" class="text-center text-xs text-ink-muted">Earlier posts are not shown yet.</p>
      <p v-if="lines.length === 0" class="py-8 text-center text-sm text-ink-muted">No posts yet. Start the conversation.</p>

      <template v-for="l in lines" :key="l.kind === 'server' ? l.message.id : l.line.message_id">
        <ChatMessageBubble
          v-if="l.kind === 'server'"
          :message="l.message"
          :viewer-id="viewerId"
          :show-sender="true"
          @edit="(id: string, body: string) => emit('edit', id, body)"
          @remove="(id: string) => emit('remove', id)"
        >
          <!-- A removed post with no replies has nothing to open: 0518 refuses a reply to it (CH011). -->
          <template v-if="l.message.reply_count > 0 || !l.message.deleted_at" #footer>
            <div class="mt-1 flex justify-end">
              <BaseButton
                size="sm"
                variant="ghost"
                :aria-pressed="openPostId === l.message.id"
                @click="emit('replies', l.message.id)"
              >
                <template v-if="l.message.reply_count > 0">
                  {{ l.message.reply_count }} {{ l.message.reply_count === 1 ? "reply" : "replies" }}<template v-if="l.message.last_reply_at"> · {{ chatRowTime(l.message.last_reply_at) }}</template>
                </template>
                <template v-else>Reply</template>
              </BaseButton>
            </div>
          </template>
        </ChatMessageBubble>
        <ChatPendingBubble v-else :line="l.line" @retry="(line: PendingLine) => emit('retry', line)" />
      </template>
    </div>

    <ChatComposer :placeholder="`Post in # ${channel.name} — Enter to send, Shift+Enter for a new line`" label="New post" action="Post" @send="(body: string) => emit('send', body)" />
  </section>
</template>
