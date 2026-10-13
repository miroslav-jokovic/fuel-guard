<script setup lang="ts">
import type { ProgramPerson } from "@silvicom/shared";
import { AppCard as BaseCard } from "@silvicom/ui";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";

/**
 * One reconciliation list on Safety › Drug & Alcohol: a heading that says what the list MEANS and
 * what to do about it, then the people, each linked to the driver page when we hold the driver.
 */
defineProps<{
  title: string;
  why: string;
  people: ProgramPerson[];
  emptyText: string;
  /** Extra column, e.g. the two medical dates. */
  detail?: (p: ProgramPerson) => string;
  detailLabel?: string;
}>();

const columns = (withDetail: boolean): DataTableColumn[] => [
  { key: "name", label: "Driver", cellClass: "font-medium text-ink" },
  ...(withDetail ? [{ key: "detail", label: "" } as DataTableColumn] : []),
];
</script>

<template>
  <BaseCard as="section" padding="none">
    <div class="px-6 pt-5 pb-3">
      <h2 class="text-sm font-semibold text-ink">
        {{ title }} <span class="ml-1 font-normal text-ink-muted">{{ people.length }}</span>
      </h2>
      <p class="mt-1 text-xs text-ink-muted">{{ why }}</p>
    </div>
    <DataTable
      embedded
      dense
      :sticky-header="false"
      :columns="columns(Boolean(detail)).map((c) => (c.key === 'detail' ? { ...c, label: detailLabel ?? '' } : c))"
      :rows="people.map((p) => ({ ...p, key: p.driverId ?? p.medstopId ?? p.name }))"
      row-key="key"
      :empty-text="emptyText"
    >
      <template #cell-name="{ row }">
        <RouterLink v-if="row.driverId" :to="{ name: 'driver-detail', params: { id: row.driverId } }" class="text-brand-700 hover:underline">
          {{ row.name }}
        </RouterLink>
        <span v-else>{{ row.name }}</span>
      </template>
      <template #cell-detail="{ row }">{{ detail ? detail(row as ProgramPerson) : "" }}</template>
    </DataTable>
  </BaseCard>
</template>
