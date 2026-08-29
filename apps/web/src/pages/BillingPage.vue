<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useInvoicesQuery, useMarginByTruckQuery, INVOICES_PAGE_SIZE } from "@/features/billing/useInvoices";
import { useDispatcherEarningsQuery } from "@/features/billing/useDispatcherEarnings";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { trailingDays } from "@/lib/dateWindow";
import { sortRows, toggleSort, type SortState } from "@/lib/sort";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import TablePagination from "@/components/TablePagination.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import StatCard from "@/components/ui/StatCard.vue";
import ExplainerPanel from "@/components/ui/ExplainerPanel.vue";
import { AppTabs, type TabItem } from "@silvicom/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";

/**
 * Three views of one window: what was invoiced, what each truck kept, who booked it.
 *
 * The strip is `AppTabs` (U4, D-UI4). It used to be hand-rolled here, with a comment saying the
 * design system had no Tabs primitive — true when it was written, false since U4 shipped, and the
 * copy carried the defect the primitive exists to fix: `role="tablist"` promises a screen reader
 * and a keyboard a roving tabindex and Left/Right/Home/End, and the hand-rolled strip had every
 * tab in the tab order and handled no keys at all.
 *
 * Margin per truck used to hang below the invoice table as a second card on the same scroll, which
 * made it look like a footnote to the invoices rather than the other half of the question. One
 * table per view, one date range shared across all three — moving between tabs to compare the same
 * month should not mean re-picking the month.
 */
type BillingTab = "invoices" | "trucks" | "dispatchers";
const TABS: TabItem[] = [
  { value: "invoices", label: "Invoices" },
  { value: "trucks", label: "Per truck" },
  { value: "dispatchers", label: "Per dispatcher" },
];
const tab = ref<BillingTab>("invoices");

// Inclusive dates, as the picker shows them; the query layer converts to the API's exclusive bound.
const defaultWindow = trailingDays(90);
const search = ref("");
const from = ref<string>(defaultWindow.from);
const to = ref<string>(defaultWindow.to);
const page = ref(1);
// The tab is a filter like any other as far as paging is concerned: page 4 of the invoices is not
// page 4 of the trucks, and carrying it across shows an empty table on a tab that has rows.
watch([search, from, to, tab], () => (page.value = 1));

const filter = computed(() => ({ q: search.value, from: from.value, to: to.value, page: page.value }));
const { data, isLoading, isError, error, refetch, isFetching } = useInvoicesQuery(filter);
const { data: margins, isLoading: marginsLoading } = useMarginByTruckQuery(from, to);
const { data: dispatchers, isLoading: dispatchersLoading } = useDispatcherEarningsQuery(from, to);
const { data: vehicles } = useVehiclesQuery();

const entries = computed(() => data.value?.entries ?? []);
const total = computed(() => data.value?.total ?? 0);
const unitById = computed(() => new Map((vehicles.value ?? []).map((v) => [v.id, v.unit_number])));

const CLIENT_PAGE_SIZE = 20;
const sort = ref<SortState>({ key: null, dir: "asc" });
const onSort = (key: string) => (sort.value = toggleSort(sort.value, key));
watch(tab, () => (sort.value = { key: null, dir: "asc" }));
const q = computed(() => search.value.trim().toLowerCase());

// Margin per truck, the unattributed bucket shown as its own honest row — never spread by a guess.
const marginRows = computed(() =>
  (margins.value ?? []).map((m) => ({
    ...m,
    key: m.vehicleId ?? "(unattributed)",
    unit: m.vehicleId ? (unitById.value.get(m.vehicleId) ?? m.vehicleId.slice(0, 8)) : "Unattributed",
  })),
);
const marginFiltered = computed(() =>
  sortRows(
    marginRows.value.filter((m) => !q.value || m.unit.toLowerCase().includes(q.value)),
    sort.value,
  ),
);

// A bill whose order carried no operations user is its own row, for the same reason the
// unattributed truck is: the money exists and hiding it would make the column stop summing.
const dispatcherRows = computed(() =>
  (dispatchers.value ?? []).map((d) => ({
    ...d,
    key: d.dispatcherUserId ?? "(unassigned)",
    name: d.dispatcherName ?? d.dispatcherUserId ?? "Unassigned",
  })),
);
const dispatcherFiltered = computed(() =>
  sortRows(
    dispatcherRows.value.filter((d) => !q.value || d.name.toLowerCase().includes(q.value)),
    sort.value,
  ),
);
const dispatcherTotal = computed(() => dispatcherRows.value.reduce((a, d) => a + d.revenue, 0));
const unpostedTotal = computed(() => dispatcherRows.value.reduce((a, d) => a + d.unpostedLoads, 0));

