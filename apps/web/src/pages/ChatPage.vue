<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { chatTitle, isRecordId, type ChatFileRef, type ChatMuteLevel, type ChatTeam } from "@silvicom/shared";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useModulesQuery } from "@/composables/useModules";
import { AppCard as BaseCard, QueryState } from "@silvicom/ui";
import ChatRail from "@/features/chat/ChatRail.vue";
import ChatConversationStage from "@/features/chat/ChatConversationStage.vue";
import ChatActivityStage from "@/features/chat/ChatActivityStage.vue";
import ChatSavedStage from "@/features/chat/ChatSavedStage.vue";
import { provideChatLineActs, useChatSavedQuery } from "@/features/chat/useChatLineActs";
import { useChatActivityMarkRead, useChatActivityQuery, useChatActivityUnreadQuery } from "@/features/chat/useChatActivity";
import ChatEmptyStage from "@/features/chat/ChatEmptyStage.vue";
import NewChatDialog from "@/features/chat/NewChatDialog.vue";
import ChatChannelStage from "@/features/chat/teams/ChatChannelStage.vue";
import NewChannelDialog from "@/features/chat/teams/NewChannelDialog.vue";
import NewTeamDialog from "@/features/chat/teams/NewTeamDialog.vue";
import AddTeamPeopleDialog from "@/features/chat/teams/AddTeamPeopleDialog.vue";
import { firstUnreadSeqOf } from "@/features/chat/chatGrouping";
import {
  useChatConversationQuery,
  useChatCreateGroup,
  useChatInboxQuery,
  useChatLoadEarlier,
  useChatMarkRead,
  useChatMessageActions,
  useChatOpenDirect,
  useChatPeopleQuery,
  useChatSend,
  useChatSetMute,
  type PendingLine,
} from "@/features/chat/useChat";
import { useChatFollow } from "@/features/chat/chatRealtime";
import { useChatTeamsQuery } from "@/features/chat/teams/useChatTeams";
import { useChatRailActions } from "@/features/chat/teams/useChatRailActions";
import { useChatShortcuts } from "@/features/chat/useChatShortcuts";
import { provideChatNames } from "@/features/chat/chatNames";

/**
 * /chat — office chat (OFFICE-CHAT-PLAN CH2; CHAT-REDESIGN-PLAN, 2026-10-26): a workspace, not a
 * document. The shell gives it the whole outlet (`meta.fullBleed`, D-CHATUI1) and it fills it with one
 * rail of everything you are in — conversations, each team's channels, the muted ones — beside the
 * stage: the open conversation, or the open channel with its thread. Drivers are not here; they talk
 * to dispatch on /messages (D54), and the API refuses a driver login.
 *
 * The open item lives in the URL — `?c=<id>` a conversation, `?ch=<id>` a channel, `&post=` its
 * thread — so a link is a link, a reload keeps it, and Back returns to the previous one. An id that is
 * not a uuid is ignored rather than sent. Opening a conversation reads it to its last line; reading is
 * never moved backwards (0512). `?view=teams` is no longer written (D-CHATUI2); an old link that
 * carries it still opens whatever `ch` names.
 *
 * A workspace with nothing in it yet — no conversation, no team — opens on a first-run stage with the
 * two ways to begin (CR4), instead of telling somebody to pick from an empty rail. The page's keys
 * (`useChatShortcuts`, D-CHATUI16) go to the rail: `/` to its search, J and K along its items.
 */
const session = useSessionStore();
const toast = useToastStore();
const route = useRoute();
const router = useRouter();

const modules = useModulesQuery();
const entitlementKnown = computed(() => modules.data.value !== undefined);
const entitled = computed(() => modules.data.value?.has("messages") ?? false);

// The rail's two lists. Chats asks for direct and group only: channels are listed by their team.
// The sidebar badge's own query (every kind) lives in `useNavCounts`.
const inbox = useChatInboxQuery(entitled, ["direct", "group"]);
const conversations = computed(() => inbox.data.value?.conversations ?? []);
const teamsQuery = useChatTeamsQuery(entitled);
const teams = computed(() => teamsQuery.data.value?.teams ?? []);
const canManage = computed(() => teamsQuery.data.value?.can_manage ?? false);
/** Both lists answered, and both are empty: nobody here has started anything (CR4). */
const firstRun = computed(() => inbox.data.value !== undefined && teamsQuery.data.value !== undefined && conversations.value.length === 0 && teams.value.length === 0);

