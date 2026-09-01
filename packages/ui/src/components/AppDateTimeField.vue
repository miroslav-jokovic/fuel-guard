<script setup lang="ts">
import DatePickerBase from "./DatePickerBase.vue";

/**
 * A date and a time, on the wire as `yyyy-MM-dd'T'HH:mm` — the same string `<input
 * type="datetime-local">` produced, so `FillUpForm` and `LoadDeclarationCard` are untouched.
 *
 * It moved with `AppDateField` rather than after it on purpose: leaving one of the two on a native
 * control would have put a browser-drawn field beside a tokened one, which is the exact complaint
 * that started this (D-DS17).
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
    with-time
    :model-value="modelValue"
    :invalid="invalid"
    :disabled="disabled"
    :min-date="minDate"
    :max-date="maxDate"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
