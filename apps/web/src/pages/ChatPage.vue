<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { isRecordId } from "@silvicom/shared";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useModulesQuery } from "@/composables/useModules";
import { AppButton as BaseButton, AppCard as BaseCard, AppTabs, QueryState, type TabItem } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import ChatConversationList from "@/features/chat/ChatConversationList.vue";
import ChatConversationPane from "@/features/chat/ChatConversationPane.vue";
import NewChatDialog from "@/features/chat/NewChatDialog.vue";
import ChatTeamsView from "@/features/chat/teams/ChatTeamsView.vue";
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
  type PendingLine,
} from "@/features/chat/useChat";
import { useChatFollow } from "@/features/chat/chatRealtime";
import { chatLinkState } from "@/features/chat/transport";

/**
 * /chat — office chat (OFFICE-CHAT-PLAN CH2): the conversations between the people in the office, the
 * Teams layout of a list beside the open conversation. Drivers are not here; they talk to dispatch on
 * /messages (D54), and the API refuses a driver login.
 *
 * The open conversation lives in the URL (`?c=<id>`), so a link to a conversation is a link, a reload
 * keeps it, and Back returns to the previous one. An id that is not a uuid is ignored rather than sent.
 * Opening a conversation reads it to its last line; reading is never moved backwards (0512).
 */
const session = useSessionStore();
const toast = useToastStore();
const route = useRoute();
const router = useRouter();

const modules = useModulesQuery();
const entitlementKnown = computed(() => modules.data.value !== undefined);
const entitled = computed(() => modules.data.value?.has("messages") ?? false);

/**
 * Chats or Teams (CH5c), in the URL as `?view=teams` so a link to a channel opens on Teams. Channels
 * are listed by their team there, so the Chats list asks for direct and group conversations only; the
 * sidebar badge still counts both (D-CHAT2).
 */
const VIEWS: TabItem[] = [
  { value: "chats", label: "Chats" },
  { value: "teams", label: "Teams" },
];
const view = computed({
  get: () => (route.query.view === "teams" ? "teams" : "chats"),
  // `query: {}` and not a copy without `c`/`ch`: vue-router would keep the old keys.
  set: (v: string) => void router.push({ query: v === "teams" ? { view: "teams" } : {} }),
});

const inbox = useChatInboxQuery(computed(() => entitled.value && view.value === "chats"), ["direct", "group"]);
const conversations = computed(() => inbox.data.value?.conversations ?? []);

const selectedId = computed<string | null>(() => {
  const c = route.query.c;
  return view.value === "chats" && typeof c === "string" && isRecordId(c) ? c : null;
});
const conversation = useChatConversationQuery(selectedId);
// The open conversation's own signals (CH3b); the shell already holds the inbox's.
useChatFollow(selectedId);
const earlier = useChatLoadEarlier(selectedId);
function open(id: string) {
  if (id !== selectedId.value) void router.push({ query: { ...route.query, c: id } });
}
/** Back to the list on a phone. `query: {}` rather than deleting `c` from a copy (vue-router keeps it). */
function close() {
  void router.push({ query: {} });
}

const markRead = useChatMarkRead();
// `immediate`: a conversation opened from the cache already has its data, so a watcher that waits for
// a change would never read it.
watch(
  () => conversation.data.value?.conversation,
  (c) => {
    if (c && c.unread > 0) markRead.mutate({ threadId: c.thread_id, seq: c.last_seq });
  },
  { immediate: true },
);

const pending = ref<PendingLine[]>([]);
const sender = useChatSend(pending);
function send(body: string) {
  if (!selectedId.value) return;
  sender.mutate({ threadId: selectedId.value, body });
}
function retry(line: PendingLine) {
  sender.mutate({ threadId: line.thread_id, body: line.body, messageId: line.message_id });
}

const { edit, retract } = useChatMessageActions(selectedId);
async function onEdit(messageId: string, body: string) {
  try {
    await edit.mutateAsync({ messageId, body });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Could not save the edit.");
  }
}
async function onRemove(messageId: string) {
  try {
    await retract.mutateAsync(messageId);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Could not remove the message.");
  }
}

