<script setup lang="ts">
import type { ChartConfiguration, TooltipItem } from "chart.js";
import { computed } from "vue";
import BaseChart from "@/components/BaseChart.vue";
import { resolve } from "./chartTheme";

export interface DonutBreakdownItem {
  key: string;
  label: string;
  value: number;
  valueLabel: string;
  color: string;
}

const props = defineProps<{
  items: DonutBreakdownItem[];
  centerValue: string;
  centerLabel: string;
  chartLabel: string;
}>();

const total = computed(() => props.items.reduce((sum, item) => sum + Math.max(0, item.value), 0));
const hasData = computed(() => total.value > 0);
const visibleSlices = computed(() => props.items.filter((item) => item.value > 0));

const shareLabel = (value: number) => {
  if (total.value === 0 || value <= 0) return "0%";
  const share = (value / total.value) * 100;
  return share < 1 ? "<1%" : `${Math.round(share)}%`;
};

const chart = computed<ChartConfiguration<"doughnut">>(() => {
  const slices = hasData.value
    ? visibleSlices.value
    : [{ key: "empty", label: "No data", value: 1, valueLabel: "0", color: resolve("--edge-subtle") }];

  return {
    type: "doughnut",
    data: {
      labels: slices.map((item) => item.label),
      datasets: [
        {
          data: slices.map((item) => item.value),
          backgroundColor: slices.map((item) => item.color),
          hoverBackgroundColor: slices.map((item) => item.color),
          borderColor: resolve("--surface"),
          borderWidth: hasData.value ? 3 : 0,
          spacing: hasData.value ? 2 : 0,
          borderRadius: hasData.value ? 7 : 0,
          hoverOffset: hasData.value ? 4 : 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "74%",
      layout: { padding: 7 },
      animation:
        typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
          ? false
          : { duration: 450 },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: hasData.value,
          backgroundColor: resolve("--surface-inverse"),
          titleColor: resolve("--ramp-neutral-50"),
          bodyColor: resolve("--ramp-neutral-200"),
          displayColors: false,
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: (item: TooltipItem<"doughnut">) => {
              const slice = visibleSlices.value[item.dataIndex];
              return slice ? `${slice.valueLabel} · ${shareLabel(slice.value)}` : "";
            },
          },
        },
      },
    },
  };
});
</script>

<template>
  <div class="grid min-h-52 grid-cols-1 items-center gap-5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-6">
    <div class="relative mx-auto size-48 shrink-0" role="img" :aria-label="chartLabel">
      <div aria-hidden="true">
        <BaseChart :config="chart" :height="192" />
      </div>
      <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
        <span class="max-w-full truncate text-lg font-semibold tabular-nums text-ink" :title="centerValue">
          {{ centerValue }}
        </span>
        <span class="mt-0.5 text-2xs font-medium text-ink-tertiary">{{ centerLabel }}</span>
      </div>
    </div>

    <ul class="min-w-0 divide-y divide-edge-subtle self-stretch" :aria-label="`${chartLabel} details`">
      <li
        v-for="item in items"
        :key="item.key"
        class="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5"
      >
        <span class="flex min-w-0 items-center gap-2.5">
          <span class="size-2.5 shrink-0 rounded-detail" :style="{ backgroundColor: item.color }" aria-hidden="true" /> <!-- token-check-disable-line: token-resolved chart color -->
          <span :class="item.value > 0 ? 'text-ink-secondary' : 'text-ink-tertiary'" class="truncate text-sm">
            {{ item.label }}
          </span>
        </span>
        <span class="text-right">
          <span :class="item.value > 0 ? 'text-ink' : 'text-ink-tertiary'" class="block text-sm font-semibold tabular-nums">
            {{ item.valueLabel }}
          </span>
          <span class="block text-2xs tabular-nums text-ink-tertiary">{{ shareLabel(item.value) }}</span>
        </span>
      </li>
    </ul>
  </div>
</template>
