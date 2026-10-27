<script setup lang="ts">
import { computed, ref } from "vue";
import { chatPreview, chatTitle, type ChatConversation, type ChatTeam, type ChatTeamChannel } from "@silvicom/shared";
import { AppAvatar, AppButton as BaseButton, AppIcon, AppSearchField, QueryState } from "@silvicom/ui";
import { BellIcon, PlusIcon, UserGroupIcon } from "@silvicom/ui/icons";
import KebabMenu from "@/components/KebabMenu.vue";
import { chatRowTime } from "./chatTime";
import { useChatNames } from "./chatNames";

/**
 * The one rail of /chat (CHAT-REDESIGN-PLAN D-CHATUI2, D-CHATUI3): everything you are in, in sections —
 * Chats (direct and group, newest activity first, the API's order, D-CHAT5), then each team's channels
 * (the ones you are in, General first; the public ones you are not in folded under "Show N more"),
 * then Muted, folded, for every conversation or channel muted `all`. Until this plan the Chats list
 * and the Teams rail were two tabs, and switching dropped the open conversation.
 *
 * A row says who or what it is, and where attention is owed: an unread row bolds its name and carries
 * its count in the brand accent (D-CHATUI5); a muted one keeps the count and never bolds. A team's
 * acts — New channel, Add people for its owner, Leave team — are its header's kebab, not three
 * buttons under every team. What a person may do is the database's to decide; these only show what it
 * would allow. The search filters by name across every section; it is this tab's, not a server call.
 *
 * Two things the page's keys ask of it (D-CHATUI16): `focusSearch` for `/`, and `step` for J and K —
 * open the item after or before the open one in the rail's own order, Chats, then each team's
 * channels, then Muted when it is unfolded, and stop at the ends rather than wrap.
 */
const props = defineProps<{
  conversations: ChatConversation[];
  teams: ChatTeam[];
  canManage: boolean;
  selectedId: string | null;
  inboxLoading: boolean;
  inboxError: Error | null;
  inboxRetrying: boolean;
  teamsLoading: boolean;
  teamsError: Error | null;
  teamsRetrying: boolean;
  /** Activity is on the stage (`?activity=1`). */
  activityOpen?: boolean;
  /** Activity items after the reader's read instant (D-CHAT25). */
  activityUnread?: number;
}>();
const emit = defineEmits<{
  "open-conversation": [id: string];
  "open-channel": [id: string];
  "open-activity": [];
  join: [id: string];
  "new-conversation": [];
  "new-team": [];
  "new-channel": [team: ChatTeam];
  "add-people": [team: ChatTeam];
  "leave-team": [team: ChatTeam];
  "retry-inbox": [];
  "retry-teams": [];
}>();

const nameOf = useChatNames();
const query = ref("");
const q = computed(() => query.value.trim().toLowerCase());
const matches = (name: string) => !q.value || name.toLowerCase().includes(q.value);

const isMuted = (x: { muted: string | null }) => x.muted === "all";
const chats = computed(() => props.conversations.filter((c) => !isMuted(c) && matches(chatTitle(c))));
const mutedChats = computed(() => props.conversations.filter((c) => isMuted(c) && matches(chatTitle(c))));
const joinedOf = (t: ChatTeam) => t.channels.filter((c) => c.joined && !isMuted(c) && matches(c.name));
const toJoinOf = (t: ChatTeam) => t.channels.filter((c) => !c.joined && matches(c.name));
const mutedChannels = computed(() => props.teams.flatMap((t) => t.channels.filter((c) => c.joined && isMuted(c) && matches(c.name)).map((c) => ({ team: t, channel: c }))));
const mutedCount = computed(() => mutedChats.value.length + mutedChannels.value.length);
const nothingMatches = computed(
  () => !!q.value && chats.value.length === 0 && mutedCount.value === 0 && props.teams.every((t) => joinedOf(t).length === 0 && toJoinOf(t).length === 0),
);

const browsing = ref<Set<string>>(new Set());
function toggleBrowse(spaceId: string) {
  const next = new Set(browsing.value);
  if (next.has(spaceId)) next.delete(spaceId);
  else next.add(spaceId);
  browsing.value = next;
}
const showMuted = ref(false);

