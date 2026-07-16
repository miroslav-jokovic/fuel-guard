<script setup lang="ts">
import { ref, computed } from "vue";
import { useFuelStations, type FuelStationRow } from "@/features/fueling/useFuelStations";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import TablePagination from "@/components/TablePagination.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { toggleSort, sortRows, type SortState } from "@/lib/sort";

const PAGE_SIZE = 25;
const { data, isLoading, isError, error } = useFuelStations();

const search = ref("");
const stateFilter = ref("");
const priceFilter = ref("");
const page = ref(1);
const sort = ref<SortState>({ key: "netPrice", dir: "asc" });

const rows = computed(() => data.value?.stations ?? []);
const stateOptions = computed(() => {
  const set = [...new Set(rows.value.map((r) => r.state).filter(Boolean))].sort() as string[];
  return [{ value: "", label: "All states" }, ...set.map((s) => ({ value: s, label: s }))];
});
const priceOptions = [
  { value: "", label: "All prices" },
  { value: "priced", label: "Fresh price" },
  { value: "estimated", label: "Estimated price" },
  { value: "stale", label: "Stale quote" },
  { value: "none", label: "No price" },
];

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return rows.value.filter((r) => {
    if (stateFilter.value && r.state !== stateFilter.value) return false;
    if (priceFilter.value === "priced" && (r.netPrice == null || r.priceEstimated)) return false;
    if (priceFilter.value === "estimated" && !r.priceEstimated) return false;
    if (priceFilter.value === "stale" && !r.stale) return false;
    if (priceFilter.value === "none" && r.netPrice != null) return false;
    if (!q) return true;
    return [r.name, r.storeNumber, r.state, r.brand].some((v) => String(v ?? "").toLowerCase().includes(q));
  });
});
const sorted = computed(() => sortRows(filtered.value, sort.value, (r, k) => (r as unknown as Record<string, unknown>)[k]));
const paged = computed(() => sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
function onSort(key: string) { sort.value = toggleSort(sort.value, key); }

const price = (n: number | null) => (n == null ? "—" : `$${n.toFixed(3)}`);
const brandLabel = (b: string) => b.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const columns: DataTableColumn[] = [
  { key: "name", label: "Truck stop", sortable: true, headerClass: "min-w-[9rem]", cellClass: "font-medium text-ink" },
  { key: "brand", label: "Brand", sortable: true, headerClass: "min-w-[6rem]", cellClass: "text-ink-secondary" },
  { key: "state", label: "State", sortable: true, headerClass: "min-w-[4rem]" },
  { key: "storeNumber", label: "Store #", sortable: true, headerClass: "min-w-[5rem]", cellClass: "text-ink-muted tabular-nums" },
  { key: "netPrice", label: "Net $/gal", sortable: true, numeric: true, headerClass: "min-w-[6rem]" },
  { key: "postedPrice", label: "Posted", sortable: true, numeric: true, headerClass: "min-w-[6rem]" },
  { key: "ageHours", label: "Price age", sortable: true, numeric: true, headerClass: "min-w-[6rem]" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Every loaded truck stop and the diesel price currently used for planning. Net is your contracted price; posted is retail." />

    <p v-if="isLoading" class="text-sm text-ink-muted">Loading…</p>
    <BaseCard v-else-if="isError" class="text-sm text-danger-600">{{ error instanceof Error ? error.message : "Could not load stations." }}</BaseCard>

    <template v-else>
      <FilterBar
        v-model:search="search"
        search-placeholder="Search stop, store #, state…"
        :count="filtered.length"
        count-label="truck stops"
      >
        <template #filters>
          <FilterSelect v-model="stateFilter" label="State" :options="stateOptions" />
          <FilterSelect v-model="priceFilter" label="Price" :options="priceOptions" />
        </template>
      </FilterBar>

      <BaseCard padding="none">
        <DataTable :columns="columns" :rows="paged" row-key="id" :sort="sort" empty-text="No truck stops match." @sort="onSort">
          <template #cell-name="{ row }">{{ (row as FuelStationRow).name ?? "—" }}</template>
          <template #cell-brand="{ row }">{{ brandLabel((row as FuelStationRow).brand) }}</template>
          <template #cell-netPrice="{ row }">
            <span class="tabular-nums font-medium text-ink">{{ price((row as FuelStationRow).netPrice) }}</span>
            <span v-if="(row as FuelStationRow).priceEstimated" :class="['ml-1.5', BADGE_BASE, toneClass('neutral')]" :title="`Estimated from history (${(row as FuelStationRow).priceConfidence} confidence)`">est.</span>
          </template>
          <template #cell-postedPrice="{ row }">
            <span class="tabular-nums text-ink-muted">{{ price((row as FuelStationRow).postedPrice) }}</span>
          </template>
          <template #cell-ageHours="{ row }">
            <span v-if="(row as FuelStationRow).netPrice == null" class="text-ink-subtle">—</span>
            <span v-else :class="[BADGE_BASE, toneClass((row as FuelStationRow).stale ? 'warning' : 'success')]">
              {{ (row as FuelStationRow).ageHours }}h{{ (row as FuelStationRow).stale ? " · stale" : "" }}
            </span>
          </template>
        </DataTable>
      </BaseCard>

      <TablePagination v-model:page="page" :page-size="PAGE_SIZE" :total="filtered.length" />
    </template>
  </div>
</template>
