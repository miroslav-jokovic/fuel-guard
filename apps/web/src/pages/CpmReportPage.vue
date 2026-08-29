<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { DeadheadTreatment } from "@silvicom/shared";
import { useCpmQuery, type CpmFilter } from "@/features/accounting/useCpm";
import CpmTruckTable from "@/features/accounting/CpmTruckTable.vue";
import CpmOwnerOperatorTable from "@/features/accounting/CpmOwnerOperatorTable.vue";
import CpmFleetTotal from "@/features/accounting/CpmFleetTotal.vue";
import { lastFullMonth } from "@/lib/dateWindow";
import { sortRows, toggleSort, type SortState } from "@/lib/sort";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import StatCard from "@/components/ui/StatCard.vue";
import ExplainerPanel from "@/components/ui/ExplainerPanel.vue";
import { AppButton as BaseButton, AppTabs, type TabItem } from "@silvicom/ui";

// Default window: the trailing full month — CPM is a period figure, and a part-month reads low
// on fixed-cadence costs. The caveats in the explainer are the harness's own, not the page's.
//
// Both ends are INCLUSIVE ("Jul 1 to Jul 31"), matching what the picker shows; `useCpm` converts
// the end to the API's exclusive bound. The old default wrote `to` as the 1st of the NEXT month to
// stand in for that conversion, which left the default correct and every hand-picked range one day
// short — the report simply read low, with nothing to show it had.
const defaultWindow = lastFullMonth();
const from = ref<string>(defaultWindow.from);
const to = ref<string>(defaultWindow.to);
const deadhead = ref<DeadheadTreatment>("estimate");
const includeOwnerOperators = ref(false);
const unitSearch = ref("");
// Idle trucks are the report's loudest distortion: a unit that moved 4 miles and carries a whole
// month of fixed cost prints a four-figure $/mi and drags the eye off the fleet. The floor hides
// the row without touching the arithmetic — the figures above still come from the harness, over
// every truck — and it defaults OFF so nothing is hidden until the reader asks for it.
const minMiles = ref("0");

/**
 * Three views of one period, so each table gets a page to itself (owner ruling, 2026-08-29). They
 * used to be stacked on one scroll: 169 truck rows, then the contractors, then the ledger check,
 * which read as one report with two footnotes rather than three answers to three questions.
 */
type CpmTab = "trucks" | "contractors" | "fleet";
const TABS: TabItem[] = [
  { value: "trucks", label: "Per truck" },
  { value: "contractors", label: "Contractors" },
  { value: "fleet", label: "Company total" },
];
const tab = ref<CpmTab>("trucks");

const filter = computed<CpmFilter>(() => ({
  from: from.value,
  to: to.value,
  deadhead: deadhead.value,
  includeOwnerOperators: includeOwnerOperators.value,
}));
const { data, isLoading, isError, error, refetch, isFetching } = useCpmQuery(filter);

const report = computed(() => data.value?.report ?? null);
const provenance = computed(() => data.value?.provenance ?? null);
const allTrucks = computed(() => report.value?.trucks ?? []);

/**
 * The visible rows. Filtering and sorting are deliberately CLIENT-side and view-only: the fleet
 * figures above, the caveats and the company total all come from the harness over the whole fleet,
 * and narrowing the table must never look like it changed them. A row hidden here is hidden, not
 * excluded from the arithmetic.
 */
const PAGE_SIZE = 20;
const page = ref(1);
const sort = ref<SortState>({ key: null, dir: "asc" });
const onSort = (key: string) => (sort.value = toggleSort(sort.value, key));
watch([unitSearch, minMiles, from, to, deadhead, includeOwnerOperators, tab], () => (page.value = 1));

const trucks = computed(() => {
  const q = unitSearch.value.trim().toLowerCase();
  const floor = Number(minMiles.value) || 0;
  const rows = allTrucks.value.filter(
    (t) => (!q || t.tractor_unit.toLowerCase().includes(q)) && t.totalMiles >= floor,
  );
  return sortRows(rows, sort.value);
});
const truckPage = computed(() => trucks.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const hiddenCount = computed(() => allTrucks.value.length - trucks.value.length);

const deadheadOptions = [
  { value: "estimate", label: "Include empty miles" },
  { value: "exclude", label: "Loaded miles only" },
];
// A truck that barely moved carries a whole month of fixed cost over a handful of miles, so its
// $/mi is arithmetically right and analytically useless. These are the thresholds an owner reads
// the report at; "any" is the default so the table starts by hiding nothing.
const minMilesOptions = [
  { value: "0", label: "Any mileage" },
  { value: "100", label: "100+ miles" },
  { value: "1000", label: "1,000+ miles" },
  { value: "5000", label: "5,000+ miles" },
];

const activeFilterCount = computed(
  () => (unitSearch.value.trim() ? 1 : 0) + (minMiles.value !== "0" ? 1 : 0),
);
function resetFilters() {
  unitSearch.value = "";
  minMiles.value = "0";
}

// The contractor side. `dealPct` is derived by the harness from pay ÷ revenue on that payee's own
// orders — never configured, so it reads back the contract rather than asserting one.
const ownerOperators = computed(() => report.value?.ownerOperators ?? []);
const ownerOpRevenue = computed(() => ownerOperators.value.reduce((a, o) => a + o.revenue, 0));
const ownerOpMargin = computed(() => ownerOperators.value.reduce((a, o) => a + o.netMargin, 0));
const ownerOpPage = computed(() =>
  ownerOperators.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE),
);

