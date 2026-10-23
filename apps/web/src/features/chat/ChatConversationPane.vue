<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { CHAT_BODY_MAX, chatTitle, type ChatConversationResponse } from "@silvicom/shared";
import { AppButton as BaseButton, AppTextarea as BaseTextarea } from "@silvicom/ui";
import { mergeLines, type PendingLine } from "./useChat";
import { chatStamp } from "./chatTime";

/**
 * One open conversation: the newest page of lines, oldest at the top, and the composer.
 *
 * Your own lines sit on the right. A line you sent that the server has not confirmed reads "Sending…";
 * one it refused keeps its text with Retry, so nothing typed is ever lost (D-CHAT2's optimistic send).
 * "Seen" appears under your newest line in a direct conversation once the other person's read
 * boundary has passed it — the receipt dispatch asked for in 0096, now from `read_seq`.
 *
 * Edit and Remove act on your own lines only; the database refuses anything else (0512), so the
 * buttons only spare a round trip. A removed line keeps its place as "Message removed".
 */
const props = defineProps<{
  data: ChatConversationResponse;
  viewerId: string;
  pending: PendingLine[];
  sending: boolean;
}>();
const emit = defineEmits<{
  send: [body: string];
  retry: [line: PendingLine];
  edit: [messageId: string, body: string];
  remove: [messageId: string];
  back: [];
}>();

const lines = computed(() => mergeLines(props.data.messages, props.pending, props.data.conversation.thread_id));
const title = computed(() => chatTitle(props.data.conversation));
const memberNames = computed(() =>
  props.data.members.filter((m) => m.user_id !== props.viewerId).map((m) => m.name ?? "Someone").join(", "),
);

/** The other side's furthest read position, for "Seen" in a direct conversation. */
const othersReadSeq = computed(() =>
  Math.max(0, ...props.data.members.filter((m) => m.user_id !== props.viewerId).map((m) => m.read_seq)),
);
const myLastSeq = computed(() => {
  const mine = props.data.messages.filter((m) => m.sender_user_id === props.viewerId);
  return mine.length ? mine[mine.length - 1]!.seq : null;
});

const draft = ref("");
const over = computed(() => draft.value.length > CHAT_BODY_MAX);
function submit() {
  const body = draft.value.trim();
  if (!body || over.value) return;
  emit("send", body);
  draft.value = "";
}
function onKey(e: KeyboardEvent) {
  // Enter sends, Shift+Enter breaks the line — Teams' and Slack's default.
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  }
}

const editingId = ref<string | null>(null);
const editDraft = ref("");
function startEdit(id: string, body: string | null) {
  editingId.value = id;
  editDraft.value = body ?? "";
}
function saveEdit() {
  const body = editDraft.value.trim();
  if (editingId.value && body) emit("edit", editingId.value, body);
  editingId.value = null;
}

const scroller = ref<HTMLElement | null>(null);
watch(
  () => [props.data.conversation.thread_id, lines.value.length],
  async () => {
    await nextTick();
    // `scrollTop`, not `scrollTo()`: same effect, and it exists on every element jsdom builds too.
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
  },
  { immediate: true },
);
</script>

