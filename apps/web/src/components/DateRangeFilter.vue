<script setup lang="ts">
import { computed } from "vue";
import { VueDatePicker } from "@vuepic/vue-datepicker";
import { CalendarIcon, XMarkIcon } from "@heroicons/vue/20/solid";

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
const props = withDefaults(defineProps<{ from?: string; to?: string; presets?: boolean; label?: string }>(), {
  from: undefined,
  to: undefined,
  presets: true,
  label: "Dates",
});
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
  <VueDatePicker
    v-model="model"
    :range="{ partialRange: false }"
    model-type="yyyy-MM-dd"
    :enable-time-picker="false"
    :preset-dates="presetDates"
    :max-date="new Date()"
    auto-apply
    teleport
    :aria-labels="{ input: 'Filter by date range' }"
  >
    <template #trigger>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors"
        :class="
          display
            ? 'bg-brand-50/60 text-brand-800 ring-brand-600/30 hover:bg-brand-50'
            : 'bg-surface text-ink-secondary ring-edge-strong hover:bg-surface-subtle'
        "
        :aria-label="display ? `Date filter: ${display}` : 'Filter by date range'"
      >
        <CalendarIcon class="size-4 shrink-0" :class="display ? 'text-brand-600' : 'text-ink-subtle'" aria-hidden="true" />
        {{ display ?? label }}
        <span
          v-if="display"
          class="-mr-0.5 rounded p-0.5 text-brand-700/70 hover:bg-brand-100 hover:text-brand-800"
          role="button"
          aria-label="Clear date filter"
          @click.stop="clear"
        >
          <XMarkIcon class="size-3.5" aria-hidden="true" />
        </span>
      </button>
    </template>
  </VueDatePicker>
</template>
