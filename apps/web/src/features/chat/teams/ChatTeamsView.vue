<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { isRecordId, type ChatTeam } from "@silvicom/shared";
import { AppButton as BaseButton, AppCard as BaseCard, QueryState, useConfirm } from "@silvicom/ui";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { genUuid } from "@/lib/uuid";
import { useChatFollow } from "../chatRealtime";
import { useChatMarkRead, useChatMessageActions, useChatPeopleQuery, useChatSend, type PendingLine } from "../useChat";
import ChatTeamsRail from "./ChatTeamsRail.vue";
import ChatChannelPane from "./ChatChannelPane.vue";
import ChatRepliesPane from "./ChatRepliesPane.vue";
import NewChannelDialog from "./NewChannelDialog.vue";
import NewTeamDialog from "./NewTeamDialog.vue";
import AddTeamPeopleDialog from "./AddTeamPeopleDialog.vue";
import {
  useAddTeamMembers,
  useChannelPostsQuery,
  useChatTeamsQuery,
  useCreateChannel,
  useJoinChannel,
  useLeaveChannel,
  useLeaveTeam,
  useRepliesQuery,
  useTeamMembersQuery,
} from "./useChatTeams";
import { useCreateTeam } from "./useChatTeamsAdmin";

/**
 * The Teams side of /chat (OFFICE-CHAT-PLAN CH5c): the rail of teams and channels, the open channel,
 * and — beside it on a wide screen, instead of it on a narrow one — one post's replies.
 *
 * The open channel and post live in the URL (`?view=teams&ch=<id>&post=<id>`), as `?c=` does for a
 * conversation: a link is a link, a reload keeps it, Back goes back. An id that is not a uuid is
 * ignored rather than sent. Opening a channel reads it to its last post (the conversation's rule:
 * reading never moves backwards, 0512); the Chat badge already counts channels (D-CHAT2).
 *
 * "New team" shows for a holder of `chat.teams` (D-CHAT17), from the API's own `can_manage`.
 */
const props = defineProps<{ entitled: boolean }>();
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
const go = (query: Record<string, string>) => void router.push({ query: { view: "teams", ...query } });
const openChannel = (id: string) => { if (id !== channelId.value) go({ ch: id }); };
const openReplies = (id: string) => channelId.value && go({ ch: channelId.value, post: id });
const closeReplies = () => channelId.value && go({ ch: channelId.value });
const backToRail = () => go({});

const found = computed(() => {
  for (const t of teams.value) {
    const c = t.channels.find((x) => x.thread_id === channelId.value);
    if (c) return { team: t, channel: c };
  }
  return null;
});
const posts = useChannelPostsQuery(computed(() => (found.value?.channel.joined ? channelId.value : null)));
const replies = useRepliesQuery(channelId, postId);
const openPost = computed(() => posts.data.value?.posts.find((p) => p.id === postId.value) ?? null);
useChatFollow(computed(() => (found.value?.channel.joined ? channelId.value : null)));

const markRead = useChatMarkRead();
watch(
  () => found.value?.channel,
  (c) => {
    if (c?.joined && c.unread > 0) markRead.mutate({ threadId: c.thread_id, seq: c.last_seq });
  },
  { immediate: true },
);

const pending = ref<PendingLine[]>([]);
const sender = useChatSend(pending);
const post = (body: string) => channelId.value && sender.mutate({ threadId: channelId.value, body });
const reply = (body: string) => channelId.value && postId.value && sender.mutate({ threadId: channelId.value, body, parentId: postId.value });
const retry = (l: PendingLine) => sender.mutate({ threadId: l.thread_id, body: l.body, messageId: l.message_id, parentId: l.parent_id });

const { edit, retract } = useChatMessageActions(channelId);
const fail = (fallback: string) => (e: unknown) => toast.error(e instanceof Error ? e.message : fallback);
const onEdit = (id: string, body: string) => edit.mutateAsync({ messageId: id, body }).catch(fail("Could not save the edit."));
const onRemove = (id: string) => retract.mutateAsync(id).catch(fail("Could not remove the message."));

const join = useJoinChannel();
async function onJoin(id: string) {
  try {
    await join.mutateAsync(id);
    openChannel(id);
  } catch (e) {
    fail("Could not join the channel.")(e);
  }
}

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
  await leaveChannel.mutateAsync(f.channel.thread_id).then(backToRail, fail("Could not leave the channel."));
}

const leaveTeam = useLeaveTeam();
async function onLeaveTeam(t: ChatTeam) {
  const ok = await confirmAsk({
    title: `Leave ${t.name}?`,
    message: "You leave every channel in it too. Somebody in the team will have to add you back.",
    confirmLabel: "Leave team",
    tone: "danger",
  });
  if (!ok) return;
  await leaveTeam.mutateAsync(t.space_id).then(backToRail, fail("Could not leave the team."));
}

// New channel and Add people both need the team's people; New team and Add people the office's.
const channelFor = ref<ChatTeam | null>(null);
const peopleFor = ref<ChatTeam | null>(null);
const creatingTeam = ref(false);
const membersOf = computed(() => channelFor.value?.space_id ?? peopleFor.value?.space_id ?? null);
const members = useTeamMembersQuery(membersOf);
const people = useChatPeopleQuery(computed(() => props.entitled && (creatingTeam.value || peopleFor.value !== null)));

