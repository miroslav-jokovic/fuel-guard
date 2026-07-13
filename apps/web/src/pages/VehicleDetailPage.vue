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
      { label: "MPG", data: mpgPoints.value.map((t) => Number(t.computed_mpg)), borderColor: "#4f46e5", backgroundColor: "#4f46e5", tension: 0.3 },
      ...(vehicle.value?.baseline_mpg ? [{ label: "Baseline", data: mpgPoints.value.map(() => Number(vehicle.value!.baseline_mpg)), borderColor: "#9ca3af", borderDash: [5, 5], pointRadius: 0 }] : []),
    ],
  },
  options: { responsive: true, maintainAspectRatio: false },
}));

const recent = computed(() => [...(txns.value ?? [])].reverse().slice(0, 15));
// Station-local date (matches the EFS report; avoids a browser-tz off-by-a-day near midnight).
const fmt = (iso: string, state: string | null) => stationDate(iso, state);
</script>

<template>
  <div class="space-y-6">
    <div v-if="vehicle" class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold text-gray-900">{{ vehicle.unit_number }}</h2>
          <p class="text-sm text-gray-500">{{ [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") }} · {{ vehicle.fuel_type }}</p>
        </div>
        <StatusBadge :status="vehicle.status" />
      </div>
      <dl class="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt class="text-gray-500">Tank</dt><dd class="font-medium text-gray-900">{{ vehicle.tank_capacity_gal }} gal</dd></div>
        <div><dt class="text-gray-500">Baseline MPG</dt><dd class="font-medium text-gray-900">{{ vehicle.baseline_mpg ?? "—" }}</dd></div>
        <div><dt class="text-gray-500">Odometer</dt><dd class="font-medium text-gray-900">{{ vehicle.current_odometer }}</dd></div>
        <div><dt class="text-gray-500">Open anomalies</dt><dd class="font-medium text-gray-900">{{ (anomalies ?? []).filter((a) => a.status !== 'resolved' && a.status !== 'dismissed').length }}</dd></div>
      </dl>
      <p v-if="Number(vehicle.odometer_offset) !== 0" class="mt-3 text-xs text-gray-500">
        Odometer calibration: dash reads <strong>{{ Number(vehicle.odometer_offset) > 0 ? "+" : "" }}{{ vehicle.odometer_offset }} mi</strong>
        vs Samsara ({{ vehicle.odometer_offset_source === "manual" ? "manual override" : "auto-learned" }}) — applied before mismatch checks.
      </p>
    </div>

    <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
      <h3 class="mb-3 text-sm font-semibold text-gray-900">MPG history</h3>
      <BaseChart v-if="mpgPoints.length" :config="mpgChart" :height="260" />
      <p v-else class="text-sm text-gray-500">Not enough data to chart MPG yet.</p>
    </div>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div class="rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
        <h3 class="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-900">Recent fills</h3>
        <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-100 whitespace-nowrap text-sm">
          <tbody class="divide-y divide-gray-100">
            <tr v-for="t in recent" :key="t.id">
              <td class="px-5 py-2 text-gray-500">{{ fmt(t.fueled_at, t.state ?? null) }}</td>
              <td class="px-5 py-2 text-gray-900">{{ t.gallons }} gal</td>
              <td class="px-5 py-2 text-gray-700">{{ t.computed_mpg ?? "—" }} mpg</td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>
      <div class="rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
        <h3 class="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-900">Anomalies</h3>
        <ul class="divide-y divide-gray-100 text-sm">
          <li v-for="a in anomalies ?? []" :key="a.id" class="flex items-center justify-between px-5 py-2">
            <span class="text-sm text-gray-700" :title="a.rule_id">{{ formatRuleId(a.rule_id) }}</span>
            <StatusBadge :status="a.status" />
          </li>
          <li v-if="(anomalies ?? []).length === 0" class="px-5 py-3 text-gray-500">No anomalies.</li>
        </ul>
      </div>
    </div>
  </div>
</template>
