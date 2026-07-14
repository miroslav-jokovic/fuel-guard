<script setup lang="ts">
import { computed } from "vue";
import { VueDatePicker } from "@vuepic/vue-datepicker";

/**
 * From/To date range on VueDatePicker (see docs/DESIGN-SYSTEM.md — themed via
 * the --dp-* token block in style.css). External API is unchanged: use with
 * v-model:from and v-model:to; values are "YYYY-MM-DD" strings.
 * Partial ranges are allowed — picking a single day (or the same day twice)
 * filters on just that date. Quick presets live in the picker's sidebar.
 */
const props = withDefaults(defineProps<{ from?: string; to?: string; presets?: boolean }>(), {
  from: undefined,
  to: undefined,
  presets: true,
});
const emit = defineEmits<{ "update:from": [v: string | undefined]; "update:to": [v: string | undefined] }>();

/** Local-safe YYYY-MM-DD (toISOString would shift across the UTC boundary). */
const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const model = computed<string[] | null>({
  get: () => (props.from || props.to ? [props.from, props.to].filter((v): v is string => !!v) : null),
  set: (v) => {
    emit("update:from", v?.[0] ?? undefined);
    emit("update:to", v?.[1] ?? v?.[0] ?? undefined);
  },
});

const lastDays = (n: number): [Date, Date] => {
  const end = new Date();
  const start = new Date(end.getTime() - n * 86400_000);
  return [start, end];
};
const presetDates = computed(() =>
  props.presets
    ? [
        { label: "Today", value: [new Date(), new Date()] },
        { label: "Last 7 days", value: lastDays(7) },
        { label: "Last 30 days", value: lastDays(30) },
        { label: "Last 90 days", value: lastDays(90) },
      ]
    : [],
);

// Display like "Jul 1 – Jul 13, 2026" in the input.
const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const previewFormat = (dates: Date | Date[]): string => {
  const arr = Array.isArray(dates) ? dates : [dates];
  const [a, b] = arr;
  if (a && b && ymd(a) !== ymd(b)) return `${fmt(a)} – ${fmt(b)}, ${b.getFullYear()}`;
  return a ? `${fmt(a)}, ${a.getFullYear()}` : "";
};
</script>

<template>
  <VueDatePicker
    v-model="model"
    :range="{ partialRange: true }"
    model-type="yyyy-MM-dd"
    :enable-time-picker="false"
    :preset-dates="presetDates"
    :format="previewFormat"
    :max-date="new Date()"
    auto-apply
    clearable
    teleport
    placeholder="All dates"
    :aria-labels="{ input: 'Filter by date range' }"
    class="w-full sm:w-64"
  />
</template>
