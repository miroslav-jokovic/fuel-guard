<script setup lang="ts">
import { computed } from "vue";
import { AppIconButton, AppSegmentedControl, type SegmentOption } from "@silvicom/ui";
import { ChevronLeftIcon, ChevronRightIcon } from "@silvicom/ui/icons";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import {
  canStepForward,
  periodAtGrain,
  periodForCustom,
  periodLabel,
  stepPeriod,
  type PeriodGrain,
  type ReportPeriod,
} from "@/lib/reportPeriod";

/**
 * The period rail — one clock for the whole Finance section (D-FRUI1).
 *
 * It sits above the tabs and every tab, the trend and the export read the period it holds. Before
 * it existed the month picker lived inside the table toolbar, which only two of the four tabs
 * rendered, so a reader on the Overview could not change the month at all; and it was a day-range
 * picker on a report whose money is a whole-month fact, offering a precision the figures could not
 * honour (measured 2026-09-04, FLEET-REPORT-UI-PLAN §0).
 *
 * Composed from primitives that already exist rather than a new date widget (D-FRUI9): two icon
 * buttons for the stepper, the segmented control for the grain, and the section's own
 * `DateRangeFilter` for a custom run of months, snapped to whole months on the way in. Stepping
 * forward stops at `cap`, the latest month the calendar allows; whether that month is REPORTABLE
 * is the page's question (G11), answered in its own callout, not hidden behind a disabled arrow.
 */

const props = defineProps<{
  modelValue: ReportPeriod;
  /** The latest month key (`YYYY-MM`) the rail may step forward to. */
  cap: string;
}>();
const emit = defineEmits<{ "update:modelValue": [period: ReportPeriod] }>();

const GRAINS: readonly SegmentOption[] = [
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "ytd", label: "Year to date" },
  { value: "custom", label: "Custom" },
];

const label = computed(() => periodLabel(props.modelValue));
const forward = computed(() => canStepForward(props.modelValue, props.cap));
const stepping = computed(() => props.modelValue.grain !== "custom");
const stepNoun = computed(() =>
  props.modelValue.grain === "quarter" ? "quarter" : props.modelValue.grain === "ytd" ? "end month" : "month",
);

function step(by: -1 | 1) {
  if (by === 1 && !forward.value) return;
  emit("update:modelValue", stepPeriod(props.modelValue, by));
}
function setGrain(grain: string) {
  emit("update:modelValue", periodAtGrain(props.modelValue, grain as PeriodGrain));
}
function setCustom(from: string | undefined, to: string | undefined) {
  emit("update:modelValue", periodForCustom(from ?? props.modelValue.from, to ?? props.modelValue.to));
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-3 rounded-surface bg-surface px-3 py-2 shadow-card ring-1 ring-inset ring-edge">
    <div class="inline-flex items-center rounded-control ring-1 ring-inset ring-edge-control">
      <AppIconButton
        :icon="ChevronLeftIcon"
        :label="`Previous ${stepNoun}`"
        size="sm"
        :disabled="!stepping"
        @click="step(-1)"
      />
      <span class="min-w-32 px-2 text-center text-sm font-semibold text-ink" aria-live="polite">{{ label }}</span>
      <AppIconButton
        :icon="ChevronRightIcon"
        :label="`Next ${stepNoun}`"
        size="sm"
        :disabled="!stepping || !forward"
        @click="step(1)"
      />
    </div>

    <AppSegmentedControl :model-value="modelValue.grain" :options="GRAINS" label="Period" @update:model-value="setGrain" />

    <DateRangeFilter
      v-if="modelValue.grain === 'custom'"
      :from="modelValue.from"
      :to="modelValue.to"
      :presets="false"
      label="Months"
      @update:from="(v) => setCustom(v, undefined)"
      @update:to="(v) => setCustom(undefined, v)"
    />

    <div v-if="$slots.default" class="ml-auto flex items-center gap-2">
      <slot />
    </div>
  </div>
</template>
