<script setup lang="ts">
import DatePickerBase from "./DatePickerBase.vue";

/**
 * A single date, on the wire as `yyyy-MM-dd`.
 *
 * The implementation and the reasoning are in `DatePickerBase.vue`; this is the date-shaped half of
 * it. Props are unchanged from the `<input type="date">` version it replaces, so no caller moved.
 */
withDefaults(
  defineProps<{
    modelValue?: string | null;
    invalid?: boolean;
    disabled?: boolean;
    minDate?: string | null;
    maxDate?: string | null;
  }>(),
  { modelValue: "", invalid: false, disabled: false, minDate: null, maxDate: null },
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
  <DatePickerBase
    :model-value="modelValue"
    :invalid="invalid"
    :disabled="disabled"
    :min-date="minDate"
    :max-date="maxDate"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
