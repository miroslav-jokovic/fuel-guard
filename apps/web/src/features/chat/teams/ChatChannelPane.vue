<script setup lang="ts">
import { computed } from "vue";
import type { ChatPostPage, ChatTeamChannel } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import KebabMenu from "@/components/KebabMenu.vue";
import ChatComposer from "../ChatComposer.vue";
import ChatMessageList from "../ChatMessageList.vue";
import ChatStageHeader from "../ChatStageHeader.vue";
import { mergeLines, type PendingLine } from "../useChat";

/**
 * One open channel (OFFICE-CHAT-PLAN CH5c, D-CHAT19): its top-level posts, oldest at the top, each
 * with how many replies it has and when the last came; and the box for a new post. A post's replies
 * open beside it (`ChatRepliesPane`, CHAT-REDESIGN-PLAN D-CHATUI9) — the channel shows the
 * conversation's shape, the thread panel one post's.
 *
 * Posting, editing and removing are the conversation's own acts: a channel IS a conversation
 * (D-CHAT18), so the same optimistic send and the same row serve it. Leaving is the header's kebab;
 * General is the team, and leaving it is leaving the team, from the rail (0519).
 */
const props = defineProps<{
  channel: ChatTeamChannel;
  teamName: string;
  page: ChatPostPage;
  viewerId: string;
  viewerName: string;
  pending: PendingLine[];
  earlierLoading?: boolean;
  earlierFailed?: boolean;
  openPostId: string | null;
  firstUnreadSeq?: number | null;
}>();
const emit = defineEmits<{
  send: [body: string];
  retry: [line: PendingLine];
  edit: [messageId: string, body: string];
  remove: [messageId: string];
  replies: [postId: string];
  leave: [];
  back: [];
  earlier: [];
}>();

const lines = computed(() => mergeLines(props.page.posts, props.pending, props.channel.thread_id));
const subtitle = computed(() => `${props.teamName}${props.channel.visibility === "private" ? " · private channel" : ""}`);
</script>

<template>
  <section class="flex h-full min-h-0 flex-1 flex-col bg-surface" :aria-label="`${channel.name}, ${teamName}`">
    <ChatStageHeader :title="channel.name" :subtitle="subtitle" glyph="channel" back-label="Back to chats and channels" @back="emit('back')">
      <KebabMenu v-if="!channel.general" trigger-label="Channel actions" placement="bottom-end">
        <BaseButton class="kebab-item" @click="emit('leave')">Leave channel</BaseButton>
      </KebabMenu>
    </ChatStageHeader>
    <ChatMessageList
      :lines="lines"
      :viewer-id="viewerId"
      :viewer-name="viewerName"
      :label="`# ${channel.name}`"
      :view-key="channel.thread_id"
      :first-unread-seq="firstUnreadSeq ?? null"
      :before-seq="page.before_seq"
      :earlier-loading="earlierLoading ?? false"
      :earlier-failed="earlierFailed ?? false"
      noun="posts"
      empty-text="No posts yet. Start the channel off."
      can-reply
      :open-post-id="openPostId"
      @edit="(id: string, body: string) => emit('edit', id, body)"
      @remove="(id: string) => emit('remove', id)"
      @reply="(id: string) => emit('replies', id)"
      @retry="(line: PendingLine) => emit('retry', line)"
      @earlier="emit('earlier')"
    />
    <ChatComposer :placeholder="`Message # ${channel.name}`" label="Post" action="Post" :thread-key="channel.thread_id" @send="(body: string) => emit('send', body)" />
  </section>
</template>
