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
const tone = (r: Row) => (r.ok >= r.total ? "text-green-600" : pct(r) >= 70 ? "text-amber-600" : "text-red-600");
</script>

<template>
  <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
    <div class="mb-3 flex items-center justify-between">
      <h3 class="text-sm font-semibold text-gray-900">Fleet readiness</h3>
      <span v-if="gaps === 0" class="inline-flex items-center gap-1 text-xs font-medium text-green-700">
        <CheckCircleIcon class="size-4" /> All set
      </span>
      <span v-else class="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
        <ExclamationTriangleIcon class="size-4" /> {{ gaps }} to complete
      </span>
    </div>
    <ul class="divide-y divide-gray-100 text-sm">
      <li v-for="r in rows" :key="r.label" class="flex items-center justify-between py-2">
        <span class="text-gray-700" :title="r.why">{{ r.label }}</span>
        <span class="flex items-center gap-3">
          <span :class="['font-medium', tone(r)]">{{ r.ok }}/{{ r.total }}</span>
          <RouterLink v-if="r.ok < r.total" :to="r.to" class="text-xs font-medium text-indigo-600 hover:text-indigo-500">Fix →</RouterLink>
          <CheckCircleIcon v-else class="size-4 text-green-500" />
        </span>
      </li>
    </ul>
  </div>
</template>
