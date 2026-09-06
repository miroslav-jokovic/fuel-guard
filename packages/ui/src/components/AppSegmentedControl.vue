<script setup lang="ts">
import { computed, ref, watch } from "vue";

/**
 * A segmented control — one answer from a short, fixed set, all of it visible at once.
 *
 * ── WHY NOT A SELECT ──────────────────────────────────────────────────────────────────────────
 * A `<select>` hides every option but the chosen one, costs two interactions, and on a phone opens a
 * native sheet over the page. For a question with three known answers that an admin repeats eleven
 * times per role — None / View / Manage — that is the wrong shape: the eye should read the current
 * answer AND the alternatives in one glance, and one tap should change it. The permissions page is
 * the first caller; a status filter with three or four fixed values is the next.
 *
 * ── WHAT IT IS TO A SCREEN READER ─────────────────────────────────────────────────────────────
 * A radio group. `role="radiogroup"` with one `role="radio"` per option, `aria-checked` on the
 * chosen one, a ROVING TABINDEX so exactly one segment is in the page's tab order, and Left/Right
 * (Home/End) moving the selection — the same contract `AppTabs` keeps, because both are "pick one of
 * these" and a keyboard user should not have to learn two.
 *
 * `inherited` draws the chosen segment outlined rather than filled. It exists for a layered answer
 * — a person's cell that is FOLLOWING their role rather than holding its own value — so the page
 * can show what the answer currently is without claiming this control decided it. Choosing any
 * segment, the outlined one included, is a real answer and emits.
 */
export interface SegmentOption {
  value: string;
  label: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: readonly SegmentOption[];
    /**
     * Names the group for a screen reader — required, because three bare words say nothing about
     * what is being answered. (Called `label`, not `ariaLabel`, for `AppTabs`'s reason.)
     */
    label: string;
    disabled?: boolean;
    /** The chosen value comes from elsewhere and is shown, not held — outlined, not filled. */
    inherited?: boolean;
  }>(),
  { disabled: false, inherited: false },
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const buttons = ref<HTMLButtonElement[]>([]);
const activeIndex = computed(() =>
  Math.max(0, props.options.findIndex((o) => o.value === props.modelValue)),
);

watch(
  () => props.options.length,
  () => {
    buttons.value = buttons.value.slice(0, props.options.length);
  },
);

function choose(index: number, focus = false): void {
  const option = props.options[index];
  if (!option || props.disabled) return;
  emit("update:modelValue", option.value);
  if (focus) void buttons.value[index]?.focus();
}

function onKey(event: KeyboardEvent): void {
  const last = props.options.length - 1;
  const i = activeIndex.value;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
      choose(i === last ? 0 : i + 1, true);
      break;
    case "ArrowLeft":
    case "ArrowUp":
      choose(i === 0 ? last : i - 1, true);
      break;
    case "Home":
      choose(0, true);
      break;
    case "End":
      choose(last, true);
      break;
    default:
      return;
  }
  event.preventDefault();
}
</script>

<template>
  <div
    class="inline-grid auto-cols-fr grid-flow-col rounded-surface bg-surface-muted p-0.5 text-sm"
    :class="disabled ? 'opacity-60' : ''"
    role="radiogroup"
    :aria-label="label"
    :aria-disabled="disabled || undefined"
    @keydown="onKey"
  >
    <button
      v-for="(option, index) in options"
      :key="option.value"
      ref="buttons"
      type="button"
      role="radio"
      class="min-h-8 rounded-control px-3 font-medium whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed"
      :class="
        option.value === modelValue
          ? inherited
            ? 'text-ink-secondary ring-1 ring-inset ring-edge-strong'
            : 'bg-surface text-ink shadow-card'
          : 'text-ink-muted hover:text-ink-secondary'
      "
      :aria-checked="option.value === modelValue"
      :tabindex="index === activeIndex ? 0 : -1"
      :disabled="disabled"
      @click="choose(index)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
