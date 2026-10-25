<script setup lang="ts">
import { ref } from "vue";
import type { ChatTeam, ChatTeamChannel } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";

/**
 * The Teams rail on /chat (OFFICE-CHAT-PLAN CH5c, D-CHAT18): every team you are in, each with the
 * channels you can see — the ones you are in first (General at the top, from the API's order), then
 * the public ones you are not in yet, folded, to join. A private channel you are not in is never
 * here: the API does not return it.
 *
 * Unread is the channel's own `last_seq − read_seq` (D-CHAT5); a fully muted channel keeps its count
 * but never bolds, as a conversation does. What a person may do is the database's to decide; these
 * buttons show what it would allow — "Add people" for a team owner, "Leave" anywhere but General.
 */
defineProps<{ teams: ChatTeam[]; selectedId: string | null }>();
const emit = defineEmits<{
  open: [threadId: string];
  join: [threadId: string];
  "new-channel": [team: ChatTeam];
  "add-people": [team: ChatTeam];
  "leave-team": [team: ChatTeam];
}>();

const browsing = ref<Set<string>>(new Set());
function toggleBrowse(spaceId: string) {
  const next = new Set(browsing.value);
  if (next.has(spaceId)) next.delete(spaceId);
  else next.add(spaceId);
  browsing.value = next;
}
const joined = (t: ChatTeam) => t.channels.filter((c) => c.joined);
const toJoin = (t: ChatTeam) => t.channels.filter((c) => !c.joined);
const bold = (c: ChatTeamChannel) => c.unread > 0 && c.muted !== "all";
</script>

<template>
  <ul class="divide-y divide-edge-subtle" aria-label="Teams">
    <li v-for="t in teams" :key="t.space_id" class="py-2">
      <div class="flex items-center justify-between gap-2 px-4 py-1">
        <h3 class="truncate text-sm font-semibold text-ink" :title="t.description ?? undefined">{{ t.name }}</h3>
        <span class="shrink-0 text-xs text-ink-muted">{{ t.member_count }} {{ t.member_count === 1 ? "person" : "people" }}</span>
      </div>
      <ul :aria-label="`${t.name} channels`">
        <li v-for="c in joined(t)" :key="c.thread_id">
          <BaseButton
            type="button"
            size="row"
            block
            :variant="selectedId === c.thread_id ? 'soft' : 'ghost'"
            class="px-4 py-1.5"
            :aria-current="selectedId === c.thread_id ? 'true' : undefined"
            @click="emit('open', c.thread_id)"
          >
            <span class="flex w-full min-w-0 items-center justify-between gap-2">
              <span class="truncate text-sm text-ink" :class="bold(c) ? 'font-semibold' : 'font-normal'">
                # {{ c.name }}<span v-if="c.visibility === 'private'" class="text-xs text-ink-muted"> · private</span>
              </span>
              <span
                v-if="c.unread > 0"
                class="shrink-0 rounded-full bg-brand-accent-strong px-1.5 py-0.5 text-xs font-semibold text-ink"
                :aria-label="`${c.unread} unread`"
              >{{ c.unread }}</span>
            </span>
          </BaseButton>
        </li>
      </ul>
      <div v-if="toJoin(t).length" class="px-4 pt-1">
        <BaseButton size="sm" variant="ghost" :aria-expanded="browsing.has(t.space_id)" @click="toggleBrowse(t.space_id)">
          {{ browsing.has(t.space_id) ? "Hide" : `${toJoin(t).length} more ${toJoin(t).length === 1 ? "channel" : "channels"} to join` }}
        </BaseButton>
        <ul v-if="browsing.has(t.space_id)" class="mt-1 space-y-1" :aria-label="`${t.name} channels to join`">
          <li v-for="c in toJoin(t)" :key="c.thread_id" class="flex items-center justify-between gap-2 text-sm">
            <span class="truncate text-ink-muted"># {{ c.name }}</span>
            <BaseButton size="sm" @click="emit('join', c.thread_id)">Join</BaseButton>
          </li>
        </ul>
      </div>
      <div class="flex flex-wrap gap-1 px-3 pt-1">
        <BaseButton size="sm" variant="ghost" @click="emit('new-channel', t)">New channel</BaseButton>
        <BaseButton v-if="t.space_role === 'owner'" size="sm" variant="ghost" @click="emit('add-people', t)">Add people</BaseButton>
        <BaseButton size="sm" variant="ghost" @click="emit('leave-team', t)">Leave team</BaseButton>
      </div>
    </li>
  </ul>
</template>
