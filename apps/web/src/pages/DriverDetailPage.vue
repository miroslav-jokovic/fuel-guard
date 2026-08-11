<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import type { ChartConfiguration } from "chart.js";
import type { Anomaly, Driver, FuelTransaction } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import { stationDate } from "@/lib/stationTime";
import BaseChart from "@/components/BaseChart.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import { AppCard as BaseCard } from "@fuelguard/ui";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import { viz, areaFill } from "@/features/dashboard/chartTheme";
import PageHeader from "@/components/ui/PageHeader.vue";

const route = useRoute();
const id = computed(() => String(route.params.id ?? ""));
const PAGE = 500;

async function fetchAllFills(driverId: string): Promise<FuelTransaction[]> {
  const rows: FuelTransaction[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("fuel_transactions")
      .select("id, org_id, vehicle_id, driver_id, fueled_at, odometer, gallons, price_per_gal, total_cost, location_text, state, source, computed_mpg, has_anomaly, max_severity, ai_risk_level, created_at")
      .eq("driver_id", driverId)
      .eq("is_canonical", true)
      .order("fueled_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as FuelTransaction[];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}

const { data: driver } = useQuery({
  queryKey: ["driver-detail", id],
  enabled: computed(() => Boolean(id.value)),
  queryFn: async (): Promise<Driver | null> => {
    const { data, error } = await supabase.from("drivers").select("*").eq("id", id.value).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as Driver | null) ?? null;
  },
});

const { data: txns } = useQuery({
  queryKey: ["driver-fills", id],
  enabled: computed(() => Boolean(id.value)),
  queryFn: () => fetchAllFills(id.value),
});

const { data: anomalies } = useQuery({
  queryKey: ["driver-anomalies", id],
  enabled: computed(() => Boolean(id.value) && txns.value !== undefined),
  queryFn: async (): Promise<Anomaly[]> => {
    const transactionIds = (txns.value ?? []).map((t) => t.id);
    if (transactionIds.length === 0) return [];
    const { data, error } = await supabase
      .from("anomalies")
      .select("id, severity, status, rule_id, message, created_at, transaction_id, org_id, vehicle_id, evidence, source, assigned_to, resolved_by, resolved_at, resolution_note, version, updated_at")
      .in("transaction_id", transactionIds)
      .neq("status", "superseded")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Anomaly[];
  },
});

const mpgPoints = computed(() => (txns.value ?? []).filter((t) => t.computed_mpg != null && Number(t.computed_mpg) >= 1 && Number(t.computed_mpg) <= 40));
const mpgChart = computed<ChartConfiguration>(() => ({
  type: "line",
  data: {
    labels: mpgPoints.value.map((t) => t.fueled_at.slice(0, 10)),
    datasets: [
      {
        label: "MPG",
        data: mpgPoints.value.map((t) => Number(t.computed_mpg)),
        borderColor: viz.brand,
        backgroundColor: areaFill("--viz-brand"),
        fill: true,
        tension: 0.35,
        borderWidth: 2.5,
        pointRadius: 0,
        pointHitRadius: 12,
      },
    ],
  },
  options: { responsive: true, maintainAspectRatio: false },
}));

const recent = computed(() => [...(txns.value ?? [])].reverse().slice(0, 20));
const openAnomalies = computed(() => (anomalies.value ?? []).filter((a) => a.status === "open" || a.status === "investigating").length);
const totalGallons = computed(() => (txns.value ?? []).reduce((sum, t) => sum + Number(t.gallons || 0), 0));
const avgMpg = computed(() => {
  const valid = mpgPoints.value;
  const gallons = valid.reduce((sum, t) => sum + Number(t.gallons || 0), 0);
  return gallons > 0 ? valid.reduce((sum, t) => sum + Number(t.computed_mpg) * Number(t.gallons || 0), 0) / gallons : null;
});
const fmt = (iso: string, state: string | null) => stationDate(iso, state);
const fillColumns: DataTableColumn[] = [
  { key: "fueled_at", label: "Date", cellClass: "text-ink-muted" },
  { key: "gallons", label: "Gallons", numeric: true },
  { key: "computed_mpg", label: "MPG", numeric: true, cellClass: "text-ink-secondary" },
  { key: "vehicle_id", label: "Vehicle", cellClass: "text-ink-muted" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader :title="driver?.full_name ?? 'Driver'" description="Driver performance and fueling history" />
    <BaseCard v-if="driver">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-semibold text-ink">Driver summary</h2>
        </div>
        <StatusBadge :status="driver.status" />
      </div>
      <dl class="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt class="text-ink-muted">Fills</dt><dd class="font-medium text-ink">{{ txns?.length ?? "—" }}</dd></div>
        <div><dt class="text-ink-muted">Gallons</dt><dd class="font-medium text-ink">{{ Math.round(totalGallons).toLocaleString() }}</dd></div>
        <div><dt class="text-ink-muted">Average MPG</dt><dd class="font-medium text-ink">{{ avgMpg != null ? avgMpg.toFixed(1) : "—" }}</dd></div>
        <div><dt class="text-ink-muted">Open anomalies</dt><dd class="font-medium text-ink">{{ openAnomalies }}</dd></div>
      </dl>
    </BaseCard>

    <BaseCard>
      <h3 class="mb-3 text-sm font-semibold text-ink">MPG history</h3>
      <BaseChart v-if="mpgPoints.length" :config="mpgChart" :height="260" />
      <p v-else class="text-sm text-ink-muted">Not enough valid data to chart MPG yet.</p>
    </BaseCard>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div class="space-y-3">
        <h3 class="text-sm font-semibold text-ink">Recent fills</h3>
        <DataTable :columns="fillColumns" :rows="recent" row-key="id" empty-text="No fills yet.">
          <template #cell-fueled_at="{ row }">{{ fmt(row.fueled_at, row.state ?? null) }}</template>
          <template #cell-gallons="{ value }">{{ value }} gal</template>
          <template #cell-computed_mpg="{ value }">{{ value ?? "—" }} mpg</template>
        </DataTable>
      </div>
      <BaseCard padding="none">
        <h3 class="border-b border-edge-subtle px-5 py-3 text-sm font-semibold text-ink">Anomalies</h3>
        <ul class="divide-y divide-edge-subtle text-sm">
          <li v-for="a in anomalies ?? []" :key="a.id" class="flex items-center justify-between px-5 py-2">
            <span class="text-ink-secondary" :title="a.rule_id">{{ a.rule_id }}</span>
            <StatusBadge :status="a.status" />
          </li>
          <li v-if="(anomalies ?? []).length === 0" class="px-5 py-3 text-ink-muted">No anomalies.</li>
        </ul>
      </BaseCard>
    </div>
  </div>
</template>
