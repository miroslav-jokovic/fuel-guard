<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { isRecordId } from "@silvicom/shared";
import { AppButton as BaseButton, QueryState, useConfirm } from "@silvicom/ui";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useChatFollow } from "../chatRealtime";
import { firstUnreadSeqOf } from "../chatGrouping";
import { useChatMarkRead, useChatMembersQuery, useChatMessageActions, useChatSend, type PendingLine } from "../useChat";
import { provideChatMentions, type MentionCandidate } from "../chatNames";
import ChatChannelPane from "./ChatChannelPane.vue";
import ChatRepliesPane from "./ChatRepliesPane.vue";
import ChatEarlierButton from "../ChatEarlierButton.vue";
import {
  useAddChannelMembers,
  useChannelPostsQuery,
  useChatTeamsQuery,
  useEarlierPosts,
  useEarlierReplies,
  useJoinChannel,
  useLeaveChannel,
  useRepliesQuery,
  useTeamMembersQuery,
} from "./useChatTeams";

/**
 * The stage when a channel is open (OFFICE-CHAT-PLAN CH5c; CHAT-REDESIGN-PLAN §4): the channel, and —
 * beside it at `xl`, in its place below — one post's thread. The rail that used to be this view's left
 * column is the page's one rail now (D-CHATUI2); what stays here is everything about the open channel.
 *
 * The open channel and post live in the URL (`?ch=<id>&post=<id>`), as `?c=` does for a conversation:
 * a link is a link, a reload keeps it, Back goes back. An id that is not a uuid is ignored rather than
 * sent. Opening a channel reads it to its last post (the conversation's rule: reading never moves
 * backwards, 0512); the "New" line remembers where that read started (D-CHATUI6).
 */
const props = defineProps<{ entitled: boolean; viewerName: string }>();
const emit = defineEmits<{ back: [] }>();
const session = useSessionStore();
const toast = useToastStore();
const confirmAsk = useConfirm();
const route = useRoute();
const router = useRouter();
const viewer = computed(() => session.userId ?? "");

const teamsQuery = useChatTeamsQuery(computed(() => props.entitled));
const teams = computed(() => teamsQuery.data.value?.teams ?? []);

const param = (name: string) => computed<string | null>(() => {
  const v = route.query[name];
  return typeof v === "string" && isRecordId(v) ? v : null;
});
const channelId = param("ch");
const postId = param("post");
// `query: { ch, … }` and never a copy of the old query: vue-router would keep `c` and `view` (D-CHATUI2).
const go = (query: Record<string, string>) => void router.push({ query });
const openReplies = (id: string) => channelId.value && go({ ch: channelId.value, post: id });
const closeReplies = () => channelId.value && go({ ch: channelId.value });

const found = computed(() => {
  for (const t of teams.value) {
    const c = t.channels.find((x) => x.thread_id === channelId.value);
    if (c) return { team: t, channel: c };
  }
  return null;
});
const joinedId = computed(() => (found.value?.channel.joined ? channelId.value : null));
const posts = useChannelPostsQuery(joinedId);
const replies = useRepliesQuery(channelId, postId);
const earlierPosts = useEarlierPosts(joinedId);
const earlierReplies = useEarlierReplies(channelId, postId);
const openPost = computed(() => posts.data.value?.posts.find((p) => p.id === postId.value) ?? null);
useChatFollow(joinedId);

/** Where unread started when each channel opened, kept while it stays open; reading moves on at once. */
const unreadMarks = ref(new Map<string, number | null>());
const firstUnreadSeq = computed(() => (channelId.value ? (unreadMarks.value.get(channelId.value) ?? null) : null));
const markRead = useChatMarkRead();
watch(
  () => found.value?.channel,
  (c) => {
    if (!c?.joined) return;
    if (!unreadMarks.value.has(c.thread_id)) unreadMarks.value.set(c.thread_id, firstUnreadSeqOf(c));
    if (c.unread > 0) markRead.mutate({ threadId: c.thread_id, seq: c.last_seq });
  },
  { immediate: true },
);
watch(channelId, (id, old) => { if (old && old !== id) unreadMarks.value.delete(old); });

const pending = ref<PendingLine[]>([]);
const sender = useChatSend(pending);
const post = (body: string) => channelId.value && sender.mutate({ threadId: channelId.value, body });
const reply = (body: string) => channelId.value && postId.value && sender.mutate({ threadId: channelId.value, body, parentId: postId.value });
const retry = (l: PendingLine) => sender.mutate({ threadId: l.thread_id, body: l.body, messageId: l.message_id, parentId: l.parent_id });

const { edit, retract } = useChatMessageActions(channelId);
const fail = (fallback: string) => (e: unknown) => toast.error(e instanceof Error ? e.message : fallback);
const onEdit = (id: string, body: string) => edit.mutateAsync({ messageId: id, body }).catch(fail("Could not save the edit."));
const onRemove = (id: string) => retract.mutateAsync(id).catch(fail("Could not remove the message."));

