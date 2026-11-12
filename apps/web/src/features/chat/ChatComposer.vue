<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { CHAT_BODY_MAX, CHAT_FILE_ACCEPT, type ChatFileRef } from "@silvicom/shared";
import { AppButton as BaseButton, AppIcon, AppIconButton, AppTextarea as BaseTextarea } from "@silvicom/ui";
import { AtIcon, PaperAirplaneIcon, PaperclipIcon } from "@silvicom/ui/icons";
import FilePickButton from "@/components/ui/FilePickButton.vue";
import ChatComposerFiles from "./ChatComposerFiles.vue";
import { useChatAttachments } from "./useChatAttachments";
import ChatEmojiTray from "./ChatEmojiTray.vue";
import { useBottomChrome } from "@/composables/bottomChrome";
import MentionList from "@/components/mentions/MentionList.vue";
import { useMentionTypeahead } from "@/components/mentions/useMentionTypeahead";

/**
 * The box a line is written in — a conversation's, a channel's, a reply's (CH2, CH5c; CHAT-REDESIGN-PLAN
 * D-CHATUI8). One field that grows from a line to eight and then scrolls, with Send inside it. Enter
 * sends, Shift+Enter breaks the line, and a composition in progress (an IME) never sends: Teams' and
 * Slack's default. The text clears when it is handed over; from there the caller's optimistic send
 * keeps it on screen until the server has it. The counter appears only inside the last tenth of the
 * limit, because a limit nobody is near is noise.
 *
 * The form registers as bottom chrome (D-CHATUI14): the Ask AI launcher parks bottom-right, over
 * exactly where Send sits on a page that fills the window, and `bottomChrome.ts`'s rule is that a bar
 * says how tall it is and the launcher keeps itself above the tallest.
 *
 * Up in an EMPTY field hands focus to the log (`up`, D-CHATUI16): Slack's way into the lines without a
 * mouse. With words in the field Up is the caret's, as ever.
 *
 * `@` opens a list of the people the stage says this conversation may name (`provideMentions`,
 * D-CHAT22, Q-CHAT20 (a); `useMentionTypeahead`, shared with a unit's notes since UN4): Up and Down
 * move, Enter or Tab picks, Esc closes, and while it is open those
 * keys are the list's, not Send's or the log's. A pick writes `@Name` into the field and is remembered;
 * on send every remembered label becomes its `<@id>` token (`mentionDraft.ts`), so the limit counts what
 * is sent. A person not in a channel yet is offered as "Add to # Loads", and picking them adds them first.
 *
 * ── The toolbar (D-CHATUI23, 2026-11-01) ──────────────────────────────────────────────────────────
 * The field used to be a thin outline with a send arrow and nothing else, the owner's "outdated". It is
 * now a card: the text on top and a toolbar along its foot — emoji, `@`, the key hint, Send — the shape
 * Slack's, Teams' and Linear's composers share. `@` writes an `@` at the caret and opens the same list
 * typing one does; the tray writes its emoji at the caret. Neither is a new path to the server: both
 * only edit `draft`, which `submit` sends exactly as before.
 *
 * FILES (CH7): the paperclip at the toolbar's left, a drop onto the box, or a paste. Each file starts
 * uploading at once (`useChatAttachments`); Send carries their references, waits while any is still on its
 * way, and a line may be only files. `uploadTo` is the conversation the files belong to — for a reply,
 * its channel, not the post `threadKey` names. Without it the box takes words only.
 */
const props = withDefaults(defineProps<{ placeholder?: string; label?: string; action?: string; threadKey?: string | null; uploadTo?: string | null }>(), {
  placeholder: "Message",
  label: "Message",
  action: "Send",
  threadKey: null,
  uploadTo: null,
});
const emit = defineEmits<{ send: [body: string, files: ChatFileRef[]]; up: [] }>();
const attachments = useChatAttachments(computed(() => props.uploadTo));
const { files: pendingFiles, refusal } = attachments;
/** Send waits for every file; a failed one must be retried or removed first. */
const canSend = computed(() =>
  (outgoing.value.trim().length > 0 || attachments.ready.value.length > 0) && !over.value && !attachments.uploading.value && !attachments.failed.value);
function onDrop(e: DragEvent) {
  if (!props.uploadTo) return;
  const dropped = [...(e.dataTransfer?.files ?? [])];
  if (dropped.length) attachments.add(dropped);
}
function onPaste(e: ClipboardEvent) {
  const pasted = [...(e.clipboardData?.files ?? [])];
  if (!props.uploadTo || pasted.length === 0) return; // words paste as words
  e.preventDefault();
  attachments.add(pasted);
}

const draft = ref("");
const field = ref<{ $el: HTMLTextAreaElement } | null>(null);
// ── the @ list ──
const { mentions, outgoing, active, listId, options, listOpen, addLabel, readCaret, pick, onListKey, close: closeList, reset: resetMentions } =
  useMentionTypeahead({ field, draft, idPrefix: "chat-mentions" });
const form = ref<HTMLElement | null>(null);
useBottomChrome(form);