/** The visible slice for the two client-side tables. `:total` below stays the FILTERED count. */
const paged = <T,>(rows: T[]) => rows.slice((page.value - 1) * CLIENT_PAGE_SIZE, page.value * CLIENT_PAGE_SIZE);
const marginPage = computed(() => paged(marginFiltered.value));
const dispatcherPage = computed(() => paged(dispatcherFiltered.value));

const visibleCount = computed(() =>
  tab.value === "invoices" ? total.value : tab.value === "trucks" ? marginFiltered.value.length : dispatcherFiltered.value.length,
);
const countLabel = computed(() =>
  tab.value === "invoices" ? "invoices" : tab.value === "trucks" ? "trucks" : "dispatchers",
);
const searchPlaceholder = computed(() =>
  tab.value === "invoices" ? "Search by invoice reference…" : tab.value === "trucks" ? "Search by truck…" : "Search by dispatcher…",
);

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtUsd = (n: number | string) => Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });

const invoiceColumns: DataTableColumn[] = [
  { key: "occurred_at", label: "Date", cellClass: "text-ink-secondary" },
  { key: "category", label: "Charge type" },
  { key: "dispatcher_name", label: "Dispatcher" },
  { key: "amount", label: "Amount", numeric: true },
  { key: "external_id", label: "Reference", cellClass: "font-mono text-xs text-ink-secondary" },
];
const marginColumns: DataTableColumn[] = [
  { key: "unit", label: "Truck", cellClass: "font-medium text-ink", sortable: true },
  { key: "earnings", label: "Money in", numeric: true, sortable: true },
  { key: "expenses", label: "Money out", numeric: true, sortable: true },
  { key: "margin", label: "Kept", numeric: true, sortable: true },
  { key: "entries", label: "Lines", numeric: true, cellClass: "text-ink-tertiary", sortable: true },
];
const dispatcherColumns: DataTableColumn[] = [
  { key: "name", label: "Dispatcher", cellClass: "font-medium text-ink", sortable: true },
  { key: "loads", label: "Loads", numeric: true, sortable: true },
  { key: "linehaul", label: "Freight", numeric: true, sortable: true },
  { key: "accessorial", label: "Extras", numeric: true, sortable: true },
  { key: "revenue", label: "Total booked", numeric: true, sortable: true },
  { key: "unpostedLoads", label: "Not booked yet", numeric: true, cellClass: "text-ink-tertiary", sortable: true },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="What the fleet earned in this period — by invoice, by truck, and by the dispatcher who booked it." />

    <ExplainerPanel summary="What counts as revenue here">
      <p>
        A load counts once the general ledger has booked it — the same rule the cost-per-mile report
        uses, so these figures and the income statement agree. Loads that are staged but not yet
        booked are counted separately, in the “not booked yet” column, never dropped and never mixed
        into the totals.
      </p>
      <p>
        Fuel and road tax collected on behalf of the government is excluded: money collected for
        someone else was never the carrier's earning.
      </p>
      <p>
        <span class="font-medium text-ink">Freight</span> is the charge for hauling the load itself
        (linehaul). <span class="font-medium text-ink">Extras</span> are the charges added to it —
        detention, layover, lumper and the rest (accessorial).
      </p>
    </ExplainerPanel>

    <AppTabs v-model="tab" :tabs="TABS" label="Revenue views" id-prefix="billing" />

    <!-- Per-dispatcher opens with the two figures that frame the table under it. -->
    <div v-if="tab === 'dispatchers'" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <StatCard
        label="Booked in this period"
        :value="fmtUsd(dispatcherTotal)"
        :sub="`across ${dispatcherRows.length} ${dispatcherRows.length === 1 ? 'dispatcher' : 'dispatchers'}`"
      />
      <StatCard
        label="Not booked yet"
        :value="unpostedTotal"
        sub="loads the ledger has not posted — held out of the figures, never dropped"
      />
    </div>

    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        :search-placeholder="searchPlaceholder"
        :count="visibleCount"
        :count-label="countLabel"
      >
        <template #filters>
          <DateRangeFilter :from="from" :to="to" @update:from="(v) => (from = v ?? from)" @update:to="(v) => (to = v ?? to)" />
        </template>
      </FilterBar>

      <div v-if="tab === 'invoices'" id="billing-panel-invoices" role="tabpanel" aria-labelledby="billing-tab-invoices">
        <DataTable
          :columns="invoiceColumns"
          :rows="entries"
          embedded
          row-key="id"
          :loading="isLoading"
          :error="isError ? (error instanceof Error ? error.message : 'Failed to load') : null"
          :retrying="isFetching"
          @retry="refetch"
        >
          <template #empty>
            <p>No invoices in this date range. Try a wider range — invoices arrive with the McLeod sweep.</p>
          </template>
          <template #cell-occurred_at="{ value }">{{ fmtDate(value) }}</template>
          <template #cell-category="{ value }">
            <span
              :class="[BADGE_BASE, toneClass(value === 'accessorial_revenue' ? 'info' : 'success')]"
              :title="value === 'accessorial_revenue' ? 'Accessorial — a charge added to the haul: detention, layover, lumper and the like.' : 'Linehaul — the charge for hauling the load itself.'"
            >
              {{ value === "accessorial_revenue" ? "Extra" : "Freight" }}
            </span>
          </template>
          <!-- Blank means the bill's order carried no operations user, not that the sweep failed. -->
          <template #cell-dispatcher_name="{ value }">
            <span :class="value ? 'text-ink-secondary' : 'text-ink-tertiary'">{{ value ?? "Unassigned" }}</span>
          </template>
          <template #cell-amount="{ value }"><span class="font-semibold text-success-700">{{ fmtUsd(value) }}</span></template>
          <template #footer>
            <TablePagination :page="page" :page-size="INVOICES_PAGE_SIZE" :total="total" :loading="isFetching" @update:page="page = $event" />
          </template>
        </DataTable>
      </div>

      <div v-else-if="tab === 'trucks'" id="billing-panel-trucks" role="tabpanel" aria-labelledby="billing-tab-trucks">
        <DataTable
          :columns="marginColumns"
          :rows="marginPage"
          embedded
          row-key="key"
          :loading="marginsLoading"
          :error="null"
          :sort="sort"
          @sort="onSort"
        >
          <template #empty>
            <p>Nothing to show for this date range. A truck appears here once it has both invoiced revenue and posted costs.</p>
          </template>
          <template #cell-earnings="{ value }">{{ fmtUsd(value) }}</template>
          <template #cell-expenses="{ value }">{{ fmtUsd(value) }}</template>
          <template #cell-margin="{ value }">
            <span
              class="font-semibold"
              :class="value >= 0 ? 'text-success-700' : 'text-danger-700'"
              title="Margin — money in minus money out for this truck, in this period."
              >{{ fmtUsd(value) }}</span
            >
          </template>
          <template #footer>
            <TablePagination :page="page" :page-size="CLIENT_PAGE_SIZE" :total="marginFiltered.length" @update:page="page = $event" />
          </template>
        </DataTable>
      </div>

      <div v-else id="billing-panel-dispatchers" role="tabpanel" aria-labelledby="billing-tab-dispatchers">
        <DataTable
          :columns="dispatcherColumns"
          :rows="dispatcherPage"
          embedded
          row-key="key"
          :loading="dispatchersLoading"
          :error="null"
          :sort="sort"
          @sort="onSort"
        >
          <template #empty>
            <p>No dispatcher earnings for this date range. The dispatcher's name arrives with the McLeod billing sweep, so bills swept before that ran carry none.</p>
          </template>
          <template #cell-linehaul="{ value }">{{ fmtUsd(value) }}</template>
          <template #cell-accessorial="{ value }">{{ fmtUsd(value) }}</template>
          <template #cell-revenue="{ value }"><span class="font-semibold text-success-700">{{ fmtUsd(value) }}</span></template>
          <template #footer>
            <TablePagination :page="page" :page-size="CLIENT_PAGE_SIZE" :total="dispatcherFiltered.length" @update:page="page = $event" />
          </template>
        </DataTable>
      </div>
    </DataWorkspace>
  </div>
</template>