const param = (name: string) => computed<string | null>(() => {
  const v = route.query[name];
  return typeof v === "string" && isRecordId(v) ? v : null;
});
const channelId = param("ch");
const selectedId = computed(() => (channelId.value ? null : param("c").value));
// Activity is a place on the stage like a conversation (CHAT-REDESIGN-PLAN §6), so it has an address.
const activityOpen = computed(() => !channelId.value && !selectedId.value && route.query.activity === "1");
// Saved (CH6c-2) is another such place, `?saved=1`.
const savedOpen = computed(() => !channelId.value && !selectedId.value && !activityOpen.value && route.query.saved === "1");
const open = computed(() => !!(selectedId.value || channelId.value || activityOpen.value || savedOpen.value));

// `query: { c }` and never a copy of the old query: vue-router would keep `ch`, `post` and `view`.
function openConversation(id: string) {
  if (id !== selectedId.value) void router.push({ query: { c: id } });
}
function openChannel(id: string) {
  if (id !== channelId.value) void router.push({ query: { ch: id } });
}
function openActivity() {
  if (!activityOpen.value) void router.push({ query: { activity: "1" } });
}
function openSaved() {
  if (!savedOpen.value) void router.push({ query: { saved: "1" } });
}
/** Back to the rail on a phone; nothing open on a desk. */
function closeAll() {
  void router.push({ query: {} });
}

const conversation = useChatConversationQuery(selectedId);
// The open conversation's own signals (CH3b); the shell already holds the inbox's.
useChatFollow(selectedId);
const earlier = useChatLoadEarlier(selectedId);

/** Where unread started when the conversation opened (D-CHATUI6), kept while it stays open. */
const unreadMarks = ref(new Map<string, number | null>());
const firstUnreadSeq = computed(() => (selectedId.value ? (unreadMarks.value.get(selectedId.value) ?? null) : null));
const markRead = useChatMarkRead();
// `immediate`: a conversation opened from the cache already has its data, so a watcher that waits for
// a change would never read it.
watch(
  () => conversation.data.value?.conversation,
  (c) => {
    if (!c) return;
    if (!unreadMarks.value.has(c.thread_id)) unreadMarks.value.set(c.thread_id, firstUnreadSeqOf(c));
    if (c.unread > 0) markRead.mutate({ threadId: c.thread_id, seq: c.last_seq });
  },
  { immediate: true },
);
watch(selectedId, (id, old) => { if (old && old !== id) unreadMarks.value.delete(old); });

const viewerName = computed(() => session.fullName ?? "You");
const pending = ref<PendingLine[]>([]);
const sender = useChatSend(pending);
function send(body: string, files: ChatFileRef[] = []) {
  if (!selectedId.value) return;
  sender.mutate({ threadId: selectedId.value, body, files });
}
function retry(line: PendingLine) {
  sender.mutate({ threadId: line.thread_id, body: line.body, files: line.files, messageId: line.message_id });
}

const { edit, retract } = useChatMessageActions(selectedId);
const fail = (fallback: string) => (e: unknown) => toast.error(e instanceof Error ? e.message : fallback);
const onEdit = (messageId: string, body: string) => edit.mutateAsync({ messageId, body }).catch(fail("Could not save the edit."));
const onRemove = (messageId: string) => retract.mutateAsync(messageId).catch(fail("Could not remove the message."));
// React, pin and save (CH6c-2): provided once here, injected by every line's row in every stage.
const lineActs = provideChatLineActs((message) => toast.error(message));
const saved = useChatSavedQuery(computed(() => entitled.value && savedOpen.value));

const starting = ref(false);
// The office's people: the New conversation dialog's list, and who every `<@id>` on the page is
// (D-CHAT22) — so it is asked as soon as the page is, not when the dialog opens.
const people = useChatPeopleQuery(entitled);
provideChatNames(people.data);
const openDirect = useChatOpenDirect();
const createGroup = useChatCreateGroup();
const startBusy = computed(() => openDirect.isPending.value || createGroup.isPending.value);
async function start(memberIds: string[], subject: string | null) {
  try {
    const id = memberIds.length === 1
      ? await openDirect.mutateAsync(memberIds[0]!)
      : await createGroup.mutateAsync({ subject, memberIds });
    starting.value = false;
    openConversation(id);
  } catch (e) {
    fail("Could not start the conversation.")(e);
  }
}