const fmtUsd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });
const fmtMiles = (n: number) => Math.round(n).toLocaleString();
// Cents stay the harness's unit; the PAGE speaks dollars per mile — $1.34, not 133.5¢.
const fmtCpm = (n: number) => `$${(n / 100).toFixed(2)}`;

const samsaraBasis = computed(() => report.value?.milesBasis === "samsara_actual");
const visibleCount = computed(() => (tab.value === "trucks" ? trucks.value.length : ownerOperators.value.length));
const countLabel = computed(() => (tab.value === "trucks" ? "trucks" : "contractors"));
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="What each truck costs and earns for every mile it drives." />

    <!--
      The method, one click away. Every sentence here used to sit in the page description or in
      trailing cards, in front of the figures rather than behind them — and none of it can be lost:
      a cost-per-mile number whose assumptions are invisible is worse than none, because it gets
      quoted. The caveats are generated by the harness from what happened in THIS run.
    -->
    <ExplainerPanel>
      <p>
        Every mile the trucks drove in the period, measured by Samsara where it has them, against
        every cost the ledger can place on a truck: fuel, driver pay, and the fixed monthly charges
        from the truck fixed-costs page.
      </p>
      <p>
        Costs that belong to no single truck — office wages, rent, interest — are shared out across
        the miles, so nothing is left out of the figure. Contractors are not in the per-truck table:
        they are paid a share of each load rather than costing us fuel and wages, so they have their
        own tab and the company total covers both.
      </p>
      <ul v-if="report?.caveats.length || provenance?.notes.length" class="space-y-1">
        <li v-for="c in report?.caveats ?? []" :key="c" class="text-sm text-ink-secondary">• {{ c }}</li>
        <li v-for="n in provenance?.notes ?? []" :key="n" class="text-xs text-ink-tertiary">• {{ n }}</li>
      </ul>
    </ExplainerPanel>

    <!-- The equation reads left to right — earned, cost, what is left — because that is the order
         the owner asks it in. -->
    <div v-if="report" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard
        label="Earned per mile"
        :value="fmtCpm(report.fleet.revenueCpm)"
        :sub="`${fmtUsd(report.fleet.revenueTotal)} over ${fmtMiles(report.fleet.totalMiles)} miles`"
      />
      <StatCard
        label="Cost per mile"
        :value="fmtCpm(report.fleet.totalCpm)"
        :sub="`${fmtCpm(report.fleet.directCpm)} fuel and pay + ${fmtCpm(report.fleet.fixedCpm)} fixed`"
      />
      <StatCard
        label="Left per mile"
        :value="fmtCpm(report.fleet.netCpm)"
        :sub="report.fleet.netCpm >= 0 ? 'earned minus cost' : 'each mile is losing money'"
        :sub-tone="report.fleet.netCpm >= 0 ? undefined : 'text-danger-700'"
      />
      <StatCard
        label="Miles driven"
        :value="fmtMiles(report.fleet.totalMiles)"
        :sub="samsaraBasis ? 'measured by Samsara, empty miles included' : `${fmtMiles(report.fleet.deadheadMilesEstimated)} empty miles estimated`"
      />
      <StatCard
        label="Total cost"
        :value="fmtUsd(report.fleet.directTotal + report.fleet.fixedTotal)"
        :sub="`against ${fmtUsd(report.fleet.revenueTotal)} earned on company trucks`"
      />
      <!-- This card used to read "Not in these figures" over the money the report declined to
           place. That was the complaint: a number nobody could act on, holding 38.9% of the fleet's
           cost. Overhead is now ON the trucks, so the card states what each mile carries of it —
           and if any is still withheld it says so in red rather than quietly. -->
      <StatCard
        label="Shared costs per mile"
        :value="fmtCpm(report.fleet.allocatedCpm)"
        :sub="report.excluded.unallocatedOverhead > 0
          ? `${fmtUsd(report.excluded.unallocatedOverhead)} could not be shared out`
          : 'office, rent and interest, spread over the miles'"
        :sub-tone="report.excluded.unallocatedOverhead > 0 ? 'text-danger-600' : undefined"
      />
    </div>

    <AppTabs v-model="tab" :tabs="TABS" label="Cost per mile views" id-prefix="cpm" />

    <!-- Contractors get their headline as prose, because the two numbers are a sentence: what they
         hauled, and what of it we kept. -->
    <p v-if="tab === 'contractors' && ownerOperators.length" class="text-sm text-ink-secondary">
      Contractors hauled <span class="font-semibold text-ink">{{ fmtUsd(ownerOpRevenue) }}</span> in this
      period, of which we kept <span class="font-semibold text-ink">{{ fmtUsd(ownerOpMargin) }}</span
      >. They are paid a share of each load, so they carry no share of the company's costs.
    </p>

    <CpmFleetTotal
      v-if="tab === 'fleet' && provenance?.glCheck?.monthsCovered?.length"
      :gl="provenance.glCheck"
      :loading="isLoading"
    />
    <p v-else-if="tab === 'fleet'" class="text-sm text-ink-secondary">
      The company total needs the ledger for a whole month. Pick a period that covers one, or run the
      McLeod sweep for this one.
    </p>

    <DataWorkspace v-if="tab !== 'fleet'">
      <FilterBar
        v-model:search="unitSearch"
        embedded
        :search-placeholder="tab === 'trucks' ? 'Search by truck number…' : ''"
        :count="visibleCount"
        :count-label="countLabel"
      >
        <template #filters>
          <!-- Hidden, correctly, when Samsara measured the period: `computeCpm` picks ONE basis
               fleet-wide (owner ruling 2026-08-27) and ignores the empty-miles rule entirely under
               `useActual`, so rendering this control there would offer a switch wired to nothing.
               The basis in force is stated on the Miles driven card and in the explainer. -->
          <FilterSelect v-if="!samsaraBasis && tab === 'trucks'" v-model="deadhead" label="Which miles" :options="deadheadOptions" />
          <FilterSelect v-if="tab === 'trucks'" v-model="minMiles" label="Least miles" :options="minMilesOptions" />
          <DateRangeFilter :from="from" :to="to" @update:from="(v) => (from = v ?? from)" @update:to="(v) => (to = v ?? to)" />
        </template>
        <template #actions>
          <BaseButton
            v-if="tab === 'trucks'"
            :variant="includeOwnerOperators ? 'secondary' : 'ghost'"
            size="sm"
            title="Contractor trucks are normally left out of this table, because their cost is a share of the load rather than our fuel and wages."
            @click="includeOwnerOperators = !includeOwnerOperators"
          >
            {{ includeOwnerOperators ? "Contractor trucks included" : "Company trucks only" }}
          </BaseButton>
          <BaseButton v-if="tab === 'trucks' && activeFilterCount" variant="ghost" size="sm" @click="resetFilters">Clear filters</BaseButton>
        </template>
      </FilterBar>

      <!-- Say what the table is not showing. A filtered view that looks like the whole fleet is how
           a per-truck number gets quoted as a fleet number. -->
      <p v-if="tab === 'trucks' && hiddenCount > 0" class="px-4 py-2.5 text-xs text-ink-tertiary sm:px-6">
        {{ hiddenCount }} {{ hiddenCount === 1 ? "truck is" : "trucks are" }} hidden by the filters above.
        The figures at the top of the page still cover every truck.
      </p>

      <CpmTruckTable
        v-if="tab === 'trucks'"
        :rows="truckPage"
        :samsara-basis="samsaraBasis"
        :loading="isLoading"
        :error="isError ? (error instanceof Error ? error.message : 'Failed to load') : null"
        :retrying="isFetching"
        :sort="sort"
        :page="page"
        :total="trucks.length"
        :total-unfiltered="allTrucks.length"
        :pending-sources="provenance?.pendingSources ?? []"
        :page-size="PAGE_SIZE"
        @sort="onSort"
        @retry="refetch"
        @update:page="page = $event"
      />
      <CpmOwnerOperatorTable
        v-else
        :rows="ownerOpPage"
        :page="page"
        :total="ownerOperators.length"
        :page-size="PAGE_SIZE"
        :loading="isLoading"
        @update:page="page = $event"
      />
    </DataWorkspace>
  </div>
</template>
