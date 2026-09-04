<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useCpmQuery, type CpmFilter } from "@/features/accounting/useCpm";
import CpmTruckTable from "@/features/accounting/CpmTruckTable.vue";
import CpmOwnerOperatorTable from "@/features/accounting/CpmOwnerOperatorTable.vue";
import CpmFleetTotal from "@/features/accounting/CpmFleetTotal.vue";
import IncomeStatementTable from "@/features/accounting/IncomeStatementTable.vue";
import FamilySummaryTable from "@/features/accounting/FamilySummaryTable.vue";
import { useIncomeStatementQuery } from "@/features/accounting/useIncomeStatement";
import { useMileageCoverageQuery } from "@/features/accounting/useMileageCoverage";
import FleetOverview from "@/features/accounting/FleetOverview.vue";
import FleetTrendChart from "@/features/accounting/FleetTrendChart.vue";
import { useFleetReportQuery } from "@/features/accounting/useFleetReport";
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
const includeOwnerOperators = ref(false);
const unitSearch = ref("");
// Idle trucks are the report's loudest distortion: a unit that moved 4 miles and carries a whole
// month of fixed cost prints a four-figure $/mi and drags the eye off the fleet. The floor hides
// the row without touching the arithmetic — the figures above still come from the harness, over
// every truck — and it defaults OFF so nothing is hidden until the reader asks for it.
const minMiles = ref("0");

/**
 * Views of one period, so each table gets a page to itself (owner ruling, 2026-08-29). They used to
 * be stacked on one scroll: 169 truck rows, then the contractors, then the ledger check, which read
 * as one report with two footnotes rather than answers to separate questions.
 *
 * The route is `/fleet-report` since G7; the file keeps its `Cpm` name until the rename lands in
 * the file tree, which is a move with no behaviour in it.
 */
type CpmTab = "overview" | "trucks" | "contractors" | "fleet" | "statement";
const TABS: TabItem[] = [
  { value: "overview", label: "Overview" },
  { value: "trucks", label: "Per truck" },
  { value: "contractors", label: "Contractors" },
  { value: "fleet", label: "Company total" },
  { value: "statement", label: "Income statement" },
];
// Overview leads (G5). It answers the question a boss actually opens the page with — did we make
// money this period, and where did it go — and the per-truck table, which used to be first, answers
// a follow-up. A page that opens on a hundred and seventy rows reads as a database, not a report.
const tab = ref<CpmTab>("overview");

/**
 * The income statement (G3) — the same period, read as the owner's printed McLeod P&L.
 *
 * Its own query rather than a field on the CPM report: the statement is the whole ledger for the
 * period and the CPM report is a fleet calculation over part of it, they answer different
 * questions, and loading ninety-four account rows to render a per-truck table would make every
 * other tab slower for nothing. `useQuery` fetches it when the tab is opened and caches it after.
 */
const statementFilter = computed(() => ({ from: from.value, to: to.value }));
const {
  data: statement,
  isLoading: statementLoading,
  isError: statementError,
} = useIncomeStatementQuery(statementFilter);

/**
 * How many trucks this period measured, and whether that is all of them (G4 + G10).
 *
 * It rides beside every tab rather than inside one, because it is the answer to "can a per-mile
 * figure be trusted for this period at all". Samsara telematics finished rolling out during 2026,
 * so an early-2026 period measured fewer trucks than delivered loads and its cost per mile reads
 * low on miles and high on cost. The banner is how that stops being invisible.
 */
const { data: coverage } = useMileageCoverageQuery(statementFilter);

/**
 * The fleet report (G1/G5) — one call carrying the whole overview.
 *
 * Its own query beside the CPM one because they answer different questions over the same period:
 * this is the ledger for the fleet, that is a per-truck calculation. Loading either to render the
 * other would make every tab wait for work it does not use.
 */
const {
  data: fleet,
  isLoading: fleetLoading,
  isError: fleetError,
} = useFleetReportQuery(statementFilter);

