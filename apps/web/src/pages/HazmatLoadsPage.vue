<script setup lang="ts">
import { computed, ref } from "vue";
import { AppIcon } from "@fuelguard/ui";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "@fuelguard/ui/icons";
import {
  HAZMAT_LOAD_STATUSES,
  HAZMAT_LOAD_STATUS_LABELS,
  type HazmatLoadRow,
} from "@fuelguard/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import { AppButton as BaseButton } from "@fuelguard/ui";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import LoadStatusBadge from "@/features/hazmat/LoadStatusBadge.vue";
import { useHazmatLoadsQuery } from "@/features/hazmat/useHazmatLoads";

const statusFilter = ref("");
const status = computed<string | undefined>(() => statusFilter.value || undefined);
const search = ref("");
const { data: loads, isLoading, isError, error, isFetching, refetch } = useHazmatLoadsQuery(status);

const statusOptions = [
  { value: "", label: "All statuses" },
  ...HAZMAT_LOAD_STATUSES.map((value) => ({ value, label: HAZMAT_LOAD_STATUS_LABELS[value] })),
];
const visible = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return loads.value ?? [];
  return (loads.value ?? []).filter((load) =>
    [load.id, load.tank_state, JSON.stringify(load.declared_lines)].some((value) => value.toLowerCase().includes(query)),
  );
});
const emptyText = computed(() =>
  (loads.value ?? []).length === 0 && !statusFilter.value
    ? "No hazmat loads yet. Create a load to begin a placard and compliance check."
    : "No hazmat loads match these filters.",
);

const lineCount = (load: HazmatLoadRow): number => Array.isArray(load.declared_lines) ? load.declared_lines.length : 0;
const lineLabel = (load: HazmatLoadRow): string => `${lineCount(load)} product${lineCount(load) === 1 ? "" : "s"}`;
const fmtDate = (iso: string): string => new Date(iso).toLocaleString();
const tankState = (value: string): string => value.replace(/_/g, " ");

const columns: DataTableColumn[] = [
  { key: "status", label: "Status", align: "left", headerClass: "min-w-[8rem]" },
  { key: "products", label: "Products", align: "left", headerClass: "min-w-[7rem]" },
  { key: "tank_state", label: "Tank state", align: "left", headerClass: "min-w-[8rem]", cellClass: "text-ink-secondary capitalize" },
  { key: "planned_pickup_at", label: "Planned pickup", align: "left", headerClass: "min-w-[11rem]", cellClass: "text-ink-secondary" },
  { key: "created_at", label: "Created", align: "left", headerClass: "min-w-[11rem]", cellClass: "text-ink-secondary" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Create, analyze, and track declared hazmat loads through review and clearance.">
      <template #actions>
        <BaseButton variant="ghost" size="sm" to="/hazmat">
          <AppIcon :icon="ChevronLeftIcon" class="size-4" aria-hidden="true" />
          HazmatGuard
        </BaseButton>
        <BaseButton variant="primary" size="sm" to="/hazmat/loads/new">
          <AppIcon :icon="PlusIcon" class="size-4" aria-hidden="true" />
          New load
        </BaseButton>
      </template>
    </PageHeader>

    <FilterBar
      v-model:search="search"
      search-placeholder="Search load or product…"
      :count="visible.length"
      count-label="loads"
    >
      <template #filters>
        <FilterSelect v-model="statusFilter" label="Status" :options="statusOptions" />
      </template>
    </FilterBar>

    <DataTable
      :columns="columns"
      :rows="visible"
      row-key="id"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Could not load hazmat loads.') : null"
      :retrying="isFetching"
      :empty-text="emptyText"
      @retry="refetch"
    >
      <template #cell-status="{ row }"><LoadStatusBadge :status="row.status" /></template>
      <template #cell-products="{ row }">{{ lineLabel(row) }}</template>
      <template #cell-tank_state="{ row }">{{ tankState(row.tank_state) }}</template>
      <template #cell-planned_pickup_at="{ row }">{{ row.planned_pickup_at ? fmtDate(row.planned_pickup_at) : "—" }}</template>
      <template #cell-created_at="{ row }">{{ fmtDate(row.created_at) }}</template>
      <template #actions="{ row }">
        <BaseButton variant="ghost" size="sm" :to="`/hazmat/loads/${row.id}`">
          Open
          <AppIcon :icon="ChevronRightIcon" class="size-4" aria-hidden="true" />
        </BaseButton>
      </template>
    </DataTable>
  </div>
</template>
