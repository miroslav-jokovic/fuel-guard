<script setup lang="ts">
import { computed, ref } from "vue";
import type { DeadheadTreatment } from "@silvicom/shared";
import { useCpmQuery, type CpmFilter } from "@/features/accounting/useCpm";
import { lastFullMonth } from "@/lib/dateWindow";
import { sortRows, toggleSort, type SortState } from "@/lib/sort";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import { AppCard as BaseCard, AppButton as BaseButton } from "@silvicom/ui";

// Default window: the trailing full month — CPM is a period figure, and a part-month reads low
// on fixed-cadence costs. The caveats below the numbers are the harness's own, not the page's.
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
// the row without touching the arithmetic — fleet totals below still come from the harness, over
// every truck — and it defaults OFF so nothing is hidden until the reader asks for it.
const minMiles = ref("0");

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
 * figures above, the caveats below and the GL card all come from the harness over the whole fleet,
 * and narrowing the table must never look like it changed them. A row hidden here is hidden, not
 * excluded from the arithmetic.
 */
const sort = ref<SortState>({ key: null, dir: "asc" });
const onSort = (key: string) => (sort.value = toggleSort(sort.value, key));

const trucks = computed(() => {
  const q = unitSearch.value.trim().toLowerCase();
  const floor = Number(minMiles.value) || 0;
  const rows = allTrucks.value.filter(
    (t) => (!q || t.tractor_unit.toLowerCase().includes(q)) && t.totalMiles >= floor,
  );
  return sortRows(rows, sort.value);
});
const hiddenCount = computed(() => allTrucks.value.length - trucks.value.length);

const deadheadOptions = [
  { value: "estimate", label: "Deadhead estimated" },
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

const fmtUsd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });
const fmtMiles = (n: number) => Math.round(n).toLocaleString();
// Cents stay the harness's unit; the PAGE speaks dollars per mile — $1.34, not 133.5¢.
const fmtCpm = (n: number) => `$${(n / 100).toFixed(2)}`;

