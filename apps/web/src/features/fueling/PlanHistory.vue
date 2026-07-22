<script setup lang="ts">
import { computed } from "vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import { BADGE_BASE, toneClass, type BadgeTone } from "@/lib/badges";
import { useFuelPlanHistory } from "./useFuelPlan";

const { data, isLoading, error, isFetching, refetch } = useFuelPlanHistory();
const rows = computed(() => data.value ?? []);
const errMsg = computed(() => (error.value ? error.value.message : null));

const columns: DataTableColumn[] = [
  { key: "created_at", label: "Created", headerClass: "min-w-[9rem]" },
  { key: "created_by_label", label: "Created by", headerClass: "min-w-[10rem]" },
  { key: "unit_number", label: "Truck" },
  { key: "route", label: "Route", headerClass: "min-w-[16rem]" },
  { key: "distance_miles", label: "Distance", numeric: true },
  { key: "stop_count", label: "Stops", numeric: true },
  { key: "total_gallons", label: "Gallons", numeric: true },
  { key: "total_cost", label: "Est. cost", numeric: true },
  { key: "status", label: "Status" },
];

const fmtDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const usd = (n: number | null) => (n == null ? "—" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  ok: { label: "OK", tone: "success" },
  emergency_used: { label: "Emergency", tone: "warning" },
  infeasible: { label: "Infeasible", tone: "danger" },
  no_stations: { label: "No stations", tone: "neutral" },
  telematics_unavailable: { label: "No telematics", tone: "neutral" },
  routing_unavailable: { label: "No routing", tone: "neutral" },
  error: { label: "Error", tone: "danger" },
};
const statusOf = (s: string) => STATUS[s] ?? { label: s, tone: "neutral" as BadgeTone };
</script>

<template>
  <DataTable
    :columns="columns"
    :rows="rows"
    row-key="id"
    :loading="isLoading"
    :error="errMsg"
    :retrying="isFetching"
    empty-text="No plans yet — generate one on the Plan tab and it'll be saved here."
    @retry="refetch"
  >
    <template #cell-created_at="{ row }">
      <span class="whitespace-nowrap text-ink-secondary">{{ fmtDate(row.created_at) }}</span>
    </template>
    <template #cell-created_by_label="{ row }">{{ row.created_by_label ?? "—" }}</template>
    <template #cell-unit_number="{ row }">{{ row.unit_number ?? "—" }}</template>
    <template #cell-route="{ row }">
      <span class="text-ink">{{ row.origin_label ?? "—" }}</span>
      <span class="mx-1 text-ink-subtle">→</span>
      <span class="text-ink">{{ row.destination_label ?? "—" }}</span>
    </template>
    <template #cell-distance_miles="{ row }">{{ row.distance_miles != null ? `${row.distance_miles.toLocaleString()} mi` : "—" }}</template>
    <template #cell-total_gallons="{ row }">{{ row.total_gallons != null ? `${row.total_gallons.toLocaleString()} gal` : "—" }}</template>
    <template #cell-total_cost="{ row }">{{ usd(row.total_cost) }}</template>
    <template #cell-status="{ row }">
      <span :class="[BADGE_BASE, toneClass(statusOf(row.status).tone)]">{{ statusOf(row.status).label }}</span>
    </template>
  </DataTable>
</template>
