<script setup lang="ts">
import { computed, ref } from "vue";
import type { ChatFileRef, ChatMuteLevel, ChatPostPage, ChatTeamChannel } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import KebabMenu from "@/components/KebabMenu.vue";
import ChatComposer from "../ChatComposer.vue";
import ChatMessageList from "../ChatMessageList.vue";
import ChatStageHeader from "../ChatStageHeader.vue";
import ChatMuteItems from "../ChatMuteItems.vue";
import ChatPinnedDialog from "../ChatPinnedDialog.vue";
import { mergeLines, type PendingLine } from "../useChat";

/**
 * One open channel (OFFICE-CHAT-PLAN CH5c, D-CHAT19): its top-level posts, oldest at the top, each
 * with how many replies it has and when the last came; and the box for a new post. A post's replies
 * open beside it (`ChatRepliesPane`, CHAT-REDESIGN-PLAN D-CHATUI9) — the channel shows the
 * conversation's shape, the thread panel one post's.
 *
 * Posting, editing and removing are the conversation's own acts: a channel IS a conversation
 * (D-CHAT18), so the same optimistic send and the same row serve it. The header's kebab holds the
 * channel's mute (D-CHAT23) and Leave — not on General, which is the team: leaving it is leaving the
 * team, from the rail (0519).
 *
 * An empty General greets the team by name with what its maker wrote about it — the team's
 * description — instead of "No posts yet" (CHAT-REDESIGN-PLAN CR4): General is where a new team first
 * meets, and the line that explains the team belongs there until somebody writes the first post.
 */
const props = defineProps<{
  channel: ChatTeamChannel;
  teamName: string;
  /** What the team's maker wrote about it: the welcome line of an empty General. */
  teamDescription?: string | null;
  page: ChatPostPage;
  viewerId: string;
  viewerName: string;
  pending: PendingLine[];
  earlierLoading?: boolean;
  earlierFailed?: boolean;
  openPostId: string | null;
  firstUnreadSeq?: number | null;
  /** The channel's members, as faces in the header (D-CHATUI24); absent while they load. */
  members?: ReadonlyArray<{ user_id: string; name: string | null }>;
}>();
const emit = defineEmits<{
  send: [body: string, files: ChatFileRef[]];
  retry: [line: PendingLine];
  edit: [messageId: string, body: string];
  remove: [messageId: string];
  replies: [postId: string];
  leave: [];
  mute: [level: ChatMuteLevel];
  back: [];
  earlier: [];
}>();

const lines = computed(() => mergeLines(props.page.posts, props.pending, props.channel.thread_id));
const subtitle = computed(() => `${props.teamName}${props.channel.visibility === "private" ? " · private channel" : ""}`);
const log = ref<InstanceType<typeof ChatMessageList> | null>(null);
const composer = ref<InstanceType<typeof ChatComposer> | null>(null);

/**
 * The header menu's Pinned messages list (CH6c-2). Mounted the first time it opens, then kept: before
 * that no stage asks for its pins, and kept mounted, its closing transition still runs, which is when
 * "Show" puts focus on the line (BaseModal `closed`).
 */
const pinsOpen = ref(false);
const pinsMounted = ref(false);
const openPins = () => { pinsMounted.value = true; pinsOpen.value = true; };
</script>

<template>
  <section class="flex h-full min-h-0 flex-1 flex-col bg-surface" :aria-label="`${channel.name}, ${teamName}`">
    <ChatStageHeader
      :title="channel.name"
      :subtitle="subtitle"
      glyph="channel"
      :people="members?.map((m) => ({ id: m.user_id, label: m.name }))" back-label="Back to chats and channels" @back="emit('back')">
      <KebabMenu trigger-label="Channel actions" placement="bottom-end">
        <BaseButton class="kebab-item" @click="openPins">Pinned messages</BaseButton>
        <ChatMuteItems :muted="channel.muted" @set="(level: ChatMuteLevel) => emit('mute', level)" />
        <BaseButton v-if="!channel.general" class="kebab-item" @click="emit('leave')">Leave channel</BaseButton>
      </KebabMenu>
    </ChatStageHeader>
    <ChatMessageList
      ref="log"
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
      @exit-bottom="composer?.focus()"
    >
      <template v-if="channel.general" #empty>
        <div class="py-10 text-center">
          <h3 class="text-lg font-semibold text-ink">Welcome to {{ teamName }}</h3>
          <p v-if="teamDescription" class="mx-auto mt-1 max-w-md text-sm text-ink-secondary">{{ teamDescription }}</p>
          <p class="mt-1 text-sm text-ink-muted">Everybody in the team is in # General. Say hello.</p>
        </div>
      </template>
    </ChatMessageList>
    <ChatComposer ref="composer" :placeholder="`Message # ${channel.name}`" label="Post" action="Post" :thread-key="channel.thread_id" :upload-to="channel.thread_id" @send="(body: string, files: ChatFileRef[]) => emit('send', body, files)" @up="log?.focusLast()" />
    <ChatPinnedDialog v-if="pinsMounted" :open="pinsOpen" :thread-id="channel.thread_id" :viewer-id="viewerId" @thread="(id: string) => emit('replies', id)" @close="pinsOpen = false" />
  </section>
</template>
