<script setup lang="ts">
/**
 * The Fuel Log's `Source records` tab — every line from the uploaded EFS Transaction reports,
 * exactly as received (FUEL-C2, D-FUI1/D-FUI2).
 *
 * ── WHAT THIS IS AND WHY IT SURVIVED THE MERGE ──────────────────────────────────────────────────
 * This was `/transactions`, a top-level nav item beside Fuel Log — two pages over the same fills,
 * one enriched and one raw, and a reader had to already know which was which. D-FUI2 makes the
 * DRAWER on a fill the normal path to its raw line; this tab remains for the case a drawer cannot
 * serve, which is the reconciliation one: an EFS line with no fill behind it has no row to hang off.
 *
 * The body below is the old page's, moved rather than rewritten — the columns, the facets and the
 * faithful `tran_date`/`tran_time` rendering are unchanged, so a controller reconciling an invoice
 * sees the same table they always did. What changed is where the window and the truck come from.
 *
 * ⚠ **This tab is behind the fuel section (`canView("fuel")`), and the shell is what checks it.**
 * `/transactions` was catalogued as `section("fuel")` while `/fuel-log` is `always`, so merging the
 * two without a gate would hand every EFS line to a recruiter. The tab strip is built from the same
 * matrix the surface catalogue reads; see `FuelLogPage.vue`.
 */
import { ref, computed, watch } from "vue";
import { useEfsTransactions, useEfsFacets, useEfsRowCoverage, EFS_PAGE_SIZE, type EfsFilters } from "./useEfsData";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import FilterBar, { type FilterChip } from "@/components/ui/FilterBar.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import FeedFreshnessLine from "@/components/FeedFreshnessLine.vue";
import RowCoverageLine from "@/components/RowCoverageLine.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import TablePagination from "@/components/TablePagination.vue";
import { toggleSort, type SortState } from "@/lib/sort";
import { stationTime, businessDate } from "@/lib/stationTime";
import { useUnitOptions } from "./unitFilter";
import type { FuelLogSharedFilters } from "./useFuelLogFilters";

const props = defineProps<{ shared: FuelLogSharedFilters }>();

/**
 * The facets this tab alone has, held locally rather than in the URL.
 *
 * `state` and `driver` exist on the declines tab too and mean the same thing there — but `driver` is
 * a name here and a driver ID on the fills tab, so promoting either to a shared parameter is the
 * cross-tab collision `useFuelLogFilters`' header refuses. C3 is the step that makes each tab's own
 * facets survive a refresh; C2 keeps them exactly as linkable as the page they came from, which is
 * to say not at all.
 */
const local = ref<Pick<EfsFilters, "search" | "item" | "state" | "driver" | "sortKey" | "sortDir">>({});

const filters = computed<EfsFilters>(() => ({
  ...local.value,
  unit: props.shared.unit.value,
  from: props.shared.from.value,
  to: props.shared.to.value,
}));

const page = ref(1);
// Deep, because `filters` is rebuilt on every change to either half — a reader who narrows the
// window while on page 7 must not be left looking at a page that no longer exists.
watch(filters, () => (page.value = 1), { deep: true });

const sort = ref<SortState>({ key: null, dir: "asc" });
function onSort(key: string) {
  sort.value = toggleSort(sort.value, key);
  local.value = { ...local.value, sortKey: sort.value.key ?? undefined, sortDir: sort.value.dir };
}

const { data, isLoading, isError, error, refetch, isFetching } = useEfsTransactions(filters, page);

const unitOptions = useUnitOptions();

const { data: facets } = useEfsFacets();

// FUEL-T5. The filter bar below says how many rows there are; this says how many of them reach a
// truck, which is what every per-unit figure in this section silently depends on.
const { data: coverage } = useEfsRowCoverage("transactions", filters);

/** Two-way proxy into the LOCAL facets for one key ("" ⇄ undefined). */
const bind = (key: "search" | "item" | "state" | "driver") =>
  computed({
    get: () => local.value[key] ?? "",
    set: (v: string) => (local.value = { ...local.value, [key]: v || undefined }),
  });
const search = bind("search");
const item = bind("item");
const state = bind("state");
const driver = bind("driver");

/** The shared half, proxied for the controls that write it back to the URL. */
const unit = computed<string>({
  get: () => props.shared.unit.value ?? "",
  set: (v) => props.shared.setUnit(v || undefined),
});
const setFrom = (v: string | undefined) => props.shared.setFrom(v);
const setTo = (v: string | undefined) => props.shared.setTo(v);

const withAll = (label: string, vals: string[] = []) => [
  { value: "", label },
  ...vals.map((v) => ({ value: v, label: v })),
];
const itemOptions = computed(() => withAll("All items", facets.value?.txnItems));
const stateOptions = computed(() => withAll("All states", facets.value?.txnStates));
const driverOptions = computed(() => withAll("All drivers", facets.value?.txnDrivers));

// Chips surface only the popover (secondary) filters — the inline triggers
// already display their own active value.
const chips = computed<FilterChip[]>(() => {
  const f = local.value;
  const out: FilterChip[] = [];
  if (f.state) out.push({ key: "state", label: "State", value: f.state });
  if (f.driver) out.push({ key: "driver", label: "Driver", value: f.driver });
  return out;
});
const moreCount = computed(() => (local.value.state ? 1 : 0) + (local.value.driver ? 1 : 0));
function removeChip(key: string) {
  local.value = { ...local.value, [key]: undefined };
}
/** Clears BOTH halves: a reader pressing "Clear filters" means the screen, not this component's share of it. */
function clearAll() {
  local.value = { sortKey: local.value.sortKey, sortDir: local.value.sortDir };
  props.shared.clear();
}

