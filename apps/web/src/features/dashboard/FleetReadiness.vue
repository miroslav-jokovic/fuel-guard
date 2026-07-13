<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { CheckCircleIcon, ExclamationTriangleIcon } from "@heroicons/vue/20/solid";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import { useDriversQuery } from "@/features/fleet/useDrivers";
import { useOrgSettingsQuery } from "@/features/settings/useOrgSettings";

const { data: vehicles } = useVehiclesQuery();
const { data: drivers } = useDriversQuery();
const { data: org } = useOrgSettingsQuery();

// Active fleet only — retired vehicles shouldn't count as "missing" data.
const fleet = computed(() => (vehicles.value ?? []).filter((v) => v.status !== "retired"));
const activeDrivers = computed(() => (drivers.value ?? []).filter((d) => d.status !== "inactive"));

interface Row {
  label: string;
  ok: number;
  total: number;
  to: string;
  why: string;
}
const rows = computed<Row[]>(() => {
  const v = fleet.value;
  const d = activeDrivers.value;
  const notif = (org.value?.notification_emails?.length ?? 0) > 0 && org.value?.notifications_enabled !== false;
  return [
    { label: "Tank capacity set", ok: v.filter((x) => Number(x.tank_capacity_gal) > 0).length, total: v.length, to: "/vehicles", why: "Needed for the tank-space & over-capacity theft checks." },
    { label: "Baseline MPG set", ok: v.filter((x) => x.baseline_mpg != null).length, total: v.length, to: "/vehicles", why: "Needed for consumption / over-fuel checks." },
    { label: "Samsara-mapped vehicles", ok: v.filter((x) => x.samsara_vehicle_id).length, total: v.length, to: "/vehicles", why: "Links each truck to telematics for location & fuel level." },
    { label: "Fuel sensor reporting", ok: v.filter((x) => x.samsara_fuel_percent != null).length, total: v.length, to: "/vehicles", why: "Enables tank-level and siphoning detection." },
    { label: "Drivers mapped to Samsara", ok: d.filter((x) => x.samsara_driver_id).length, total: d.length, to: "/drivers", why: "Attributes fills to the right driver." },
    { label: "Notification recipients", ok: notif ? 1 : 0, total: 1, to: "/settings", why: "Who receives alerts and the weekly digest." },
  ];
});

const gaps = computed(() => rows.value.filter((r) => r.total > 0 && r.ok < r.total).length);
const pct = (r: Row) => (r.total === 0 ? 0 : Math.round((r.ok / r.total) * 100));
const meterTone = (r: Row) =>
  r.ok >= r.total ? "bg-emerald-500" : pct(r) >= 70 ? "bg-amber-500" : "bg-red-500";
const textTone = (r: Row) =>
  r.ok >= r.total ? "text-emerald-600" : pct(r) >= 70 ? "text-amber-600" : "text-red-600";
</script>

<template>
  <!-- Fully configured → collapse to a slim confirmation strip; detail returns whenever a gap opens. -->
  <div
    v-if="gaps === 0"
    class="flex items-center gap-2 rounded-xl bg-white px-5 py-3 shadow-sm ring-1 ring-gray-200"
  >
    <CheckCircleIcon class="size-5 text-emerald-500" aria-hidden="true" />
    <p class="text-sm text-gray-700">
      <span class="font-semibold text-gray-900">Fleet readiness:</span> all set — detection checks have the
      data they need.
    </p>
  </div>

  <div v-else class="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
    <div class="mb-4 flex items-center justify-between gap-2">
      <h3 class="text-sm font-semibold text-gray-900">Fleet readiness</h3>
      <span
        class="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-600/20 ring-inset"
      >
        <ExclamationTriangleIcon class="size-3.5" aria-hidden="true" /> {{ gaps }} to complete
      </span>
    </div>
    <ul class="grid grid-cols-1 gap-x-10 gap-y-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
      <li v-for="r in rows" :key="r.label" :title="r.why">
        <div class="flex items-center justify-between gap-3">
          <span class="truncate text-gray-700">{{ r.label }}</span>
          <span class="flex shrink-0 items-center gap-2">
            <span :class="['text-xs font-semibold tabular-nums', textTone(r)]">{{ r.ok }}/{{ r.total }}</span>
            <RouterLink
              v-if="r.ok < r.total"
              :to="r.to"
              class="rounded text-xs font-medium text-indigo-600 hover:text-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              Fix →
            </RouterLink>
            <CheckCircleIcon v-else class="size-4 text-emerald-500" aria-hidden="true" />
          </span>
        </div>
        <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
          <div
            :class="['h-full rounded-full transition-all duration-300', meterTone(r)]"
            :style="{ width: `${pct(r)}%` }"
          />
        </div>
      </li>
    </ul>
  </div>
</template>
