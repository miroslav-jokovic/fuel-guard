<script setup lang="ts">
/**
 * The compact scan strip: the five measured figures, then what the checks made of them, then the
 * trust line. Secondary measures share one strip rather than competing as hero cards.
 *
 * The ledger tiles sit AFTER the five and not among them, because they answer a different kind of
 * question: the first five are what the fleet did, and these two are what somebody still has to do
 * about it. They are also the only tiles here that can be absent for a caller (C9's per-row gate),
 * so keeping them at the end means the strip does not reflow around a hole.
 */
import { computed } from "vue";
import { RouterLink } from "vue-router";
import {
  CurrencyDollarIcon, GallonsIcon, GaugeIcon, InvoiceIcon, RadarIcon,
  ReeferTruckIcon, RejectionIcon, RoadIcon,
} from "@silvicom/ui/icons";
import { AppCard as BaseCard } from "@silvicom/ui";
import { useFuelRangeTotals, type FuelFilters } from "@/composables/useFuelLog";
import { fuelTileDestinations } from "@/composables/dashboardFuelLinks";
import { useFindingsSummaryQuery, ledgerTiles } from "@/composables/useFindingsSummary";
import { applyMoneyGate } from "../moneyGate";
import { useFleetWidgetData, fmtInt, type FleetRange } from "../fleetWidgetData";
import { fmtMoney, fmtCompact } from "@/lib/chartTheme";

const props = defineProps<{ range: FleetRange }>();
const range = computed(() => props.range);
const { s, isLoading, canSeeMoney, mpgTotal, mpgSub, mpgTitle, rangeLabel } = useFleetWidgetData(range);

// The same UTC bounds `useDashboard` uses, so the fill count and miles cover exactly the fills
// behind the spend/gallons/MPG figures taken from the summary — the whole row stays consistent.
const fuelRange = computed<FuelFilters>(() => ({
  from: new Date(`${range.value.from}T00:00:00`).toISOString(),
  to: new Date(`${range.value.to}T23:59:59.999`).toISOString(),
}));
const { data: fuelTotals, isLoading: fuelLoading } = useFuelRangeTotals(fuelRange);
const { data: findings } = useFindingsSummaryQuery();

const ledgerStats = computed(() =>
  ledgerTiles(findings.value, { open: InvoiceIcon, money: CurrencyDollarIcon },
    { int: fmtInt, compact: fmtCompact, money: fmtMoney }),
);

const fuelingStats = computed(() => {
  const t = fuelTotals.value;
  const d = s.value;
  // Destinations live in `dashboardFuelLinks` — pure, and TOTAL over the strip's labels, so a tile
  // added here without a destination is a compiler error.
  const to = fuelTileDestinations(range.value);
  return [
    { label: "Fill-ups", value: t ? fmtInt(t.fillUps) : "—", sub: "in selected range", icon: InvoiceIcon, tone: "text-brand-600 bg-brand-50", to: to["Fill-ups"] },
    { label: "Gallons", value: d ? fmtInt(d.totalGallons) : "—", sub: "total fuel", icon: GallonsIcon, tone: "text-info-600 bg-info-50", to: to.Gallons },
    { label: "Miles driven", value: t ? fmtInt(t.totalMiles) : "—", sub: "odometer span in range", icon: RoadIcon, tone: "text-success-600 bg-success-50", to: to["Miles driven"] },
    { label: "Fuel spend", money: true as const, value: d ? `$${fmtCompact(d.totalSpend)}` : "—", valueTitle: d ? fmtMoney(d.totalSpend) : undefined, sub: "total cost", icon: CurrencyDollarIcon, tone: "text-success-600 bg-success-50", to: to["Fuel spend"] },
    { label: "Avg MPG", value: mpgTotal.value?.mpg != null ? mpgTotal.value.mpg.toFixed(1) : "—", valueTitle: mpgTitle.value, sub: mpgSub.value, icon: GaugeIcon, tone: "text-brand-600 bg-brand-50", to: to["Avg MPG"] },
  ];
});

const trust = computed(() => [
  {
    label: "Telematics coverage",
    value: s.value?.coveragePct != null ? `${s.value.coveragePct}%` : "—",
    // D-SAM7. The big number is the window the reader picked; the subtitle is the whole history, and
    // the pair is the point. Over 90 days this reads ~95% and looks healthy; against the carrier's
    // entire history on 2026-09-01 it was 23%, because 76.8% of fills had never had telematics
    // fetched at all. Showing only the first turned an unanswered question into a reassuring answer.
    sub: s.value?.allTimeCoveragePct != null ? `${s.value.allTimeCoveragePct}% all time` : "fills corroborated",
    icon: RadarIcon, tone: "text-info-600 bg-info-50", to: "/coverage",
  },
  {
    label: "Reefer fuel", money: true as const,
    value: s.value ? `$${fmtCompact(s.value.reeferSpend)}` : "—",
    valueTitle: s.value ? fmtMoney(s.value.reeferSpend) : undefined,
    sub: "refrigerated tank", icon: ReeferTruckIcon, tone: "text-info-600 bg-info-50", to: "/reefer-coverage",
  },
  {
    label: "Declined attempts",
    value: s.value ? String(s.value.declinedCount) : "—",
    sub: "blocked at the pump", icon: RejectionIcon,
    tone: (s.value?.declinedCount ?? 0) > 0 ? "text-caution-700 bg-caution-50" : "text-ink-muted bg-surface-muted",
    // FUEL-C2: the declines are a TAB of the Fuel Log now. `/rejections` still redirects and always
    // will, but a tile should name where the thing lives rather than lean on the compatibility path.
    to: "/fuel-log?tab=declines",
  },
]);

const metricStrip = computed(() =>
  applyMoneyGate([...fuelingStats.value, ...ledgerStats.value, ...trust.value], canSeeMoney.value),
);
</script>

<template>
  <BaseCard padding="none" as="section">
    <div class="border-b border-edge-subtle px-4 py-3">
      <h2 class="text-sm font-semibold text-ink">Operating metrics · {{ rangeLabel }}</h2>
    </div>
    <dl class="grid grid-cols-2 divide-x divide-y divide-edge-subtle sm:grid-cols-4 xl:grid-cols-8">
      <RouterLink
        v-for="stat in metricStrip"
        :key="stat.label"
        :to="stat.to"
        class="min-w-0 px-4 py-3 hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring"
      >
        <dt class="truncate text-xs font-medium text-ink-tertiary">{{ stat.label }}</dt>
        <dd class="mt-1 truncate text-lg font-semibold tabular-nums text-ink" :title="stat.valueTitle">
          {{ isLoading || fuelLoading ? "—" : stat.value }}
        </dd>
        <dd class="truncate text-xs text-ink-tertiary">{{ stat.sub }}</dd>
      </RouterLink>
    </dl>
  </BaseCard>
</template>
