<script setup lang="ts">
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { computed } from "vue";
import type { PlanStopView } from "./useFuelPlan";

const props = defineProps<{ stops: PlanStopView[] }>();
const rows = computed(() => props.stops.map((s, i) => ({ ...s, seq: i + 1 })));

const usd3 = (n: number | null) => (n == null ? "—" : `$${n.toFixed(3)}`);
const usd = (n: number | null) => (n == null ? "—" : n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }));

const columns: DataTableColumn[] = [
  { key: "seq", label: "#", headerClass: "w-10" },
  { key: "station", label: "Station", headerClass: "min-w-[12rem]", cellClass: "font-medium text-ink" },
  { key: "exit", label: "Exit", headerClass: "min-w-[6rem]", cellClass: "text-ink-secondary" },
  { key: "milesAhead", label: "Mile", numeric: true, headerClass: "min-w-[5rem]", cellClass: "text-ink-secondary" },
  { key: "gallons", label: "Gallons", numeric: true, headerClass: "min-w-[6rem]", cellClass: "font-medium text-ink" },
  { key: "netPrice", label: "Net $/gal", numeric: true, headerClass: "min-w-[6rem]", cellClass: "text-ink-secondary" },
  { key: "cost", label: "Cost", numeric: true, headerClass: "min-w-[6rem]", cellClass: "text-ink-secondary" },
  { key: "detourMiles", label: "Detour", numeric: true, headerClass: "min-w-[5rem]", cellClass: "text-ink-muted" },
  { key: "type", label: "Type", headerClass: "min-w-[7rem]" },
];
</script>

<template>
  <DataTable :columns="columns" :rows="rows" row-key="seq" empty-text="No fuel stops needed — the truck reaches the destination on its current fuel.">
    <template #cell-seq="{ row }">{{ row.seq }}</template>
    <template #cell-station="{ row }">
      {{ row.stationName }}
      <span class="ml-1 text-xs text-ink-muted">{{ row.brand }}<span v-if="row.state"> · {{ row.state }}</span></span>
    </template>
    <template #cell-exit="{ row }">{{ row.exit ?? "—" }}</template>
    <template #cell-milesAhead="{ row }">{{ row.milesAhead }}</template>
    <template #cell-gallons="{ row }">{{ row.gallons }}</template>
    <template #cell-netPrice="{ row }">
      {{ usd3(row.netPrice) }}
      <span v-if="row.priceAgeHours != null" class="ml-1 text-xs text-ink-subtle">· {{ row.priceAgeHours }}h</span>
    </template>
    <template #cell-cost="{ row }">{{ usd(row.cost) }}</template>
    <template #cell-detourMiles="{ row }">{{ row.detourMiles }} mi</template>
    <template #cell-type="{ row }">
      <span v-if="row.isEmergency" :class="[BADGE_BASE, toneClass('warning')]">Emergency</span>
      <span v-else :class="[BADGE_BASE, toneClass('success')]">Preferred</span>
    </template>
  </DataTable>
</template>
