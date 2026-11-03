<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  useQueryState,
  SORT_DIRECTIONS,
  useUrlSort,
  AppButton as BaseButton,
  AppIcon,
  DataWorkspace,
  FilterBar,
  DataTable,
  type DataTableColumn,
  TablePagination,
  sortRows,
  columnsWithData,
} from "@silvicom/ui";
import { Cog6ToothIcon, ScanIcon } from "@silvicom/ui/icons";
import { PART_USAGE_WINDOW_DAYS, usd2, type PartUsageSort, type StockLineDto } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import StockLevelCell from "@/features/inventory/StockLevelCell.vue";
import LocationsDrawer from "@/features/inventory/LocationsDrawer.vue";
import { INVENTORY_PAGE_SIZE, useLowStockQuery } from "@/features/inventory/useInventory";
import { usePartUsageListQuery } from "@/features/inventory/usePartUsage";
import { formatDate } from "@/lib/format";
import { SHELF_COUNTING_SHOWN } from "@/lib/shelfCounting";
import { useSessionStore } from "@/stores/session";
import { useOpens } from "@/composables/useOpens";

/**
 * Shop parts — what the shop goes through, from FleetPal's repair orders (SHOP-PARTS-USAGE-PLAN.md
 * SP-U2), over the catalogue FleetPal syncs every hour (F12, M8).
 *
 * ── IT OPENS ON WHAT WAS USED, MOST USED FIRST (D-SPU1) ───────────────────────────────────────
 * Measured 2026-11-03: 3,560 catalogue parts, 392 of them used in the last 90 days. The page used to
 * open on all 3,560 in part-number order, with a Manufacturer and a Category column that were blank on
 * every row (FleetPal's catalogue carries neither). Now the resting view — `show=""`, so the filter
 * chip opens unapplied (`FilterSelect` reads any non-empty value as applied) — is the parts used in the
 * window, and "All parts" is one choice away. The blank columns are gone (D-SPU6).
 *
 * ── THE SERVER SORTS, SO EVERY HEADER IS HONEST ───────────────────────────────────────────────
 * The catalogue used to refuse sorting, because a header that sorted fifty rows on screen would have
 * presented a page-local order as the catalogue's. `shop_parts_list` (0557) sorts the whole filtered
 * list before paging, so these headers sort for real. No sort in the URL means "most used first".
 *
 * ── LAST PRICE, AND NO COLUMN OVER NOTHING (D-SPU10, D-SPU11) ──────────────────────────────
 * The owner ruled 2026-11-03: unit prices show ("we can show everything"), and "let's not have empty
 * rows and columns if data does not exist". So the last price paid per unit is a column, and a column
 * every row on screen leaves empty is not drawn (`columnsWithData`) — a page of never-used parts under
 * All parts shows no Used, Repairs, Last used or Last price, rather than four columns of zeros and
 * "Never". Part number and description always show: they are what a row is.
 *
 * ── SAID ONCE, NOT ON EVERY ROW ───────────────────────────────────────────────────────────────
 * Every row of this list is FleetPal's, and the header says so; M8 also said "· From FleetPal" on every
 * row, which is the header repeated 3,560 times. Only the exception is labelled: a part typed here
 * before F12 reads "· Added here".
 *
 * ── THE SHELF HALF, KEPT AND HIDDEN (Q-MX8) ──────────────────────────────────────────────────
 * Places, Labels and Running low are shelf counting's, hidden by one constant (`lib/shelfCounting.ts`).
 * With it on, the Stock filter swaps the reader and the columns: "everything at its reorder point" is
 * a list of SHELVES, not parts — the same part is three rows of it if it sits in three places — so it
 * is its own endpoint (`/low-stock`), deliberately unpaginated (a list of what to order that stops at
 * fifty says "nothing more to order", and the 2026-09-09 review removed exactly that defect), and it
 * sorts on the client because it arrives whole. Places is a worded button, not a gear: the 2026-09-10
 * critique found the only unlabelled header buttons in the product here.
 *
 * ── A ROW OPENS TWO WAYS ──────────────────────────────────────────────────────────────────────
 * `@row-click` is the mouse's path; the kebab's "Open part" is the keyboard's and the screen reader's
 * (contract §5.7, the 2026-09-10 critique's "rows open only by mouse").
 */

const router = useRouter();
const session = useSessionStore();
const opens = useOpens();

const SHOW_OPTIONS = [
  { value: "", label: `Used in the last ${PART_USAGE_WINDOW_DAYS} days` },
  { value: "all", label: "All parts" },
];
// Running low is shelf counting's: with the flag off the filter is not drawn and the parameter accepts
// only "", so an old `?stock=low` link opens the list.
const STOCK_OPTIONS = [
  { value: "", label: "All parts" },
  { value: "low", label: "Running low" },
];