const filter = computed<CpmFilter>(() => ({
  from: from.value,
  to: to.value,
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
watch([unitSearch, minMiles, from, to, includeOwnerOperators, tab], () => (page.value = 1));

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

// A truck that barely moved earns a handful of dollars over a handful of miles, so its rate is
// arithmetically right and analytically useless. These are the thresholds an owner reads the report
// at; "any" is the default so the table starts by hiding nothing.
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
/** The comparative line under a statement headline. Absent when the period has no wider window. */
const statementToDateSub = (n: number | null) => (n === null ? undefined : `${fmtUsd(n)} year to date`);

const pageDescription = computed(() =>
  tab.value === "overview"
    ? "What the fleet earned, spent and kept — and each of those for every mile it ran."
    : tab.value === "statement"
      ? "The general ledger, in the shape McLeod prints it."
      : "What each truck drove and earned. There is no per-truck cost figure that is precise, so there is none here.",
);
const fmtMiles = (n: number) => Math.round(n).toLocaleString();

// The McLeod financial sweep's last landing, in the reader's own words. Null is said out loud.
const figuresAsOf = computed(() => {
  if (!provenance.value) return "";
  const at = provenance.value.financialSweptAt;
  if (!at) return " McLeod figures have never been swept for this organisation.";
  const d = new Date(at);
  return ` McLeod figures as of ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}.`;
});

const visibleCount = computed(() => (tab.value === "trucks" ? trucks.value.length : ownerOperators.value.length));
const countLabel = computed(() => (tab.value === "trucks" ? "trucks" : "contractors"));
</script>

<template>
  <div class="space-y-6">
    <!-- "Figures as of" is the sweep's own stamp (D-FIN3), never the page's clock: a report that
         looks current while its source stopped three weeks ago is the failure the audit found. -->
    <!-- The description follows the tab, because the page now answers two different questions.
         Overview and the income statement are about the whole fleet from the ledger; the per-truck
         tabs are about the allocation harness. One sentence describing both would describe
         neither. -->
    <PageHeader :description="`${pageDescription}${figuresAsOf}`" />

    <!--
      The method, one click away. Every sentence here used to sit in the page description or in
      trailing cards, in front of the figures rather than behind them — and none of it can be lost:
      a cost-per-mile number whose assumptions are invisible is worse than none, because it gets
      quoted. The caveats are generated by the harness from what happened in THIS run.
    -->
    <ExplainerPanel>
      <p>
        Money comes from McLeod's general ledger and miles from Samsara. Nothing is estimated and
        nothing is shared out: the overview and the income statement are the ledger's own totals over
        the period, and every rate is that total divided by the miles Samsara measured.
      </p>
      <p>
        The per-truck tab shows only what is precise for one truck — the miles it drove and what its
        loads earned. There is no per-truck cost column, because no source at this carrier can put a
        lease payment, an insurance premium or an office wage on a particular truck, and a column
        that looks measured but is estimated is worse than one that is missing.
      </p>
      <ul v-if="provenance?.notes.length" class="space-y-1">
        <li v-for="n in provenance?.notes ?? []" :key="n" class="text-xs text-ink-tertiary">• {{ n }}</li>
      </ul>
    </ExplainerPanel>

    <!-- The fleet stat strip went at G7 with the allocation apparatus it reported. It carried
         "cost per mile", "left per mile" and "shared costs per mile" — every one of them a figure
         built by sharing overhead across trucks, which nothing does any more (D-FLEET8). It is also
         what put two different "earned per mile" numbers on one screen; the overview's, from the
         ledger, is now the only one. -->

    <!-- The coverage banner (G10). A period whose miles are short of its trucks cannot carry a
         per-mile figure at all, and saying so once, at the top, beats a dash on every row. -->
    <p
      v-if="coverage?.reason"
      class="rounded-control bg-warning-50 px-3 py-2 text-sm text-warning-700 ring-1 ring-inset ring-warning-600/20"
    >
      {{ coverage.reason }}
    </p>
    <p v-else-if="coverage?.trucks" class="text-sm text-ink-secondary">
      <span class="font-semibold text-ink">{{ coverage.trucks }}</span> trucks ran in this period and
      Samsara measured every one of them, over
      <span class="font-semibold text-ink">{{ fmtMiles(coverage.miles ?? 0) }}</span> miles.
      <template v-if="coverage.months[0]?.emptyPct !== null && coverage.months[0]?.emptyPct !== undefined">
        <span class="text-ink-tertiary">
          {{ coverage.months[0].emptyPct }}% of those miles carried no load.
        </span>
      </template>
    </p>

    <!-- The ledger's own shortfall (G11) is NOT a page-level banner, unlike the mileage one above.
         It affects only the two tabs that read the ledger — the overview and the income statement —
         and both say it themselves; a banner as well printed the same sentence twice on one screen.
         The per-truck tabs come from the CPM harness and are unaffected by it. -->
    <AppTabs v-model="tab" :tabs="TABS" label="Fleet report views" id-prefix="fleet-report" />

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

    <!-- The overview (G5): earned, spent, kept — for the whole fleet, for our trucks and for
         contractors — and each of those per mile when the period's mileage covers the fleet. -->
    <div v-if="tab === 'overview'">
      <p v-if="fleetError" class="text-sm text-danger-600">
        The overview could not be loaded. Try the period again in a moment.
      </p>
      <FleetOverview v-else-if="fleet" :report="fleet" :loading="fleetLoading" />
      <p v-else class="text-sm text-ink-secondary">Loading the overview…</p>

      <!-- The trend (G9). The overview says what this period did; the trend says whether that is
           where the fleet has been sitting or where it has just moved to, which is the difference
           between a figure and a decision. It ends on the period on screen and reads its own
           twelve months back, so widening the picker does not stretch the chart. -->
      <FleetTrendChart class="mt-4" :to="to" />
    </div>

    <!-- The income statement (G3): the period's ledger in the shape the owner's own printed P&L
         takes. Sections in McLeod's order, accounts by code inside each, and a row opens to show
         which parts of McLeod posted it. -->
    <div v-if="tab === 'statement'" class="space-y-4">
      <p v-if="statementError" class="text-sm text-danger-600">
        The income statement could not be loaded. Try the period again in a moment.
      </p>

      <template v-else-if="statement">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Earned" :value="fmtUsd(statement.revenue)" :sub="statementToDateSub(statement.toDateRevenue)" />
          <StatCard label="Spent" :value="fmtUsd(statement.expenses)" :sub="statementToDateSub(statement.toDateExpenses)" />
          <StatCard
            label="Kept"
            :value="fmtUsd(statement.net)"
            :sub="statementToDateSub(statement.toDateNet)"
            :sub-tone="statement.net < 0 ? 'text-danger-600' : undefined"
          />
        </div>

        <!-- A month the sweep reached mid-month is not a month the sweep has not reached: its rows
             are staged and real, and they are left out because part of a month reported as the
             month is a precise wrong answer (G11). -->
        <p v-if="statement.ledgerReason" class="text-sm text-warning-700">{{ statement.ledgerReason }}</p>
        <p v-if="statement.monthsMissing.length" class="text-sm text-warning-700">
          The McLeod sweep has not reached
          {{ statement.monthsMissing.join(", ") }}, so
          {{ statement.monthsMissing.length === 1 ? "that month is" : "those months are" }}
          missing from these figures.
        </p>
        <p v-if="statement.unrecognisedNet !== 0" class="text-sm text-warning-700">
          {{ fmtUsd(statement.unrecognisedNet) }} sits in an account group this report does not
          recognise. It is shown below and counted in neither total.
        </p>

        <!-- The family summary (G6) leads the statement. Ninety-four rows is the document the
             owner reconciles; ten rows is the answer a boss acts on, and the second cannot be
             derived from the first — the grouping is signed (see glFamilies.ts). It reads from the
             fleet report because that call holds the miles as well as the lines; the statement
             below is the same money in McLeod's own order. -->
        <FamilySummaryTable
          v-if="fleet"
          :families="fleet.families"
          :show-to-date="statement.toDateRevenue !== null"
          :loading="fleetLoading"
        />

        <IncomeStatementTable
          v-for="section in statement.sections"
          :key="section.typeId ?? 'unclassified'"
          :section="section"
          :loading="statementLoading"
          :show-to-date="statement.toDateRevenue !== null"
        />

        <p class="text-xs text-ink-tertiary">
          Straight from McLeod's own ledger, grouped and ordered the way McLeod prints it. Money is
          reported by whole calendar month, because that is the grain the ledger keeps — a period
          that covers part of a month shows the whole month
          <template v-if="statement.monthsCovered.length">
            ({{ statement.monthsCovered.join(", ") }})</template
          >. Year to date runs from {{ statement.toDateFrom }}.
        </p>
      </template>

      <p v-else class="text-sm text-ink-secondary">Loading the income statement…</p>
    </div>

    <DataWorkspace v-if="tab === 'trucks' || tab === 'contractors'">
      <FilterBar
        v-model:search="unitSearch"
        embedded
        :search-placeholder="tab === 'trucks' ? 'Search by truck number…' : ''"
        :count="visibleCount"
        :count-label="countLabel"
      >
        <template #filters>
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
        :error="isError ? (error instanceof Error ? error.message : 'Failed to load') : null"
        @update:page="page = $event"
      />
    </DataWorkspace>
  </div>
</template>
