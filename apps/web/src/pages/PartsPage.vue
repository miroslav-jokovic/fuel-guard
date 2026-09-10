<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import { Cog6ToothIcon, PlusIcon, ScanIcon } from "@silvicom/ui/icons";
import { UNIT_OF_MEASURE_LABELS, type StockLineDto } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import PartDrawer from "@/features/inventory/PartDrawer.vue";
import StockLevelCell from "@/features/inventory/StockLevelCell.vue";
import LocationsDrawer from "@/features/inventory/LocationsDrawer.vue";
import { useLowStockQuery, usePartsQuery } from "@/features/inventory/useInventory";
import { useSessionStore } from "@/stores/session";

/**
 * Parts — the shop's catalogue, and the low-stock list (INVENTORY-PLAN.md I4; I12's "the Parts
 * filter" is this step's, and its step text says so).
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
 * ── THE GEAR IS STOCK LOCATIONS, AND IT IS HERE BECAUSE NOTHING ELSE COULD MAKE ONE ───────────
 * I4's step text puts a settings gear on Parts and means I11's `inventory_settings`, which has no
 * table yet. What the gear carries today is the locations manager, and that is not an early
 * delivery of I11 — it is a gap no step owned. Measured 2026-09-09: production holds zero rows in
 * all four inventory tables, `POST /locations` shipped at I3 with no consumer, and I11's settings
 * drawer picks a DEFAULT location, presuming some exist. `LocationsDrawer.vue` carries the
 * reasoning; I11 adds its settings to the same drawer.
 *
 * ── AND WHAT IS STILL NOT HERE ────────────────────────────────────────────────────────────────
 * No CSV import: the manual escape hatch A3 leaves open needs an endpoint the API does not have,
 * and this step is web-only. Named in §8 of the plan rather than stubbed as a control that does
 * nothing.
 */

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

const STOCK_OPTIONS = [
  { value: "all", label: "All parts" },
  { value: "low", label: "At reorder point" },
];

const search = ref("");
const stock = ref<string>(route.query.stock === "low" ? "low" : "all");
const page = ref(1);
watch([search, stock], () => (page.value = 1));

/** The home's low-stock card links here with `?stock=low`; the filter is the page's own state after that. */
watch(stock, (v) => {
  void router.replace({ query: v === "low" ? { stock: "low" } : {} });
});

const lowOnly = computed(() => stock.value === "low");

const catalogueFilter = computed(() => ({ search: search.value || undefined, page: page.value }));
const catalogue = usePartsQuery(catalogueFilter);
const low = useLowStockQuery();

const rows = computed(() =>
  lowOnly.value ? (low.data.value?.lines ?? []) : (catalogue.data.value?.parts ?? []),
);
const total = computed(() => (lowOnly.value ? (low.data.value?.total ?? 0) : (catalogue.data.value?.total ?? 0)));
const loading = computed(() => (lowOnly.value ? low.isLoading.value : catalogue.isLoading.value));
const failed = computed(() => (lowOnly.value ? low.error.value : catalogue.error.value));
const refetch = () => void (lowOnly.value ? low.refetch() : catalogue.refetch());

const CATALOGUE_COLUMNS: DataTableColumn[] = [
  { key: "partNumber", label: "Part number", cellClass: "font-mono text-xs text-ink", width: "md" },
  { key: "description", label: "Description" },
  { key: "manufacturer", label: "Manufacturer", cellClass: "text-ink-secondary" },
  { key: "category", label: "Category", cellClass: "text-ink-tertiary" },
  { key: "unitOfMeasure", label: "Counted in", cellClass: "text-ink-tertiary" },
];

const LOW_COLUMNS: DataTableColumn[] = [
  { key: "partNumber", label: "Part number", cellClass: "font-mono text-xs text-ink", width: "md" },
  { key: "partDescription", label: "Description" },
  { key: "locationName", label: "Location", cellClass: "text-ink-secondary" },
  { key: "quantityOnHand", label: "On hand", numeric: true },
  { key: "reorderPoint", label: "Reorder at", numeric: true },
  { key: "reorderQuantity", label: "Order", numeric: true },
];

