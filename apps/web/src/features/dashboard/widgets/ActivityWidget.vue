<script setup lang="ts">
/**
 * What happened in the range — the four figures that appear nowhere else on the tab (D-FO7): one
 * card subdivided by hairlines, the "operating metrics" archetype every comp draws, kept.
 *
 * Reefer, Recovered, Declined, Fuel spend and Avg MPG left this strip: reefer is a slice of the
 * Fuel card, declines are a rail row, spend and MPG are the hero cards, and "Recovered" is a
 * Fuel costs figure that belongs on that page.
 *
 * ── CONTAINER QUERIES, NOT BREAKPOINTS ───────────────────────────────────────────────────────────
 * The old strip measured this trap three times (D-DR17, DR5, DR7a): the four-up cell at a 1024px
 * viewport and the two-up cell at a 390px viewport are nearly the same width, so any rule keyed on
 * the window gets one of them backwards. `@container` asks the only question that matters — how
 * wide is THIS card — and the thresholds are the measured ones: a cell needs ~208px for its widest
 * caption, so two-up from 26rem and four-up from 52rem.
 */
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { GallonsIcon, InvoiceIcon, RadarIcon, RoadIcon } from "@silvicom/ui/icons";
import { AppCard as BaseCard, AppDelta, AppIconChip } from "@silvicom/ui";
import { deltaLabel, deltaTone, type PeriodDelta } from "@silvicom/shared";
import { fuelTileDestinations } from "@/composables/dashboardFuelLinks";
import { useOpens } from "@/composables/useOpens";
import { useFleetWidgetData, fmtInt, type FleetRange } from "../fleetWidgetData";

const props = defineProps<{ range: FleetRange }>();
const range = computed(() => props.range);
const { s, isLoading, fuelTotals, fuelLoading, deltas, previousLabel } = useFleetWidgetData(range);
const opens = useOpens();

const pill = (d: PeriodDelta | null, upIsGood: boolean) =>
  d ? { direction: d.direction, tone: deltaTone(d, upIsGood), label: deltaLabel(d), against: previousLabel.value } : null;

const loading = computed(() => isLoading.value || fuelLoading.value);
const cells = computed(() => {
  const to = fuelTileDestinations(range.value);
  const t = fuelTotals.value, d = s.value;
  return [
    { label: "Fill-ups", value: t ? fmtInt(t.fillUps) : "—", sub: "in range", icon: InvoiceIcon, tone: "info" as const, to: to["Fill-ups"], delta: pill(deltas.value.fillUps, true) },
    { label: "Gallons", value: d ? fmtInt(d.totalGallons) : "—", sub: "total fuel", icon: GallonsIcon, tone: "info" as const, to: to.Gallons, delta: pill(deltas.value.gallons, false) },
    { label: "Miles driven", value: t ? fmtInt(t.totalMiles) : "—", sub: "odometer span in range", icon: RoadIcon, tone: "success" as const, to: to["Miles driven"], delta: pill(deltas.value.miles, true) },
    {
      label: "Telematics coverage",
      value: d?.coveragePct != null ? `${d.coveragePct}%` : "—",
      // D-SAM7: the big number is the picked window; the caption is the whole history, and the pair
      // is the point — 95% over 90 days read healthy while all-time was 23%.
      sub: d?.allTimeCoveragePct != null ? `${d.allTimeCoveragePct}% all time` : "fills corroborated",
      icon: RadarIcon, tone: "brand" as const, to: "/coverage", delta: null,
    },
  ];
});
</script>

<template>
  <BaseCard padding="none" as="section" class="@container" aria-label="Activity in range">
    <dl class="grid grid-cols-1 divide-y divide-edge-subtle @[26rem]:grid-cols-2 @[26rem]:divide-y-0 @[52rem]:grid-cols-4">
      <component
        :is="opens(c.to) ? RouterLink : 'div'"
        v-for="c in cells"
        :key="c.label"
        v-bind="opens(c.to) ? { to: c.to } : {}"
        class="group flex min-w-0 items-start gap-3 px-4 py-3.5 @[26rem]:border-l @[26rem]:border-edge-subtle @[26rem]:first:border-l-0 @[52rem]:[&:nth-child(3)]:border-l"
        :class="opens(c.to) && 'hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring'"
      >
        <AppIconChip :icon="c.icon" :tone="c.tone" size="sm" />
        <div class="min-w-0 flex-1">
          <dt class="truncate text-xs font-medium text-ink-tertiary">{{ c.label }}</dt>
          <dd class="mt-0.5 flex items-baseline gap-2">
            <span class="text-lg font-bold tabular-nums text-ink">{{ loading ? "—" : c.value }}</span>
            <AppDelta v-if="c.delta && !loading" v-bind="c.delta" />
          </dd>
          <dd class="truncate text-xs text-ink-tertiary">{{ c.sub }}</dd>
        </div>
      </component>
    </dl>
  </BaseCard>
</template>