/** A usage column's key → the sort `shop_parts_list` knows it by. */
const USAGE_SORT: Record<string, PartUsageSort> = {
  partNumber: "part_number",
  usedQuantity: "used",
  usedRepairs: "repairs",
  lastUsedAt: "last_used",
  lastPrice: "last_price",
};

const USAGE_COLUMNS: DataTableColumn[] = [
  { key: "partNumber", label: "Part number", card: "title", sortable: true, cellClass: "font-mono text-xs text-ink", width: "md" },
  { key: "description", label: "Description", card: "sentence" },
  // A long FleetPal description wraps (`:nowrap="false"` below) so the Last price column stays on
  // screen at 1280 px; measured in the browser 2026-11-03, it ran off the right edge unwrapped.
  { key: "usedQuantity", label: `Used, ${PART_USAGE_WINDOW_DAYS} days`, card: "meta", sortable: true, numeric: true, cellClass: "whitespace-nowrap" },
  { key: "usedRepairs", label: "Repairs", card: "none", sortable: true, numeric: true },
  { key: "lastUsedAt", label: "Last used", card: "none", sortable: true, cellClass: "whitespace-nowrap text-ink-secondary" },
  { key: "lastPrice", label: "Last price", card: "none", sortable: true, numeric: true, cellClass: "whitespace-nowrap" },
];

const LOW_COLUMNS: DataTableColumn[] = [
  { key: "partNumber", label: "Part number", card: "title", sortable: true, cellClass: "font-mono text-xs text-ink", width: "md" },
  { key: "partDescription", label: "Description", card: "sentence" },
  { key: "locationName", label: "Place", card: "none", sortable: true, cellClass: "text-ink-secondary" },
  { key: "quantityOnHand", label: "On hand", card: "meta", sortable: true, numeric: true },
  { key: "reorderPoint", label: "Order below", card: "none", sortable: true, numeric: true },
  { key: "reorderQuantity", label: "Order", card: "none", numeric: true },
];

// Filters, sort and page live in the URL (D-US2), so a reload, a pasted link and Back from a part keep them.
const qs = useQueryState();
const search = qs.param("search");
const show = qs.param("show", SHOW_OPTIONS.map((o) => o.value));
const stock = qs.param("stock", SHELF_COUNTING_SHOWN ? STOCK_OPTIONS.map((o) => o.value) : [""]);
const page = qs.page();
watch([search, show, stock], () => (page.value = 1));

const lowOnly = computed(() => stock.value === "low");
const activeFilterCount = computed(
  () => (search.value.trim() ? 1 : 0) + (show.value ? 1 : 0) + (stock.value ? 1 : 0),
);
function resetFilters() {
  qs.set({ search: undefined, show: undefined, stock: undefined });
}

// One sort parameter for both tables; a key the current table does not sort by reads as none.
const SORTABLE = [...new Set([...USAGE_COLUMNS, ...LOW_COLUMNS].filter((c) => c.sortable).map((c) => c.key))];
const { sort: urlSort, onSort } = useUrlSort(qs.param("sort", SORTABLE), qs.param("dir", SORT_DIRECTIONS));
const tableColumns = computed(() => (lowOnly.value ? LOW_COLUMNS : USAGE_COLUMNS));
const sort = computed(() =>
  urlSort.value.key && tableColumns.value.some((c) => c.sortable && c.key === urlSort.value.key)
    ? urlSort.value
    : { key: null, dir: "asc" as const },
);

const usageFilter = computed(() => ({
  search: search.value.trim() || undefined,
  show: show.value === "all" ? ("all" as const) : ("used" as const),
  // No sort chosen = most used first.
  sort: sort.value.key ? USAGE_SORT[sort.value.key]! : ("used" as const),
  descending: sort.value.key ? sort.value.dir === "desc" : true,
  page: page.value,
}));
const usage = usePartUsageListQuery(usageFilter);
const low = useLowStockQuery();

const rows = computed(() =>
  lowOnly.value ? sortRows(low.data.value?.lines ?? [], sort.value) : (usage.data.value?.rows ?? []),
);
// A usage count of 0 is no data for that column (D-SPU11); a blank price or date already is.
const NOTHING = (v: unknown) => !v;
const columns = computed(() =>
  lowOnly.value
    ? LOW_COLUMNS
    : columnsWithData(USAGE_COLUMNS, rows.value as Record<string, unknown>[], {
        keep: ["partNumber", "description"],
        empty: { usedQuantity: NOTHING, usedRepairs: NOTHING },
      }),
);
const total = computed(() => (lowOnly.value ? (low.data.value?.total ?? 0) : (usage.data.value?.total ?? 0)));
const loading = computed(() => (lowOnly.value ? low.isLoading.value : usage.isLoading.value));
const failed = computed(() => (lowOnly.value ? low.error.value : usage.error.value));
const refetch = () => void (lowOnly.value ? low.refetch() : usage.refetch());

