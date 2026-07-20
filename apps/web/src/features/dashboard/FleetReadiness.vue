<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import { CheckCircleIcon, ChevronDownIcon, ExclamationTriangleIcon } from "@heroicons/vue/20/solid";
import BaseCard from "@/components/ui/BaseCard.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useDriversQuery } from "@/composables/useDrivers";
import { useOrgSettingsQuery } from "@/composables/useOrgSettings";

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
const open = ref(true); // the checklist starts expanded; collapse it once you've reviewed the gaps
const pct = (r: Row) => (r.total === 0 ? 0 : Math.round((r.ok / r.total) * 100));
const meterTone = (r: Row) =>
  r.ok >= r.total
    ? "bg-gradient-to-r from-success-500 to-success-300"
    : pct(r) >= 70
      ? "bg-gradient-to-r from-warning-500 to-warning-300"
      : "bg-gradient-to-r from-danger-500 to-danger-300";
const textTone = (r: Row) =>
  r.ok >= r.total ? "text-success-600" : pct(r) >= 70 ? "text-warning-600" : "text-danger-600";
</script>

<template>
  <!-- Fully configured → collapse to a slim confirmation strip; detail returns whenever a gap opens. -->
  <BaseCard v-if="gaps === 0" padding="none" class="flex items-center gap-2 px-5 py-3">
    <CheckCircleIcon class="size-5 text-success-500" aria-hidden="true" />
    <p class="text-sm text-ink-secondary">
      <span class="font-semibold text-ink">Fleet readiness:</span> all set — detection checks have the
      data they need.
    </p>
  </BaseCard>

  <BaseCard v-else>
    <button
      type="button"
      class="flex w-full items-center justify-between gap-2 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      :class="open ? 'mb-4' : ''"
      :aria-expanded="open"
      aria-controls="fleet-readiness-list"
      @click="open = !open"
    >
      <span class="flex items-center gap-2">
        <ChevronDownIcon
          class="size-4 text-ink-subtle transition-transform duration-200"
          :class="open ? '' : '-rotate-90'"
          aria-hidden="true"
        />
        <h3 class="text-sm font-semibold text-ink">Fleet readiness</h3>
      </span>
      <span :class="[BADGE_BASE, toneClass('warning'), 'normal-case']">
        <ExclamationTriangleIcon class="size-3.5" aria-hidden="true" /> {{ gaps }} to complete
      </span>
    </button>
    <ul v-show="open" id="fleet-readiness-list" class="grid grid-cols-1 gap-x-10 gap-y-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
      <li v-for="r in rows" :key="r.label" :title="r.why">
        <div class="flex items-center justify-between gap-3">
          <span class="truncate text-ink-secondary">{{ r.label }}</span>
          <span class="flex shrink-0 items-center gap-2">
            <span :class="['text-xs font-semibold tabular-nums', textTone(r)]">{{ r.ok }}/{{ r.total }}</span>
            <RouterLink
              v-if="r.ok < r.total"
              :to="r.to"
              class="rounded text-xs font-medium text-brand-600 hover:text-brand-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              Fix →
            </RouterLink>
            <CheckCircleIcon v-else class="size-4 text-success-500" aria-hidden="true" />
          </span>
        </div>
        <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted">
          <div
            :class="['h-full rounded-full transition-all duration-300', meterTone(r)]"
            :style="{ width: `${pct(r)}%` }"
          />
        </div>
      </li>
    </ul>
  </BaseCard>
</template>