const root = ref<HTMLElement | null>(null);
function focusSearch() {
  root.value?.querySelector<HTMLInputElement>("input")?.focus();
}
/** Everything the rail shows, top to bottom. */
const shown = computed(() => [
  ...chats.value.map((c) => ({ id: c.thread_id, channel: false })),
  ...props.teams.flatMap((t) => joinedOf(t).map((c) => ({ id: c.thread_id, channel: true }))),
  ...(showMuted.value || q.value
    ? [...mutedChats.value.map((c) => ({ id: c.thread_id, channel: false })), ...mutedChannels.value.map(({ channel: c }) => ({ id: c.thread_id, channel: true }))]
    : []),
]);
function step(delta: 1 | -1) {
  const list = shown.value;
  const i = list.findIndex((x) => x.id === props.selectedId);
  const next = list[i < 0 ? (delta > 0 ? 0 : list.length - 1) : i + delta];
  if (!next) return;
  if (next.channel) emit("open-channel", next.id);
  else emit("open-conversation", next.id);
}
defineExpose({ focusSearch, step });

const bold = (x: { unread: number; muted: string | null }) => x.unread > 0 && x.muted !== "all";
const current = (id: string) => (props.selectedId === id ? "true" : undefined);
const variant = (id: string) => (props.selectedId === id ? "soft" : "ghost");
const channelLabel = (c: ChatTeamChannel) => `# ${c.name}${c.visibility === "private" ? ", private" : ""}`;
</script>