const starting = ref(false);
const people = useChatPeopleQuery(computed(() => entitled.value && starting.value));
const openDirect = useChatOpenDirect();
const createGroup = useChatCreateGroup();
const startBusy = computed(() => openDirect.isPending.value || createGroup.isPending.value);
async function start(memberIds: string[], subject: string | null) {
  try {
    const id = memberIds.length === 1
      ? await openDirect.mutateAsync(memberIds[0]!)
      : await createGroup.mutateAsync({ subject, memberIds });
    starting.value = false;
    open(id);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Could not start the conversation.");
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Conversations with the people in your office.">
      <template #actions>
        <!-- Only once a live link has dropped (or never came up): the polls carry on meanwhile at their
             fast pace, so nothing is lost — it is only slower. -->
        <span v-if="chatLinkState === 'reconnecting'" role="status" class="text-sm text-ink-muted">
          Reconnecting… messages may take a few seconds.
        </span>
        <BaseButton v-if="entitled && view === 'chats'" variant="primary" @click="starting = true">New conversation</BaseButton>
      </template>
    </PageHeader>

    <QueryState
      v-if="!entitlementKnown"
      :loading="modules.isPending.value && !modules.isError.value"
      :error="modules.isError.value ? modules.error.value : null"
      :retrying="modules.isFetching.value"
      loading-text="Loading chat…"
      error-text="Could not check whether chat is part of your plan."
      @retry="modules.refetch()"
    />
    <BaseCard v-else-if="!entitled">
      <p class="text-sm text-ink-muted">Chat isn't part of your plan. Contact Silvicom 360 to enable it.</p>
    </BaseCard>

    <!-- The panel fills the window below the page header and stops above the Ask AI launcher
         (`--assistant-clearance`, AssistantLauncher.vue), so the composer and Send are never under it
         without scrolling — the browser pass found a fixed 70vh put Send under the launcher. 15rem is
         the shell's top bar plus this page's header and gaps, measured at 1440×900 and 1920×1080.
         Below `lg` the header wraps taller, hence 19rem there; and a phone shows the list OR the open
         conversation (Teams' pattern), with Back in the conversation's header — side by side, both
         were too short to use (browser pass, 390×844).
         `_`, not `,`, inside brackets: Tailwind 4 reads a comma there as one value (MessagesPage). -->
    <AppTabs v-if="entitled" v-model="view" :tabs="VIEWS" label="Chats or teams" id-prefix="chat-view" />

    <ChatTeamsView v-if="entitled && view === 'teams'" :entitled="entitled" />
    <!-- 3rem more than before CH5c in both heights: the Chats | Teams tabs above the panel. -->
    <div
      v-else-if="entitled"
      class="grid h-[calc(100dvh_-_22rem_-_var(--assistant-clearance,0px))] min-h-96 gap-4 lg:h-[calc(100dvh_-_18rem_-_var(--assistant-clearance,0px))] lg:grid-cols-[20rem_minmax(0,1fr)]"
    >
      <BaseCard padding="none" class="min-h-0 overflow-y-auto" :class="selectedId ? 'hidden lg:block' : ''">
        <ChatConversationList v-if="conversations.length > 0" :conversations="conversations" :selected-id="selectedId" @open="open" />
        <!-- Loading, failed and empty are three answers (D-US5). -->
        <div v-else class="px-4 py-8 text-center text-sm text-ink-muted">
          <QueryState
            compact
            :loading="inbox.isPending.value && !inbox.isError.value"
            :error="inbox.isError.value ? inbox.error.value : null"
            :retrying="inbox.isFetching.value"
            loading-text="Loading your conversations…"
            error-text="Could not load your conversations."
            @retry="inbox.refetch()"
          >
            No conversations yet. Start one with “New conversation”.
          </QueryState>
        </div>
      </BaseCard>

      <BaseCard padding="none" class="min-h-0" :class="selectedId ? '' : 'hidden lg:block'">
        <ChatConversationPane
          v-if="selectedId && conversation.data.value"
          :data="conversation.data.value"
          :viewer-id="session.userId ?? ''"
          :pending="pending"
          :sending="sender.isPending.value"
          :earlier-loading="earlier.isPending.value"
          :earlier-failed="earlier.isError.value"
          @earlier="earlier.mutate()"
          @send="send"
          @retry="retry"
          @edit="onEdit"
          @remove="onRemove"
          @back="close"
        />
        <div v-else class="flex h-full items-center justify-center px-4 text-center text-sm text-ink-muted">
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
          <template v-else>Pick a conversation, or start a new one.</template>
        </div>
      </BaseCard>
    </div>

    <NewChatDialog
      :open="starting"
      :people="people.data.value ?? []"
      :viewer-id="session.userId ?? ''"
      :busy="startBusy"
      @close="starting = false"
      @start="start"
    />
  </div>
</template>
