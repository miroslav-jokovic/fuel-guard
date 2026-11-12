import { computed, nextTick, ref, type Ref } from "vue";
import { fromDraft, mentionLabel, mentionQueryAt } from "./mentionDraft";
import { useMentions, type MentionCandidate, type MentionContext } from "./mentionNames";

/**
 * The `@` list of a text field (D-CHAT22, Q-CHAT20 (a)), for any composer under a `provideMentions`:
 * chat's box since CH6b-2, a unit's note composer since UN7 (UNIT-NOTES-PLAN D-UN8). Promoted out of
 * `ChatComposer.vue` at UN4 so the two composers share one behaviour rather than two copies.
 *
 * Up and Down move, Enter or Tab picks, Esc closes, and while the list is open those keys are the
 * list's (`onListKey` answers true), not the caller's Send or anything else. A pick writes `@Name` into
 * the field and is remembered; `outgoing` is the draft with every remembered label turned into its
 * `<@id>` token (`mentionDraft.ts`), so a caller's limit counts what is sent. A candidate who is not a
 * member yet is added first, and is not named at all when that is refused.
 */
export function useMentionTypeahead(opts: {
  field: Ref<{ $el: HTMLTextAreaElement } | null>;
  draft: Ref<string>;
  /** The listbox's id prefix; each option is `<id>-<index>` for `aria-activedescendant`. */
  idPrefix: string;
  /**
   * Whom the `@` may name, given directly, for a composer that IS the surface knowing the answer — a
   * unit's notes name the whole office (D-UN8), which the note composer reads itself. A component
   * cannot inject what it provides, so without this a provider would have to sit one level above.
   * Absent: the nearest `provideMentions` (chat's stages).
   */
  mentions?: MentionContext;
}) {
  const { field, draft } = opts;
  const mentions = opts.mentions ?? useMentions();
  const picks = ref(new Map<string, string>());
  const outgoing = computed(() => fromDraft(draft.value, picks.value));
  const typed = ref<{ query: string; start: number } | null>(null);
  const active = ref(0);
  const listId = `${opts.idPrefix}-${Math.random().toString(36).slice(2, 8)}`;
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
  const addLabel = computed(() => mentions?.addLabel.value ?? null);

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
  /** The list's keys while it is open; true when the key was the list's and the caller must not act on it. */
  function onListKey(e: KeyboardEvent): boolean {
    if (!listOpen.value || e.isComposing) return false;
    const n = options.value.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active.value = (active.value + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      void pick(options.value[active.value]!);
      return true;
    }
    if (e.key === "Escape") {
      // The list's Esc only: a panel or drawer around this field must not close with it.
      e.preventDefault();
      e.stopPropagation();
      typed.value = null;
      return true;
    }
    return false;
  }
  function close() {
    typed.value = null;
  }
  /** A new draft: nothing remembered, no list open. */
  function reset() {
    picks.value = new Map();
    typed.value = null;
  }

  return { mentions, outgoing, active, listId, options, listOpen, addLabel, readCaret, pick, onListKey, close, reset };
}