// Activity (D-CHAT25): the rail's count always; the list only while it is on the stage. Showing it reads
// it up to the newest item shown, so an item that lands meanwhile still counts.
const activityUnread = useChatActivityUnreadQuery(entitled);
const activity = useChatActivityQuery(computed(() => entitled.value && activityOpen.value));
const activityRead = useChatActivityMarkRead();
watch(
  () => (activityOpen.value ? activity.items.value[0] : undefined),
  (newest) => { if (newest?.unread) activityRead.mutate(newest.at); },
  { immediate: true },
);
// Reading on sight would wipe the bold before anybody saw it, so an item that was unread when the list
// was shown keeps looking unread while Activity stays open — the "New" line's rule (D-CHATUI6).
const seenUnread = ref(new Set<string>());
watch(
  () => (activityOpen.value ? activity.items.value : null),
  (items) => {
    if (!items) { seenUnread.value = new Set(); return; }
    const fresh = items.filter((i) => i.unread && !seenUnread.value.has(i.message_id));
    if (fresh.length) seenUnread.value = new Set([...seenUnread.value, ...fresh.map((i) => i.message_id)]);
  },
  { immediate: true },
);
const activityItems = computed(() =>
  activity.items.value.map((i) => (!i.unread && seenUnread.value.has(i.message_id) ? { ...i, unread: true } : i)));
/** A group with no name is called what the rail calls it. */
const titleOf = (threadId: string) => {
  const c = conversations.value.find((x) => x.thread_id === threadId);
  return c ? chatTitle(c) : null;
};

const setMute = useChatSetMute();
const onMute = (level: ChatMuteLevel) =>
  selectedId.value && setMute.mutateAsync({ threadId: selectedId.value, muted: level }).catch(fail("Could not change the mute."));

const rail = useChatRailActions(entitled, openChannel, closeAll);
const railRef = ref<InstanceType<typeof ChatRail> | null>(null);
useChatShortcuts((s) => {
  if (s === "search") railRef.value?.focusSearch();
  else railRef.value?.step(s === "next" ? 1 : -1);
});
</script>

