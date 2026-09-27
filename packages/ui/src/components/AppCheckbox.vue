<script setup lang="ts">
/**
 * The checkbox (D-DS). Its ROOT IS A BLOCK-LEVEL FLEX, which is the whole point of this comment.
 *
 * It shipped as `inline-flex`, and that quietly broke every stacked list of options in the app:
 *  · inline-level siblings share a line whenever they fit, so three options read as one run-on
 *    sentence at one window width and as three rows at another — which is exactly how it was
 *    reported on the placard calculator's "What the BOL declares" block;
 *  · vertical margins do not apply to inline-level boxes, so `space-y-*` on the wrapper did
 *    NOTHING. The gap those lists appeared to have was line-height, not the spacing anyone wrote.
 *
 * Blockifying is safe for the other callers by construction: every remaining call site puts the
 * checkbox in a `flex` or `grid` parent, and flex and grid items are blockified regardless of their
 * own `display`. A survey of all 30 files that use this component found none that need it to sit
 * inline inside running text.
 *
 * The box aligns to the FIRST LINE rather than to the middle of a wrapped label — `items-start`
 * plus a 2px nudge.
 *
 * ── WHY 2px AND NOT 10px (measured 2026-09-02) ─────────────────────────────────────────────────
 * This carried `mt-2.5` (10px) and the comment justifying it reasoned from the wrong box: it took
 * where `min-h-9 items-center` had put the checkbox — centred in the 36px ROW — and kept that
 * offset after switching to `items-start`. But `items-start` moves the LABEL to the top of the row
 * too, so the box was being aligned against a position the text no longer occupies. The result was
 * a checkbox sitting 8px below its own label on every page that stacks options.
 *
 * Measured in the design-system lab rather than derived: label first line top 1px, height 18px, so
 * its centre is at 10px; a 16px box must therefore start at 2px. Confirmed 0px on all three lab
 * variants — checked, unchecked, and a label that wraps.
 *
 * ⚠ `min-h-9` stays and is not dead space: it is the 36px touch target, and with `items-start` the
 * content sits at the top of it rather than floating in the middle, which is what a wrapped label
 * needs. Removing it shrinks every option row below the tap minimum.
 *
 * `size="touch"` makes that row 44px — the target APPLICATION-FLOW-V2-PLAN.md §6.8 sets for `/apply`,
 * as `AppButton`'s and `AppRadioGroup`'s `touch` do — by padding, so the 2px alignment above still
 * holds and a one-line label sits in the middle of the row. Added 2026-09-27
 * (C3c2b) for the application's job panel, where "I drove a commercial vehicle" sits among 44px
 * Yes/No rows.
 */
defineOptions({ inheritAttrs: false });
withDefaults(
  defineProps<{ modelValue?: boolean; label?: string; disabled?: boolean; size?: "default" | "touch" }>(),
  { modelValue: false, label: undefined, disabled: false, size: "default" },
);
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
</script>

<template>
  <label class="flex items-start gap-2 text-sm text-ink-secondary" :class="size === 'touch' ? 'min-h-11 py-3' : 'min-h-9'">
    <input
      v-bind="$attrs"
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      class="mt-0.5 size-4 shrink-0 rounded-detail border-edge-control accent-action-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span v-if="label"
      ><slot>{{ label }}</slot></span
    >
    <slot v-else />
  </label>
</template>
