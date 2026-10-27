<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import type { ChatMessage } from "@silvicom/shared";
import { AppAvatar, AppButton as BaseButton, AppIconButton, AppTextarea as BaseTextarea } from "@silvicom/ui";
import { ChatIcon, PencilSquareIcon, TrashIcon } from "@silvicom/ui/icons";
import { chatClock, chatStamp } from "./chatTime";
import ChatBody from "./ChatBody.vue";
import { useChatNames } from "./chatNames";
import { fromDraft, toDraft } from "./mentionDraft";

/**
 * One line of a conversation, a channel or a thread — the same row in all three (CHAT-REDESIGN-PLAN
 * D-CHATUI4). The first line of a run carries the avatar, the name and the time; a line that continues
 * a run carries only its words, and shows its time in the gutter when pointed at or focused. Own lines
 * sit where everybody's do: "you" is a name, not a side.
 *
 * The row's acts (D-CHATUI7) — Reply in thread on a channel post, Edit and Remove on your own line —
 * are a small toolbar at the row's top right, drawn on hover and on focus-within. They are faded, not
 * `hidden`, so a keyboard reaches them by tabbing: a `display: none` button cannot take focus, which
 * is how the bubble this replaced left Edit and Remove unreachable without a mouse. The row itself
 * takes focus on a click (`tabindex="-1"`), which is a phone's way to the toolbar: a finger cannot
 * hover. Edit and Remove act on your own lines only; the database refuses anything else (0512), so the
 * buttons only spare a round trip. A removed line keeps its place as "Message removed".
 *
 * With the row focused (the arrows bring it, D-CHATUI16), Enter opens a post's thread and E edits your
 * own line; when the edit ends, focus returns to the row so the arrows carry on from where they were.
 *
 * A mention is drawn as a chip (`ChatBody`, D-CHAT22) and edited as the words `@Name`, which become its
 * token again on save (`mentionDraft.ts`), so an edit that does not touch a mention keeps it.
 */
const props = defineProps<{
  message: ChatMessage;
  viewerId: string;
  first: boolean;
  /** A channel post: offer Reply in thread and show its replies under it. */
  canReply?: boolean;
  /** This post's thread is open beside the channel. */
  open?: boolean;
}>();
const emit = defineEmits<{ edit: [messageId: string, body: string]; remove: [messageId: string]; reply: [messageId: string] }>();

const root = ref<HTMLElement | null>(null);
const editor = ref<{ $el: HTMLTextAreaElement } | null>(null);
const editing = ref(false);
const draft = ref("");
const nameOf = useChatNames();
let editPicks = new Map<string, string>();
async function startEdit() {
  const d = toDraft(props.message.body ?? "", nameOf);
  draft.value = d.text;
  editPicks = d.picks;
  editing.value = true;
  await nextTick();
  editor.value?.$el.focus();
}
function endEdit() {
  editing.value = false;
  root.value?.focus();
}
function save() {
  const body = fromDraft(draft.value, editPicks).trim();
  if (body) emit("edit", props.message.id, body);
  endEdit();
}
const mine = computed(() => props.message.sender_user_id === props.viewerId);
const name = computed(() => props.message.sender_name ?? "Someone");
const clock = computed(() => chatClock(props.message.created_at));
const stamp = computed(() => chatStamp(props.message.created_at));
const replies = computed(() => props.message.reply_count);

function onKeydown(e: KeyboardEvent) {
  // The row itself only: its buttons and an edit in progress keep their keys.
  if (e.target !== e.currentTarget || props.message.deleted_at) return;
  if (e.key === "Enter" && props.canReply) {
    e.preventDefault();
    emit("reply", props.message.id);
  } else if ((e.key === "e" || e.key === "E") && mine.value) {
    e.preventDefault();
    void startEdit();
  }
}
</script>

<template>
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
  <div
    :id="`chat-line-${message.id}`"
    ref="root"
    class="group relative flex gap-3 rounded-control px-2 hover:bg-surface-subtle focus-within:bg-surface-subtle focus:outline-none"
    :class="[first ? 'mt-3 py-1' : 'py-0.5', open ? 'bg-brand-50/40' : '']"
    tabindex="-1"
    data-chat-row
    @keydown="onKeydown"
  >
    <div class="w-9 shrink-0 text-right">
      <AppAvatar v-if="first" :label="name" size="sm" class="ml-auto" />
      <span
        v-else
        class="block pt-0.5 text-2xs tabular-nums text-ink-tertiary opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
        :title="stamp"
        aria-hidden="true"
      >{{ clock.replace(/ [AP]M$/, "") }}</span>
    </div>

    <div class="min-w-0 flex-1 text-sm">
      <div v-if="first" class="flex items-baseline gap-2">
        <span class="truncate font-semibold text-ink">{{ name }}</span>
        <time class="shrink-0 text-xs text-ink-muted" :datetime="message.created_at" :title="stamp">{{ clock }}</time>
      </div>
      <!-- A screen reader hears the time of a continuation line too; a sighted reader finds it in the gutter. -->
      <span v-else class="sr-only">{{ name }}, {{ clock }}</span>

      <template v-if="editing">
        <BaseTextarea ref="editor" v-model="draft" :rows="2" aria-label="Edit message" class="mt-1 min-h-0!" @keydown.enter.exact.prevent="save" @keydown.esc.stop="endEdit" />
        <div class="mt-1.5 flex gap-2">
          <BaseButton size="sm" variant="primary" @click="save">Save</BaseButton>
          <BaseButton size="sm" variant="ghost" @click="endEdit">Cancel</BaseButton>
        </div>
      </template>
      <p v-else class="whitespace-pre-wrap break-words" :class="message.deleted_at ? 'italic text-ink-muted' : 'text-ink'">
        <template v-if="message.deleted_at">Message removed</template>
        <template v-else><ChatBody :body="message.body ?? ''" :viewer-id="viewerId" /><span v-if="message.edited_at" class="ml-1 text-xs text-ink-muted">(edited)</span></template>
        <slot name="stamp" />
      </p>

      <!-- A post's thread, as a line under it: how many replies and when the last came (D-CHATUI9). -->
      <BaseButton v-if="canReply && replies > 0" size="sm" variant="link" class="mt-1 text-xs" :aria-pressed="open" @click="emit('reply', message.id)">
        {{ replies }} {{ replies === 1 ? "reply" : "replies" }}<template v-if="message.last_reply_at"> · {{ chatClock(message.last_reply_at) }}</template>
      </BaseButton>
    </div>

    <div
      v-if="!message.deleted_at && !editing && (canReply || mine)"
      class="absolute -top-3 right-2 flex items-center rounded-control bg-surface p-0.5 shadow-card ring-1 ring-edge-subtle opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
      role="toolbar"
      aria-label="Message actions"
    >
      <AppIconButton v-if="canReply" :icon="ChatIcon" label="Reply in thread" size="sm" @click="emit('reply', message.id)" />
      <AppIconButton v-if="mine" :icon="PencilSquareIcon" label="Edit" size="sm" @click="startEdit" />
      <AppIconButton v-if="mine" :icon="TrashIcon" label="Remove" size="sm" variant="danger" @click="emit('remove', message.id)" />
    </div>
  </div>
</template>
