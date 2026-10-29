<script setup lang="ts">
import { computed, watch } from "vue";
import { useRouter } from "vue-router";
import {
  useQueryState,
  AppButton as BaseButton,
  DataWorkspace,
  FilterBar,
  DataTable,
  type DataTableColumn,
  TablePagination,
} from "@silvicom/ui";
import { ASSET_STATUSES, ASSET_STATUS_LABELS, type AssetDto } from "@silvicom/shared";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import { ASSETS_PAGE_SIZE, useAssetsQuery, useAssetTypesQuery } from "@/features/inventory/useAssets";
import { BADGE_BASE, assetStatusBadge, toneClass } from "@/lib/badges";

/**
 * Equipment › Inventory — everything the shop owns that has an identity (INVENTORY-PLAN.md I8). It
 * was the whole of `/shop/assets` until M7 (MAINTENANCE-SECTION-REDESIGN-PROPOSAL §7a.4) made that
 * page two tabs; the list moved in as it was.
 *
 * ── WHY THIS IS A SEPARATE PAGE FROM PARTS AND NOT A TAB ON IT ────────────────────────────────
 * §2.1's seam, rendered. A case of oil filters is stock: the questions are "how many" and "where",
 * and the row is a SHELF. A tablet is A-0412: the questions are "which one" and "where was it
 * before", and the row is a THING. Two questions, two lists, two sets of columns — the plan's own
 * warning about six tabs on the driver page is what a single "Inventory" screen with a toggle
 * becomes.
 *
 * ── THE HOLDER IS ONE COLUMN, ASSEMBLED, NOT THREE ────────────────────────────────────────────
 * `assetDtoSchema.holder` arrives as one object with a kind, a label and — for a truck — the driver
 * the roster has assigned right now (D-INV3, inferred and never stored). Rendering three columns
 * that are null two-thirds of the time each would make the table unreadable and would leak the
 * schema's shape into the screen.
 *
 * ── AND THE STATUS PILL IS DELIBERATELY ABSENT FROM MOST ROWS ─────────────────────────────────
 * `assetStatusBadge` returns null for `in_service`, which nearly every asset is. A badge on every
 * row means nothing; the coloured ones are the exceptions worth walking over to.
 *
 * The pill is `[BADGE_BASE, toneClass(...)]` because that is the rule `apps/web/CLAUDE.md` states
 * for every badge. (It was once load-bearing as well: `AppBadge` carried `capitalize` until
 * 2026-09-09 and rendered "In Repair" on a real page. The primitive no longer does, so the base
 * classes are the convention here and not a workaround.)
 *
 * ── SEARCH IS THE API'S, AND THE COLUMNS DO NOT SORT ──────────────────────────────────────────
 * The list arrives one server page at a time, so the search box asks `/assets?search=` rather than
 * filtering the fifty rows on screen — a client filter over one page says "no such asset" about a
 * tablet on page two. The same fact is why no column header sorts: a page-local order presented as
 * the fleet's is the wrong answer that gets believed. Server-side sort is owed to the API.
 *
 * ── THE FILTERS' "EVERYTHING" IS `""` ─────────────────────────────────────────────────────────
 * `FilterSelect` reads any non-empty value as applied. `PartsPage.vue` carries the measurement.
 */

const router = useRouter();

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  ...ASSET_STATUSES.map((s) => ({ value: s, label: ASSET_STATUS_LABELS[s] })),
];

// Filters and page live in the URL (D-US2), so Back from an asset returns to the same page of the
// same list. Status is a closed set and is checked against the shared catalogue; Kind is not — the
// org's asset types arrive after the first render, and an unknown type id is not a hazard: it is
// sent as `assetTypeId` and the API answers it with an empty list, which the chip explains.
const qs = useQueryState();
const search = qs.param("search");
const status = qs.param("status", ASSET_STATUSES);
const typeId = qs.param("kind");
const page = qs.page();
watch([search, status, typeId], () => (page.value = 1));

