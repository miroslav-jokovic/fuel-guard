<script setup lang="ts">
/**
 * Fuel, for the Operations tab — is fuel behaving? (FLEET-MANAGER-HOME-PLAN §4 card 7).
 *
 * The summary Fleet overview is the detail of: fleet MPG against the previous period, open fuel cases
 * and idle hours, and the door to that tab. No money by construction (D-FM6) — none of the three reads
 * a currency field, so `applyMoneyGate` has nothing to decide here.
 *
 * ── ITS WINDOW IS FIXED AND SAYS SO (D-FM5) ──────────────────────────────────────────────────────
 * The Operations tab is NOW and has no range picker; this is the one card that needs a window at all,
 * so it takes the Dashboard's own default — the last 30 days to the carrier's today — and prints it.
 * Same window as Fleet overview opens on, so the two tabs agree until somebody picks another range.
 */
import { computed } from "vue";
import { GaugeIcon } from "@silvicom/ui/icons";
import { AppDelta } from "@silvicom/ui";
import { deltaLabel, deltaTone, shiftDay, todayInZone } from "@silvicom/shared";
import ChartCard from "@/components/ui/ChartCard.vue";
import CountList, { type CountRow } from "@/components/ui/CountList.vue";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { useFleetWidgetData } from "../fleetWidgetData";

const { zone } = useOrgTimezone();
const range = computed(() => {
  const today = todayInZone(new Date(), zone.value);
  return { from: shiftDay(today, -30), to: today };
});
const { s, mpgTotal, mpgPrevious, deltas, previousLabel, previousPhrase, rangeLabel } = useFleetWidgetData(range);

const readout = computed(() => (mpgTotal.value?.mpg != null ? `${mpgTotal.value.mpg} MPG` : "—"));
const delta = computed(() => {
  const d = deltas.value.mpg;
  return d ? { direction: d.direction, tone: deltaTone(d, true), label: deltaLabel(d, "abs"), against: previousLabel.value } : null;
});
const caption = computed(() =>
  mpgPrevious.value?.mpg != null ? `fleet MPG · vs ${mpgPrevious.value.mpg} ${previousPhrase.value}` : "fleet MPG",
);

const rows = computed<CountRow[]>(() => [
  { key: "cases", label: "Open fuel cases", value: s.value?.openAnomalies ?? null, caption: "open now", to: "/anomalies", door: "Cases" },
  { key: "idle", label: "Idle hours", value: s.value?.idleHours ?? null, caption: rangeLabel.value, to: "/idling", door: "Idling" },
]);
</script>

<template>
  <ChartCard
    title="Fuel"
    :subtitle="`Last 30 days · ${rangeLabel}`"
    :icon="GaugeIcon"
    tone="brand"
    :readout="readout"
    :caption="caption"
    class="h-full"
  >
    <template #beside-readout><AppDelta v-if="delta" v-bind="delta" /></template>
    <CountList :rows="rows" :more="{ to: '/?tab=fleet', label: 'Fleet overview' }" />
  </ChartCard>
</template>
