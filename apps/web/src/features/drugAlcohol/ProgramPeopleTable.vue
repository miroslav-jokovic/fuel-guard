<script setup lang="ts">
import { computed } from "vue";
import type { ProgramPerson } from "@silvicom/shared";
import { AppCard as BaseCard, DataTable, type DataTableColumn, TablePagination } from "@silvicom/ui";
import { useClientPage } from "@/composables/useClientPage";

/**
 * One reconciliation list on Safety › Drug & Alcohol: a heading that says what the list MEANS and
 * what to do about it, then the people, each linked to the driver page when we hold the driver.
 */
const props = defineProps<{
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

// Paged (F26): the pool reconciliation drew 178 drivers in one card on staging.
const rows = computed(() => props.people.map((p) => ({ ...p, key: p.driverId ?? p.medstopId ?? p.name })));
const { page, pageRows, total, paged, pageSize } = useClientPage(rows);
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
      :rows="pageRows"
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
      <template v-if="paged" #footer>
        <TablePagination :page="page" :page-size="pageSize" :total="total" @update:page="page = $event" />
      </template>
    </DataTable>
  </BaseCard>
</template>
