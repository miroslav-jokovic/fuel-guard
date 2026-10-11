<script setup lang="ts">
/**
 * Biggest savings on the table — the Fuel costs page's own opportunity rows, reused (D-FO9; Q-FO5
 * ruled (a)). "Ranked by dollars at stake" is the one 2026 pattern that mapped straight onto rows
 * the product already computes, so this card draws `FuelOpportunitiesStrip` in its card variant
 * rather than restating its query, its link rule or its "counted separately" caveat.
 *
 * Gated `accounting` in the catalogue: every row is a dollar figure, and there is no honest
 * non-money reading of "the biggest savings". The strip's own rows link into the findings inbox
 * only where that page opens for the reader (SP5), which it decides from `canOpenInbox`.
 */
import { computed } from "vue";
import { ChartBarSquareIcon } from "@silvicom/ui/icons";
import ChartCard from "@/components/ui/ChartCard.vue";
import DoorLink from "@/components/ui/DoorLink.vue";
import FuelOpportunitiesStrip from "./FuelOpportunitiesStrip.vue";
import { useFuelOpportunitiesQuery } from "./useFuelOpportunities";
import { useOpens } from "@/composables/useOpens";
import type { DayWindow } from "@silvicom/shared";

// `DayWindow` from shared, not the dashboard feature's `FleetRange` alias of the same shape: this
// file lives in `features/reconcile`, and a feature may not import another's internals.
const props = defineProps<{ range: DayWindow }>();
const opens = useOpens();
const opportunities = useFuelOpportunitiesQuery(computed(() => ({ from: props.range.from, to: props.range.to, vehicleIds: [] })));
</script>

<template>
  <ChartCard
    title="Biggest savings on the table"
    subtitle="Open fuel findings, ranked by dollars · the same rows as Fuel costs"
    :icon="ChartBarSquareIcon"
    tone="success"
    class="h-full"
  >
    <template #meta><DoorLink to="/fuel-spend">Fuel costs</DoorLink></template>
    <FuelOpportunitiesStrip
      variant="card"
      :rows="opportunities.data.value"
      :loading="opportunities.isLoading.value"
      :error="opportunities.isError.value"
      :from="range.from"
      :to="range.to"
      :vehicle-ids="[]"
      :can-open-inbox="opens('/fuel-problems')"
    />
  </ChartCard>
</template>
