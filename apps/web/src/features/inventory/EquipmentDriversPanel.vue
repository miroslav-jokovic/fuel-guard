<script setup lang="ts">
import { computed, watch } from "vue";
import { useRouter } from "vue-router";
import {
  useQueryState,
  AppButton as BaseButton,
  AppCallout,
  DataWorkspace,
  FilterBar,
  DataTable,
  type DataTableColumn,
  TablePagination,
} from "@silvicom/ui";
import type { AssetDto } from "@silvicom/shared";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import { useOpens } from "@/composables/useOpens";
import { ASSETS_PAGE_SIZE, useAssetsQuery, useNotReturnedCountQuery } from "@/features/inventory/useAssets";
import { BADGE_BASE, toneClass } from "@/lib/badges";

/**
 * Equipment › Drivers — everything a driver holds, which today is tablets (D-DE1; EQUIPMENT-ASSIGN-
 * BY-SCAN-PROPOSAL §3.4, EA2; the owner's "trucks and drivers (separate tabs) with assigned equipment
 * listed").
 *
 * ── A ROW PER THING, NOT PER DRIVER ───────────────────────────────────────────────────────────
 * A driver holds one tablet, two at most, so a row per driver would be a row per tablet with the
 * second one folded into a cell. The row names the driver first because that is what this tab is
 * for, and opens the driver's page — where *Give a tablet* and *Return to shop* live (EA1). Without
 * the roster section the driver's page will not open, so the row opens the tablet's own page instead.
 *
 * ── TABLETS NOT RETURNED MOVED HERE FROM THE INVENTORY TAB (D-DE3) ─────────────────────────────
 * It is a question about drivers who have left, so it is asked on the drivers' tab. The count is the
 * database's (`?notReturned=true&limit=1`'s `total`), never the rows on screen; the warning's button
 * and the *Returned* filter are one control, as they were on Inventory (DE2b).
 *
 * Search is the API's — the list arrives a server page at a time, so a client filter over one page
 * would say "no such tablet" about one on page two (`EquipmentInventoryPanel` has the long form).
 */

const router = useRouter();
const opens = useOpens();
const qs = useQueryState();
const search = qs.param("search");
const returned = qs.param("returned", ["not-returned"] as const);
const page = qs.page();
watch([search, returned], () => (page.value = 1));

const notReturnedQ = useNotReturnedCountQuery();
const notReturnedCount = computed(() => notReturnedQ.data.value ?? 0);
const returnedOptions = computed(() => [
  { value: "", label: "All drivers" },
  { value: "not-returned", label: "Not returned", count: String(notReturnedCount.value) },
]);
const activeFilterCount = computed(() => [search.value.trim(), returned.value].filter(Boolean).length);
const clearAll = () => qs.set({ search: undefined, returned: undefined });

const filter = computed(() => ({
  holder: "driver" as const,
  search: search.value.trim() || undefined,
  notReturned: returned.value === "not-returned" || undefined,
  page: page.value,
}));
const assets = useAssetsQuery(filter);

const COLUMNS: DataTableColumn[] = [
  { key: "holder", label: "Driver", card: "title" },
  { key: "displayNo", label: "Number", card: "none", cellClass: "font-mono text-xs text-ink", width: "sm" },
  { key: "name", label: "What it is", card: "sentence" },
  { key: "imei", label: "IMEI", card: "meta", cellClass: "font-mono text-xs text-ink-tertiary" },
];

const driverRoute = (a: AssetDto) => ({ name: "driver-detail", params: { id: a.holder.id ?? "" } });
function openRow(row: Record<string, unknown>) {
  const a = row as unknown as AssetDto;
  const driver = driverRoute(a);
  void router.push(a.holder.id && opens(driver) ? driver : { name: "asset", params: { id: a.id } });
}
</script>

<template>
  <DataWorkspace>
    <AppCallout v-if="notReturnedCount > 0 && !returned" tone="warning" data-test="not-returned-callout">
      {{ notReturnedCount === 1 ? "1 tablet is" : `${notReturnedCount} tablets are` }} still with a driver who has left.
      <template #actions>
        <BaseButton size="sm" @click="returned = 'not-returned'">Show them</BaseButton>
      </template>
    </AppCallout>

    <FilterBar
      v-model:search="search"
      embedded
      search-placeholder="Search number, name, IMEI or tag…"
      :count="assets.data.value?.total ?? 0"
      count-label="items"
      :active-count="activeFilterCount"
      @clear-all="clearAll"
    >
      <template #filters>
        <FilterSelect v-model="returned" label="Returned" :options="returnedOptions" />
      </template>
    </FilterBar>

    <DataTable
      embedded
      :columns="COLUMNS"
      :rows="assets.data.value?.assets ?? []"
      :loading="assets.isLoading.value"
      :error="assets.isError.value ? 'Could not load what the drivers hold.' : null"
      :row-class="() => 'cursor-pointer'"
      @row-click="openRow"
      @retry="() => assets.refetch()"
    >
      <template #cell-holder="{ row }">
        <span class="font-medium text-ink">{{ row.holder.label ?? "A driver" }}</span>
        <span v-if="row.holder.notReturned" :class="[BADGE_BASE, toneClass('danger'), 'ml-1']">Not returned</span>
      </template>
      <template #cell-imei="{ value }">
        <span v-if="value">…{{ String(value).slice(-5) }}</span>
        <span v-else class="text-ink-tertiary">—</span>
      </template>
      <template #actions="{ row }">
        <KebabMenu>
          <BaseButton class="kebab-item" @click="openRow(row)">Open</BaseButton>
        </KebabMenu>
      </template>
      <template #empty>
        <p v-if="returned">Every tablet given to a driver who has left has come back.</p>
        <p v-else-if="search">Nothing a driver holds matches that.</p>
        <p v-else>No driver holds anything yet. Open a driver and press Give a tablet, then scan it.</p>
      </template>
      <template #footer>
        <TablePagination :page="page" :page-size="ASSETS_PAGE_SIZE" :total="assets.data.value?.total ?? 0" @update:page="page = $event" />
      </template>
    </DataTable>
  </DataWorkspace>
</template>
