<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import { Cog6ToothIcon, PlusIcon, ScanIcon } from "@silvicom/ui/icons";
import { ASSET_STATUSES, ASSET_STATUS_LABELS, type AssetDto } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import AssetDrawer from "@/features/inventory/AssetDrawer.vue";
import AssetTypesDrawer from "@/features/inventory/AssetTypesDrawer.vue";
import { ASSETS_PAGE_SIZE, useAssetsQuery, useAssetTypesQuery } from "@/features/inventory/useAssets";
import { BADGE_BASE, assetStatusBadge, toneClass } from "@/lib/badges";
import { useSessionStore } from "@/stores/session";

/**
 * Assets — everything the shop owns that has an identity (INVENTORY-PLAN.md I8).
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

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  ...ASSET_STATUSES.map((s) => ({ value: s, label: ASSET_STATUS_LABELS[s] })),
];

const search = ref("");
const status = ref<string>("");
const typeId = ref<string>("");
const page = ref(1);
watch([search, status, typeId], () => (page.value = 1));

const { data: types } = useAssetTypesQuery();
const typeOptions = computed(() => [
  { value: "", label: "All kinds" },
  ...(types.value ?? []).map((t) => ({ value: t.id, label: t.name })),
]);

const filtered = computed(() => Boolean(search.value || status.value || typeId.value));

const filter = computed(() => ({
  search: search.value.trim() || undefined,
  status: (status.value || undefined) as AssetDto["status"] | undefined,
  assetTypeId: typeId.value || undefined,
  page: page.value,
}));
const assets = useAssetsQuery(filter);

const COLUMNS: DataTableColumn[] = [
  { key: "displayNo", label: "Number", cellClass: "font-mono text-xs text-ink", width: "sm" },
  { key: "name", label: "What it is" },
  { key: "assetTypeName", label: "Kind", cellClass: "text-ink-secondary" },
  { key: "holder", label: "Where it is" },
  { key: "serialNumber", label: "Serial", cellClass: "font-mono text-xs text-ink-tertiary" },
  { key: "status", label: "Status", width: "sm" },
];

const openAsset = (row: Record<string, unknown>) =>
  void router.push({ name: "asset", params: { id: String(row.id) } });

const typesOpen = ref(false);
const creating = ref(route.query.new === "1");
watch(creating, (open) => {
  if (!open && route.query.new) void router.replace({ query: {} });
});
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Everything with a number on it — tools, tablets, straps — and which truck has it.">
      <template #actions>
        <!-- The kinds of thing, as a worded button. It is not a nicety: an asset cannot be created
             without a type, and until 2026-09-09 no screen in the product could make one — the same
             dead end `LocationsDrawer.vue` closed for stock locations at I4. Worded rather than an
             icon-only gear for the reason `PartsPage.vue` records. -->
        <BaseButton v-if="session.can('maintenance')" @click="typesOpen = true">
          <AppIcon :icon="Cog6ToothIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Asset kinds
        </BaseButton>
        <BaseButton v-if="session.can('maintenance')" to="/shop/labels">
          <AppIcon :icon="ScanIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Labels
        </BaseButton>
        <BaseButton v-if="session.can('maintenance')" variant="primary" @click="creating = true">
          <AppIcon :icon="PlusIcon" class="-ml-0.5 size-5" aria-hidden="true" /> New asset
        </BaseButton>
      </template>
    </PageHeader>

    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search number, name, serial or tag…"
        :count="assets.data.value?.total ?? 0"
        count-label="assets"
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
        :error="assets.isError.value ? 'Could not load assets' : null"
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
            <BaseButton class="kebab-item" @click="openAsset(row)">Open asset</BaseButton>
          </KebabMenu>
        </template>
        <template #empty>
          <p v-if="search">No asset matches that. Try its number, its serial, or the tag on it.</p>
          <p v-else-if="filtered">
            Nothing matches those filters. Clear them to see everything the shop owns.
          </p>
          <p v-else>
            No assets yet. Set up the kinds of thing under Asset kinds first — then add the first
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

    <AssetDrawer :open="creating" @close="creating = false" />
    <AssetTypesDrawer :open="typesOpen" @close="typesOpen = false" />
  </div>
</template>
