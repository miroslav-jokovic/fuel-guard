<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { CHAT_BODY_MAX } from "@silvicom/shared";
import { AppButton as BaseButton, AppIcon, AppTextarea as BaseTextarea } from "@silvicom/ui";
import { PaperAirplaneIcon } from "@silvicom/ui/icons";
import { useBottomChrome } from "@/composables/bottomChrome";
import { useChatMentions, type MentionCandidate } from "./chatNames";
import { fromDraft, mentionLabel, mentionQueryAt } from "./mentionDraft";

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
 * `@` opens a list of the people the stage says this conversation may name (`provideChatMentions`,
 * D-CHAT22, Q-CHAT20 (a)): Up and Down move, Enter or Tab picks, Esc closes, and while it is open those
 * keys are the list's, not Send's or the log's. A pick writes `@Name` into the field and is remembered;
 * on send every remembered label becomes its `<@id>` token (`mentionDraft.ts`), so the limit counts what
 * is sent. A person not in a channel yet is offered as "Add to # Loads", and picking them adds them first.
 */
const props = withDefaults(defineProps<{ placeholder?: string; label?: string; action?: string; threadKey?: string | null }>(), {
  placeholder: "Message",
  label: "Message",
  action: "Send",
  threadKey: null,
});
const emit = defineEmits<{ send: [body: string]; up: [] }>();

const draft = ref("");
const picks = ref(new Map<string, string>());
const outgoing = computed(() => fromDraft(draft.value, picks.value));
const field = ref<{ $el: HTMLTextAreaElement } | null>(null);
const form = ref<HTMLElement | null>(null);
useBottomChrome(form);

const over = computed(() => outgoing.value.length > CHAT_BODY_MAX);
const remaining = computed(() => CHAT_BODY_MAX - outgoing.value.length);
const nearLimit = computed(() => outgoing.value.length >= CHAT_BODY_MAX * 0.9);

// ── the @ list ──
const mentions = useChatMentions();
const typed = ref<{ query: string; start: number } | null>(null);
const active = ref(0);
const listId = `chat-mentions-${Math.random().toString(36).slice(2, 8)}`;
const options = computed<MentionCandidate[]>(() => {
  if (!typed.value || !mentions) return [];
  const q = typed.value.query.toLowerCase();
  // Any word of the name: "@ru" finds Ana Ruiz as well as "@an" does.
  return [...mentions.candidates.value]
    .filter((c) => c.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)))
    // Members first: naming somebody already here is the common case; adding somebody is the exception.
    .sort((a, b) => Number(b.member) - Number(a.member) || a.name.localeCompare(b.name))
    .slice(0, 6);
});
const listOpen = computed(() => options.value.length > 0);
function readCaret() {
  const el = field.value?.$el;
  // The element's own value, never `draft`: this listener runs before v-model has written the key just
  // typed, and a caret measured on one text and applied to another put the pick one character off.
  typed.value = el && typeof el.selectionStart === "number" ? mentionQueryAt(el.value, el.selectionStart) : null;
  active.value = 0;
}
async function pick(c: MentionCandidate) {
  const at = typed.value;
  if (!at || !mentions) return;
  typed.value = null;
  if (!c.member && !(await mentions.add(c.user_id))) return;
  const label = mentionLabel(c.name);
  const el = field.value?.$el;
  const end = at.start + 1 + at.query.length;
  draft.value = `${draft.value.slice(0, at.start)}${label} ${draft.value.slice(end)}`;
  picks.value = new Map(picks.value).set(label, c.user_id);
  await nextTick();
  const caret = at.start + label.length + 1;
  el?.focus();
  el?.setSelectionRange(caret, caret);
}

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
watch(() => props.threadKey, () => { draft.value = ""; picks.value = new Map(); typed.value = null; });

function submit() {
  const body = outgoing.value.trim();
  if (!body || over.value) return;
  emit("send", body);
  draft.value = "";
  picks.value = new Map();
  typed.value = null;
  field.value?.$el.focus();
}
function onKey(e: KeyboardEvent) {
  if (listOpen.value && !e.isComposing) {
    const n = options.value.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active.value = (active.value + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      void pick(options.value[active.value]!);
      return;
    }
    if (e.key === "Escape") {
      // The list's Esc only: a thread panel around this field must not close with it.
      e.preventDefault();
      e.stopPropagation();
      typed.value = null;
      return;
    }
  }
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  } else if (e.key === "ArrowUp" && draft.value === "") {
    e.preventDefault();
    emit("up");
  }
}
defineExpose({ focus: () => field.value?.$el.focus() });
</script>

<template>
  <form ref="form" class="shrink-0 px-2 pt-1 pb-2 sm:px-4 sm:pb-3" @submit.prevent="submit">
    <div
      class="relative max-w-3xl rounded-surface bg-surface ring-1 ring-inset focus-within:ring-2"
      :class="over ? 'ring-danger-600 focus-within:ring-danger-600' : 'ring-edge-strong focus-within:ring-focus-ring'"
    >
      <BaseTextarea
        ref="field"
        v-model="draft"
        :rows="1"
        :placeholder="props.placeholder"
        :aria-label="props.label"
        class="min-h-0! resize-none bg-transparent! py-2.5 pr-12 ring-0! focus:ring-0!"
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
        @blur="typed = null"
      />
      <ul
        v-if="listOpen"
        :id="listId"
        role="listbox"
        aria-label="People to mention"
        class="absolute bottom-full left-0 mb-1 w-72 max-w-full overflow-hidden rounded-surface bg-surface py-1 shadow-card ring-1 ring-edge-subtle"
      >
        <!-- mousedown, not click: a click lands after the field's blur has closed the list. -->
        <li
          v-for="(c, i) in options"
          :id="`${listId}-${i}`"
          :key="c.user_id"
          role="option"
          :aria-selected="i === active"
          class="flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm"
          :class="i === active ? 'bg-surface-subtle text-ink' : 'text-ink-secondary'"
          @mousedown.prevent="pick(c)"
          @mousemove="active = i"
        >
          <span class="truncate">{{ c.name }}</span>
          <span v-if="!c.member && mentions?.addLabel.value" class="shrink-0 text-2xs text-ink-tertiary">{{ mentions.addLabel.value }}</span>
        </li>
      </ul>
      <BaseButton type="submit" size="icon" variant="primary" class="absolute right-1.5 bottom-1.5" :aria-label="props.action" :title="props.action" :disabled="!draft.trim() || over">
        <AppIcon :icon="PaperAirplaneIcon" class="size-4" aria-hidden="true" />
      </BaseButton>
    </div>
    <p class="mt-1 flex max-w-3xl justify-between gap-2 text-2xs text-ink-tertiary">
      <span>Enter to send · Shift+Enter for a new line</span>
      <span v-if="nearLimit" class="tabular-nums" :class="over ? 'text-danger-text' : ''" aria-live="polite">
        <template v-if="over">{{ -remaining }} characters too long</template>
        <template v-else>{{ remaining }} left</template>
      </span>
    </p>
  </form>
</template>
