<script setup lang="ts">
import { AppIcon } from "@silvicom/ui";
import {
  CalendarIcon,
  XMarkIcon,
} from "@silvicom/ui/icons";
import { computed } from "vue";
import { VueDatePicker } from "@vuepic/vue-datepicker";

/**
 * From/To date range on VueDatePicker (themed via the --dp-* token block in
 * style.css). Renders as a compact toolbar trigger — "Dates ▾" when idle,
 * "Jul 1 – Jul 13 ✕" with a brand tint when active — matching FilterSelect.
 * External API: v-model:from / v-model:to, values are "YYYY-MM-DD" strings.
 * Range mode: pick a start then an end date (auto-applies once both are set).
 * For a single day, click the same date twice. Quick presets live in the sidebar.
 * NOTE: partialRange MUST stay false — with auto-apply, partialRange:true makes the
 * first click a valid (single-date) selection that applies + closes the menu, so a
 * range can never be picked (vue-datepicker modes-configuration docs).
 */
const props = withDefaults(
  defineProps<{
    from?: string;
    to?: string;
    presets?: boolean;
    label?: string;
    maxDate?: Date | null;
  }>(),
  {
    from: undefined,
    to: undefined,
    presets: true,
    label: "Dates",
    maxDate: () => new Date(),
  },
);
const emit = defineEmits<{ "update:from": [v: string | undefined]; "update:to": [v: string | undefined] }>();

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
/**
 * The last COMPLETE Monday-to-Sunday week.
 *
 * "Last 7 days" is a rolling window and answers a different question: it straddles two weekends and
 * cannot be compared with the seven days before it. A weekly report is read against the week before it,
 * so the period has to be a calendar week — and it has to be a FINISHED one, or a Tuesday's report
 * covers two days and reads as a collapse in everything.
 */
const lastCompleteWeek = (): [Date, Date] => {
  const now = new Date();
  const backToMonday = (now.getDay() + 6) % 7; // 0 = Monday
  const end = new Date(now);
  end.setDate(now.getDate() - backToMonday - 1); // yesterday's Sunday
  const start = new Date(end);
  start.setDate(end.getDate() - 6);
  return [start, end];
};

const presetDates = computed(() =>
  props.presets
    ? [
        { label: "Today", value: [new Date(), new Date()] },
        { label: "Last week", value: lastCompleteWeek() },
        { label: "Last 7 days", value: lastDays(7) },
        { label: "Last 30 days", value: lastDays(30) },
        { label: "Last 90 days", value: lastDays(90) },
      ]
    : [],
);

/* Trigger label, e.g. "Jul 1 – Jul 13" / "Jul 13" */
const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const display = computed(() => {
  if (props.from && props.to && props.from !== props.to) return `${fmtDay(props.from)} – ${fmtDay(props.to)}`;
  const one = props.from ?? props.to;
  return one ? fmtDay(one) : null;
});

function clear() {
  emit("update:from", undefined);
  emit("update:to", undefined);
}
</script>

<template>
  <div class="inline-flex items-center gap-1">
    <!-- `time-config`, not `enable-time-picker`: v14 regrouped the flat props, and a stale one is
         accepted as a plain HTML attribute rather than refused — this carried the pre-bump name,
         which landed on the root div and did nothing. Same class of silent break as the `--dp-*`
         theme block, which had stopped matching for the same reason (D-DS17). -->
    <VueDatePicker
      v-model="model"
      :range="{ partialRange: false }"
      model-type="yyyy-MM-dd"
      :time-config="{ enableTimePicker: false }"
      :preset-dates="presetDates"
      :max-date="maxDate || undefined"
      auto-apply
      teleport
      :aria-labels="{ input: 'Filter by date range' }"
    >
      <template #trigger>
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-control px-2.5 text-sm font-medium ring-1 ring-inset transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          :class="
            display
              ? 'bg-brand-50/60 text-brand-800 ring-edge hover:bg-brand-50'
              : 'bg-surface text-ink-secondary ring-edge hover:bg-surface-subtle'
          "
          :aria-label="display ? `Date filter: ${display}` : 'Filter by date range'"
        >
          <AppIcon :icon="CalendarIcon" class="size-4 shrink-0" :class="display ? 'text-brand-600' : 'text-ink-tertiary'" aria-hidden="true" />
          {{ display ?? label }}
        </button>
      </template>
    </VueDatePicker>
    <button
      v-if="display"
      type="button"
      class="inline-flex size-8 items-center justify-center rounded-control text-brand-700 ring-1 ring-inset ring-edge hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      aria-label="Clear date filter"
      @click="clear"
    >
      <AppIcon :icon="XMarkIcon" class="size-4" aria-hidden="true" />
    </button>
  </div>
</template>
