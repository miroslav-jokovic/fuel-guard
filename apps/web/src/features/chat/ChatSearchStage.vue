<script setup lang="ts">
import { computed, onMounted, ref, toRef } from "vue";
import { AppButton as BaseButton, AppSearchField, QueryState } from "@silvicom/ui";
import ChatLineLink from "./ChatLineLink.vue";
import ChatStageHeader from "./ChatStageHeader.vue";
import { activityTarget } from "./chatActivity";
import { useChatSearchQuery } from "./useChatSearch";

/**
 * Search on the stage (OFFICE-CHAT-PLAN CH8, CHAT-REDESIGN-PLAN Q-CHATUI7), at `?search=<words>` — a place
 * with an address, like Activity and Saved, so Back and a shared link both work. Reached two ways: the
 * rail's "Search messages" under its name filter, across every conversation; and a conversation's or a
 * channel's menu, which adds `within` and keeps the search to it until "Search everywhere" drops it.
 *
 * The words live in the address, not in this component: typing replaces the query (the page's
 * `router.replace`), so Back leaves search rather than stepping through every letter. Each result opens
 * where it lives by the rule Activity and Saved use (`activityTarget`), with `line` naming the line, so
 * the log brings that line into view (`ChatMessageList` `focusId`). What may be found — the
 * conversations you are in now, never a removed line — is the database's (0542 `chat_search`).
 */
const props = defineProps<{
  q: string;
  /** The conversation or channel the search is kept to, and what to call it; null for everywhere. */
  within: string | null;
  withinLabel: string | null;
  viewerId: string;
  titleOf: (threadId: string) => string | null;
}>();
const emit = defineEmits<{ "update:q": [q: string]; everywhere: []; open: [query: Record<string, string>]; back: [] }>();

const search = useChatSearchQuery(toRef(props, "q"), toRef(props, "within"), ref(true));
const field = ref<InstanceType<typeof AppSearchField> | null>(null);
onMounted(() => { field.value?.input()?.focus(); });

const subtitle = computed(() => (props.within ? `In ${props.withinLabel ?? "this conversation"}` : "In every conversation you are in"));
</script>

<template>
  <section class="flex h-full min-h-0 flex-1 flex-col bg-surface" aria-label="Search">
    <ChatStageHeader title="Search" :subtitle="subtitle" glyph="search" back-label="Back to conversations" @back="emit('back')">
      <BaseButton v-if="within" size="sm" variant="ghost" @click="emit('everywhere')">Search everywhere</BaseButton>
    </ChatStageHeader>
    <div class="shrink-0 border-b border-edge-subtle px-3 py-2.5 sm:px-5">
      <AppSearchField
        ref="field"
        :model-value="q"
        :placeholder="within ? `Search in ${withinLabel ?? 'this conversation'}` : 'Search messages'"
        label="Search messages"
        class="max-w-xl"
        @update:model-value="(v: string) => emit('update:q', v)"
      />
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2 sm:px-4">
      <ul v-if="search.items.value.length" class="max-w-3xl" aria-label="Messages found">
        <li v-for="line in search.items.value" :key="line.id" class="flex">
          <ChatLineLink :line="line" :viewer-id="viewerId" :title-of="titleOf" @open="emit('open', { ...activityTarget(line), line: line.id })" />
        </li>
      </ul>
      <div v-if="search.items.value.length && search.hasNextPage.value" class="max-w-3xl px-3 py-2">
        <BaseButton size="sm" variant="ghost" :disabled="search.isFetchingNextPage.value" @click="search.fetchNextPage()">
          {{ search.isFetchingNextPage.value ? "Loading…" : "Show earlier" }}
        </BaseButton>
      </div>
      <div v-if="!search.items.value.length" class="flex h-full items-center justify-center px-6 text-center text-sm text-ink-muted">
        <p v-if="!search.words.value">Type a word, a name or a load number. Every word must match; the beginning of a word is enough.</p>
        <QueryState
          v-else
          compact
          :loading="search.isPending.value && !search.isError.value"
          :error="search.isError.value ? search.error.value : null"
          :retrying="search.isFetching.value"
          loading-text="Searching…"
          error-text="Could not search the messages."
          @retry="search.refetch()"
        >
          No messages match “{{ search.words.value }}”{{ within ? ` in ${withinLabel ?? "this conversation"}` : "" }}.
        </QueryState>
      </div>
    </div>
  </section>
</template>