// The miles columns follow the report's basis (owner ruling: Samsara actuals are the fleet's
// mileage truth; McLeod loaded stays as reference). The estimate columns appear only when the
// window has no Samsara miles and the harness fell back — and said so.
const samsaraBasis = computed(() => report.value?.milesBasis === "samsara_actual");
const columns = computed<DataTableColumn[]>(() => [
  { key: "tractor_unit", label: "Truck", cellClass: "font-mono text-xs", sortable: true },
  { key: "movements", label: "Trips", numeric: true, sortable: true },
  { key: "loadedMiles", label: "Loaded mi", numeric: true, cellClass: "text-ink-tertiary", sortable: true },
  ...(samsaraBasis.value
    ? [{ key: "totalMiles", label: "Samsara mi", numeric: true, sortable: true } as DataTableColumn]
    : [
        { key: "deadheadMilesEstimated", label: "Deadhead mi", numeric: true, cellClass: "text-ink-tertiary", sortable: true } as DataTableColumn,
        { key: "totalMiles", label: "Total mi", numeric: true, sortable: true } as DataTableColumn,
      ]),
  { key: "directFuel", label: "Fuel", numeric: true, sortable: true },
  { key: "directSettlement", label: "Driver pay", numeric: true, sortable: true },
  { key: "directTotal", label: "Direct cost", numeric: true, sortable: true },
  { key: "fixedCost", label: "Fixed cost", numeric: true, sortable: true },
  { key: "revenue", label: "Revenue", numeric: true, sortable: true },
  { key: "totalCpm", label: "Cost $/mi", numeric: true, sortable: true },
  { key: "revenueCpm", label: "Rev $/mi", numeric: true, sortable: true },
  { key: "netCpm", label: "Net $/mi", numeric: true, sortable: true },
]);
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Direct cost per mile for every company truck — measured miles, measured cost, and every assumption stated. Overhead stays unallocated until finance sets a rule; the caveats say exactly what each figure excludes." />

    <div v-if="report" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <BaseCard padding="sm">
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Net $ / mile</p>
        <p class="text-2xl font-bold text-ink">{{ fmtCpm(report.fleet.netCpm) }}</p>
        <p class="text-2xs text-ink-tertiary">revenue {{ fmtCpm(report.fleet.revenueCpm) }} − cost {{ fmtCpm(report.fleet.totalCpm) }}; read the caveats for what net still omits</p>
      </BaseCard>
      <BaseCard padding="sm">
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Cost $ / mile</p>
        <p class="text-2xl font-bold text-ink">{{ fmtCpm(report.fleet.totalCpm) }}</p>
        <p class="text-2xs text-ink-tertiary">direct {{ fmtCpm(report.fleet.directCpm) }} + fixed {{ fmtCpm(report.fleet.fixedCpm) }}</p>
      </BaseCard>
      <BaseCard padding="sm">
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Total miles</p>
        <p class="text-2xl font-bold text-ink">{{ fmtMiles(report.fleet.totalMiles) }}</p>
        <p class="text-2xs text-ink-tertiary">{{ samsaraBasis ? "Samsara measured, empty miles included" : `${fmtMiles(report.fleet.deadheadMilesEstimated)} estimated deadhead` }}</p>
      </BaseCard>
      <BaseCard padding="sm">
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Booked revenue</p>
        <p class="text-2xl font-bold text-ink">{{ fmtUsd(report.fleet.revenueTotal) }}</p>
        <p class="text-2xs text-ink-tertiary">GL-posted invoices on company trucks; cost in figures {{ fmtUsd(report.fleet.directTotal + report.fleet.fixedTotal) }}</p>
      </BaseCard>
      <BaseCard padding="sm">
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Not in these figures</p>
        <p class="text-2xl font-bold text-ink">{{ fmtUsd(report.excluded.unallocatedOverhead + report.excluded.ownerOperatorSettlement) }}</p>
        <p class="text-2xs text-ink-tertiary">unallocated overhead + owner-operator pool</p>
      </BaseCard>
    </div>

    <FilterBar v-model:search="unitSearch" search-placeholder="Search by truck unit…" :count="trucks.length" count-label="trucks">
      <template #filters>
        <!-- Hidden, correctly, when Samsara measured the window: `computeCpm` picks ONE basis
             fleet-wide (owner ruling 2026-08-27) and ignores the deadhead rule entirely under
             `useActual`, so rendering this control there would offer a switch wired to nothing.
             The basis in force is stated on the Total miles card and in the harness's caveats. -->
        <FilterSelect v-if="!samsaraBasis" v-model="deadhead" label="Miles basis" :options="deadheadOptions" />
        <FilterSelect v-model="minMiles" label="Min miles" :options="minMilesOptions" />
        <DateRangeFilter :from="from" :to="to" @update:from="(v) => (from = v ?? from)" @update:to="(v) => (to = v ?? to)" />
      </template>
      <template #actions>
        <BaseButton :variant="includeOwnerOperators ? 'secondary' : 'ghost'" size="sm" @click="includeOwnerOperators = !includeOwnerOperators">
          {{ includeOwnerOperators ? "Owner-operators included" : "Company trucks only" }}
        </BaseButton>
        <BaseButton v-if="activeFilterCount" variant="ghost" size="sm" @click="resetFilters">Clear filters</BaseButton>
      </template>
    </FilterBar>

    <!-- Say what the table is not showing. A filtered view that looks like the whole fleet is how
         a per-truck number gets quoted as a fleet number. -->
    <p v-if="hiddenCount > 0" class="text-xs text-ink-tertiary">
      {{ hiddenCount }} {{ hiddenCount === 1 ? "truck" : "trucks" }} hidden by the filters above. The fleet
      figures and the ledger below still cover every truck in the window.
    </p>

    <DataTable
      :columns="columns"
      :rows="trucks"
      row-key="tractor_unit"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load') : null"
      :retrying="isFetching"
      :sort="sort"
      @sort="onSort"
      @retry="refetch"
    >
      <template #empty>
        <!-- Two different emptinesses. "The filters matched nothing" is the reader's own doing and
             is fixed by clearing them; "the sweeps have not run" is the harness's, and naming the
             pending source is the whole point of the provenance block. -->
        <div v-if="allTrucks.length" class="space-y-1">
          <p>No truck matches these filters.</p>
          <p class="text-xs text-ink-tertiary">
            {{ allTrucks.length }} {{ allTrucks.length === 1 ? "truck is" : "trucks are" }} in the window. Clear
            the filters to see them.
          </p>
        </div>
        <div v-else class="space-y-1">
          <p>No cost per mile for this window yet.</p>
          <p v-for="s in provenance?.pendingSources ?? []" :key="s" class="text-xs text-ink-tertiary">{{ s }}</p>
        </div>
      </template>
      <template #cell-loadedMiles="{ value }">{{ fmtMiles(value) }}</template>
      <template #cell-deadheadMilesEstimated="{ value }">{{ fmtMiles(value) }}</template>
      <template #cell-totalMiles="{ value }">{{ fmtMiles(value) }}</template>
      <template #cell-directFuel="{ value }">{{ fmtUsd(value) }}</template>
      <template #cell-directSettlement="{ value }">{{ fmtUsd(value) }}</template>
      <template #cell-directTotal="{ value }">{{ fmtUsd(value) }}</template>
      <template #cell-fixedCost="{ value }">{{ fmtUsd(value) }}</template>
      <template #cell-revenue="{ value }">{{ fmtUsd(value) }}</template>
      <template #cell-totalCpm="{ value }">{{ fmtCpm(value) }}</template>
      <template #cell-revenueCpm="{ value }">{{ fmtCpm(value) }}</template>
      <template #cell-netCpm="{ value }">
        <span class="font-semibold" :class="value >= 0 ? 'text-ink' : 'text-danger-600'">{{ fmtCpm(value) }}</span>
      </template>
    </DataTable>

    <!-- The fleet truth: the GL for this window's months read as an income statement through
         McLeod's own account classes. EVERY dollar — office payroll, lease cheques, interest —
         where the table above holds only per-truck attributable cost. Proven to reproduce the
         owner's P&L to the dollar (2026-08-28 reconciliation). -->
    <BaseCard v-if="provenance?.glCheck?.monthsCovered?.length" padding="sm">
      <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Fleet truth — the general ledger for {{ provenance.glCheck.monthsCovered.join(", ") }}</p>
      <div class="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p class="text-2xs text-ink-tertiary">GL revenue</p>
          <p class="text-lg font-bold text-ink">{{ fmtUsd(provenance.glCheck.revenue) }}</p>
        </div>
        <div>
          <p class="text-2xs text-ink-tertiary">GL expenses — every dollar, not just per-truck</p>
          <p class="text-lg font-bold text-ink">{{ fmtUsd(provenance.glCheck.expenses) }}</p>
        </div>
        <div>
          <p class="text-2xs text-ink-tertiary">GL net income</p>
          <p class="text-lg font-bold" :class="provenance.glCheck.net >= 0 ? 'text-ink' : 'text-danger-600'">{{ fmtUsd(provenance.glCheck.net) }}</p>
        </div>
        <div>
          <p class="text-2xs text-ink-tertiary">GL net $ / mile</p>
          <p class="text-lg font-bold" :class="provenance.glCheck.netCpm >= 0 ? 'text-ink' : 'text-danger-600'">{{ fmtCpm(provenance.glCheck.netCpm) }}</p>
        </div>
      </div>
      <p class="mt-2 text-2xs text-ink-tertiary">The whole-fleet bottom line from McLeod's ledger. The per-truck table above attributes what CAN be attributed; the difference is unattributed overhead and the owner-operator pool — never missing money.</p>
      <p v-if="provenance.glCheck.monthsMissing.length" class="text-2xs text-danger-600">GL not yet swept for: {{ provenance.glCheck.monthsMissing.join(", ") }}</p>
      <p v-if="Math.abs(provenance.glCheck.unclassifiedNet) > 0.01" class="text-2xs text-danger-600">{{ fmtUsd(provenance.glCheck.unclassifiedNet) }} sits in accounts the staged chart of accounts cannot classify — re-run the agent sweep.</p>
    </BaseCard>

    <!-- The harness's own caveats — generated from what happened in THIS run. A CPM figure whose
         assumptions are invisible is worse than none, because it gets quoted. -->
    <BaseCard v-if="report?.caveats.length || provenance?.notes.length" padding="sm">
      <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Read before quoting</p>
      <ul class="mt-2 space-y-1">
        <li v-for="c in report?.caveats ?? []" :key="c" class="text-xs text-ink-secondary">{{ c }}</li>
        <li v-for="n in provenance?.notes ?? []" :key="n" class="text-xs text-ink-tertiary">{{ n }}</li>
      </ul>
    </BaseCard>
  </div>
</template>
