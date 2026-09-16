<script setup lang="ts">
/**
 * The headline strip — the money + risk figures, each tile drilling into its detail page.
 *
 * ⚠ Every currency figure passes through `applyMoneyGate` against `canView("accounting")`. The
 * WIDGET is gated `fuel` rather than `accounting`, deliberately: `fleet_manager` holds
 * `accounting: none` and gating the whole strip on money would take their headline away. That
 * per-element split is Q-LM-F1's ruling, and `moneyGate.ts` carries the reasoning — including why
 * "Idle waste" keeps its tile and its hours and loses only the dollars.
 */
import { computed } from "vue";
import { CurrencyDollarIcon, FireIcon, GaugeIcon, ShieldExclamationIcon } from "@silvicom/ui/icons";
import StatCard from "@/components/ui/StatCard.vue";
import { applyMoneyGate } from "../moneyGate";
import { useFleetWidgetData, type FleetRange } from "../fleetWidgetData";
import { viz, fmtMoney, fmtCompact } from "@/lib/chartTheme";

const props = defineProps<{ range: FleetRange }>();
const { s, isLoading, canSeeMoney, mpgTotal, mpgWeeks, mpgSub, mpgTitle, rangeLabel } =
  useFleetWidgetData(computed(() => props.range));

const statsRaw = computed(() => {
  const sev = s.value?.anomaliesBySeverity ?? { low: 0, medium: 0, high: 0, critical: 0 };
  const alerts = sev.critical + sev.high;
  return [
    {
      label: "Fuel spend", money: true as const,
      value: s.value ? `$${fmtCompact(s.value.totalSpend)}` : "—",
      valueTitle: s.value ? fmtMoney(s.value.totalSpend) : undefined,
      sub: rangeLabel.value, icon: CurrencyDollarIcon, tone: "text-success-600 bg-success-50",
      spark: s.value?.spendTrend.map((p) => p.value), sparkColor: viz.spend, to: "/transactions",
    },
    {
      label: "Fleet avg MPG",
      value: mpgTotal.value?.mpg != null ? String(mpgTotal.value.mpg) : "—",
      valueTitle: mpgTitle.value, sub: mpgSub.value, icon: GaugeIcon, tone: "text-brand-600 bg-brand-50",
      // A weekly spark, because there is no honest daily point to draw (D-MPG6).
      spark: mpgWeeks.value.map((p) => p.mpg), sparkColor: viz.brand, to: "/driver-performance",
    },
    {
      label: "Idle waste", money: true as const,
      // The one money tile with an honest operational twin, so a caller without `accounting` keeps
      // the hours — the number a dispatcher can act on — and loses only the dollars.
      withoutMoney: { value: s.value ? Math.round(s.value.idleHours).toLocaleString() : "—", sub: "idle hrs" },
      value: s.value ? `$${fmtCompact(s.value.idleCostUsd)}` : "—",
      valueTitle: s.value ? fmtMoney(s.value.idleCostUsd) : undefined,
      sub: s.value ? `${Math.round(s.value.idleHours).toLocaleString()} idle hrs` : undefined,
      icon: FireIcon, tone: "text-caution-700 bg-caution-50", to: "/idling",
    },
    {
      label: "Active alerts",
      value: s.value ? String(alerts) : "—",
      sub: s.value ? `${s.value.openAnomalies} open case${s.value.openAnomalies === 1 ? "" : "s"}` : undefined,
      icon: ShieldExclamationIcon,
      tone: alerts > 0 ? "text-danger-600 bg-danger-50" : "text-ink-muted bg-surface-muted",
      to: "/anomalies",
    },
  ];
});

const stats = computed(() => applyMoneyGate(statsRaw.value, canSeeMoney.value));
</script>

<template>
  <dl class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <StatCard v-for="stat in stats" :key="stat.label" v-bind="stat" size="hero" :loading="isLoading" />
  </dl>
</template>
