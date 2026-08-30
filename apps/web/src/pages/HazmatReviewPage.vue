<script setup lang="ts">
import { computed, ref } from "vue";
import { AppIcon } from "@silvicom/ui";
import { ChevronRightIcon } from "@silvicom/ui/icons";
import type { HazmatLoadRow } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { useReviewQueueQuery } from "@/features/hazmat/useHazmatReview";
import { emptyQueueFilter, filterReviewQueue } from "@/features/hazmat/reviewModel";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useDriversQuery } from "@/composables/useDrivers";

const { data: loads, isLoading, isError, error, isFetching, refetch } = useReviewQueueQuery();
const { data: vehicles } = useVehiclesQuery();
const { data: drivers } = useDriversQuery();
const filter = ref(emptyQueueFilter());
const search = computed({ get: () => filter.value.search, set: (value: string) => (filter.value.search = value) });

const vehicleOptions = computed(() => [
  { value: "", label: "All trucks" },
  ...(vehicles.value ?? []).map((vehicle) => ({ value: vehicle.id, label: vehicle.unit_number })),
]);
const driverOptions = computed(() => [
  { value: "", label: "All drivers" },
  ...(drivers.value ?? []).map((driver) => ({ value: driver.id, label: driver.full_name })),
]);
const visible = computed(() => filterReviewQueue(loads.value ?? [], filter.value));
const emptyText = computed(() =>
  (loads.value ?? []).length === 0 ? "Nothing is waiting for review." : "No review items match these filters.",
);

const lineCount = (load: HazmatLoadRow): number => Array.isArray(load.declared_lines) ? load.declared_lines.length : 0;
const lineLabel = (load: HazmatLoadRow): string => `${lineCount(load)} product${lineCount(load) === 1 ? "" : "s"}`;
const fmtDate = (iso: string): string => new Date(iso).toLocaleString();
const waitingHours = (iso: string): number => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000));
const waitingLabel = (iso: string): string => {
  const hours = waitingHours(iso);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
};
const vehicleLabel = (id: string | null): string =>
  (vehicles.value ?? []).find((vehicle) => vehicle.id === id)?.unit_number ?? "—";
const driverLabel = (id: string | null): string =>
  (drivers.value ?? []).find((driver) => driver.id === id)?.full_name ?? "—";

const columns: DataTableColumn[] = [
  // H-U3: the load reference leads. A reviewer is being asked to clear a specific truckload, and
  // every row used to open with "2 products" — the queue named the freight by a count and never by
  // the number the rest of the business uses for it.
  { key: "load_ref", label: "Load #", width: "md", cellClass: "font-medium text-ink" },
  { key: "products", label: "Products", width: "md" },
  { key: "vehicle_id", label: "Truck", width: "md", cellClass: "text-ink-secondary" },
  { key: "driver_id", label: "Driver", width: "lg", cellClass: "text-ink-secondary" },
  { key: "waiting", label: "Waiting", numeric: true, width: "sm", cellClass: "font-medium text-ink-secondary" },
  { key: "created_at", label: "Created", width: "lg", cellClass: "text-ink-secondary" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Review flagged loads oldest-first, inspect the evidence, and record an attestation or rejection." />

    <FilterBar
      v-model:search="search"
      search-placeholder="Search load number or product…"
      :count="visible.length"
      count-label="loads"
    >
      <template #filters>
        <FilterSelect v-model="filter.vehicleId" label="Truck" :options="vehicleOptions" />
        <FilterSelect v-model="filter.driverId" label="Driver" :options="driverOptions" />
      </template>
    </FilterBar>

    <DataTable
      :columns="columns"
      :rows="visible"
      row-key="id"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Could not load the review queue.') : null"
      :retrying="isFetching"
      :empty-text="emptyText"
      @retry="refetch"
    >
      <template #cell-load_ref="{ row }">
        <span v-if="row.load_ref">{{ row.load_ref }}</span>
        <span v-else class="text-ink-tertiary" title="This record was never linked to a dispatch load">Unlinked</span>
      </template>
      <template #cell-products="{ row }">{{ lineLabel(row) }}</template>
      <template #cell-vehicle_id="{ row }">{{ vehicleLabel(row.vehicle_id) }}</template>
      <template #cell-driver_id="{ row }">{{ driverLabel(row.driver_id) }}</template>
      <template #cell-waiting="{ row }">{{ waitingLabel(row.created_at) }}</template>
      <template #cell-created_at="{ row }">{{ fmtDate(row.created_at) }}</template>
      <template #actions="{ row }">
        <BaseButton variant="secondary" size="sm" :to="`/hazmat/loads/${row.id}`">
          Review
          <AppIcon :icon="ChevronRightIcon" class="size-4" aria-hidden="true" />
        </BaseButton>
      </template>
    </DataTable>
  </div>
</template>
