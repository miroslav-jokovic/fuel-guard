<script setup lang="ts">
/**
 * Where open cases concentrate — ONE ranked list with a Vehicles | Drivers switch (D-FO5), in
 * place of two identical cards that differed only in noun.
 *
 * "Open cases", not "risk": the rows rank by open anomaly count, which is what the data is. The
 * 2026-10-06 F02/F04 audit found human verdicts on these cases run to a high false-positive rate
 * (2,284 open, 4.6% assigned), so the card says what it counts and leaves "risk" for the day the
 * card-fraud plan's incident type gives it something sharper to rank by.
 *
 * The switch is local state, not the URL: it is a glance choice inside one card, and `?tab=` on
 * this page already means which DASHBOARD is open (D-DR24).
 */
import { computed, ref } from "vue";
import { TruckIcon } from "@silvicom/ui/icons";
import { AppSegmentedControl } from "@silvicom/ui";
import ChartCard from "@/components/ui/ChartCard.vue";
import RankedBarList from "../RankedBarList.vue";
import { useFleetWidgetData, type FleetRange } from "../fleetWidgetData";

const props = defineProps<{ range: FleetRange }>();
const { s } = useFleetWidgetData(computed(() => props.range));

const which = ref<"vehicles" | "drivers">("vehicles");
const OPTIONS = [
  { value: "vehicles", label: "Vehicles" },
  { value: "drivers", label: "Drivers" },
] as const;

const rows = computed(() => (which.value === "vehicles" ? s.value?.topVehiclesByRisk : s.value?.topDriversByRisk) ?? []);
const linkBase = computed(() => (which.value === "vehicles" ? "/vehicles" : "/drivers"));
const emptyLabel = computed(() => (which.value === "vehicles" ? "No flagged vehicles" : "No flagged drivers"));
</script>

<template>
  <ChartCard
    title="Where open cases concentrate"
    subtitle="Top five · bar length is open cases, red is critical"
    :icon="TruckIcon"
    tone="caution"
    class="flex h-full flex-col"
  >
    <template #meta>
      <AppSegmentedControl
        :model-value="which"
        :options="OPTIONS"
        label="Rank by"
        @update:model-value="which = $event as 'vehicles' | 'drivers'"
      />
    </template>
    <RankedBarList :rows="rows" :link-base="linkBase" :empty-label="emptyLabel" />
    <p class="mt-3 flex gap-4 text-2xs text-ink-tertiary" aria-hidden="true">
      <span class="flex items-center gap-1.5"><span class="inline-block h-2 w-2.5 rounded-detail bg-danger-600" /> Critical</span>
      <span class="flex items-center gap-1.5"><span class="inline-block h-2 w-2.5 rounded-detail bg-surface-muted" /> Other open</span>
    </p>
  </ChartCard>
</template>
