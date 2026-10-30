<script setup lang="ts">
import { afterReset, useDetectionEpoch } from "@/features/anomalies/useDetectionEpoch";
import { computed, nextTick, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import type { ChartConfiguration } from "chart.js";
import { formatRuleId, type FuelTransaction, type Vehicle, type Anomaly } from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import { useSessionStore } from "@/stores/session";
import { stationDate } from "@/lib/stationTime";
import BaseChart from "@/components/BaseChart.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import {
  AppCard as BaseCard,
  AppTabs,
  type TabItem,
  DataTable,
  type DataTableColumn,
  FactList,
  type Fact,
  QueryState,
  NotFoundError,
  isNotFound,
} from "@silvicom/ui";
import HolderEquipmentCard from "@/features/inventory/HolderEquipmentCard.vue";
import UnitWorkOrdersCard from "@/features/maintenance/UnitWorkOrdersCard.vue";
import UnitInspectionsCard from "@/features/roadside/UnitInspectionsCard.vue";
import UnitFileSection from "@/components/files/UnitFileSection.vue";
import type { UnitFileSubject } from "@/components/files/fileSubject";
import { viz, areaFill } from "@/lib/chartTheme";
import PageHeader from "@/components/ui/PageHeader.vue";
import { VEHICLE_SECTIONS, resolveVehicleSection, type VehicleSection } from "./vehicleSections";

const route = useRoute();
const router = useRouter();
const id = computed(() => String(route.params.id));
const session = useSessionStore();

/**
 * Overview · File · Maintenance · Fuel (UNIT-FILES-PLAN UF5), on the driver page's model (D-ROS5):
 * `?section=` is an anchor the strip scrolls to, never a tab that hides the rest. The truck's file is
 * a SECTION here rather than a page of its own, beside the kit and the fills it was always one click
 * away from needing — the same move the driver's qualification file made at DQF D1.
 */
const SECTIONS: TabItem[] = VEHICLE_SECTIONS.map((s) => ({ value: s.value, label: s.label }));
const section = computed<VehicleSection>(() => resolveVehicleSection(route.query.section));
function scrollToSection(s: VehicleSection): void {
  const el = typeof document !== "undefined" ? document.getElementById(`section-${s}`) : null;
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}
watch(section, (s) => void nextTick(() => scrollToSection(s)), { immediate: true });
function setSection(s: VehicleSection): void {
  void router.replace({ query: { ...route.query, section: s === "overview" ? undefined : s } });
}
const fileSubject = computed<UnitFileSubject>(() => ({ type: "tractor", id: id.value }));
// The truck's file belongs to the equipment section and its fuel history to the fuel section, and a
// technician holds the first without the second. Until the database refuses that read (migration 0416,
// database audit 2026-10-03 finding 1) this page was the only thing between a `fuel: none` user and the
// fills, and it did not stand there: it queried them for every role. The query is switched off, not just
// the panels hidden, so no role without the section sends the request, and the panels go with it
// because a chart and a table of blanks would say "this truck has never been fuelled".
const canSeeFuel = computed(() => session.canView("fuel"));

/*
 * Every read below THROWS on a refusal (F9, US6b). They used to read `data` and drop `error`, so a
 * failed read was an empty answer: "Not enough data to chart MPG yet", "No fills yet", "No
 * anomalies" — three claims about the truck, made by a request that never reached it. Each panel now
 * waits for its own read and offers a Retry.
 */
const vehicleQuery = useQuery({
  queryKey: ["vehicle", id],
  queryFn: async (): Promise<Vehicle> => {
    const { data, error } = await supabase.from("vehicles").select("*").eq("id", id.value).maybeSingle();
    if (error) throw new Error(error.message);
    // No row is not-found (F21), not a vehicle with no data: it was `null`, and the page drew the
    // header, an empty kit card and "No fills yet" for a truck that was never on the fleet.
    if (!data) throw new NotFoundError("That vehicle is not on the fleet.");
    return data as Vehicle;
  },
});
const vehicle = vehicleQuery.data;
/** The truck does not exist, so none of the panels below has a truck to describe. */
const missing = computed(() => isNotFound(vehicleQuery.error.value));