const columns = computed(() => (lowOnly.value ? LOW_COLUMNS : CATALOGUE_COLUMNS));

/**
 * A stock line has no id of its own — it IS the (part, location) pair — so the table is keyed on
 * both. Keying on `partId` alone would collapse the three shelves one part sits on into one row.
 */
const rowKey = computed(() => (lowOnly.value ? ((r: Record<string, unknown>) => `${r.partId}:${r.locationId}`) : "id"));

/**
 * Opening a row is `@row-click`, not `row-to`.
 *
 * ⚠ `AnnualInspectionsPage.vue` — the page I4's step text names as the shape to follow — passes
 * `:row-to`, and `DataTable` declares no such prop: it lands in `$attrs` and does nothing, so those
 * rows have never been clickable and the kebab's "Open report" is what actually opens one. Measured
 * 2026-09-09 by grepping the component; recorded in the plan's §8 rather than copied.
 */
const openPart = (row: Record<string, unknown>) =>
  void router.push({ name: "part", params: { id: String(lowOnly.value ? row.partId : row.id) } });

const locationsOpen = ref(false);
const creating = ref(route.query.new === "1");
watch(creating, (open) => {
  if (!open && route.query.new) void router.replace({ query: {} });
});
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Everything the shop carries, and what has fallen to its reorder point.">
      <template #actions>
        <BaseButton v-if="session.can('maintenance')" aria-label="Stock locations" @click="locationsOpen = true">
          <AppIcon :icon="Cog6ToothIcon" class="size-5" aria-hidden="true" />
        </BaseButton>
        <BaseButton v-if="session.can('maintenance')" to="/shop/labels">
          <AppIcon :icon="ScanIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Labels
        </BaseButton>
        <BaseButton v-if="session.can('maintenance')" variant="primary" @click="creating = true">
          <AppIcon :icon="PlusIcon" class="-ml-0.5 size-5" aria-hidden="true" /> New part
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
      >
        <template #filters>
          <FilterSelect v-model="stock" label="Stock" :options="STOCK_OPTIONS" />
        </template>
      </FilterBar>

      <DataTable
        embedded
        :columns="columns"
        :rows="rows"
        :row-key="rowKey"
        :loading="loading"
        :error="failed ? (failed instanceof Error ? failed.message : 'Could not load parts') : null"
        :row-class="() => 'cursor-pointer'"
        @row-click="openPart"
        @retry="refetch"
      >
        <template #cell-manufacturer="{ value }">{{ value ?? "—" }}</template>
        <template #cell-category="{ value }">{{ value ?? "—" }}</template>
        <template #cell-unitOfMeasure="{ value }">{{ UNIT_OF_MEASURE_LABELS[value as keyof typeof UNIT_OF_MEASURE_LABELS] }}</template>
        <template #cell-quantityOnHand="{ row }">
          <StockLevelCell :line="row as StockLineDto" />
        </template>
        <template #cell-reorderQuantity="{ value }">{{ value ?? "—" }}</template>
        <template #empty>
          <p v-if="lowOnly">
            Nothing is at its reorder point. A shelf is only counted here once somebody has set one —
            open a part and add a shelf to say how many is enough.
          </p>
          <p v-else-if="search">No part matches that. Try the part number, or the supplier's barcode.</p>
          <p v-else>No parts yet. Add the first one, and the shop starts keeping count of it.</p>
        </template>
        <template v-if="!lowOnly" #footer>
          <TablePagination :page="page" :page-size="50" :total="total" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>

    <PartDrawer :open="creating" @close="creating = false" />
    <LocationsDrawer :open="locationsOpen" @close="locationsOpen = false" />
  </div>
</template>
