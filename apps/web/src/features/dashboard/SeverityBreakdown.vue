<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { CheckCircleIcon } from "@heroicons/vue/24/outline";
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
</script>

<template>
  <div class="flex h-full flex-col rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-sm font-semibold text-gray-900">Open cases by severity</h3>
      <RouterLink
        to="/anomalies"
        class="rounded-md px-1.5 py-0.5 text-xs font-medium text-indigo-600 hover:text-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        View all →
      </RouterLink>
    </div>

    <div v-if="total === 0" class="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
      <CheckCircleIcon class="size-8 text-emerald-500" aria-hidden="true" />
      <p class="text-sm font-medium text-gray-900">No open cases</p>
      <p class="text-xs text-gray-500">Nothing needs your attention in this period.</p>
    </div>

    <template v-else>
      <!-- Stacked meter: 2px surface gaps separate segments; the labeled rows below carry the values. -->
      <div class="mt-4 flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" :aria-label="`${total} open cases by severity`">
        <div
          v-for="seg in segments"
          :key="seg.key"
          class="h-full rounded-[2px] first:rounded-l-full last:rounded-r-full"
          :style="{ width: `${seg.pct}%`, backgroundColor: seg.color, minWidth: '6px' }"
        />
      </div>

      <ul class="mt-4 divide-y divide-gray-100">
        <li v-for="row in rows" :key="row.key" class="flex items-center justify-between py-2 text-sm">
          <span class="inline-flex items-center gap-2">
            <span class="size-2.5 rounded-full" :style="{ backgroundColor: row.color }" aria-hidden="true" />
            <span :class="row.count > 0 ? 'text-gray-700' : 'text-gray-400'" class="capitalize">{{ row.key }}</span>
          </span>
          <span class="inline-flex items-baseline gap-2">
            <span :class="row.count > 0 ? 'font-semibold text-gray-900' : 'text-gray-400'" class="tabular-nums">
              {{ row.count }}
            </span>
            <span class="w-9 text-right text-xs tabular-nums text-gray-400">{{ row.pct.toFixed(0) }}%</span>
          </span>
        </li>
      </ul>

      <p class="mt-auto border-t border-gray-100 pt-3 text-xs text-gray-500">
        <span class="font-semibold text-gray-900 tabular-nums">{{ total }}</span> open case{{ total === 1 ? "" : "s" }} total
      </p>
    </template>
  </div>
</template>
