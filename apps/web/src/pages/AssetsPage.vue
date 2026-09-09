<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import { PlusIcon } from "@silvicom/ui/icons";
import { ASSET_STATUSES, ASSET_STATUS_LABELS, type AssetDto } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import AssetDrawer from "@/features/inventory/AssetDrawer.vue";
import { useAssetsQuery, useAssetTypesQuery } from "@/features/inventory/useAssets";
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
 * ⚠ The pill is `[BADGE_BASE, toneClass(...)]` and NOT `AppBadge`, which is the rule
 * `apps/web/CLAUDE.md` states — and here it is load-bearing rather than stylistic. `AppBadge` carries
 * `capitalize`, so it rendered "In Repair" on a real page while the source said "In repair"; the
 * plan's own §8 records the same primitive title-casing "Not counted" at I5, which was worked around
 * there by choosing a one-word label. There is no one-word way to say "In repair", so this uses the
 * base classes, which deliberately carry no transform (badges.ts records why).
 */

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  ...ASSET_STATUSES.map((s) => ({ value: s, label: ASSET_STATUS_LABELS[s] })),
];

const status = ref<string>("all");
const typeId = ref<string>("all");
const page = ref(1);
watch([status, typeId], () => (page.value = 1));

const { data: types } = useAssetTypesQuery();
const typeOptions = computed(() => [
  { value: "all", label: "All kinds" },
  ...(types.value ?? []).map((t) => ({ value: t.id, label: t.name })),
]);

const filter = computed(() => ({
  status: status.value === "all" ? undefined : (status.value as AssetDto["status"]),
  assetTypeId: typeId.value === "all" ? undefined : typeId.value,
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

const creating = ref(route.query.new === "1");
watch(creating, (open) => {
  if (!open && route.query.new) void router.replace({ query: {} });
});
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Everything with a number on it — tools, tablets, straps — and which truck has it.">
      <template #actions>
        <BaseButton v-if="session.can('maintenance')" variant="primary" @click="creating = true">
          <AppIcon :icon="PlusIcon" class="-ml-0.5 size-5" aria-hidden="true" /> New asset
        </BaseButton>
      </template>
    </PageHeader>

    <DataWorkspace>
      <FilterBar embedded :count="assets.data.value?.total ?? 0" count-label="assets">
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
        <template #cell-serialNumber="{ value }">{{ value ?? "—" }}</template>
        <template #cell-status="{ value }">
          <span
            v-if="assetStatusBadge(value)"
            :class="[BADGE_BASE, toneClass(assetStatusBadge(value)!.tone)]"
          >
            {{ assetStatusBadge(value)!.label }}
          </span>
          <span v-else class="text-ink-tertiary">—</span>
        </template>
        <template #empty>
          <p v-if="status !== 'all' || typeId !== 'all'">
            Nothing matches those filters. Clear them to see everything the shop owns.
          </p>
          <p v-else>
            No assets yet. Add the first tablet or load bar, and the shop starts knowing which truck
            has it.
          </p>
        </template>
        <template #footer>
          <TablePagination
            :page="page"
            :page-size="50"
            :total="assets.data.value?.total ?? 0"
            @update:page="page = $event"
          />
        </template>
      </DataTable>
    </DataWorkspace>

    <AssetDrawer :open="creating" @close="creating = false" />
  </div>
</template>
