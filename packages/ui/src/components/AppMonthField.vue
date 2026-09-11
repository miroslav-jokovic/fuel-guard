<script setup lang="ts">
import DatePickerBase from "./DatePickerBase.vue";

/**
 * A month, on the wire as `yyyy-MM` (APPLY-EXPERIENCE-PLAN D-AX4).
 *
 * ── WHY A PRODUCT THAT ALREADY HAS A DATE FIELD NEEDED THIS ───────────────────────────────────
 * §391.21(b)(3) asks where an applicant has lived, and (b)(6) what equipment they have driven —
 * both over PERIODS, and both stored as `yyyy-MM`. Until this existed, those five fields were
 * `AppInput` boxes with `placeholder="2024-03"` and a `/^\d{4}-\d{2}$/` regex behind them, so
 * `March 2024`, `3/24`, `03-2024` and `2024-3` were all refused — by a validation summary at the
 * top of the page that named the field `addresses` and left the driver to work out that the month
 * needed a leading zero. Meanwhile the employer dates two screens away offered a calendar.
 *
 * The implementation and the reasoning are in `DatePickerBase.vue`; this is the month-shaped half of
 * it, and its props are `AppDateField`'s so no caller has to learn a second control.
 *
 * ⚠ `minDate`/`maxDate` are still `yyyy-MM-dd`, deliberately: they are passed straight through to
 * the calendar, which bounds by day whatever grid it is showing. A caller bounding a month field
 * writes the first or last day of the month it means.
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
    month-only
    :model-value="modelValue"
    :invalid="invalid"
    :disabled="disabled"
    :min-date="minDate"
    :max-date="maxDate"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
