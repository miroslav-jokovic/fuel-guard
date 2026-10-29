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
} from "@silvicom/ui";
import { Cog6ToothIcon, ScanIcon } from "@silvicom/ui/icons";
import { UNIT_OF_MEASURE_LABELS, type StockLineDto } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import StockLevelCell from "@/features/inventory/StockLevelCell.vue";
import LocationsDrawer from "@/features/inventory/LocationsDrawer.vue";
import { INVENTORY_PAGE_SIZE, useLowStockQuery, usePartsQuery } from "@/features/inventory/useInventory";
import { SHELF_COUNTING_SHOWN } from "@/lib/shelfCounting";
import { useSessionStore } from "@/stores/session";
import { useOpens } from "@/composables/useOpens";

/**
 * Shop parts — the shop's catalogue, pulled from FleetPal, and the low-stock list (INVENTORY-PLAN.md
 * I4; I12's "the Parts filter" is this step's, and its step text says so).
 *
 * ── FLEETPAL'S LIST, SHOWN HERE, CHANGED THERE (M8, 2026-10-28) ───────────────────────────────
 * The owner could not tell what this page was (R4): FleetPal's parts, or our truck equipment? It is
 * FleetPal's — synced every hour since F12 (PRs 1801 and 1803) — and the header now says so, each row says
 * "From FleetPal", and the page offers no New part: a part typed here would be a second catalogue
 * beside FleetPal's, the second source of truth the two-inventories ruling exists to prevent
 * (DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md). Truck equipment is Equipment's, and never named here.
 * The shelf half of this page — Places, Labels, Running low — is hidden (`lib/shelfCounting.ts`, Q-MX8).
 *
 * ── ONE FILTER THAT CHANGES THE QUESTION, NOT ONE TABLE WITH A HIDDEN COLUMN ──────────────────
 * "Everything we carry" and "everything at its reorder point" are two different lists of two
 * different things: the first is parts, the second is SHELVES, and the same part is three rows of
 * it if it sits in three places. So the Stock filter swaps the reader and the columns with it,
 * rather than adding a `low` flag to the catalogue query — which is what the API declined to do for
 * the same reason (`/low-stock` is its own endpoint, not a flag on `/stock`).
 *
 * ⚠ **The low-stock view is deliberately unpaginated**, here as at the API. A list of what to order
 * that stops at fifty rows says "nothing more to order" and is believed; that defect shipped once
 * already and the 2026-09-09 review of I0–I3 removed it. `TablePagination` therefore renders in the
 * catalogue view only, and the count in the toolbar is the whole answer in both.
 *
 * ── "STOCK LOCATIONS" IS A WORDED BUTTON, AND IT IS HERE BECAUSE NOTHING ELSE COULD MAKE ONE ──
 * I4's step text puts a settings gear on Parts and means I11's `inventory_settings`, which has no
 * table yet. What the button carries today is the locations manager, and that is not an early
 * delivery of I11 — it is a gap no step owned. Measured 2026-09-09: production holds zero rows in
 * all four inventory tables, `POST /locations` shipped at I3 with no consumer, and I11's settings
 * drawer picks a DEFAULT location, presuming some exist. `LocationsDrawer.vue` carries the
 * reasoning; I11 adds its settings to the same drawer.
 *
 * It says what it opens. The 2026-09-10 critique of this section found that the three inventory
 * lists carried the only unlabelled header buttons in the product — an icon-only gear each, one of
 * them the page's sole action — and that a reader arriving from any other section had no way to
 * know that shop configuration was split across three of them. A word costs nothing; a tooltip the
 * reader has to hover for is not a label.
 *
 * ── THE FILTER'S "EVERYTHING" IS `""`, AS IT IS ON EVERY OTHER LIST ───────────────────────────
 * `FilterSelect` reads any non-empty value as a filter APPLIED: blue, with a ✕ that emits `""`. This
 * page shipped with `"all"` as its resting value, so the chip opened in the applied state and the ✕
 * cleared it to a value none of its options had. Measured in a real render 2026-09-10; the same
 * defect sat on Assets and Units. `AnnualInspectionsPage.vue` and every older list use `""`.
 *
 * ── THE CATALOGUE DOES NOT SORT; THE LOW-STOCK VIEW DOES ──────────────────────────────────────
 * The catalogue arrives one server page at a time, and a column header that sorted the fifty rows
 * on screen would present a page-local order as the catalogue's — the "believed wrong answer" this
 * file's low-stock note is about. The low-stock list arrives whole, so its columns sort honestly.
 * A server-side sort for the catalogue is owed to the API, not faked here.
 *
 * ── AND WHAT IS STILL NOT HERE ────────────────────────────────────────────────────────────────
 * No CSV import: the manual escape hatch A3 leaves open needs an endpoint the API does not have,
 * and this step is web-only. Named in §8 of the plan rather than stubbed as a control that does
 * nothing.
 */

const router = useRouter();
const session = useSessionStore();
const opens = useOpens();

// Running low is shelf counting's (hidden, Q-MX8): with the flag off the filter is not drawn and the
// parameter accepts only "", so an old `?stock=low` link opens the catalogue.
const STOCK_OPTIONS = [
  { value: "", label: "All parts" },
  { value: "low", label: "Running low" },
];

// Filters, sort and page live in the URL (D-US2). The home's low-stock card links here with
// `?stock=low`, and that link is now simply this parameter rather than a one-time seed the page
// mirrored back by hand — so the same link also survives a reload and Back from a part.
const qs = useQueryState();
const search = qs.param("search");
const stock = qs.param("stock", SHELF_COUNTING_SHOWN ? STOCK_OPTIONS.map((o) => o.value) : [""]);
const page = qs.page();
watch([search, stock], () => (page.value = 1));