<template>
  <div class="flex h-full min-h-0 bg-surface">
    <div v-if="!entitlementKnown" class="flex flex-1 items-center justify-center p-6">
      <QueryState
        :loading="modules.isPending.value && !modules.isError.value"
        :error="modules.isError.value ? modules.error.value : null"
        :retrying="modules.isFetching.value"
        loading-text="Loading chat…"
        error-text="Could not check whether chat is part of your plan."
        @retry="modules.refetch()"
      />
    </div>
    <div v-else-if="!entitled" class="p-6">
      <BaseCard><p class="text-sm text-ink-muted">Chat isn't part of your plan. Contact Silvicom 360 to enable it.</p></BaseCard>
    </div>

    <template v-else>
      <!-- A phone shows the rail OR the stage (D-DR25's pattern); the stage header's chevron is the way back. -->
      <ChatRail
        ref="railRef"
        class="w-full lg:w-72 lg:shrink-0"
        :class="open ? 'hidden lg:flex' : 'flex'"
        :conversations="conversations"
        :teams="teams"
        :can-manage="canManage"
        :selected-id="channelId ?? selectedId"
        :activity-open="activityOpen"
        :activity-unread="activityUnread.data.value ?? 0"
        :saved-open="savedOpen"
        :inbox-loading="inbox.isPending.value && !inbox.isError.value"
        :inbox-error="inbox.isError.value ? inbox.error.value : null"
        :inbox-retrying="inbox.isFetching.value"
        :teams-loading="teamsQuery.isPending.value && !teamsQuery.isError.value"
        :teams-error="teamsQuery.isError.value ? teamsQuery.error.value : null"
        :teams-retrying="teamsQuery.isFetching.value"
        @open-conversation="openConversation"
        @open-channel="openChannel"
        @open-activity="openActivity"
        @open-saved="openSaved"
        @join="rail.onJoin"
        @new-conversation="starting = true"
        @new-team="rail.creatingTeam.value = true"
        @new-channel="(t: ChatTeam) => (rail.channelFor.value = t)"
        @add-people="(t: ChatTeam) => (rail.peopleFor.value = t)"
        @leave-team="rail.onLeaveTeam"
        @retry-inbox="inbox.refetch()"
        @retry-teams="teamsQuery.refetch()"
      />

      <div class="min-h-0 min-w-0 flex-1" :class="open ? 'flex' : 'hidden lg:flex'">
        <ChatChannelStage v-if="channelId" :entitled="entitled" :viewer-name="viewerName" @back="closeAll" />
        <ChatActivityStage
          v-else-if="activityOpen"
          :items="activityItems"
          :viewer-id="session.userId ?? ''"
          :title-of="titleOf"
          :loading="activity.isPending.value && !activity.isError.value"
          :error="activity.isError.value ? activity.error.value : null"
          :retrying="activity.isFetching.value"
          :has-more="activity.hasNextPage.value"
          :loading-more="activity.isFetchingNextPage.value"
          @open="(query: Record<string, string>) => router.push({ query })"
          @more="activity.fetchNextPage()"
          @retry="activity.refetch()"
          @back="closeAll"
        />
        <ChatSavedStage
          v-else-if="savedOpen"
          :items="saved.items.value"
          :viewer-id="session.userId ?? ''"
          :title-of="titleOf"
          :loading="saved.isPending.value && !saved.isError.value"
          :error="saved.isError.value ? saved.error.value : null"
          :retrying="saved.isFetching.value"
          :has-more="saved.hasNextPage.value"
          :loading-more="saved.isFetchingNextPage.value"
          @open="(query: Record<string, string>) => router.push({ query })"
          @unsave="(id: string) => lineActs.save(id, false)"
          @more="saved.fetchNextPage()"
          @retry="saved.refetch()"
          @back="closeAll"
        />
        <ChatConversationStage
          v-else-if="selectedId && conversation.data.value"
          :data="conversation.data.value"
          :viewer-id="session.userId ?? ''"
          :pending="pending"
          :sending="sender.isPending.value"
          :first-unread-seq="firstUnreadSeq"
          :earlier-loading="earlier.isPending.value"
          :earlier-failed="earlier.isError.value"
          @earlier="earlier.mutate()"
          @send="send"
          @retry="retry"
          @edit="onEdit"
          @remove="onRemove"
          @mute="onMute"
          @back="closeAll"
        />
        <div v-else class="flex flex-1 items-center justify-center px-6 text-center text-sm text-ink-muted">
          <QueryState
            v-if="selectedId"
            compact
            :loading="conversation.isPending.value && !conversation.isError.value"
            :error="conversation.isError.value ? conversation.error.value : null"
            :retrying="conversation.isFetching.value"
            loading-text="Opening the conversation…"
            error-text="Could not open that conversation."
            @retry="conversation.refetch()"
          />
          <ChatEmptyStage v-else :first-run="firstRun" :can-manage="canManage" @new-conversation="starting = true" @new-team="rail.creatingTeam.value = true" />
        </div>
      </div>
    </template>

    <NewChatDialog :open="starting" :people="people.data.value ?? []" :viewer-id="session.userId ?? ''" :busy="startBusy" @close="starting = false" @start="start" />
    <NewChannelDialog
      :team="rail.channelFor.value"
      :members="rail.members.data.value ?? []"
      :viewer-id="session.userId ?? ''"
      :busy="rail.createChannelBusy.value"
      @close="rail.channelFor.value = null"
      @create="rail.onCreateChannel"
    />
    <AddTeamPeopleDialog
      :team="rail.peopleFor.value"
      :people="rail.people.data.value ?? []"
      :member-ids="(rail.members.data.value ?? []).map((m) => m.user_id)"
      :viewer-id="session.userId ?? ''"
      :busy="rail.addPeopleBusy.value"
      @close="rail.peopleFor.value = null"
      @add="rail.onAddPeople"
    />
    <NewTeamDialog
      :open="rail.creatingTeam.value"
      :people="rail.people.data.value ?? []"
      :viewer-id="session.userId ?? ''"
      :busy="rail.createTeamBusy.value"
      @close="rail.creatingTeam.value = false"
      @create="rail.onCreateTeam"
    />
  </div>
</template>