<template>
  <aside ref="root" class="flex h-full min-h-0 flex-col border-r border-edge-subtle bg-canvas">
    <div class="flex shrink-0 items-center gap-2 border-b border-edge-subtle px-3 py-2.5">
      <AppSearchField v-model="query" placeholder="Search chat" label="Search chat" :debounce="0" class="min-w-0 flex-1" />
      <KebabMenu trigger-label="New" placement="bottom-end">
        <template #trigger>
          <span class="inline-flex size-9 items-center justify-center rounded-control bg-action-primary text-action-primary-foreground hover:bg-action-primary-hover" title="New">
            <AppIcon :icon="PlusIcon" class="size-5" aria-hidden="true" />
          </span>
        </template>
        <BaseButton class="kebab-item" @click="emit('new-conversation')">New conversation</BaseButton>
        <BaseButton v-if="canManage" class="kebab-item" @click="emit('new-team')">New team</BaseButton>
        <BaseButton v-for="t in teams" :key="t.space_id" class="kebab-item" @click="emit('new-channel', t)">New channel in {{ t.name }}</BaseButton>
      </KebabMenu>
    </div>

    <nav class="min-h-0 flex-1 overflow-y-auto py-2" aria-label="Chats and channels">
      <p v-if="nothingMatches" class="px-4 py-6 text-center text-sm text-ink-muted">Nothing in chat is called that.</p>

      <!-- Activity, above Chats (CHAT-REDESIGN-PLAN §6): what named you or answered your posts. Not a search result. -->
      <div v-if="!q" class="px-0 pb-2">
        <BaseButton type="button" size="row" block :variant="activityOpen ? 'soft' : 'ghost'" class="px-3 py-1.5" :aria-current="activityOpen ? 'true' : undefined" @click="emit('open-activity')">
          <span class="flex w-full min-w-0 items-center gap-3">
            <span class="flex size-7 shrink-0 items-center justify-center text-ink-tertiary" aria-hidden="true"><AppIcon :icon="BellIcon" class="size-4" /></span>
            <span class="min-w-0 flex-1 truncate text-sm text-ink" :class="activityUnread ? 'font-semibold' : 'font-normal'">Activity</span>
            <span v-if="activityUnread" class="shrink-0 rounded-full bg-brand-accent-strong px-1.5 py-0.5 text-2xs font-semibold text-ink" :aria-label="`${activityUnread} unread`">{{ activityUnread }}</span>
          </span>
        </BaseButton>
      </div>

      <!-- Chats -->
      <section v-if="!q || chats.length" aria-labelledby="chat-rail-chats" class="pb-2">
        <h3 id="chat-rail-chats" class="px-4 pt-1 pb-1 text-xs font-semibold tracking-wider text-ink-muted uppercase">Chats</h3>
        <ul v-if="chats.length">
          <li v-for="c in chats" :key="c.thread_id">
            <BaseButton type="button" size="row" block :variant="variant(c.thread_id)" class="px-3 py-2" :aria-current="current(c.thread_id)" @click="emit('open-conversation', c.thread_id)">
              <span class="flex w-full min-w-0 items-center gap-3">
                <AppAvatar v-if="c.kind === 'direct'" :label="chatTitle(c)" size="sm" />
                <span v-else class="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-secondary ring-1 ring-inset ring-edge" aria-hidden="true">
                  <AppIcon :icon="UserGroupIcon" class="size-4" />
                </span>
                <span class="block min-w-0 flex-1">
                  <span class="flex items-baseline justify-between gap-2">
                    <span class="truncate text-sm text-ink" :class="bold(c) ? 'font-semibold' : 'font-medium'">{{ chatTitle(c) }}</span>
                    <span class="shrink-0 text-2xs tabular-nums text-ink-tertiary">{{ chatRowTime(c.last_message_at) }}</span>
                  </span>
                  <span class="mt-0.5 flex items-center justify-between gap-2">
                    <span class="truncate text-xs" :class="bold(c) ? 'text-ink-secondary' : 'text-ink-muted'">
                      <template v-if="c.kind !== 'direct' && c.last_message?.sender_name">{{ c.last_message.sender_name }}: </template>{{ chatPreview(c.last_message, 90, nameOf) }}
                    </span>
                    <span v-if="c.unread > 0" class="shrink-0 rounded-full bg-brand-accent-strong px-1.5 py-0.5 text-2xs font-semibold text-ink" :aria-label="`${c.unread} unread`">{{ c.unread }}</span>
                  </span>
                </span>
              </span>
            </BaseButton>
          </li>
        </ul>
        <div v-else-if="!q" class="px-4 py-3 text-sm text-ink-muted">
          <QueryState compact :loading="inboxLoading" :error="inboxError" :retrying="inboxRetrying" loading-text="Loading your conversations…" error-text="Could not load your conversations." @retry="emit('retry-inbox')">
            No conversations yet. Start one with New.
          </QueryState>
        </div>
      </section>

      <!-- Teams -->
      <section v-for="t in teams" :key="t.space_id" :aria-labelledby="`chat-rail-team-${t.space_id}`" class="pb-2">
        <template v-if="!q || joinedOf(t).length || toJoinOf(t).length">
          <div class="flex items-center justify-between gap-2 px-4 pt-1 pb-1">
            <h3 :id="`chat-rail-team-${t.space_id}`" class="truncate text-xs font-semibold tracking-wider text-ink-muted uppercase" :title="t.description ?? undefined">{{ t.name }}</h3>
            <KebabMenu :trigger-label="`${t.name} actions`" placement="bottom-end">
              <BaseButton class="kebab-item" @click="emit('new-channel', t)">New channel</BaseButton>
              <BaseButton v-if="t.space_role === 'owner'" class="kebab-item" @click="emit('add-people', t)">Add people</BaseButton>
              <BaseButton class="kebab-item" @click="emit('leave-team', t)">Leave team</BaseButton>
            </KebabMenu>
          </div>
          <ul :aria-label="`${t.name} channels`">
            <li v-for="c in joinedOf(t)" :key="c.thread_id">
              <BaseButton type="button" size="row" block :variant="variant(c.thread_id)" class="px-3 py-1.5" :aria-current="current(c.thread_id)" :aria-label="channelLabel(c)" @click="emit('open-channel', c.thread_id)">
                <span class="flex w-full min-w-0 items-center gap-3">
                  <span class="w-7 shrink-0 text-center text-sm text-ink-tertiary" aria-hidden="true">#</span>
                  <span class="min-w-0 flex-1 truncate text-sm text-ink" :class="bold(c) ? 'font-semibold' : 'font-normal'">
                    {{ c.name }}<span v-if="c.visibility === 'private'" class="ml-1 text-2xs text-ink-tertiary">private</span>
                  </span>
                  <span v-if="c.unread > 0" class="shrink-0 rounded-full bg-brand-accent-strong px-1.5 py-0.5 text-2xs font-semibold text-ink" :aria-label="`${c.unread} unread`">{{ c.unread }}</span>
                </span>
              </BaseButton>
            </li>
          </ul>
          <div v-if="toJoinOf(t).length" class="px-3">
            <BaseButton size="sm" variant="ghost" class="text-xs" :aria-expanded="browsing.has(t.space_id) || !!q" @click="toggleBrowse(t.space_id)">
              {{ browsing.has(t.space_id) && !q ? "Show fewer" : `Show ${toJoinOf(t).length} more ${toJoinOf(t).length === 1 ? "channel" : "channels"}` }}
            </BaseButton>
            <ul v-if="browsing.has(t.space_id) || q" class="pb-1" :aria-label="`${t.name} channels to join`">
              <li v-for="c in toJoinOf(t)" :key="c.thread_id" class="flex items-center gap-3 py-1 pl-1 text-sm">
                <span class="w-7 shrink-0 text-center text-ink-tertiary" aria-hidden="true">#</span>
                <span class="min-w-0 flex-1 truncate text-ink-muted">{{ c.name }}</span>
                <BaseButton size="sm" variant="secondary" :aria-label="`Join # ${c.name}`" @click="emit('join', c.thread_id)">Join</BaseButton>
              </li>
            </ul>
          </div>
        </template>
      </section>
      <div v-if="teams.length === 0 && !q" class="px-4 py-2 text-sm text-ink-muted">
        <QueryState compact :loading="teamsLoading" :error="teamsError" :retrying="teamsRetrying" loading-text="Loading your teams…" error-text="Could not load your teams." @retry="emit('retry-teams')">
          {{ canManage ? "No teams yet. Make one with New." : "You are not in a team yet. Somebody in a team can add you." }}
        </QueryState>
      </div>

      <!-- Muted, at the bottom and folded: a muted item keeps its place and its count, and never asks (D-CHATUI3). -->
      <section v-if="mutedCount" aria-labelledby="chat-rail-muted" class="pb-2">
        <BaseButton size="sm" variant="ghost" class="mx-2 text-xs" :aria-expanded="showMuted || !!q" @click="showMuted = !showMuted">
          <span id="chat-rail-muted" class="font-semibold tracking-wider text-ink-muted uppercase">Muted</span>
          <span class="ml-1 text-ink-tertiary">{{ mutedCount }}</span>
        </BaseButton>
        <ul v-if="showMuted || q">
          <li v-for="c in mutedChats" :key="c.thread_id">
            <BaseButton type="button" size="row" block :variant="variant(c.thread_id)" class="px-3 py-1.5" :aria-current="current(c.thread_id)" @click="emit('open-conversation', c.thread_id)">
              <span class="flex w-full min-w-0 items-center gap-3">
                <AppAvatar :label="chatTitle(c)" size="sm" />
                <span class="min-w-0 flex-1 truncate text-sm text-ink-secondary">{{ chatTitle(c) }}</span>
                <span v-if="c.unread > 0" class="shrink-0 text-2xs tabular-nums text-ink-tertiary" :aria-label="`${c.unread} unread`">{{ c.unread }}</span>
              </span>
            </BaseButton>
          </li>
          <li v-for="{ team, channel: c } in mutedChannels" :key="c.thread_id">
            <BaseButton type="button" size="row" block :variant="variant(c.thread_id)" class="px-3 py-1.5" :aria-current="current(c.thread_id)" :aria-label="`${channelLabel(c)}, ${team.name}`" @click="emit('open-channel', c.thread_id)">
              <span class="flex w-full min-w-0 items-center gap-3">
                <span class="w-7 shrink-0 text-center text-sm text-ink-tertiary" aria-hidden="true">#</span>
                <span class="min-w-0 flex-1 truncate text-sm text-ink-secondary">{{ c.name }} <span class="text-2xs text-ink-tertiary">{{ team.name }}</span></span>
                <span v-if="c.unread > 0" class="shrink-0 text-2xs tabular-nums text-ink-tertiary" :aria-label="`${c.unread} unread`">{{ c.unread }}</span>
              </span>
            </BaseButton>
          </li>
        </ul>
      </section>
    </nav>
  </aside>
</template>