<template>
  <section class="flex h-full min-h-0 flex-col" :aria-label="title">
    <header class="flex items-center gap-2 border-b border-edge-subtle px-4 py-3">
      <!-- A phone shows the list OR the conversation (ChatPage); this is the way back. -->
      <BaseButton size="sm" variant="ghost" class="lg:hidden" @click="$emit('back')">Back</BaseButton>
      <div class="min-w-0">
        <h2 class="truncate text-sm font-semibold text-ink">{{ title }}</h2>
        <p v-if="data.conversation.kind !== 'direct'" class="truncate text-xs text-ink-muted">{{ memberNames }}</p>
      </div>
    </header>

    <div ref="scroller" class="flex-1 space-y-2 overflow-y-auto px-4 py-3" aria-live="polite">
      <p v-if="data.before_seq" class="text-center text-xs text-ink-muted">Earlier messages are not shown yet.</p>
      <p v-if="lines.length === 0" class="py-8 text-center text-sm text-ink-muted">No messages yet. Say hello.</p>

      <template v-for="l in lines" :key="l.kind === 'server' ? l.message.id : l.line.message_id">
        <div
          v-if="l.kind === 'server'"
          class="group max-w-[75%] rounded-surface px-3 py-2 text-sm"
          :class="l.message.sender_user_id === viewerId ? 'ml-auto bg-action-primary text-action-primary-foreground' : 'bg-surface-subtle text-ink'"
        >
          <div v-if="l.message.sender_user_id !== viewerId && data.conversation.kind !== 'direct'" class="text-xs font-semibold opacity-80">
            {{ l.message.sender_name ?? "Someone" }}
          </div>
          <template v-if="editingId === l.message.id">
            <BaseTextarea v-model="editDraft" :rows="2" aria-label="Edit message" @keydown.enter.exact.prevent="saveEdit" @keydown.esc.stop="editingId = null" />
            <div class="mt-1 flex justify-end gap-2">
              <BaseButton size="sm" variant="ghost" @click="editingId = null">Cancel</BaseButton>
              <BaseButton size="sm" @click="saveEdit">Save</BaseButton>
            </div>
          </template>
          <div v-else class="whitespace-pre-wrap break-words" :class="l.message.deleted_at ? 'italic opacity-70' : ''">
            {{ l.message.deleted_at ? "Message removed" : l.message.body }}
          </div>
          <div class="mt-0.5 flex items-center justify-end gap-2 text-2xs opacity-70">
            <span>{{ chatStamp(l.message.created_at) }}</span>
            <span v-if="l.message.edited_at && !l.message.deleted_at">· edited</span>
            <span v-if="data.conversation.kind === 'direct' && l.message.seq === myLastSeq && othersReadSeq >= l.message.seq">· Seen</span>
          </div>
          <div
            v-if="l.message.sender_user_id === viewerId && !l.message.deleted_at && editingId !== l.message.id"
            class="mt-1 hidden justify-end gap-2 text-2xs group-focus-within:flex group-hover:flex"
          >
            <BaseButton size="sm" variant="ghost" @click="startEdit(l.message.id, l.message.body)">Edit</BaseButton>
            <BaseButton size="sm" variant="ghost" @click="$emit('remove', l.message.id)">Remove</BaseButton>
          </div>
        </div>

        <div v-else class="ml-auto max-w-[75%] rounded-surface bg-action-primary px-3 py-2 text-sm text-action-primary-foreground opacity-80">
          <div class="whitespace-pre-wrap break-words">{{ l.line.body }}</div>
          <div class="mt-0.5 text-right text-2xs">
            <template v-if="l.line.state === 'pending'">Sending…</template>
            <template v-else>
              Not sent — {{ l.line.error }}
              <BaseButton size="sm" variant="ghost" @click="$emit('retry', l.line)">Retry</BaseButton>
            </template>
          </div>
        </div>
      </template>
    </div>

    <form class="border-t border-edge-subtle p-3" @submit.prevent="submit">
      <BaseTextarea
        v-model="draft"
        :rows="2"
        placeholder="Type a message — Enter to send, Shift+Enter for a new line"
        aria-label="Message"
        @keydown="onKey"
      />
      <div class="mt-2 flex items-center justify-between gap-2">
        <span class="text-xs" :class="over ? 'text-danger-text' : 'text-ink-muted'">
          <template v-if="over">{{ draft.length - CHAT_BODY_MAX }} characters too long</template>
        </span>
        <BaseButton type="submit" variant="primary" :disabled="!draft.trim() || over">Send</BaseButton>
      </div>
    </form>
  </section>
</template>