const rows = computed(() => data.value?.rows ?? []);
const total = computed(() => data.value?.total ?? 0);
// Consistent numeric formatting: thousands separators, "—" for null. Money shows 2 decimals.
const fmtNum = (v: number | null) => (v == null ? "—" : v.toLocaleString());
const fmtMoney = (v: number | null) => (v == null ? "—" : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const columns: DataTableColumn[] = [
  {
    key: "unit",
    label: "Unit",
    sortable: true,
    width: "sm",
  },
  { key: "tran_date", label: "Tran Date", sortable: true, width: "md", cellClass: "text-ink-secondary" },
  { key: "tran_time", label: "Time", width: "sm", cellClass: "text-ink-secondary" },
  { key: "card_num", label: "Card #", width: "md", cellClass: "text-ink-secondary" },
  { key: "invoice", label: "Invoice", width: "sm", cellClass: "text-ink-secondary" },
  { key: "driver_name", label: "Driver", sortable: true, width: "lg", cellClass: "text-ink-secondary" },
  { key: "odometer", label: "Odometer", sortable: true, numeric: true, width: "md", cellClass: "text-ink-secondary" },
  { key: "location_name", label: "Location", width: "xl", cellClass: "text-ink-secondary" },
  { key: "city", label: "City", width: "md", cellClass: "text-ink-secondary" },
  { key: "state", label: "State", width: "xs", cellClass: "text-ink-secondary" },
  { key: "item", label: "Item", width: "sm", cellClass: "text-ink-secondary" },
  { key: "unit_price", label: "Unit Price", numeric: true, width: "md", cellClass: "text-ink-secondary" },
  { key: "qty", label: "Qty", sortable: true, numeric: true, width: "xs", cellClass: "text-ink-secondary" },
  { key: "amt", label: "Amt", sortable: true, numeric: true, width: "sm", cellClass: "text-ink-secondary" },
  { key: "fees", label: "Fees", numeric: true, width: "xs", cellClass: "text-ink-secondary" },
  { key: "db", label: "DB", width: "xs", cellClass: "text-ink-secondary" },
  { key: "currency", label: "Currency", width: "sm", cellClass: "text-ink-secondary" },
];
</script>

<template>
  <div class="space-y-6">
    <!-- A7 / FUEL-T5. These rows are EFS's own, so this tab cannot show a wrong one — only a
         missing one, and a stopped poller reads exactly like a quiet week. Above the filters, where
         a reader meets it before drawing a conclusion from a short list. -->
    <FeedFreshnessLine feed="posted" />

    <!-- FUEL-T5. Arrival, then composition: the line above says whether the list is short, this one
         says how much of what is here can be reached by a unit filter or a per-truck total. -->
    <RowCoverageLine :coverage="coverage" />

    <DataWorkspace>
    <FilterBar
      v-model:search="search"
      embedded
      search-placeholder="Search driver, location, card, invoice…"
      :count="total"
      count-label="transactions"
      :chips="chips"
      :more-count="moreCount"
      @remove="removeChip"
      @clear-all="clearAll"
    >
      <template #filters>
        <FilterSelect v-model="unit" label="Unit" :options="unitOptions" />
        <FilterSelect v-model="item" label="Item" :options="itemOptions" />
        <DateRangeFilter :from="shared.from.value" :to="shared.to.value" @update:from="setFrom" @update:to="setTo" />
      </template>
      <template #more>
        <FilterSelect v-model="state" label="State" :options="stateOptions" block />
        <FilterSelect v-model="driver" label="Driver" :options="driverOptions" block />
      </template>
    </FilterBar>

    <!-- D-FUI11: one date contract, and each control says which day it means. Before FUEL-T1
         the section had four answers to “what is a day” and no surface admitted to having one. -->
    <p class="-mt-3 text-xs text-ink-tertiary">Dates are the EFS business date printed on the report line.</p>

    <DataTable
      embedded
      :columns="columns"
      :rows="rows"
      row-key="id"
      dense
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load transactions') : null"
      :retrying="isFetching"
      :sort="sort"
      pin-first-column
      empty-text="No transactions match — upload an EFS Transaction report from the Import page, or adjust filters."
      @sort="onSort"
      @retry="refetch"
    >
      <template #cell-tran_date="{ row }">{{ businessDate(row.tran_date) }}</template>
      <template #cell-tran_time="{ row }">{{ row.tran_time || stationTime(row.fueled_at, row.state) }}</template>
      <template #cell-odometer="{ row }">{{ fmtNum(row.odometer) }}</template>
      <template #cell-unit_price="{ row }">{{ fmtMoney(row.unit_price) }}</template>
      <template #cell-qty="{ row }">{{ fmtNum(row.qty) }}</template>
      <template #cell-amt="{ row }">{{ fmtMoney(row.amt) }}</template>
      <template #cell-fees="{ row }">{{ fmtMoney(row.fees) }}</template>
      <template #footer>
        <TablePagination
          :page="page"
          :page-size="EFS_PAGE_SIZE"
          :total="total"
          :loading="isFetching"
          @update:page="page = $event"
        />
      </template>
    </DataTable>
    </DataWorkspace>
  </div>
</template>
