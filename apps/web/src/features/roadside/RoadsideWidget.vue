<script setup lang="ts">
/**
 * Roadside inspections — how are our trucks doing at the scale and the roadside? (FLEET-MANAGER-HOME-PLAN
 * §4 card 10, FM5).
 *
 * Four counts from `GET /api/roadside-inspections/summary`, over the last 90 days on the carrier's
 * calendar, each the length of the list its door opens (D-FM7, D-FM9): the inspections, then those
 * carrying a driver, a vehicle and a hazmat out-of-service order. Q-FM7 (a) built that list — the
 * Inspections inbox's first slice — so these figures could have a door at all.
 *
 * The three OOS figures overlap (a hazmat OOS order is also a vehicle one), so the card never totals
 * them; each row's caption says what it counts. The plan's clean-inspection rate is not here: "clean"
 * has no definition in the FMCSA sources we hold, and it waits on the owner's ruling (Q-FM8).
 */
import { computed } from "vue";
import { RoadIcon } from "@silvicom/ui/icons";
import ChartCard from "@/components/ui/ChartCard.vue";
import CountList, { type CountRow } from "@/components/ui/CountList.vue";
import { useRoadsideSummaryQuery } from "./useRoadsideInspections";
import { roadsideFeedSentence } from "./feedFreshness";
import { useOrgTimezone } from "@/composables/useOrgTimezone";

const { data: summary } = useRoadsideSummaryQuery();
const { zone } = useOrgTimezone();
// How current the record behind these figures is (IC1c): a figure from a feed that stopped is still
// shown — it is the last good record — but never without saying so.
const freshness = computed(() => (summary.value ? roadsideFeedSentence(summary.value.feed, zone.value) : null));

// `view=all`: the inbox opens on "Needs action" (Q-IC17), and each figure here counts the WHOLE list it opens.
const LIST = "/roadside-inspections?view=all&period=90d";
const rows = computed<CountRow[]>(() => [
  { key: "inspections", label: "Inspections", value: summary.value?.inspections ?? null, caption: "last 90 days", to: LIST, door: "Inspections" },
  { key: "driver-oos", label: "Driver out of service", value: summary.value?.driverOos ?? null, caption: "inspections with a driver OOS order", to: `${LIST}&oos=driver`, door: "Driver OOS", alarm: true },
  { key: "vehicle-oos", label: "Vehicle out of service", value: summary.value?.vehicleOos ?? null, caption: "inspections with a vehicle OOS order", to: `${LIST}&oos=vehicle`, door: "Vehicle OOS", alarm: true },
  { key: "hazmat-oos", label: "Hazmat out of service", value: summary.value?.hazmatOos ?? null, caption: "inspections with a hazmat OOS order", to: `${LIST}&oos=hazmat`, door: "Hazmat OOS", alarm: true },
]);
</script>

<template>
  <ChartCard title="Roadside inspections" subtitle="FMCSA's record, last 90 days" :icon="RoadIcon" tone="warning" class="h-full">
    <CountList :rows="rows" />
    <p v-if="freshness" class="mt-3 text-xs" :class="freshness.late ? 'text-caution-700' : 'text-ink-tertiary'" data-test="feed">{{ freshness.text }}</p>
  </ChartCard>
</template>