const { data: types } = useAssetTypesQuery();
const typeOptions = computed(() => [
  { value: "", label: "All kinds" },
  ...(types.value ?? []).map((t) => ({ value: t.id, label: t.name })),
]);

const filtered = computed(() => Boolean(search.value || status.value || typeId.value));
const activeFilterCount = computed(() => [search.value.trim(), status.value, typeId.value].filter(Boolean).length);
function resetFilters() {
  qs.set({ search: undefined, status: undefined, kind: undefined });
}

const filter = computed(() => ({
  search: search.value.trim() || undefined,
  status: (status.value || undefined) as AssetDto["status"] | undefined,
  assetTypeId: typeId.value || undefined,
  page: page.value,
}));
const assets = useAssetsQuery(filter);

const COLUMNS: DataTableColumn[] = [
  { key: "displayNo", label: "Number", card: "none", cellClass: "font-mono text-xs text-ink", width: "sm" },
  { key: "name", label: "What it is", card: "title" },
  { key: "assetTypeName", label: "Kind", card: "none", cellClass: "text-ink-secondary" },
  { key: "holder", label: "Where it is", card: "sentence" },
  { key: "serialNumber", label: "Serial", card: "none", cellClass: "font-mono text-xs text-ink-tertiary" },
  { key: "status", label: "Status", card: "meta", width: "sm" },
];

const openAsset = (row: Record<string, unknown>) =>
  void router.push({ name: "asset", params: { id: String(row.id) } });
</script>

<template>
  <DataWorkspace>
    <FilterBar
      v-model:search="search"
      embedded
      search-placeholder="Search number, name, serial, IMEI or tag…"
      :count="assets.data.value?.total ?? 0"
      count-label="items"
      :active-count="activeFilterCount"
      @clear-all="resetFilters"
    >
      <template #filters>
        <FilterSelect v-model="typeId" label="Kind" :options="typeOptions" />
        <FilterSelect v-model="status" label="Status" :options="STATUS_OPTIONS" />
      </template>
    </FilterBar>

    <DataTable
      embedded
      :columns="COLUMNS"
      :rows="assets.data.value?.assets ?? []"
      :loading="assets.isLoading.value"
      :error="assets.isError.value ? 'Could not load assets.' : null"
      :row-class="() => 'cursor-pointer'"
      @row-click="openAsset"
      @retry="() => assets.refetch()"
    >
      <template #cell-holder="{ row }">
        <span v-if="row.holder.label" class="text-ink">
          {{ row.holder.label }}
          <span v-if="row.holder.inferredDriverName" class="text-ink-tertiary">
            · {{ row.holder.inferredDriverName }}
          </span>
        </span>
        <span v-else class="text-ink-tertiary">Not placed</span>
      </template>
      <template #cell-status="{ value }">
        <span
          v-if="assetStatusBadge(value)"
          :class="[BADGE_BASE, toneClass(assetStatusBadge(value)!.tone)]"
        >
          {{ assetStatusBadge(value)!.label }}
        </span>
        <span v-else class="text-ink-tertiary">—</span>
      </template>
      <template #actions="{ row }">
        <KebabMenu>
          <BaseButton class="kebab-item" @click="openAsset(row)">Open</BaseButton>
        </KebabMenu>
      </template>
      <template #empty>
        <p v-if="search">Nothing matches that. Try its number, its serial, or the tag on it.</p>
        <p v-else-if="filtered">
          Nothing matches those filters. Clear them to see everything the shop owns.
        </p>
        <p v-else>
          No equipment yet. Set up the types under Types of equipment first — then add the first
          tablet or load bar, and the shop starts knowing which truck has it.
        </p>
      </template>
      <template #footer>
        <TablePagination
          :page="page"
          :page-size="ASSETS_PAGE_SIZE"
          :total="assets.data.value?.total ?? 0"
          @update:page="page = $event"
        />
      </template>
    </DataTable>
  </DataWorkspace>
</template>