// The `@` list (Q-CHAT20 (a)): the channel's people, then the team's others as "Add to # Loads" — a
// token must name a participant (CH013), and any channel member may add a team member, so picking one
// adds them first. Whether this channel takes them is still the database's answer; a refusal is a toast.
const members = useChatMembersQuery(joinedId);
const teamMembers = useTeamMembersQuery(computed(() => (joinedId.value ? (found.value?.team.space_id ?? null) : null)));
const addMembers = useAddChannelMembers();
provideChatMentions({
  candidates: computed<MentionCandidate[]>(() => {
    const inIt = new Set((members.data.value ?? []).map((m) => m.user_id));
    return [
      ...(members.data.value ?? []).map((m) => ({ user_id: m.user_id, name: m.name ?? "Someone", member: true })),
      ...(teamMembers.data.value ?? []).filter((m) => !inIt.has(m.user_id)).map((m) => ({ user_id: m.user_id, name: m.name ?? "Someone", member: false })),
    ].filter((c) => c.user_id !== viewer.value);
  }),
  addLabel: computed(() => (found.value ? `Add to # ${found.value.channel.name}` : null)),
  add: async (userId) => {
    if (!channelId.value) return false;
    return addMembers.mutateAsync({ threadId: channelId.value, userIds: [userId] }).then(
      () => true,
      (e: unknown) => { fail("Could not add them to the channel.")(e); return false; },
    );
  },
});

const join = useJoinChannel();
const onJoin = (id: string) => join.mutateAsync(id).catch(fail("Could not join the channel."));

const leaveChannel = useLeaveChannel();
async function onLeaveChannel() {
  const f = found.value;
  if (!f) return;
  const ok = await confirmAsk({
    title: `Leave # ${f.channel.name}?`,
    message: f.channel.visibility === "public" ? "You can join it again from the team." : "Somebody in it will have to add you back.",
    confirmLabel: "Leave",
  });
  if (!ok) return;
  await leaveChannel.mutateAsync(f.channel.thread_id).then(() => emit("back"), fail("Could not leave the channel."));
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-1">
    <div class="min-h-0 min-w-0 flex-1 flex-col bg-surface" :class="postId ? 'hidden xl:flex' : 'flex'">
      <ChatChannelPane
        v-if="found?.channel.joined && posts.data.value"
        :channel="found.channel"
        :team-name="found.team.name"
        :team-description="found.team.description"
        :page="posts.data.value"
        :viewer-id="viewer"
        :viewer-name="viewerName"
        :pending="pending"
        :open-post-id="postId"
        :first-unread-seq="firstUnreadSeq"
        :earlier-loading="earlierPosts.isPending.value"
        :earlier-failed="earlierPosts.isError.value"
        @earlier="earlierPosts.mutate()"
        @send="post"
        @retry="retry"
        @edit="onEdit"
        @remove="onRemove"
        @replies="openReplies"
        @leave="onLeaveChannel"
        @back="emit('back')"
      />
      <div v-else class="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-sm text-ink-muted">
        <template v-if="found && !found.channel.joined">
          <p># {{ found.channel.name }} is a public channel of {{ found.team.name }}.</p>
          <BaseButton variant="primary" :disabled="join.isPending.value" @click="onJoin(found.channel.thread_id)">Join the channel</BaseButton>
        </template>
        <QueryState
          v-else-if="channelId && found"
          compact
          :loading="posts.isPending.value && !posts.isError.value"
          :error="posts.isError.value ? posts.error.value : null"
          :retrying="posts.isFetching.value"
          loading-text="Opening the channel…"
          error-text="Could not open that channel."
          @retry="posts.refetch()"
        />
        <QueryState
          v-else-if="channelId"
          compact
          :loading="teamsQuery.isPending.value && !teamsQuery.isError.value"
          :error="teamsQuery.isError.value ? teamsQuery.error.value : null"
          :retrying="teamsQuery.isFetching.value"
          loading-text="Opening the channel…"
          error-text="Could not load your teams."
          @retry="teamsQuery.refetch()"
        >
          That channel is not one you can see.
        </QueryState>
      </div>
    </div>

    <div v-if="postId && channelId" class="flex min-h-0 w-full flex-col xl:w-96 xl:shrink-0 xl:border-l xl:border-edge-subtle">
      <ChatRepliesPane
        v-if="openPost && found"
        :post="openPost"
        :thread-id="channelId"
        :channel-name="found.channel.name"
        :page="replies.data.value"
        :loading="replies.isPending.value"
        :error="replies.isError.value ? replies.error.value : null"
        :viewer-id="viewer"
        :viewer-name="viewerName"
        :pending="pending"
        :earlier-loading="earlierReplies.isPending.value"
        :earlier-failed="earlierReplies.isError.value"
        @earlier="earlierReplies.mutate()"
        @send="reply"
        @retry="retry"
        @edit="onEdit"
        @remove="onRemove"
        @close="closeReplies"
        @refetch="replies.refetch()"
      />
      <div v-else class="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-ink-muted">
        <p>That post is not on this page of the channel.</p>
        <!-- A link to an older post (CH6a): the channel pages back until the post is on it. -->
        <ChatEarlierButton v-if="posts.data.value?.before_seq" noun="posts" :loading="earlierPosts.isPending.value" :failed="earlierPosts.isError.value" @load="earlierPosts.mutate()" />
        <BaseButton size="sm" variant="ghost" @click="closeReplies">Back to the channel</BaseButton>
      </div>
    </div>
  </div>
</template>
