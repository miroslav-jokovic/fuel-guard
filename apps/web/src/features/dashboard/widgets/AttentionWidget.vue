<script setup lang="ts">
/**
 * What needs me — the page's answer to "is anything wrong", as a column of counts with doors
 * (D-FO6; Q-FO7 ruled (a): a fixed editorial order, not a ranking by dollars the rows cannot all
 * carry). Top-right, where the eye lands after the hero.
 *
 * ── EACH ROW SAYS WHAT IT IS COUNTING, BECAUSE THEY DIFFER ───────────────────────────────────────
 * Open cases and open findings are CURRENT STATE — what is open now, whatever the range picker
 * says — and carry no pill (D-DR12: a snapshot has no previous period). Declines and idle hours are
 * what the RANGE turned up and say so in their caption; idle hours carry the pill, declines do not,
 * because a decline count moving 3 → 5 is not a trend anybody should act on.
 *
 * ── MONEY ────────────────────────────────────────────────────────────────────────────────────────
 * The one dollar figure here is the idle row's "$X at the pump", shown only behind `canSeeMoney`;
 * the hours are the number a dispatcher acts on and stay for everyone (Q-LM-F1's reasoning on the
 * old "Idle waste" tile, kept).
 */
import { computed } from "vue";
import { ShieldExclamationIcon } from "@silvicom/ui/icons";
import { AppDelta } from "@silvicom/ui";
import { deltaLabel, deltaTone } from "@silvicom/shared";
import ChartCard from "@/components/ui/ChartCard.vue";
import DoorLink from "@/components/ui/DoorLink.vue";
import { useFindingsSummaryQuery } from "@/composables/useFindingsSummary";
import { useFleetWidgetData, fmtInt, type FleetRange } from "../fleetWidgetData";
import { viz, fmtCompact, fmtMoney } from "@/lib/chartTheme";

const props = defineProps<{ range: FleetRange }>();
const { s, isLoading, canSeeMoney, deltas, previousLabel } = useFleetWidgetData(computed(() => props.range));
const { data: findings } = useFindingsSummaryQuery();

const sev = computed(() => s.value?.anomaliesBySeverity ?? { low: 0, medium: 0, high: 0, critical: 0 });
const ORDER = ["critical", "high", "medium", "low"] as const;
const sevTotal = computed(() => ORDER.reduce((n, k) => n + sev.value[k], 0));
const sevPct = (k: (typeof ORDER)[number]) => (sevTotal.value > 0 ? (sev.value[k] / sevTotal.value) * 100 : 0);
const sevLine = computed(() => ORDER.map((k) => `${fmtInt(sev.value[k])} ${k}`).join(" · "));

const idlePill = computed(() => {
  const d = deltas.value.idleHours;
  return d ? { direction: d.direction, tone: deltaTone(d, false), label: deltaLabel(d), against: previousLabel.value } : null;
});

const v = (n: number | null | undefined) => (isLoading.value || n == null ? "—" : fmtInt(n));
</script>

<template>
  <ChartCard title="Needs attention" subtitle="Open now, and what the range turned up" :icon="ShieldExclamationIcon" tone="danger" class="h-full">
    <ul class="divide-y divide-edge-subtle">
      <li class="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 py-3 first:pt-0">
        <span class="text-sm font-medium text-ink">Card declines</span>
        <span class="text-lg font-bold tabular-nums text-ink" data-test="attention-declines">{{ v(s?.declinedCount) }}</span>
        <span class="col-span-2 flex flex-wrap items-center justify-between gap-x-2 text-xs text-ink-tertiary">
          <span>blocked at the pump · in range</span>
          <DoorLink to="/fuel-log?tab=declines">Review</DoorLink>
        </span>
      </li>

      <li class="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 py-3">
        <span class="text-sm font-medium text-ink">Open cases</span>
        <span class="text-lg font-bold tabular-nums text-ink" data-test="attention-cases">{{ v(s?.openAnomalies) }}</span>
        <!-- Severity as a stacked bar, not a ring (D-FO4, Q-DT3): four ordered buckets read in one
             pass; the text line under it is the accessible reading. -->
        <span class="col-span-2 mt-1 flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
          <span v-for="k in ORDER" :key="k" class="block h-full" :style="{ width: `${sevPct(k)}%`, backgroundColor: viz.severity[k] }" /> <!-- token-check-disable-line: token-resolved chart color -->
        </span>
        <span class="col-span-2 flex flex-wrap items-center justify-between gap-x-2 text-xs text-ink-tertiary">
          <span>{{ sevLine }}</span>
          <DoorLink to="/anomalies">Cases</DoorLink>
        </span>
      </li>

      <li class="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 py-3">
        <span class="text-sm font-medium text-ink">Open findings</span>
        <span class="text-lg font-bold tabular-nums text-ink" data-test="attention-findings">{{ v(findings?.open) }}</span>
        <span class="col-span-2 flex flex-wrap items-center justify-between gap-x-2 text-xs text-ink-tertiary">
          <span>need somebody · open now</span>
          <DoorLink to="/findings">Assign</DoorLink>
        </span>
      </li>

      <li class="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 py-3 last:pb-0">
        <span class="text-sm font-medium text-ink">Idle hours</span>
        <span class="text-lg font-bold tabular-nums text-ink" data-test="attention-idle">{{ v(s?.idleHours == null ? null : Math.round(s.idleHours)) }}</span>
        <span class="col-span-2 flex flex-wrap items-center justify-between gap-x-2 text-xs text-ink-tertiary">
          <span class="flex items-center gap-1.5">
            <AppDelta v-if="idlePill" v-bind="idlePill" />
            <span v-if="canSeeMoney && s" :title="fmtMoney(s.idleCostUsd)">${{ fmtCompact(s.idleCostUsd) }} at the pump · in range</span>
            <span v-else>in range</span>
          </span>
          <DoorLink to="/idling">Idling</DoorLink>
        </span>
      </li>
    </ul>
  </ChartCard>
</template>