const txnsQuery = useQuery({
  queryKey: ["vehicle_txns", id],
  enabled: canSeeFuel,
  queryFn: async (): Promise<FuelTransaction[]> => {
    const { data, error } = await supabase
      .from("fuel_transactions")
      .select("id, org_id, vehicle_id, driver_id, fueled_at, odometer, gallons, price_per_gal, total_cost, location_text, state, source, computed_mpg, has_anomaly, max_severity, ai_risk_level, created_at")
      .eq("vehicle_id", id.value)
      .eq("is_canonical", true)
      .order("fueled_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as FuelTransaction[];
  },
});
const txns = txnsQuery.data;

// D-CF9 (0439): cases before the org's detection start date are not listed (useDetectionEpoch.ts).
const { epoch: detectionEpoch, ready: epochReady } = useDetectionEpoch();
const anomaliesQuery = useQuery({
  queryKey: ["vehicle_anomalies", id, detectionEpoch],
  enabled: epochReady,
  queryFn: async (): Promise<Anomaly[]> => {
    const { data, error } = await afterReset(
      supabase
        .from("anomalies")
        .select("id, severity, status, rule_id, message, created_at, transaction_id, org_id, vehicle_id, evidence, source, assigned_to, resolved_by, resolved_at, resolution_note, version, updated_at, fueled_at")
        .eq("vehicle_id", id.value)
        .neq("status", "superseded"),
      detectionEpoch.value,
    ).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Anomaly[];
  },
});
const anomalies = anomaliesQuery.data;

/**
 * The summary card's facts (D-US6). A truck with no tank on file printed " gal" here before FactList:
 * the unit is only glued to a number, and a blank is `null` so the list draws its em dash.
 */
const facts = computed<Fact[]>(() => {
  const v = vehicle.value;
  if (!v) return [];
  return [
    { label: "Tank", value: v.tank_capacity_gal != null ? `${v.tank_capacity_gal} gal` : null },
    { label: "Baseline MPG", value: v.baseline_mpg, numeric: true },
    { label: "Odometer", value: v.current_odometer, numeric: true },
    {
      label: "Open anomalies",
      // A dash until the anomalies have answered — a count of an unread list is not zero.
      value: anomalies.value ? anomalies.value.filter((a) => a.status !== "resolved" && a.status !== "dismissed").length : null,
      numeric: true,
    },
  ];
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
    <PageHeader
      :title="vehicle?.unit_number ?? 'Vehicle'"
      :description="vehicle ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') : 'Vehicle performance and fueling history'"
    />
    <QueryState
      :loading="vehicleQuery.isLoading.value"
      :error="vehicleQuery.isError.value ? vehicleQuery.error.value : null"
      :retrying="vehicleQuery.isFetching.value"
      loading-text="Loading the vehicle…"
      error-text="Could not load this vehicle."
      not-found-text="That vehicle is not on the fleet. The link may be incomplete, or the truck belongs to another company."
      @retry="vehicleQuery.refetch()"
    >
      <BaseCard v-if="vehicle" id="section-overview" class="scroll-mt-6">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-sm font-semibold text-ink">Vehicle summary · {{ vehicle.fuel_type }}</h2>
          </div>
          <StatusBadge :status="vehicle.status" />
        </div>
        <FactList class="mt-4" :facts="facts" />
        <p v-if="Number(vehicle.odometer_offset) !== 0" class="mt-3 text-xs text-ink-muted">
          Odometer calibration: dash reads <strong>{{ Number(vehicle.odometer_offset) > 0 ? "+" : "" }}{{ vehicle.odometer_offset }} mi</strong>
          vs Samsara ({{ vehicle.odometer_offset_source === "manual" ? "manual override" : "auto-learned" }}) — applied before mismatch checks.
        </p>
      </BaseCard>
    </QueryState>

    <template v-if="!missing">
      <!-- A jump nav, not a tab strip: every section is on the page and this scrolls to one. No
           `id-prefix`, as on the driver page — the sections are named by the URL, not owned by the strip. -->
      <AppTabs
        :model-value="section"
        :tabs="SECTIONS"
        label="Vehicle sections"
        @update:model-value="setSection($event as VehicleSection)"
      />

      <!-- The truck's file (UF5, D-UF1): the same rollup row the Vehicles list draws its cell from. -->
      <section id="section-file" class="scroll-mt-6">
        <UnitFileSection v-if="vehicle" :subject="fileSubject" :unit-number="vehicle.unit_number" :plate="vehicle.plate" />
      </section>

      <section id="section-maintenance" class="scroll-mt-6 space-y-4">
        <!-- What this truck is carrying (INVENTORY-PLAN.md I9, D-AVI17). Read only and gated
             `maintenance: view`: the equipment section owns the truck's file and the shop owns what is
             inside it, so this is a window and never a control. A reader without the shop section gets
             no card at all — a card full of blanks would say "this truck carries nothing", which is a
             different and alarming claim. -->
        <HolderEquipmentCard v-if="vehicle" :target="{ kind: 'vehicle', id, label: `Truck ${vehicle.unit_number}` }" />
        <!-- Read-only windows onto the shop's open orders and the roadside record for this unit (UF5),
             each from a read its own page already makes, each linking out to where the work is done. -->
        <UnitWorkOrdersCard v-if="vehicle" kind="tractor" :unit-id="id" />
        <UnitInspectionsCard v-if="vehicle" kind="tractor" :unit-number="vehicle.unit_number" :plate="vehicle.plate" />
      </section>

      <BaseCard v-if="canSeeFuel" id="section-fuel" class="scroll-mt-6">
        <h3 class="mb-3 text-sm font-semibold text-ink">MPG history</h3>
        <QueryState
          compact
          :loading="txnsQuery.isLoading.value"
          :error="txnsQuery.isError.value"
          :retrying="txnsQuery.isFetching.value"
          loading-text="Loading the fills…"
          error-text="Could not load the fills."
          @retry="txnsQuery.refetch()"
        >
          <BaseChart v-if="mpgPoints.length" :config="mpgChart" :height="260" />
          <p v-else class="text-sm text-ink-muted">Not enough data to chart MPG yet.</p>
        </QueryState>
      </BaseCard>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div v-if="canSeeFuel" class="space-y-3">
          <h3 class="text-sm font-semibold text-ink">Recent fills</h3>
          <DataTable
            :columns="fillColumns"
            :rows="recent"
            row-key="id"
            :loading="txnsQuery.isLoading.value"
            :error="txnsQuery.isError.value ? 'Could not load the fills.' : null"
            :retrying="txnsQuery.isFetching.value"
            empty-text="No fills yet."
            @retry="txnsQuery.refetch()"
          >
            <template #cell-fueled_at="{ row }">{{ fmt(row.fueled_at, row.state ?? null) }}</template>
            <template #cell-gallons="{ value }">{{ value != null ? `${value} gal` : "—" }}</template>
            <template #cell-computed_mpg="{ value }">{{ value != null ? `${value} mpg` : "—" }}</template>
          </DataTable>
        </div>
        <BaseCard padding="none">
          <h3 class="border-b border-edge-subtle px-5 py-3 text-sm font-semibold text-ink">Anomalies</h3>
          <!-- `isPending`, not `isLoading`: the read waits on the detection epoch, and while it is
               disabled `isLoading` is false — which drew "No anomalies" before anything was asked. -->
          <div v-if="anomaliesQuery.isPending.value || anomaliesQuery.isError.value" class="px-5 py-3">
            <QueryState
              compact
              :loading="anomaliesQuery.isPending.value && !anomaliesQuery.isError.value"
              :error="anomaliesQuery.isError.value"
              :retrying="anomaliesQuery.isFetching.value"
              loading-text="Loading the anomalies…"
              error-text="Could not load the anomalies."
              @retry="anomaliesQuery.refetch()"
            />
          </div>
          <ul v-else class="divide-y divide-edge-subtle text-sm">
            <li v-for="a in anomalies ?? []" :key="a.id" class="flex items-center justify-between px-5 py-2">
              <span class="text-sm text-ink-secondary" :title="a.rule_id">{{ formatRuleId(a.rule_id) }}</span>
              <StatusBadge :status="a.status" />
            </li>
            <li v-if="(anomalies ?? []).length === 0" class="px-5 py-3 text-ink-muted">No anomalies.</li>
          </ul>
        </BaseCard>
      </div>
    </template>
  </div>
</template>