const over = computed(() => outgoing.value.length > CHAT_BODY_MAX);
const remaining = computed(() => CHAT_BODY_MAX - outgoing.value.length);
const nearLimit = computed(() => outgoing.value.length >= CHAT_BODY_MAX * 0.9);

/** Eight lines of `text-sm` plus the field's padding, then the field scrolls. */
const MAX_HEIGHT = 8 * 20 + 20;
function grow() {
  const el = field.value?.$el;
  if (!el || typeof el.scrollHeight !== "number") return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
}
watch(draft, grow, { flush: "post" });
// A different conversation is a different draft: the field empties and shrinks with it.
watch(() => props.threadKey, () => { draft.value = ""; resetMentions(); attachments.clear(); });

function submit() {
  const body = outgoing.value.trim();
  if (!canSend.value) return;
  emit("send", body, attachments.ready.value);
  attachments.clear();
  draft.value = "";
  resetMentions();
  field.value?.$el.focus();
}
function onKey(e: KeyboardEvent) {
  if (onListKey(e)) return;
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  } else if (e.key === "ArrowUp" && draft.value === "") {
    e.preventDefault();
    emit("up");
  }
}
/** Writes `text` at the caret (or over the selection) and leaves the caret after it. */
async function insertAtCaret(text: string) {
  const el = field.value?.$el;
  const start = el?.selectionStart ?? draft.value.length;
  const end = el?.selectionEnd ?? start;
  draft.value = `${draft.value.slice(0, start)}${text}${draft.value.slice(end)}`;
  await nextTick();
  const caret = start + text.length;
  el?.focus();
  el?.setSelectionRange(caret, caret);
  readCaret();
}
/** `@` from the toolbar: a space first when it would otherwise join the word before it. */
function startMention() {
  const el = field.value?.$el;
  const at = el?.selectionStart ?? draft.value.length;
  void insertAtCaret(at > 0 && !/\s/.test(draft.value[at - 1] ?? "") ? " @" : "@");
}

defineExpose({ focus: () => field.value?.$el.focus() });
</script>

<template>
  <!-- Dropping a file is a pointer's shortcut; the keyboard's way to the same act is the paperclip. -->
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
  <form ref="form" class="shrink-0 px-2 pt-1 pb-2 sm:px-4 sm:pb-3" @submit.prevent="submit" @dragover.prevent @drop.prevent="onDrop">
    <div
      class="relative max-w-3xl rounded-surface bg-surface shadow-card ring-1 ring-inset transition-shadow focus-within:ring-2"
      :class="over ? 'ring-danger-600 focus-within:ring-danger-600' : 'ring-edge-strong focus-within:ring-focus-ring'"
    >
      <BaseTextarea
        ref="field"
        v-model="draft"
        :rows="1"
        :placeholder="props.placeholder"
        :aria-label="props.label"
        class="min-h-0! resize-none bg-transparent! px-3 pt-3 pb-1 ring-0! focus:ring-0!"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="listOpen"
        :aria-controls="listOpen ? listId : undefined"
        :aria-activedescendant="listOpen ? `${listId}-${active}` : undefined"
        @keydown="onKey"
        @input="readCaret"
        @click="readCaret"
        @keyup.left="readCaret"
        @keyup.right="readCaret"
        @blur="closeList"
        @paste="onPaste"
      />
      <MentionList v-if="listOpen" :id="listId" :options="options" :active="active" :add-label="addLabel" @pick="pick" @point="active = $event" />
      <ChatComposerFiles :files="pendingFiles" :refusal="refusal" @remove="attachments.remove" @retry="attachments.retry" />
      <div class="flex items-center gap-0.5 px-1.5 pb-1.5" role="toolbar" aria-label="Message tools">
        <FilePickButton v-if="uploadTo" :icon="PaperclipIcon" label="Attach files" :accept="CHAT_FILE_ACCEPT" @files="attachments.add" />
        <ChatEmojiTray @pick="insertAtCaret" />
        <AppIconButton v-if="mentions" :icon="AtIcon" label="Mention someone" size="sm" @click="startMention" />
        <!-- The key hint is a desk's; the limit is everyone's, so it shows on a phone too. -->
        <span class="ml-auto px-2 text-2xs text-ink-tertiary" :class="nearLimit ? 'inline' : 'hidden sm:inline'">
          <template v-if="nearLimit">
            <span class="tabular-nums" :class="over ? 'text-danger-text' : ''" aria-live="polite">
              <template v-if="over">{{ -remaining }} characters too long</template>
              <template v-else>{{ remaining }} left</template>
            </span>
          </template>
          <template v-else>Enter to send · Shift+Enter for a new line</template>
        </span>
        <BaseButton type="submit" size="icon" variant="primary" :class="nearLimit ? '' : 'ml-auto sm:ml-0'" :aria-label="props.action" :title="props.action" :disabled="!canSend">
          <AppIcon :icon="PaperAirplaneIcon" class="size-4" aria-hidden="true" />
        </BaseButton>
      </div>
    </div>
  </form>
</template>
