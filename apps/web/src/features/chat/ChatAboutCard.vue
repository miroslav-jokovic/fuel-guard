<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { useRouter } from "vue-router";
import { chatAboutTitle, chatTitle, type ChatAboutConversation, type ChatAboutKind } from "@silvicom/shared";
import { AppButton as BaseButton, AppCard as BaseCard, QueryState } from "@silvicom/ui";
import { useSessionStore } from "@/stores/session";
import NewChatDialog from "./NewChatDialog.vue";
import ChatUnreadCount from "./ChatUnreadCount.vue";
import { chatRowTime } from "./chatTime";
import { useChatPeopleQuery } from "./useChat";
import { useChatAboutAccess, useChatAboutList, useChatCreateAbout } from "./useChatAbout";

/**
 * "Chat about this" on a load's, a driver's or a truck's page (OFFICE-CHAT-PLAN CH11c, §9.4, D-CHAT32–34).
 *
 * The conversations about this record that YOU are in, newest activity first, each opening in /chat —
 * and nobody else's, not even how many there are (Q-CHAT6 (a)): a dispatcher must not learn here that
 * safety is discussing their driver. "Chat about this" picks the people, as New conversation does, and
 * starts a group named for the record ("Load L-20481"); /chat's header links back here.
 *
 * Shown only to somebody who may use chat AND may read this kind of record (`useChatAboutAccess`, the
 * API's own two checks), so nothing here is offered that the server would refuse.
 */
const props = defineProps<{ kind: ChatAboutKind; recordId: string | null; label: string | null }>();

const session = useSessionStore();
const router = useRouter();
const kind = toRef(props, "kind");
const allowed = useChatAboutAccess(kind);
const list = useChatAboutList(kind, toRef(props, "recordId"), allowed);
const starting = ref(false);
const people = useChatPeopleQuery(computed(() => allowed.value && starting.value));
const create = useChatCreateAbout();
const failure = ref<string | null>(null);
const subject = computed(() => (props.label ? chatAboutTitle(props.kind, props.label) : null));

/** A row's title: its name, or the people in it as the rail calls a group with none. */
const titleOf = (c: ChatAboutConversation) => chatTitle({ kind: "group", subject: c.subject, title_members: c.title_members, member_count: c.member_count });

function open(threadId: string) {
  void router.push({ name: "chat", query: { c: threadId } });
}

async function start(memberIds: string[], name: string | null) {
  if (!props.recordId) return;
  failure.value = null;
  try {
    const id = await create.mutateAsync({ thread_id: crypto.randomUUID(), kind: props.kind, record_id: props.recordId, subject: name ?? subject.value, member_ids: memberIds });
    starting.value = false;
    open(id);
  } catch (e) {
    failure.value = e instanceof Error ? e.message : "Could not start the conversation.";
  }
}
</script>

<template>
  <BaseCard v-if="allowed && recordId" data-chat-about-card>
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold text-ink">Chat</h2>
        <p class="text-xs text-ink-muted">Your conversations about this {{ kind === "vehicle" ? "truck" : kind }}. Only the people in each one see it.</p>
      </div>
      <BaseButton size="sm" variant="secondary" @click="starting = true">Chat about this</BaseButton>
    </div>
    <ul v-if="list.data.value?.length" class="mt-3 divide-y divide-edge-subtle" aria-label="Conversations about this">
      <li v-for="c in list.data.value" :key="c.thread_id">
        <BaseButton type="button" size="row" block variant="ghost" class="px-2 py-2" @click="open(c.thread_id)">
          <span class="flex w-full min-w-0 items-center gap-3 text-left">
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm text-ink" :class="c.unread ? 'font-semibold' : 'font-medium'">{{ titleOf(c) }}</span>
              <span class="block text-xs text-ink-muted">{{ c.member_count }} people · {{ chatRowTime(c.last_message_at) }}</span>
            </span>
            <ChatUnreadCount :count="c.unread" />
          </span>
        </BaseButton>
      </li>
    </ul>
    <div v-else class="mt-3 text-sm text-ink-muted">
      <QueryState
        compact
        :loading="list.isPending.value && !list.isError.value"
        :error="list.isError.value ? list.error.value : null"
        :retrying="list.isFetching.value"
        loading-text="Loading your conversations…"
        error-text="Could not load the conversations about this."
        @retry="list.refetch()"
      >
        None of yours yet. Chat about this starts one with the people you pick.
      </QueryState>
    </div>
    <p v-if="failure" class="mt-2 text-sm text-danger-text" role="alert">{{ failure }}</p>
    <NewChatDialog
      :open="starting"
      :people="people.data.value ?? []"
      :viewer-id="session.userId ?? ''"
      :busy="create.isPending.value"
      :about="subject"
      @close="starting = false"
      @start="start"
    />
  </BaseCard>
</template>
