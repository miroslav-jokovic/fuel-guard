<script setup lang="ts">
import { useId } from "vue";

export type RadioValue = string | number;
export interface RadioOption {
  value: RadioValue;
  label: string;
  description?: string;
  disabled?: boolean;
}

withDefaults(
  defineProps<{
    modelValue?: RadioValue;
    options: RadioOption[];
    legend: string;
    name?: string;
    disabled?: boolean;
  }>(),
  { modelValue: undefined, name: undefined, disabled: false },
);
const emit = defineEmits<{ "update:modelValue": [value: RadioValue] }>();
const generatedName = `radio-${useId()}`;
</script>

<template>
  <fieldset class="space-y-1.5" :disabled="disabled">
    <legend class="text-sm font-medium text-ink-secondary">{{ legend }}</legend>
    <label
      v-for="option in options"
      :key="String(option.value)"
      class="flex min-h-9 items-start gap-2 text-sm text-ink-secondary"
      :class="option.disabled && 'cursor-not-allowed opacity-60'"
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
