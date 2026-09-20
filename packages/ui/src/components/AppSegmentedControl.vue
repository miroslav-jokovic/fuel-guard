<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { SEGMENTED_IDLE, SEGMENTED_SEGMENT, SEGMENTED_SELECTED, SEGMENTED_WELL } from "../segmentedSurface";

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
 * ── WHAT IT LOOKS LIKE IS NOT DECIDED HERE ────────────────────────────────────────────────────
 * The well, the pill and the idle ink come from `../segmentedSurface`, shared with `AppTabs`
 * (D-DT16). Both files had hand-written the same recipe and drifted — this one's pill carried
 * `shadow-card`, the tab strip's did not — which is what made the de-grey a two-file edit instead
 * of a one-map one. Density stays here: `p-0.5` and `min-h-8`, because a permissions table draws
 * eleven of these per role and four more pixels each is a page taller.
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
    class="inline-grid auto-cols-fr grid-flow-col p-0.5 text-sm"
    :class="[SEGMENTED_WELL, disabled ? 'opacity-60' : '']"
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
      class="min-h-8 whitespace-nowrap disabled:cursor-not-allowed"
      :class="[
        SEGMENTED_SEGMENT,
        option.value === modelValue
          ? inherited
            ? 'text-ink-secondary ring-1 ring-inset ring-edge-strong'
            : SEGMENTED_SELECTED
          : SEGMENTED_IDLE,
      ]"
      :aria-checked="option.value === modelValue"
      :tabindex="index === activeIndex ? 0 : -1"
      :disabled="disabled"
      @click="choose(index)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