const createChannel = useCreateChannel();
async function onCreateChannel(name: string, visibility: "public" | "private", memberIds: string[]) {
  const t = channelFor.value;
  if (!t) return;
  try {
    const id = await createChannel.mutateAsync({ spaceId: t.space_id, name, visibility, memberIds });
    channelFor.value = null;
    openChannel(id);
  } catch (e) {
    fail("Could not make the channel.")(e);
  }
}

const addPeople = useAddTeamMembers();
async function onAddPeople(userIds: string[]) {
  const t = peopleFor.value;
  if (!t) return;
  try {
    await addPeople.mutateAsync({ spaceId: t.space_id, userIds });
    toast.success(userIds.length === 1 ? "Added to the team." : `${userIds.length} people added to the team.`);
    peopleFor.value = null;
  } catch (e) {
    fail("Could not add those people.")(e);
  }
}

const createTeam = useCreateTeam();
async function onCreateTeam(name: string, description: string | null, memberIds: string[]) {
  const generalId = genUuid();
  try {
    await createTeam.mutateAsync({ space_id: genUuid(), general_id: generalId, name, description, member_ids: memberIds });
    creatingTeam.value = false;
    openChannel(generalId);
  } catch (e) {
    fail("Could not make the team.")(e);
  }
}
</script>

<template>
  <div
    class="grid h-[calc(100dvh_-_22rem_-_var(--assistant-clearance,0px))] min-h-96 gap-4 lg:h-[calc(100dvh_-_18rem_-_var(--assistant-clearance,0px))]"
    :class="postId ? 'lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)_22rem]' : 'lg:grid-cols-[18rem_minmax(0,1fr)]'"
  >
    <BaseCard padding="none" class="min-h-0 overflow-y-auto" :class="channelId ? 'hidden lg:block' : ''">
      <div v-if="teamsQuery.data.value?.can_manage" class="flex justify-end border-b border-edge-subtle px-3 py-2">
        <BaseButton size="sm" variant="primary" @click="creatingTeam = true">New team</BaseButton>
      </div>
      <ChatTeamsRail
        v-if="teams.length > 0"
        :teams="teams"
        :selected-id="channelId"
        @open="openChannel"
        @join="onJoin"
        @new-channel="(t: ChatTeam) => (channelFor = t)"
        @add-people="(t: ChatTeam) => (peopleFor = t)"
        @leave-team="onLeaveTeam"
      />
      <div v-else class="px-4 py-8 text-center text-sm text-ink-muted">
        <QueryState
          compact
          :loading="teamsQuery.isPending.value && !teamsQuery.isError.value"
          :error="teamsQuery.isError.value ? teamsQuery.error.value : null"
          :retrying="teamsQuery.isFetching.value"
          loading-text="Loading your teams…"
          error-text="Could not load your teams."
          @retry="teamsQuery.refetch()"
        >
          You are not in a team yet. {{ teamsQuery.data.value?.can_manage ? "Make one with “New team”." : "Somebody in a team can add you." }}
        </QueryState>
      </div>
    </BaseCard>

    <BaseCard padding="none" class="min-h-0" :class="[channelId ? '' : 'hidden lg:block', postId ? 'hidden xl:block' : '']">
      <ChatChannelPane
        v-if="found?.channel.joined && posts.data.value"
        :channel="found.channel"
        :team-name="found.team.name"
        :page="posts.data.value"
        :viewer-id="viewer"
        :pending="pending"
        :open-post-id="postId"
        @send="post"
        @retry="retry"
        @edit="onEdit"
        @remove="onRemove"
        @replies="openReplies"
        @leave="onLeaveChannel"
        @back="backToRail"
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
        <template v-else-if="channelId && !teamsQuery.isPending.value">That channel is not one you can see.</template>
        <template v-else>Pick a channel.</template>
      </div>
    </BaseCard>

    <BaseCard v-if="postId && channelId" padding="none" class="min-h-0">
      <ChatRepliesPane
        v-if="openPost"
        :post="openPost"
        :thread-id="channelId"
        :page="replies.data.value"
        :loading="replies.isPending.value"
        :error="replies.isError.value ? replies.error.value : null"
        :viewer-id="viewer"
        :pending="pending"
        @send="reply"
        @retry="retry"
        @edit="onEdit"
        @remove="onRemove"
        @close="closeReplies"
        @refetch="replies.refetch()"
      />
      <div v-else class="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-ink-muted">
        <p>That post is not on this page of the channel.</p>
        <BaseButton size="sm" variant="ghost" @click="closeReplies">Back to the channel</BaseButton>
      </div>
    </BaseCard>

    <NewChannelDialog
      :team="channelFor"
      :members="members.data.value ?? []"
      :viewer-id="viewer"
      :busy="createChannel.isPending.value"
      @close="channelFor = null"
      @create="onCreateChannel"
    />
    <AddTeamPeopleDialog
      :team="peopleFor"
      :people="people.data.value ?? []"
      :member-ids="(members.data.value ?? []).map((m) => m.user_id)"
      :viewer-id="viewer"
      :busy="addPeople.isPending.value"
      @close="peopleFor = null"
      @add="onAddPeople"
    />
    <NewTeamDialog
      :open="creatingTeam"
      :people="people.data.value ?? []"
      :viewer-id="viewer"
      :busy="createTeam.isPending.value"
      @close="creatingTeam = false"
      @create="onCreateTeam"
    />
  </div>
</template>
