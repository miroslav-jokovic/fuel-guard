<script setup lang="ts">
import AppDateField from "./AppDateField.vue";

export interface DateRangeValue {
  start: string;
  end: string;
}

const props = defineProps<{ modelValue: DateRangeValue; disabled?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: DateRangeValue] }>();
</script>

<template>
  <fieldset class="grid gap-2 sm:grid-cols-2" :disabled="disabled">
    <legend class="sr-only">Date range</legend>
    <label class="text-sm text-ink-secondary">
      <span class="mb-1 block font-medium">Start date</span>
      <AppDateField
        :model-value="modelValue.start"
        :max="modelValue.end || undefined"
        @update:model-value="emit('update:modelValue', { ...props.modelValue, start: $event })"
      />
    </label>
    <label class="text-sm text-ink-secondary">
      <span class="mb-1 block font-medium">End date</span>
      <AppDateField
        :model-value="modelValue.end"
        :min="modelValue.start || undefined"
        @update:model-value="emit('update:modelValue', { ...props.modelValue, end: $event })"
      />
    </label>
  </fieldset>
</template>
