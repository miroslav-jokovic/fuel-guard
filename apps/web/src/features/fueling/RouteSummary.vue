<script setup lang="ts">
import { computed } from "vue";
import { MapPinIcon, ClockIcon, TruckIcon, FlagIcon } from "@heroicons/vue/24/outline";
import BaseCard from "@/components/ui/BaseCard.vue";
import type { PlanResult } from "./useFuelPlan";

const props = defineProps<{
  route: NonNullable<PlanResult["route"]>;
  origin?: string;
  destination?: string;
  waypoints?: string[];
  stopCount?: number;
}>();

// HERE's estimated moving time. Legal drive is 11 h/day, so this also hints how many days the run takes.
const driveTime = computed(() => {
  const h = Math.floor(props.route.durationHours);
  const m = Math.round((props.route.durationHours - h) * 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
});
const drivingDays = computed(() => Math.max(1, Math.ceil(props.route.durationHours / 11)));
const facts = computed(() => [
  { icon: TruckIcon, label: "Distance", value: `${props.route.distanceMiles.toLocaleString()} mi` },
  { icon: ClockIcon, label: "Est. drive time", value: `${driveTime.value} (~${drivingDays.value} day${drivingDays.value > 1 ? "s" : ""} @ 11h)` },
  ...(props.stopCount != null ? [{ icon: MapPinIcon, label: "Fuel stops", value: String(props.stopCount) }] : []),
]);
</script>

<template>
  <BaseCard>
    <h3 class="text-sm font-semibold text-ink">Route</h3>
    <ol class="mt-3 space-y-2">
      <li v-if="origin" class="flex items-start gap-2 text-sm">
        <FlagIcon class="mt-0.5 size-4 shrink-0 text-success-600" aria-hidden="true" />
        <span class="text-ink-secondary"><span class="font-medium text-ink">Start:</span> {{ origin }}</span>
      </li>
      <li v-for="(w, i) in waypoints ?? []" :key="i" class="flex items-start gap-2 text-sm">
        <MapPinIcon class="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
        <span class="text-ink-secondary"><span class="font-medium text-ink">Stop {{ i + 1 }}:</span> {{ w }}</span>
      </li>
      <li v-if="destination" class="flex items-start gap-2 text-sm">
        <FlagIcon class="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
        <span class="text-ink-secondary"><span class="font-medium text-ink">Destination:</span> {{ destination }}</span>
      </li>
    </ol>
    <dl class="mt-4 grid grid-cols-1 gap-3 border-t border-edge pt-4 sm:grid-cols-3">
      <div v-for="f in facts" :key="f.label" class="flex items-center gap-2">
        <component :is="f.icon" class="size-5 shrink-0 text-ink-subtle" aria-hidden="true" />
        <div>
          <dt class="text-xs text-ink-muted">{{ f.label }}</dt>
          <dd class="text-sm font-semibold text-ink">{{ f.value }}</dd>
        </div>
      </div>
    </dl>
  </BaseCard>
</template>
