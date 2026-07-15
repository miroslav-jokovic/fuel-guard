<script setup lang="ts">
import { computed } from "vue";
import { FlagIcon, BoltIcon, MoonIcon, ClockIcon, MapPinIcon } from "@heroicons/vue/24/outline";
import BaseCard from "@/components/ui/BaseCard.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import type { PlanStopView } from "./useFuelPlan";

const props = defineProps<{
  stops: PlanStopView[];
  origin?: string;
  destination?: string;
  startFuelPct: number | null;
  tankCapacityGal: number | null;
  distanceMiles: number;
  arrivalFuelPct: number | null;
}>();

const pct = (gal: number) => (props.tankCapacityGal && props.tankCapacityGal > 0 ? Math.round((gal / props.tankCapacityGal) * 100) : null);
const money = (n: number | null) => (n == null ? null : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

interface Node {
  key: string;
  icon: unknown;
  tone: "success" | "brand" | "info" | "warning" | "caution";
  title: string;
  sub?: string;
  mile?: number;
  detail?: string;
  fuel?: string;
  tags: { label: string; tone: string }[];
}

const nodes = computed<Node[]>(() => {
  const out: Node[] = [];
  out.push({
    key: "start", icon: MapPinIcon, tone: "success", title: "Start", sub: props.origin,
    fuel: props.startFuelPct != null ? `Departing at ${props.startFuelPct}% fuel` : undefined, tags: [],
  });
  props.stops.forEach((s, i) => {
    const arrive = pct(s.arrivalGal);
    const after = pct(s.arrivalGal + s.gallons);
    if (s.kind === "rest") {
      out.push({
        key: `stop${i}`, icon: s.isOvernight ? MoonIcon : ClockIcon, tone: s.isOvernight ? "info" : "caution",
        title: s.isOvernight ? "Overnight reset (10 h)" : "30-min break", mile: s.milesAhead,
        detail: s.isOvernight ? "HOS drive limit reached — required rest before continuing." : "Required 30-minute break.",
        fuel: arrive != null ? `~${arrive}% fuel on arrival` : undefined, tags: [],
      });
    } else {
      const tags: { label: string; tone: string }[] = [];
      if (s.isEmergency) tags.push({ label: "Emergency", tone: "warning" });
      if (s.coversBreak) tags.push({ label: "Covers 30-min break", tone: "success" });
      if (s.isOvernight) tags.push({ label: "+ Overnight reset", tone: "info" });
      out.push({
        key: `stop${i}`, icon: BoltIcon, tone: s.isEmergency ? "warning" : "brand",
        title: `Fuel — ${s.stationName ?? s.brand ?? "Station"}`, sub: s.state ?? undefined, mile: s.milesAhead,
        detail: [
          `${s.gallons.toLocaleString()} gal`,
          s.netPrice != null ? `@ ${money(s.netPrice)}/gal` : "price unknown",
          s.cost != null ? `= ${money(s.cost)}` : null,
        ].filter(Boolean).join(" "),
        fuel: arrive != null && after != null ? `Arrive ~${arrive}% → fill to ~${after}%` : undefined,
        tags,
      });
    }
  });
  out.push({
    key: "dest", icon: FlagIcon, tone: "brand", title: "Destination", sub: props.destination,
    fuel: props.arrivalFuelPct != null ? `Arriving at ~${props.arrivalFuelPct}% fuel` : undefined, tags: [],
  });
  return out;
});

const DOT: Record<string, string> = {
  success: "bg-success-600 text-ink-inverse", brand: "bg-brand-600 text-ink-inverse",
  info: "bg-info-600 text-ink-inverse", warning: "bg-warning-500 text-ink-inverse", caution: "bg-caution-500 text-ink-inverse",
};
</script>

<template>
  <BaseCard>
    <h3 class="text-sm font-semibold text-ink">Itinerary</h3>
    <p class="mt-0.5 text-xs text-ink-muted">Start → fuel stops → destination, in order, respecting fuel, hours of service, and your rules.</p>
    <ol class="mt-4">
      <li v-for="(n, i) in nodes" :key="n.key" class="relative flex gap-3 pb-5 last:pb-0">
        <span v-if="i < nodes.length - 1" class="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-edge" aria-hidden="true" />
        <span class="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full" :class="DOT[n.tone]">
          <component :is="n.icon" class="size-4.5" aria-hidden="true" />
        </span>
        <div class="min-w-0 flex-1 pt-1">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="text-sm font-semibold text-ink">{{ n.title }}</span>
            <span v-if="n.mile != null" class="text-xs text-ink-muted">· mile {{ n.mile.toLocaleString() }}</span>
            <span v-for="t in n.tags" :key="t.label" :class="[BADGE_BASE, toneClass(t.tone)]">{{ t.label }}</span>
          </div>
          <p v-if="n.sub" class="truncate text-sm text-ink-secondary">{{ n.sub }}</p>
          <p v-if="n.detail" class="text-sm text-ink">{{ n.detail }}</p>
          <p v-if="n.fuel" class="text-xs text-ink-muted">{{ n.fuel }}</p>
        </div>
      </li>
    </ol>
  </BaseCard>
</template>
