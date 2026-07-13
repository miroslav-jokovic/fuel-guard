<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { CheckCircleIcon } from "@heroicons/vue/24/outline";
import BaseCard from "@/components/ui/BaseCard.vue";
import { viz } from "./chartTheme";

const props = defineProps<{
  severity: Record<"critical" | "high" | "medium" | "low", number>;
}>();

const ORDER = ["critical", "high", "medium", "low"] as const;

const total = computed(() => ORDER.reduce((sum, k) => sum + props.severity[k], 0));

const rows = computed(() =>
  ORDER.map((key) => ({
    key,
    count: props.severity[key],
    pct: total.value === 0 ? 0 : (props.severity[key] / total.value) * 100,
    color: viz.severity[key],
  })),
);

const segments = computed(() => rows.value.filter((r) => r.count > 0));

// Style objects built in script — colors are token-resolved via viz.*, never literals.
const segStyle = (seg: { pct: number; color: string }) => ({
  width: `${seg.pct}%`,
  backgroundColor: seg.color,
  minWidth: "6px",
});
const dotStyle = (row: { color: string }) => ({ backgroundColor: row.color });
</script>

<template>
  <BaseCard class="flex h-full flex-col">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-sm font-semibold text-ink">Open cases by severity</h3>
      <RouterLink
        to="/anomalies"
        class="rounded-md px-1.5 py-0.5 text-xs font-medium text-brand-600 hover:text-brand-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        View all →
      </RouterLink>
    </div>

    <div v-if="total === 0" class="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
      <CheckCircleIcon class="size-8 text-success-500" aria-hidden="true" />
      <p class="text-sm font-medium text-ink">No open cases</p>
      <p class="text-xs text-ink-muted">Nothing needs your attention in this period.</p>
    </div>

    <template v-else>
      <!-- Stacked meter: 2px surface gaps separate segments; the labeled rows below carry the values. -->
      <div class="mt-4 flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" :aria-label="`${total} open cases by severity`">
        <div
          v-for="seg in segments"
          :key="seg.key"
          class="h-full rounded-[2px] first:rounded-l-full last:rounded-r-full"
          :style="segStyle(seg)"
        />
      </div>

      <ul class="mt-4 divide-y divide-edge-subtle">
        <li v-for="row in rows" :key="row.key" class="flex items-center justify-between py-2 text-sm">
          <span class="inline-flex items-center gap-2">
            <span class="size-2.5 rounded-full" :style="dotStyle(row)" aria-hidden="true" />
            <span :class="row.count > 0 ? 'text-ink-secondary' : 'text-ink-subtle'" class="capitalize">{{ row.key }}</span>
          </span>
          <span class="inline-flex items-baseline gap-2">
            <span :class="row.count > 0 ? 'font-semibold text-ink' : 'text-ink-subtle'" class="tabular-nums">
              {{ row.count }}
            </span>
            <span class="w-9 text-right text-xs tabular-nums text-ink-subtle">{{ row.pct.toFixed(0) }}%</span>
          </span>
        </li>
      </ul>

      <p class="mt-auto border-t border-edge-subtle pt-3 text-xs text-ink-muted">
        <span class="font-semibold text-ink tabular-nums">{{ total }}</span> open case{{ total === 1 ? "" : "s" }} total
      </p>
    </template>
  </BaseCard>
</template>
