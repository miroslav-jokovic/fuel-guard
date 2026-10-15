<script setup lang="ts">
import { AppIcon, AppCard as BaseCard, FactList, type Fact } from "@silvicom/ui";
import {
  BoltIcon,
  CheckCircleIcon,
  ClockIcon,
  FlagIcon,
  MapPinIcon,
  PetrolPumpIcon,
  RoadIcon,
  TruckIcon,
} from "@silvicom/ui/icons";
import { computed } from "vue";
import type { PlanResult } from "./useFuelPlan";

const props = defineProps<{
  route: NonNullable<PlanResult["route"]>;
  origin?: string;
  destination?: string;
  waypoints?: string[];
  stopCount?: number;
  truck?: NonNullable<PlanResult["truck"]>;
  breakAdvice?: NonNullable<PlanResult["breakAdvice"]>;
}>();

// A clock the truck did not report is a blank, so FactList draws its em dash (D-US6).
const hoursLabel = (h: number | null | undefined) => (h == null ? null : `${h}h`);
const clocks = computed<Fact[]>(() =>
  props.truck
    ? [
        { label: "Drive", value: hoursLabel(props.truck.driveRemainingHours), numeric: true },
        { label: "Break in", value: hoursLabel(props.truck.breakInHours), numeric: true },
        { label: "Shift", value: hoursLabel(props.truck.shiftRemainingHours), numeric: true },
        { label: "Cycle", value: hoursLabel(props.truck.cycleRemainingHours), numeric: true },
      ]
    : [],
);

// HERE's estimated moving time. Legal drive is 11 h/day, so this also hints how many days the run takes.
const driveTime = computed(() => {
  const h = Math.floor(props.route.durationHours);
  const m = Math.round((props.route.durationHours - h) * 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
});
const drivingDays = computed(() => Math.max(1, Math.ceil(props.route.durationHours / 11)));
const facts = computed(() => [
  { icon: RoadIcon, label: "Distance", value: `${props.route.distanceMiles.toLocaleString()} mi` },
  { icon: ClockIcon, label: "Est. drive time", value: `${driveTime.value} (~${drivingDays.value} day${drivingDays.value > 1 ? "s" : ""} @ 11h)` },
  ...(props.stopCount != null ? [{ icon: PetrolPumpIcon, label: "Fuel stops", value: String(props.stopCount) }] : []),
]);
</script>

<template>
  <BaseCard>
    <h3 class="text-sm font-semibold text-ink">Route</h3>
    <ol class="mt-3 space-y-2">
      <li v-if="origin" class="flex items-start gap-2 text-sm">
        <AppIcon :icon="FlagIcon" class="mt-0.5 size-4 shrink-0 text-success-600" aria-hidden="true" />
        <span class="text-ink-secondary"><span class="font-medium text-ink">Start:</span> {{ origin }}</span>
      </li>
      <li v-for="(w, i) in waypoints ?? []" :key="i" class="flex items-start gap-2 text-sm">
        <AppIcon :icon="MapPinIcon" class="mt-0.5 size-4 shrink-0 text-ink-tertiary" aria-hidden="true" />
        <span class="text-ink-secondary"><span class="font-medium text-ink">Stop {{ i + 1 }}:</span> {{ w }}</span>
      </li>
      <li v-if="destination" class="flex items-start gap-2 text-sm">
        <AppIcon :icon="FlagIcon" class="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
        <span class="text-ink-secondary"><span class="font-medium text-ink">Destination:</span> {{ destination }}</span>
      </li>
    </ol>
    <!-- ui-adoption: not-a-fact-list — each figure is drawn with its own icon beside it, a route stat strip that FactList's label-over-value cell has no place for. -->
    <dl class="mt-4 grid grid-cols-1 gap-3 border-t border-edge pt-4 sm:grid-cols-3">
      <div v-for="f in facts" :key="f.label" class="flex items-center gap-2">
        <AppIcon :icon="f.icon" class="size-5 shrink-0 text-ink-tertiary" aria-hidden="true" />
        <div>
          <dt class="text-xs text-ink-muted">{{ f.label }}</dt>
          <dd class="text-sm font-semibold text-ink">{{ f.value }}</dd>
        </div>
      </div>
    </dl>

    <div v-if="truck" class="mt-4 border-t border-edge pt-4">
      <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div class="flex items-center gap-2">
          <AppIcon :icon="BoltIcon" class="size-5 shrink-0 text-ink-tertiary" aria-hidden="true" />
          <div>
            <dt class="text-xs text-ink-muted">Fuel level (live)</dt>
            <dd class="text-sm font-semibold text-ink">
              {{ truck.fuelPct != null ? truck.fuelPct + "%" : "—" }}
              <span v-if="truck.gallonsOnHand != null" class="font-normal text-ink-muted">· {{ truck.gallonsOnHand.toLocaleString() }} / {{ truck.tankCapacityGal.toLocaleString() }} gal</span>
            </dd>
          </div>
        </div>
        <div v-if="truck.reachableMiles != null" class="flex items-center gap-2">
          <AppIcon :icon="TruckIcon" class="size-5 shrink-0 text-ink-tertiary" aria-hidden="true" />
          <div>
            <dt class="text-xs text-ink-muted">Reachable now</dt>
            <dd class="text-sm font-semibold text-ink">{{ truck.reachableMiles.toLocaleString() }} mi <span class="font-normal text-ink-muted">(fuel + HOS)</span></dd>
          </div>
        </div>
      </div>
      <div class="mt-3">
        <p class="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">Hours of service (remaining)</p>
        <FactList :facts="clocks" data-testid="route-hos-clocks" />
      </div>
      <div v-if="breakAdvice && breakAdvice.breakDueMiles != null" class="mt-3 text-sm">
        <p v-if="breakAdvice.coincidesStopIndex != null" class="inline-flex items-center gap-1.5 rounded-control bg-success-50 px-2.5 py-1.5 font-medium text-success-800">
          <AppIcon :icon="CheckCircleIcon" class="size-4" aria-hidden="true" />
          Fuel stop {{ breakAdvice.coincidesStopIndex + 1 }} also covers your 30-min break (~mile {{ breakAdvice.breakDueMiles.toLocaleString() }}) — saves ~{{ breakAdvice.savesMinutes }} min.
        </p>
        <p v-else class="text-ink-secondary">
          Required 30-min break due around mile {{ breakAdvice.breakDueMiles.toLocaleString() }} (~{{ breakAdvice.breakDueHours }}h in). No fuel stop lands there — plan a standalone break, or fuel near it to combine.
        </p>
      </div>
    </div>
  </BaseCard>
</template>
