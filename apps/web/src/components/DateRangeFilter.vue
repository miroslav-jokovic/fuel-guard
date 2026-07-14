<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { VueDatePicker } from "@vuepic/vue-datepicker";
import { CalendarIcon, XMarkIcon } from "@heroicons/vue/20/solid";

/**
 * From/To date range on VueDatePicker (themed via the --dp-* token block in
 * style.css). Renders as a compact toolbar trigger — "Dates ▾" when idle,
 * "Jul 1 – Jul 13 ✕" with a brand tint when active — matching FilterSelect.
 * External API: v-model:from / v-model:to, values are "YYYY-MM-DD" strings.
 * Partial ranges are allowed — picking a single day filters on just that
 * date. Quick presets live in the picker's sidebar.
 */
const props = withDefaults(defineProps<{ from?: string; to?: string; presets?: boolean; label?: string }>(), {
  from: undefined,
  to: undefined,
  presets: true,
  label: "Dates",
});
const emit = defineEmits<{ "update:from": [v: string | undefined]; "update:to": [v: string | undefined] }>();

/** Local-safe YYYY-MM-DD. */
const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const parseYmd = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
};

/**
 * Local ref holds the picker's in-progress selection.
 * NOT a computed — avoids the reactivity cascade where mid-range emissions
 * update parent props → getter re-evaluates → new array fed back to
 * VueDatePicker → picker resets and closes after the first date click.
 */
const localDates = ref<Date[] | null>(null);

watch(
  () => [props.from, props.to] as const,
  ([f, t]) => {
    if (f && t) localDates.value = [parseYmd(f), parseYmd(t)];
    else if (f) localDates.value = [parseYmd(f)];
    else localDates.value = null;
  },
  { immediate: true },
);

function onUpdate(v: Date[] | null) {
  localDates.value = v;
  if (!v || !v.length) {
    emit("update:from", undefined);
    emit("update:to", undefined);
  } else if (v.length >= 2 && v[0] && v[1]) {
    emit("update:from", ymd(v[0]));
    emit("update:to", ymd(v[1]));
  }
  // length === 1 → start picked, waiting for end — keep picker open, no parent emit
}

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
const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const display = computed(() => {
  if (props.from && props.to && props.from !== props.to)
    return `${fmtDay(parseYmd(props.from))} – ${fmtDay(parseYmd(props.to))}`;
  const one = props.from ?? props.to;
  return one ? fmtDay(parseYmd(one)) : null;
});

function clear() {
  localDates.value = null;
  emit("update:from", undefined);
  emit("update:to", undefined);
}
</script>

<template>
  <VueDatePicker
    :model-value="localDates"
    range
    :enable-time-picker="false"
    :preset-dates="presetDates"
    :max-date="new Date()"
    :multi-calendars="{ solo: false }"
    auto-apply
    teleport
    :aria-labels="{ input: 'Filter by date range' }"
    @update:model-value="onUpdate"
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
