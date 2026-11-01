<script setup lang="ts">
import { computed, ref } from "vue";
import { chatTitle, type ChatConversationResponse, type ChatMuteLevel } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import KebabMenu from "@/components/KebabMenu.vue";
import { mergeLines, type PendingLine } from "./useChat";
import ChatComposer from "./ChatComposer.vue";
import ChatMessageList from "./ChatMessageList.vue";
import ChatStageHeader from "./ChatStageHeader.vue";
import ChatMuteItems from "./ChatMuteItems.vue";
import ChatPinnedDialog from "./ChatPinnedDialog.vue";
import { provideChatMentions } from "./chatNames";

/**
 * One open conversation (CH2; CHAT-REDESIGN-PLAN §4): its header, its log and its composer, filling
 * the stage. The newest page comes first; "Show earlier" asks the page's container for the one above
 * (CH6a). The log's rows, runs and day lines are `ChatMessageList`'s (D-CHATUI4).
 *
 * A line you sent that the server has not confirmed reads "Sending…"; one it refused keeps its text
 * with Retry, so nothing typed is ever lost (D-CHAT2's optimistic send). "Seen" appears after your
 * newest line in a direct conversation once the other person's read boundary has passed it — the
 * receipt dispatch asked for in 0096, now from `read_seq`.
 */
const props = defineProps<{
  data: ChatConversationResponse;
  viewerId: string;
  pending: PendingLine[];
  sending: boolean;
  /** The page above is being fetched, or could not be. */
  earlierLoading?: boolean;
  earlierFailed?: boolean;
  /** Where the "New" line goes (D-CHATUI6); null for nothing unread when it opened. */
  firstUnreadSeq?: number | null;
}>();
defineEmits<{
  send: [body: string];
  retry: [line: PendingLine];
  edit: [messageId: string, body: string];
  remove: [messageId: string];
  back: [];
  earlier: [];
  mute: [level: ChatMuteLevel];
}>();

const lines = computed(() => mergeLines(props.data.messages, props.pending, props.data.conversation.thread_id));
// Up from the empty composer goes into the log; Down past its newest line comes back (D-CHATUI16).
const log = ref<InstanceType<typeof ChatMessageList> | null>(null);
const composer = ref<InstanceType<typeof ChatComposer> | null>(null);
const title = computed(() => chatTitle(props.data.conversation));
const direct = computed(() => props.data.conversation.kind === "direct");
const others = computed(() => props.data.members.filter((m) => m.user_id !== props.viewerId));
const subtitle = computed(() => (direct.value ? null : others.value.map((m) => m.name ?? "Someone").join(", ")));
const viewerName = computed(() => props.data.members.find((m) => m.user_id === props.viewerId)?.name ?? "You");

// The `@` list: the people in it (Q-CHAT20 (a)). Adding somebody to a group is the header's act, not
// the composer's, so nobody outside it is offered.
provideChatMentions({
  candidates: computed(() => others.value.map((m) => ({ user_id: m.user_id, name: m.name ?? "Someone", member: true }))),
  addLabel: computed(() => null),
  add: async () => false,
});

/** The other side's furthest read position, for "Seen" after your newest line in a direct conversation. */
const othersReadSeq = computed(() => Math.max(0, ...others.value.map((m) => m.read_seq)));
const myLastSeq = computed(() => {
  const mine = props.data.messages.filter((m) => m.sender_user_id === props.viewerId);
  return mine.length ? mine[mine.length - 1]!.seq : null;
});
const seenSeq = computed(() => (direct.value && myLastSeq.value !== null && othersReadSeq.value >= myLastSeq.value ? myLastSeq.value : null));

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
  <section class="flex h-full min-h-0 flex-1 flex-col bg-surface" :aria-label="title">
    <ChatStageHeader
      :title="title"
      :subtitle="subtitle"
      :glyph="direct ? 'person' : 'group'"
      :identity="direct ? others[0]?.user_id : null"
      :people="direct ? undefined : data.members.map((m) => ({ id: m.user_id, label: m.name }))" back-label="Back to conversations" @back="$emit('back')">
      <!-- Its mute (D-CHAT23): what reaches you from it, and whether it sits in Muted. -->
      <KebabMenu trigger-label="Conversation actions" placement="bottom-end">
        <BaseButton class="kebab-item" @click="openPins">Pinned messages</BaseButton>
        <ChatMuteItems :muted="data.conversation.muted" @set="(level: ChatMuteLevel) => $emit('mute', level)" />
      </KebabMenu>
    </ChatStageHeader>
    <ChatMessageList
      ref="log"
      :lines="lines"
      :viewer-id="viewerId"
      :viewer-name="viewerName"
      :label="title"
      :view-key="data.conversation.thread_id"
      :first-unread-seq="firstUnreadSeq ?? null"
      :before-seq="data.before_seq"
      :earlier-loading="earlierLoading ?? false"
      :earlier-failed="earlierFailed ?? false"
      noun="messages"
      empty-text="No messages yet. Say hello."
      :seen-seq="seenSeq"
      @edit="(id: string, body: string) => $emit('edit', id, body)"
      @remove="(id: string) => $emit('remove', id)"
      @retry="(line: PendingLine) => $emit('retry', line)"
      @earlier="$emit('earlier')"
      @exit-bottom="composer?.focus()"
    />
    <ChatComposer ref="composer" :placeholder="`Message ${title}`" :thread-key="data.conversation.thread_id" @send="(body: string) => $emit('send', body)" @up="log?.focusLast()" />
    <ChatPinnedDialog v-if="pinsMounted" :open="pinsOpen" :thread-id="data.conversation.thread_id" :viewer-id="viewerId" @close="pinsOpen = false" />
  </section>
</template>