const lowOnly = computed(() => stock.value === "low");
const activeFilterCount = computed(() => (search.value.trim() ? 1 : 0) + (stock.value ? 1 : 0));
function resetFilters() {
  qs.set({ search: undefined, stock: undefined });
}

const catalogueFilter = computed(() => ({ search: search.value || undefined, page: page.value }));
const catalogue = usePartsQuery(catalogueFilter);
const low = useLowStockQuery();


const rows = computed(() =>
  lowOnly.value
    ? sortRows(low.data.value?.lines ?? [], sort.value)
    : (catalogue.data.value?.parts ?? []),
);
const total = computed(() => (lowOnly.value ? (low.data.value?.total ?? 0) : (catalogue.data.value?.total ?? 0)));
const loading = computed(() => (lowOnly.value ? low.isLoading.value : catalogue.isLoading.value));
const failed = computed(() => (lowOnly.value ? low.error.value : catalogue.error.value));
const refetch = () => void (lowOnly.value ? low.refetch() : catalogue.refetch());

const CATALOGUE_COLUMNS: DataTableColumn[] = [
  { key: "partNumber", label: "Part number", card: "title", cellClass: "font-mono text-xs text-ink", width: "md" },
  { key: "description", label: "Description", card: "sentence" },
  { key: "manufacturer", label: "Manufacturer", card: "none", cellClass: "text-ink-secondary" },
  { key: "category", label: "Category", card: "none", cellClass: "text-ink-tertiary" },
  { key: "unitOfMeasure", label: "Counted in", card: "none", cellClass: "text-ink-tertiary" },
];

const LOW_COLUMNS: DataTableColumn[] = [
  { key: "partNumber", label: "Part number", card: "title", sortable: true, cellClass: "font-mono text-xs text-ink", width: "md" },
  { key: "partDescription", label: "Description", card: "sentence" },
  { key: "locationName", label: "Place", card: "none", sortable: true, cellClass: "text-ink-secondary" },
  { key: "quantityOnHand", label: "On hand", card: "meta", sortable: true, numeric: true },
  { key: "reorderPoint", label: "Order below", card: "none", sortable: true, numeric: true },
  { key: "reorderQuantity", label: "Order", card: "none", numeric: true },
];

const columns = computed(() => (lowOnly.value ? LOW_COLUMNS : CATALOGUE_COLUMNS));

// Only the low-stock view sorts (see the header), so the sort's vocabulary is ITS sortable columns.
// A sort left in the URL while the catalogue shows is inert — the table is handed `null` — and
// comes back into force when the reader returns to the low-stock view.
const { sort, onSort } = useUrlSort(
  qs.param("sort", LOW_COLUMNS.filter((c) => c.sortable).map((c) => c.key)),
  qs.param("dir", SORT_DIRECTIONS),
);

/**
 * A stock line has no id of its own — it IS the (part, location) pair — so the table is keyed on
 * both. Keying on `partId` alone would collapse the three shelves one part sits on into one row.
 */
const rowKey = computed(() => (lowOnly.value ? ((r: Record<string, unknown>) => `${r.partId}:${r.locationId}`) : "id"));

/**
 * Opening a row is `@row-click` AND the kebab's "Open part". The click is the mouse's path; the
 * kebab is the keyboard's and the screen reader's — a row that only opens on click has no focusable
 * element in it, which the 2026-09-10 critique measured as "rows open only by mouse" on all three
 * inventory lists. Contract §5.7 asks for both, and `AnnualInspectionsPage.vue` carries both.
 *
 * (That page passed `:row-to` until 2026-09-10, a prop `DataTable` never declared, so its rows had
 * never been clickable — measured 2026-09-09 by grepping the component and corrected alongside this.)
 */
const openPart = (row: Record<string, unknown>) =>
  void router.push({ name: "part", params: { id: String(lowOnly.value ? row.partId : row.id) } });

const locationsOpen = ref(false);
const shelvesShown = SHELF_COUNTING_SHOWN;
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="The shop's parts catalogue, pulled from FleetPal every hour. Add and change parts in FleetPal.">
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
        search-placeholder="Search part number, description, barcode…"
        :count="total"
        :count-label="lowOnly ? 'shelves' : 'parts'"
        :active-count="activeFilterCount"
        @clear-all="resetFilters"
      >
        <template v-if="shelvesShown" #filters>
          <FilterSelect v-model="stock" label="Show" :options="STOCK_OPTIONS" />
        </template>
      </FilterBar>

      <DataTable
        embedded
        :columns="columns"
        :rows="rows"
        :row-key="rowKey"
        :loading="loading"
        :error="failed ? 'Could not load parts.' : null"
        :sort="lowOnly ? sort : null"
        :row-class="() => 'cursor-pointer'"
        @sort="onSort"
        @row-click="openPart"
        @retry="refetch"
      >
        <!-- "From FleetPal" rides on the sentence, so a card says it too (§7a.5); a hand-typed part from
             before F12 says nothing. -->
        <template #cell-description="{ row }">
          {{ row.description }}<span v-if="row.fleetpalId" class="text-ink-tertiary" data-test="from-fleetpal"> · From FleetPal</span>
        </template>
        <template #cell-unitOfMeasure="{ value }">{{ UNIT_OF_MEASURE_LABELS[value as keyof typeof UNIT_OF_MEASURE_LABELS] }}</template>
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
          <p v-else-if="search">No part matches that. Try the part number, or the supplier's barcode.</p>
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
