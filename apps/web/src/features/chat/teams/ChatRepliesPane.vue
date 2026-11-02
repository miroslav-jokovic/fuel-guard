<script setup lang="ts">
import { useChatFocusWalk } from "../chatFocusWalk";
import { computed, ref } from "vue";
import type { ChatFileRef, ChatPost, ChatPostPage } from "@silvicom/shared";
import { AppIconButton, QueryState } from "@silvicom/ui";
import { XMarkIcon } from "@silvicom/ui/icons";
import ChatComposer from "../ChatComposer.vue";
import ChatMessageList from "../ChatMessageList.vue";
import ChatMessageRow from "../ChatMessageRow.vue";
import ChatStageHeader from "../ChatStageHeader.vue";
import { mergeLines, type PendingLine } from "../useChat";

/**
 * One post's thread (OFFICE-CHAT-PLAN CH5c, D-CHAT19; CHAT-REDESIGN-PLAN D-CHATUI9): a panel beside the
 * channel at `xl`, in its place below that. The post stays at the top while its replies scroll under
 * it, oldest first, and the box for a reply is at the bottom. One level deep, as Teams: a reply is
 * answered by replying to the post. A removed post takes no new reply (0518, CH011), so its box is not
 * offered. Esc closes the panel, as Close does.
 */
const props = defineProps<{
  post: ChatPost;
  threadId: string;
  channelName: string;
  page: ChatPostPage | undefined;
  loading: boolean;
  error: Error | null;
  viewerId: string;
  viewerName: string;
  pending: PendingLine[];
  earlierLoading?: boolean;
  earlierFailed?: boolean;
  /** CH8: the line a search result opened (`?line=`), brought into view; the pages above loaded to reach it. */
  focusId?: string | null;
}>();
const emit = defineEmits<{
  send: [body: string, files: ChatFileRef[]];
  retry: [line: PendingLine];
  edit: [messageId: string, body: string];
  remove: [messageId: string];
  close: [];
  refetch: [];
  earlier: [];
}>();
const walk = useChatFocusWalk(
  computed(() => props.focusId),
  { beforeSeq: computed(() => props.page?.before_seq ?? null), loading: computed(() => props.earlierLoading ?? false), failed: computed(() => props.earlierFailed ?? false) },
  () => emit("earlier"),
);

const lines = computed(() => mergeLines(props.page?.posts ?? [], props.pending, props.threadId, props.post.id));
const log = ref<InstanceType<typeof ChatMessageList> | null>(null);
const composer = ref<InstanceType<typeof ChatComposer> | null>(null);
</script>

<template>
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
  <section class="flex h-full min-h-0 flex-col bg-surface" aria-label="Thread" @keydown.esc="emit('close')">
    <ChatStageHeader title="Thread" :subtitle="`# ${channelName}`" glyph="channel" back-label="Back to the channel" back-until="xl" @back="emit('close')">
      <AppIconButton :icon="XMarkIcon" label="Close thread" class="hidden xl:inline-flex" @click="emit('close')" />
    </ChatStageHeader>

    <div class="max-h-56 shrink-0 overflow-y-auto border-b border-edge-subtle px-2 pt-1 pb-3 sm:px-4">
      <ChatMessageRow :message="post" :viewer-id="viewerId" first @edit="(id: string, body: string) => emit('edit', id, body)" @remove="(id: string) => emit('remove', id)" />
    </div>

    <div v-if="!page" class="flex flex-1 items-center justify-center px-4 text-center text-sm text-ink-muted">
      <QueryState compact :loading="loading && !error" :error="error" :retrying="loading" loading-text="Loading the replies…" error-text="Could not load the replies." @retry="emit('refetch')" />
    </div>
    <ChatMessageList
      v-else
      ref="log"
      :lines="lines"
      :viewer-id="viewerId"
      :viewer-name="viewerName"
      label="Replies"
      :view-key="post.id"
      :first-unread-seq="null"
      :before-seq="page.before_seq"
      :earlier-loading="earlierLoading ?? false"
      :earlier-failed="earlierFailed ?? false"
      noun="replies"
      empty-text="No replies yet."
      :focus-id="focusId ?? null"
      @focus-missing="walk.onMissing"
      @edit="(id: string, body: string) => emit('edit', id, body)"
      @remove="(id: string) => emit('remove', id)"
      @retry="(line: PendingLine) => emit('retry', line)"
      @earlier="emit('earlier')"
      @exit-bottom="composer?.focus()"
    />

    <p v-if="walk.lost.value" role="status"class="shrink-0 border-t border-edge-subtle px-4 py-1.5 text-center text-xs text-ink-muted">
      That message is not in this thread any more, or it is further back than the pages loaded. Scroll up and press Show earlier to keep looking.
    </p>
    <ChatComposer v-if="!post.deleted_at" ref="composer" placeholder="Reply" label="Reply" action="Reply" :thread-key="post.id" :upload-to="threadId" @send="(body: string, files: ChatFileRef[]) => emit('send', body, files)" @up="log?.focusLast()" />
    <p v-else class="shrink-0 border-t border-edge-subtle px-4 py-3 text-sm text-ink-muted">This post was removed, so it takes no new replies.</p>
  </section>
</template>
