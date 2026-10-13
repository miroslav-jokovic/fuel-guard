<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useFuelStations, type FuelStationRow } from "@/features/fueling/useFuelStations";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import TablePagination from "@/components/TablePagination.vue";
import DataTable from "@/components/ui/DataTable.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import PriceUploadDrawer from "@/features/fueling/PriceUploadDrawer.vue";
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import { ArrowUpTrayIcon } from "@silvicom/ui/icons";
import { useSessionStore } from "@/stores/session";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { sortRows } from "@/lib/sort";
import { useQueryState } from "@/composables/useQueryState";
import { SORT_DIRECTIONS, useUrlSort } from "@/composables/useUrlSort";

const PAGE_SIZE = 25;
const { data, isLoading, isError, isFetching, refetch } = useFuelStations();

/**
 * FUEL-C4, D-FUI3 — the price and locations uploads moved here from `/import`, which is gone.
 *
 * `can("dispatch")` and not `canView`: this page is catalogued at `section("dispatch")` VIEW, so an
 * auditor reaches it and must not be offered a write. See `PriceUploadDrawer` for why that section
 * is the honest reading of the route's `requireRole("admin", "fleet_manager", "dispatcher")`.
 */
const session = useSessionStore();
const uploadOpen = ref(false);

/**
 * Filters, sort and page live in the URL (D-US2), so a reload, a forwarded "cheapest Pilot in OK" link
 * and Back keep the list. The price filter is checked against its own options; state and network are
 * not, because their options are read off the loaded stations and a pasted link is read before they
 * load — an unknown one filters to nothing, and the count says so.
 */
const qs = useQueryState();
const search = qs.param("search");
const stateFilter = qs.param("state");
const brandFilter = qs.param("network");
const page = qs.page();

const rows = computed(() => data.value?.stations ?? []);
const stateOptions = computed(() => {
  const set = [...new Set(rows.value.map((r) => r.state).filter(Boolean))].sort() as string[];
  return [{ value: "", label: "All states" }, ...set.map((s) => ({ value: s, label: s }))];
});
const brandOptions = computed(() => {
  const set = [...new Set(rows.value.map((r) => r.brand))].sort();
  return [{ value: "", label: "All networks" }, ...set.map((b) => ({ value: b, label: brandLabel(b) }))];
});
const priceOptions = [
  { value: "", label: "All prices" },
  { value: "priced", label: "Fresh price" },
  { value: "estimated", label: "Estimated price" },
  { value: "stale", label: "Stale quote" },
  { value: "none", label: "No price" },
];
const priceFilter = qs.param("price", priceOptions.map((o) => o.value).filter(Boolean));

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return rows.value.filter((r) => {
    if (stateFilter.value && r.state !== stateFilter.value) return false;
    if (brandFilter.value && r.brand !== brandFilter.value) return false;
    if (priceFilter.value === "priced" && (r.netPrice == null || r.priceEstimated)) return false;
    if (priceFilter.value === "estimated" && !r.priceEstimated) return false;
    if (priceFilter.value === "stale" && !r.stale) return false;
    if (priceFilter.value === "none" && r.netPrice != null) return false;
    if (!q) return true;
    return [r.name, r.storeNumber, r.state, r.brand].some((v) => String(v ?? "").toLowerCase().includes(q));
  });
});
const activeFilterCount = computed(
  () => [search.value.trim(), stateFilter.value, brandFilter.value, priceFilter.value].filter(Boolean).length,
);
function clearFilters(): void {
  // The filters only: the sort is how the reader is LOOKING at the list, not what they narrowed it to.
  qs.set({ search: undefined, state: undefined, network: undefined, price: undefined });
}
// Narrowing while on page four lands on an empty page that reads as "no stations" — and with the page
// in the URL, a stale `?page=` from a wider list would do the same.
watch([search, stateFilter, brandFilter, priceFilter], () => (page.value = 1));

const price = (n: number | null) => (n == null ? "—" : `$${n.toFixed(3)}`);
const brandLabel = (b: string) => b.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const columns: DataTableColumn[] = [
  { key: "name", label: "Truck stop", sortable: true, width: "lg", cellClass: "font-medium text-ink" },
  { key: "brand", label: "Brand", sortable: true, width: "sm", cellClass: "text-ink-secondary" },
  { key: "state", label: "State", sortable: true, width: "xs" },
  { key: "city", label: "Location", sortable: true, width: "md", cellClass: "text-ink-secondary" },
  { key: "storeNumber", label: "Store #", sortable: true, width: "sm", cellClass: "text-ink-muted tabular-nums" },
  { key: "netPrice", label: "Net $/gal", sortable: true, numeric: true, width: "sm" },
  { key: "postedPrice", label: "Posted", sortable: true, numeric: true, width: "sm" },
  { key: "ageHours", label: "Price age", sortable: true, numeric: true, width: "sm" },
];
/**
 * Cheapest net price first is where the list OPENS — it is the question a dispatcher brings here — so
 * `netPrice` is the sort key's fallback and a plain link never carries it. The direction needs no
 * fallback: absent already reads as ascending. The third click on a column ("no sort") has to say so
 * against a default, and it does in `useQueryState`'s own word for that: `?sort=any`, which reads as
 * the stations' loaded order. Clear filters leaves the sort alone.
 */
