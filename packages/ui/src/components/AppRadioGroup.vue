<script setup lang="ts">
import { computed, useId } from "vue";
import { useTouchTargets } from "../touchTargets";

export type RadioValue = string | number;
export interface RadioOption {
  value: RadioValue;
  label: string;
  description?: string;
  disabled?: boolean;
}

const props = withDefaults(
  defineProps<{
    modelValue?: RadioValue;
    options: RadioOption[];
    legend: string;
    name?: string;
    disabled?: boolean;
    /**
     * `touch` makes each choice a 48 CSS px row — the target APPLICATION-FLOW-V2-PLAN.md §6.8 sets for
     * `/apply`, as `AppButton`'s `touch` does. `default` is 36. Added 2026-09-27 (C3c2b), when the
     * application's employer questions became Yes/No choices pressed by a thumb. The row grows by
     * padding (14 + a 20px line + 14 = 48): a one-line choice sits in the middle of it, and a wrapped
     * one stays aligned to its first line (`items-start`, `AppCheckbox`'s measured reasoning). Measured
     * at 390px: `min-h-11` alone left each radio at the top of its row with 24px of nothing under it.
     */
    size?: "default" | "touch";
    /**
     * `cards` draws each choice as a bordered block the whole of which is the target, filled when chosen
     * — the applicant's Yes and No (APPLICATION-FIX-PLAN U3: "two big buttons, never a checkbox"). Still
     * radios underneath, so the keyboard, a screen reader and a form read it exactly as the list.
     */
    variant?: "list" | "cards";
    /** `cards` side by side — two short answers share a phone's width. */
    columns?: 1 | 2;
  }>(),
  { modelValue: undefined, name: undefined, disabled: false, size: "default", variant: "list", columns: 1 },
);
const emit = defineEmits<{
  "update:modelValue": [value: RadioValue];
  /**
   * A choice was TAPPED or clicked — not reached with the keyboard. For a page that moves on when a
   * question is answered (U3): arrowing through the choices must never do that, and a browser reports an
   * arrow key (and Space) on a radio as a click on it. So the radio remembers a key going down and its
   * click is then not a pick. Listened for on the radio itself, which a tap on its label also clicks.
   * Fired after the model has changed. Tapping the choice already chosen fires it too.
   */
  pick: [value: RadioValue];
}>();
/**
 * ⚠ Cleared on key UP, never on blur: an arrow key moves focus to the next radio BEFORE the browser
 * clicks it, so a blur would forget the key just in time to call the click a tap.
 */
const keys = { down: false };
const keyDown = (): void => { keys.down = true; };
const keyUp = (): void => { keys.down = false; };
function tapped(option: RadioOption): void {
  if (keys.down || option.disabled || props.disabled) return;
  setTimeout(() => emit("pick", option.value), 0);
}
const generatedName = `radio-${useId()}`;
/** Inside a thumb-pressed layout (`touchTargets.ts`) every choice is `touch`, asked or not. */
const touchTargets = useTouchTargets();
const touch = computed(() => touchTargets.value || props.size === "touch");
</script>

<template>
  <fieldset class="space-y-1.5" :disabled="disabled">
    <legend class="text-sm font-medium text-ink-secondary">{{ legend }}</legend>
    <div :class="variant === 'cards' ? ['grid gap-3', columns === 2 ? 'grid-cols-2' : 'grid-cols-1'] : 'space-y-1.5'">
    <label
      v-for="option in options"
      :key="String(option.value)"
      class="flex gap-2 text-sm"
      :class="[
        variant === 'cards'
          ? 'min-h-14 cursor-pointer items-center rounded-surface bg-surface px-4 py-3 text-base font-medium text-ink ring-1 ring-inset ring-edge-control has-[:checked]:bg-surface-muted has-[:checked]:ring-2 has-[:checked]:ring-action-primary'
          : ['items-start text-ink-secondary', touch ? 'min-h-12 py-3.5' : 'min-h-9'],
        option.disabled && 'cursor-not-allowed opacity-60',
      ]"
    >
      <input
        type="radio"
        :name="name ?? generatedName"
        :value="String(option.value)"
        :checked="modelValue === option.value"
        :disabled="option.disabled"
        :class="variant === 'cards' ? '' : 'mt-0.5'"
        class="size-4 border-edge-control accent-action-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        @change="emit('update:modelValue', option.value)"
        @keydown="keyDown"
        @keyup="keyUp"
        @click="tapped(option)"
      />
      <span>
        <span class="block">{{ option.label }}</span>
        <span v-if="option.description" class="block text-xs text-ink-tertiary">{{
          option.description
        }}</span>
      </span>
    </label>
    </div>
  </fieldset>
</template>
