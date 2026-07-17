<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import type { ChartConfiguration } from "chart.js";
import { formatRuleId, type FuelTransaction, type Vehicle, type Anomaly } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import { stationDate } from "@/lib/stationTime";
import BaseChart from "@/components/BaseChart.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import { viz, areaFill } from "@/features/dashboard/chartTheme";

const route = useRoute();
const id = computed(() => String(route.params.id));

const { data: vehicle } = useQuery({
  queryKey: ["vehicle", id],
  queryFn: async (): Promise<Vehicle | null> => {
    const { data } = await supabase.from("vehicles").select("*").eq("id", id.value).maybeSingle();
    return (data as Vehicle | null) ?? null;
  },
});

const { data: txns } = useQuery({
  queryKey: ["vehicle_txns", id],
  queryFn: async (): Promise<FuelTransaction[]> => {
    const { data } = await supabase
      .from("fuel_transactions")
      .select("id, org_id, vehicle_id, driver_id, fueled_at, odometer, gallons, price_per_gal, total_cost, location_text, state, source, computed_mpg, has_anomaly, max_severity, ai_risk_level, created_at")
      .eq("vehicle_id", id.value)
      .order("fueled_at", { ascending: true })
      .limit(200);
    return (data ?? []) as FuelTransaction[];
  },
});

const { data: anomalies } = useQuery({
  queryKey: ["vehicle_anomalies", id],
  queryFn: async (): Promise<Anomaly[]> => {
    const { data } = await supabase
      .from("anomalies")
      .select("id, severity, status, rule_id, message, created_at, transaction_id, org_id, vehicle_id, evidence, source, assigned_to, resolved_by, resolved_at, resolution_note, version, updated_at")
      .eq("vehicle_id", id.value)
      .neq("status", "superseded")
      .order("created_at", { ascending: false });
    return (data ?? []) as Anomaly[];
  },
});

const mpgPoints = computed(() => (txns.value ?? []).filter((t) => t.computed_mpg != null));
const mpgChart = computed<ChartConfiguration>(() => ({
  type: "line",
  data: {
    labels: mpgPoints.value.map((t) => t.fueled_at.slice(0, 10)),
    datasets: [
      {
        label: "MPG",
        data: mpgPoints.value.map((t) => Number(t.computed_mpg)),
        borderColor: viz.brand,
        backgroundColor: areaFill("--viz-brand") as unknown as string,
        fill: true,
        tension: 0.4,
        borderWidth: 2.5,
        borderCapStyle: "round",
        borderJoinStyle: "round",
        pointRadius: 0,
        pointHitRadius: 12,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: viz.brand,
        pointHoverBorderColor: viz.pointHalo,
        pointHoverBorderWidth: 2,
      },
      ...(vehicle.value?.baseline_mpg ? [{ label: "Baseline", data: mpgPoints.value.map(() => Number(vehicle.value!.baseline_mpg)), borderColor: viz.reference, borderDash: [5, 5], pointRadius: 0 }] : []),
    ],
  },
  options: { responsive: true, maintainAspectRatio: false },
}));

const recent = computed(() => [...(txns.value ?? [])].reverse().slice(0, 15));
// Station-local date (matches the EFS report; avoids a browser-tz off-by-a-day near midnight).
const fmt = (iso: string, state: string | null) => stationDate(iso, state);

const fillColumns: DataTableColumn[] = [
  { key: "fueled_at", label: "Date", cellClass: "text-ink-muted" },
  { key: "gallons", label: "Gallons", numeric: true },
  { key: "computed_mpg", label: "MPG", numeric: true, cellClass: "text-ink-secondary" },
];
</script>

<template>
  <div class="space-y-6">
    <BaseCard v-if="vehicle">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold text-ink">{{ vehicle.unit_number }}</h2>
          <p class="text-sm text-ink-muted">{{ [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") }} · {{ vehicle.fuel_type }}</p>
        </div>
        <StatusBadge :status="vehicle.status" />
      </div>
      <dl class="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt class="text-ink-muted">Tank</dt><dd class="font-medium text-ink">{{ vehicle.tank_capacity_gal }} gal</dd></div>
        <div><dt class="text-ink-muted">Baseline MPG</dt><dd class="font-medium text-ink">{{ vehicle.baseline_mpg ?? "—" }}</dd></div>
        <div><dt class="text-ink-muted">Odometer</dt><dd class="font-medium text-ink">{{ vehicle.current_odometer }}</dd></div>
        <div><dt class="text-ink-muted">Open anomalies</dt><dd class="font-medium text-ink">{{ (anomalies ?? []).filter((a) => a.status !== 'resolved' && a.status !== 'dismissed').length }}</dd></div>
      </dl>
      <p v-if="Number(vehicle.odometer_offset) !== 0" class="mt-3 text-xs text-ink-muted">
        Odometer calibration: dash reads <strong>{{ Number(vehicle.odometer_offset) > 0 ? "+" : "" }}{{ vehicle.odometer_offset }} mi</strong>
        vs Samsara ({{ vehicle.odometer_offset_source === "manual" ? "manual override" : "auto-learned" }}) — applied before mismatch checks.
      </p>
    </BaseCard>

    <BaseCard>
      <h3 class="mb-3 text-sm font-semibold text-ink">MPG history</h3>
      <BaseChart v-if="mpgPoints.length" :config="mpgChart" :height="260" />
      <p v-else class="text-sm text-ink-muted">Not enough data to chart MPG yet.</p>
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
            <span class="text-sm text-ink-secondary" :title="a.rule_id">{{ formatRuleId(a.rule_id) }}</span>
            <StatusBadge :status="a.status" />
          </li>
          <li v-if="(anomalies ?? []).length === 0" class="px-5 py-3 text-ink-muted">No anomalies.</li>
        </ul>
      </BaseCard>
    </div>
  </div>
</template>
