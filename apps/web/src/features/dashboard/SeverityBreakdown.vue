<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import ChartCard from "./ChartCard.vue";
import DonutBreakdown from "./DonutBreakdown.vue";
import { viz } from "@/lib/chartTheme";

const props = defineProps<{
  severity: Record<"critical" | "high" | "medium" | "low", number>;
}>();

const ORDER = ["critical", "high", "medium", "low"] as const;

const total = computed(() => ORDER.reduce((sum, k) => sum + props.severity[k], 0));

const rows = computed(() =>
  ORDER.map((key) => ({
    key,
    label: key.charAt(0).toUpperCase() + key.slice(1),
    value: props.severity[key],
    valueLabel: props.severity[key].toLocaleString("en-US"),
    color: viz.severity[key],
  })),
);
</script>

<template>
  <ChartCard title="Open cases by severity" subtitle="Current open and investigating cases" class="h-full">
    <template #meta>
      <RouterLink
        to="/anomalies"
        class="rounded-control px-1.5 py-0.5 text-xs font-medium text-link hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        View all →
      </RouterLink>
    </template>

    <DonutBreakdown
      :items="rows"
      :center-value="total.toLocaleString('en-US')"
      center-label="open cases"
      :chart-label="`${total} open case${total === 1 ? '' : 's'} by severity`"
    />
  </ChartCard>
</template>
