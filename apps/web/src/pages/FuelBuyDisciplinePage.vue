<script setup lang="ts">
import { computed } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import BuyDisciplineTab from "@/features/reconcile/BuyDisciplineTab.vue";
import DiscountCaptureCard from "@/features/reconcile/DiscountCaptureCard.vue";
import { useBuyFillsQuery } from "@/features/reconcile/useBuyFills";
import { useSpendLinesQuery } from "@/features/reconcile/useSpendLines";
import { useSpendFilters } from "@/features/reconcile/useSpendFilters";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useFuelPolicy } from "@/composables/useRouteFuelSettings";

/**
 * Buy discipline — fuel bought in a dearer state and hauled into a cheaper one, and the fuel targets
 * graded (F13b, C8). It was the second of Fuel Spend's three tabs; FS2 made that page one report with
 * no tabs (R1, D-FSV1), and this is where the tab went (Q-FSV12), whole and unchanged.
 *
 * Not folded into the report: it reads a different source (`fuel_buy_fills`, the fill SEQUENCE with a
 * 14-day lookback, because a leg that crossed into the window needs its predecessor), it grades a
 * policy rather than reporting a cost, and it has two tables of its own where the report keeps one.
 * It shares the report's window and truck parameters, so a link from one opens the other on the same
 * days and trucks.
 *
 * The fills billed above Pilot's quote came with it. On the old page they were the "Billed against
 * contract" KPI's drill-down; the report keeps the net figure as a card, and the per-fill list — what a
 * claim is made from — is a buying check like the rest of this page. Its proper home is the Findings
 * inbox once `contractFindings` is wired (it never has been; `exceptions.ts`), which is noted in §4.
 */
const f = useSpendFilters();
const { data: vehicles } = useVehiclesQuery();
const truckOptions = computed(() => (vehicles.value ?? []).map((v) => ({ value: v.id, label: v.unit_number })));

const queryFilters = computed(() => ({ from: f.from.value, to: f.to.value, vehicleIds: f.vehicleIds.value }));
const { data: buyFillData, isLoading, isError } = useBuyFillsQuery(f.range);
const buyFills = computed(() => buyFillData.value ?? []);
// The on-network share is a question about brands, which the fill sequence carries none of.
const { data: feedData } = useSpendLinesQuery(queryFilters);
const lines = computed(() => feedData.value ?? []);
const policy = useFuelPolicy();
const legs = computed(() => buyFills.value.filter((x) => x.inWindow !== false).length);
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Fuel carried out of a dearer state into a cheaper one, the fuel targets graded, and fills billed above Pilot's quote." />

    <p
      v-if="f.windowNotice.value"
      class="rounded-surface bg-caution-50 px-4 py-2.5 text-sm text-caution-800 ring-1 ring-caution-100"
    >
      {{ f.windowNotice.value }}
    </p>

    <FilterBar :count="legs" count-label="fills in sequence">
      <template #filters>
        <DateRangeFilter v-model:from="f.from.value" v-model:to="f.to.value" label="Dates" />
        <FilterSelect v-model="f.vehicleIds.value" :options="truckOptions" label="Trucks" multiple />
        <BaseButton v-if="f.active.value" variant="ghost" @click="f.reset()">Clear filters</BaseButton>
      </template>
    </FilterBar>

    <p v-if="isError" class="rounded-surface bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100">
      Couldn't load the fill sequence for this window.
    </p>
    <!-- A truck filter strips the grade, since a target is a fleet commitment. -->
    <BuyDisciplineTab
      v-else
      :fills="buyFills"
      :lines="lines"
      :window="f.range.value"
      :fleet-wide="f.vehicleIds.value.length === 0"
      :policy="policy"
      :loading="isLoading"
    />

    <DiscountCaptureCard :lines="lines" :from="f.from.value" :to="f.to.value" @narrow="(a, b) => f.setWindow(a, b)" />
  </div>
</template>
