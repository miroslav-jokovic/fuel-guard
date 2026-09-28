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
     * `touch` makes each choice a 44 CSS px row — the target APPLICATION-FLOW-V2-PLAN.md §6.8 sets for
     * `/apply`, as `AppButton`'s `touch` does. `default` is 36. Added 2026-09-27 (C3c2b), when the
     * application's employer questions became Yes/No choices pressed by a thumb. The row grows by
     * padding (12 + a 20px line + 12 = 44): a one-line choice sits in the middle of it, and a wrapped
     * one stays aligned to its first line (`items-start`, `AppCheckbox`'s measured reasoning). Measured
     * at 390px: `min-h-11` alone left each radio at the top of its row with 24px of nothing under it.
     */
    size?: "default" | "touch";
  }>(),
  { modelValue: undefined, name: undefined, disabled: false, size: "default" },
);
const emit = defineEmits<{ "update:modelValue": [value: RadioValue] }>();
const generatedName = `radio-${useId()}`;
/** Inside a thumb-pressed layout (`touchTargets.ts`) every choice is `touch`, asked or not. */
const touchTargets = useTouchTargets();
const touch = computed(() => touchTargets || props.size === "touch");
</script>

<template>
  <fieldset class="space-y-1.5" :disabled="disabled">
    <legend class="text-sm font-medium text-ink-secondary">{{ legend }}</legend>
    <label
      v-for="option in options"
      :key="String(option.value)"
      class="flex items-start gap-2 text-sm text-ink-secondary"
      :class="[touch ? 'min-h-11 py-3' : 'min-h-9', option.disabled && 'cursor-not-allowed opacity-60']"
    >
      <input
        type="radio"
        :name="name ?? generatedName"
        :value="String(option.value)"
        :checked="modelValue === option.value"
        :disabled="option.disabled"
        class="mt-0.5 size-4 border-edge-control accent-action-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        @change="emit('update:modelValue', option.value)"
      />
      <span>
        <span class="block">{{ option.label }}</span>
        <span v-if="option.description" class="block text-xs text-ink-tertiary">{{
          option.description
        }}</span>
      </span>
    </label>
  </fieldset>
</template>