const { sort, onSort } = useUrlSort(
  qs.param("sort", columns.filter((c) => c.sortable).map((c) => c.key), "netPrice"),
  qs.param("dir", SORT_DIRECTIONS),
);
const sorted = computed(() => sortRows(filtered.value, sort.value, (r, k) => (r as unknown as Record<string, unknown>)[k]));
const paged = computed(() => sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Every loaded truck stop and the diesel price currently used for planning. Net is your contracted price; posted is retail.">
      <template v-if="session.can('dispatch')" #actions>
        <BaseButton variant="secondary" @click="uploadOpen = true">
          <AppIcon :icon="ArrowUpTrayIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Upload prices
        </BaseButton>
      </template>
    </PageHeader>

    <PriceUploadDrawer :open="uploadOpen" @close="uploadOpen = false" />

    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search stop, store #, state…"
        :count="isLoading || isError ? null : filtered.length"
        count-label="truck stops"
        :active-count="activeFilterCount"
        @clear-all="clearFilters"
      >
        <template #filters>
          <FilterSelect v-model="brandFilter" label="Network" :options="brandOptions" />
          <FilterSelect v-model="stateFilter" label="State" :options="stateOptions" />
          <FilterSelect v-model="priceFilter" label="Price" :options="priceOptions" />
        </template>
      </FilterBar>

      <DataTable
        embedded
        :columns="columns"
        :rows="paged"
        row-key="id"
        :sort="sort"
        :loading="isLoading"
        :error="isError ? 'Could not load stations.' : null"
        :retrying="isFetching"
        empty-text="No truck stops match."
        @sort="onSort"
        @retry="refetch"
      >
          <template #cell-name="{ row }">{{ (row as FuelStationRow).name ?? "—" }}</template>
          <template #cell-brand="{ row }">{{ brandLabel((row as FuelStationRow).brand) }}</template>
          <template #cell-city="{ row }">
            <template v-if="(row as FuelStationRow).city">
              {{ (row as FuelStationRow).city }}<span v-if="(row as FuelStationRow).exit" class="text-ink-muted"> · Exit {{ (row as FuelStationRow).exit }}</span>
              <span
                v-if="(row as FuelStationRow).coordSource !== 'exact_export'"
                class="ml-1 text-ink-tertiary"
                title="Approximate placement (city-centroid geocode). Upload the Pilot 'Download All Locations' export for exact coordinates."
              >≈</span>
            </template>
            <span
              v-else
              class="text-ink-tertiary"
              title="No city on file yet — upload the Pilot 'Download All Locations' export to fill exact location and coordinates."
            >— ≈</span>
          </template>
          <template #cell-netPrice="{ row }">
            <span class="tabular-nums font-medium text-ink">{{ price((row as FuelStationRow).netPrice) }}</span>
            <span
              v-if="(row as FuelStationRow).priceEstimated"
              :class="['ml-1.5', BADGE_BASE, toneClass('neutral')]"
              :title="(row as FuelStationRow).priceBasis === 'posted_discount'
                ? `Current posted price with your discount rule applied (${(row as FuelStationRow).priceConfidence} confidence)`
                : `Estimated from history (${(row as FuelStationRow).priceConfidence} confidence)`"
            >{{ (row as FuelStationRow).priceBasis === "posted_discount" ? "posted−disc." : "est." }}</span>
          </template>
          <template #cell-postedPrice="{ row }">
            <span class="tabular-nums text-ink-muted">{{ price((row as FuelStationRow).postedPrice) }}</span>
          </template>
          <template #cell-ageHours="{ row }">
            <span v-if="(row as FuelStationRow).netPrice == null || (row as FuelStationRow).ageHours == null" class="text-ink-tertiary">—</span>
            <span v-else :class="[BADGE_BASE, toneClass((row as FuelStationRow).stale ? 'warning' : 'success')]">
              {{ (row as FuelStationRow).ageHours }}h{{ (row as FuelStationRow).stale ? " · stale" : "" }}
            </span>
          </template>
          <template #footer>
            <TablePagination v-model:page="page" :page-size="PAGE_SIZE" :total="filtered.length" />
          </template>
      </DataTable>
    </DataWorkspace>
  </div>
</template>
