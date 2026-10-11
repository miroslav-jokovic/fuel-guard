<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import BuyDisciplineTab from "@/features/reconcile/BuyDisciplineTab.vue";
import DiscountCaptureCard from "@/features/reconcile/DiscountCaptureCard.vue";
import { useBuyFillsQuery } from "@/features/reconcile/useBuyFills";
import { useSpendLinesQuery } from "@/features/reconcile/useSpendLines";
import { usePolicyGallonsQuery } from "@/features/reconcile/usePolicyGallons";
import { useContractTotalsQuery } from "@/features/reconcile/useContractTotals";
import { useSpendFilters } from "@/features/reconcile/useSpendFilters";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useFuelPolicy, useRouteFuelSettings } from "@/composables/useRouteFuelSettings";

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
const { data: buyFillData, isLoading, isError, refetch: refetchFills } = useBuyFillsQuery(f.range);
// `fuel_buy_fills` takes no truck parameter, but a leg is a pair of fills on ONE vehicle, so dropping
// other trucks' rows after the fetch is exact (it cannot orphan a pair, lookback rows included). Without
// this the Trucks filter above applied to the brand cards and silently not to the fills (verdict 03,
// principle #6).
const buyFills = computed(() => {
  const all = buyFillData.value ?? [];
  const picked = f.vehicleIds.value;
  return picked.length ? all.filter((x) => picked.includes(x.vehicleId)) : all;
});
// The on-network share is a question about brands, which the fill sequence carries none of. The grades
// read tractor gallons ADDED UP in the database (Q-FSV16): they used to wait for every spend line, nine
// seconds with the sections empty, and now wait for one call.
const { data: cellData, isLoading: cellsLoading, isError: cellsError } = usePolicyGallonsQuery(queryFilters);
const cells = computed(() => cellData.value ?? []);
// The quote tile reads four database sums (Q-FSV18, `fuel_contract_totals`) and the rows behind it only when
// it is opened: before, its headline waited on every `fuel_spend_lines` row, nine seconds with the card
// absent. Neither request holds the grades up, and the card keeps its own states.
const { data: totals, isLoading: totalsLoading, isError: totalsError } = useContractTotalsQuery(queryFilters);
const quoteOpen = ref(false);
const { data: feedData, isLoading: feedLoading, isError: feedError } = useSpendLinesQuery(queryFilters, quoteOpen);
const lines = computed(() => feedData.value ?? []);
const policy = useFuelPolicy();
// `useFuelPolicy` answers with defaults while the settings are pending or failed, which reads as "no
// target set"; the same query (one key, no extra request) says which of those it is.
const { isLoading: settingsLoading, isError: settingsError } = useRouteFuelSettings();
/** Whether what the targets are graded from actually arrived. The quote card has its own state. */
const inputs = computed<"ready" | "loading" | "error">(() =>
  cellsError.value || settingsError.value ? "error" : cellsLoading.value || settingsLoading.value ? "loading" : "ready",
);
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

    <!-- No count until the fills answer: a pending or failed read is not "0 fills" (verdict E8). -->
    <FilterBar :count="buyFillData ? legs : null" count-label="fills in sequence">
      <template #filters>
        <DateRangeFilter v-model:from="f.from.value" v-model:to="f.to.value" label="Dates" />
        <FilterSelect v-model="f.vehicleIds.value" :options="truckOptions" label="Trucks" multiple />
        <BaseButton v-if="f.active.value" variant="ghost" @click="f.reset()">Clear filters</BaseButton>
      </template>
    </FilterBar>

    <!-- A truck filter strips the grade, since a target is a fleet commitment. A failed fill sequence is said
         inside the parts worked out from it; the targets read their own sums and stay (verdict E8). -->
    <BuyDisciplineTab
      :fills="buyFills"
      :cells="cells"
      :window="f.range.value"
      :fleet-wide="f.vehicleIds.value.length === 0"
      :policy="policy"
      :fills-state="isError ? 'error' : isLoading || !buyFillData ? 'loading' : 'ready'"
      @retry="refetchFills()"
      :inputs="inputs"
    />

    <!-- The quote tile reads four sums. Pending or failed, an empty default would say "no fill matched a
         quote", which is a finding about the fills and not about the request. -->
    <p v-if="totalsError" class="rounded-surface bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100">
      Couldn't load the purchases to compare with Pilot's quote. Reload to try again.
    </p>
    <p v-else-if="totalsLoading || !totals" class="text-sm text-ink-muted">Loading the purchases to compare with Pilot's quote…</p>
    <DiscountCaptureCard
      v-else
      v-model:open="quoteOpen"
      :totals="totals"
      :lines="lines"
      :lines-loading="feedLoading"
      :lines-error="feedError"
      :from="f.from.value"
      :to="f.to.value"
      @narrow="(a, b) => f.setWindow(a, b)"
    />
  </div>
</template>