/** A stock line has no id of its own — it IS the (part, location) pair — so that table keys on both. */
const rowKey = computed(() => (lowOnly.value ? ((r: Record<string, unknown>) => `${r.partId}:${r.locationId}`) : "id"));

const openPart = (row: Record<string, unknown>) =>
  void router.push({ name: "part", params: { id: String(lowOnly.value ? row.partId : row.id) } });

// Feet and gallons arrive fractional; a count of filters does not need ".00".
const quantity = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

const locationsOpen = ref(false);
const shelvesShown = SHELF_COUNTING_SHOWN;
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Parts the shop puts on trucks and trailers, from FleetPal's repair orders. Add and change parts in FleetPal.">
      <template v-if="shelvesShown" #actions>
        <BaseButton v-if="session.can('maintenance')" @click="locationsOpen = true">
          <AppIcon :icon="Cog6ToothIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Places
        </BaseButton>
        <!-- SP5: shown when Labels opens. It is `maintenance` view and answers to the shop home's screen
             (`maintenance.repair-spend`, D-SURF8), which is switchable per person apart from this page —
             not `maintenance` manage, which hid it from a viewer the Labels page admits. -->
        <BaseButton v-if="opens('/shop/labels')" to="/shop/labels">
          <AppIcon :icon="ScanIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Labels
        </BaseButton>
      </template>
    </PageHeader>

    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search part number or description…"
        :count="total"
        :count-label="lowOnly ? 'shelves' : 'parts'"
        :active-count="activeFilterCount"
        @clear-all="resetFilters"
      >
        <template #filters>
          <FilterSelect v-if="!lowOnly" v-model="show" label="Show" :options="SHOW_OPTIONS" />
          <FilterSelect v-if="shelvesShown" v-model="stock" label="Stock" :options="STOCK_OPTIONS" />
        </template>
      </FilterBar>

      <DataTable
        embedded
        :columns="columns"
        :rows="rows"
        :row-key="rowKey"
        :nowrap="false"
        :loading="loading"
        :error="failed ? 'Could not load parts.' : null"
        :sort="sort"
        :row-class="() => 'cursor-pointer'"
        @sort="onSort"
        @row-click="openPart"
        @retry="refetch"
      >
        <template #cell-description="{ row }">
          {{ row.description }}<span v-if="!row.fleetpalId" class="text-ink-tertiary" data-test="added-here"> · Added here</span>
        </template>
        <template #cell-usedQuantity="{ value }">
          <!-- A phone card shows this as its one figure, so it says what the figure is; the table's
               header already does (DataTable's card mode is below md). -->
          <span :class="value ? 'font-semibold text-ink' : 'text-ink-tertiary'">{{ quantity.format(value) }}<span class="md:hidden"> used</span></span>
        </template>
        <template #cell-usedRepairs="{ value }">
          <span :class="value ? '' : 'text-ink-tertiary'">{{ value }}</span>
        </template>
        <template #cell-lastUsedAt="{ value }">{{ value ? formatDate(value) : "Never" }}</template>
        <template #cell-lastPrice="{ value }">{{ usd2(value) }}</template>
        <template #cell-quantityOnHand="{ row }">
          <StockLevelCell :line="row as StockLineDto" />
        </template>
        <template #actions="{ row }">
          <KebabMenu>
            <BaseButton class="kebab-item" @click="openPart(row)">Open part</BaseButton>
          </KebabMenu>
        </template>
        <template #empty>
          <p v-if="lowOnly">
            Nothing is at its reorder point. A shelf is only counted here once somebody has set one —
            open a part and add a shelf to say how many is enough.
          </p>
          <p v-else-if="search">
            No part matches that. Try the shop's part number, the number printed on the box, or a word
            from the description<template v-if="!show"> — or show All parts, for one not used lately</template>.
          </p>
          <p v-else-if="!show">
            No part went on a repair in the last {{ PART_USAGE_WINDOW_DAYS }} days. Repair orders arrive
            from FleetPal every hour; All parts shows the whole catalogue.
          </p>
          <p v-else>No parts yet. They arrive from FleetPal within the hour once its sync is on (Settings › FleetPal).</p>
        </template>
        <template v-if="!lowOnly" #footer>
          <TablePagination :page="page" :page-size="INVENTORY_PAGE_SIZE" :total="total" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>

    <LocationsDrawer :open="locationsOpen" @close="locationsOpen = false" />
  </div>
</template>
