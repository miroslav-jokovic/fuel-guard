<script setup lang="ts">
import { MEDSTOP_OUTCOME_LABELS, type MedstopResultRow } from "@silvicom/shared";
import { AppCard as BaseCard } from "@silvicom/ui";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import { BADGE_BASE, medstopOutcomeTone } from "@/lib/badges";
import { formatDate } from "@/lib/format";

/**
 * A list of Med-Stop results on Safety › Drug & Alcohol (MEDSTOP-PLAN.md §6 F-5, MS2c). Only ever
 * given rows by a page whose API answered `results` — i.e. a reader `canReadTestingRecords` admits.
 */
defineProps<{ title: string; why: string; rows: MedstopResultRow[]; emptyText: string }>();

const columns: DataTableColumn[] = [
  { key: "name", label: "Person", cellClass: "font-medium text-ink" },
  { key: "test", label: "Test" },
  { key: "collectedOn", label: "Collected" },
  { key: "outcome", label: "Result" },
];
const kindText = (kind: string) => (kind === "drug" ? "Drug" : kind === "alcohol" ? "Alcohol" : "Medical");
</script>

<template>
  <BaseCard as="section" padding="none">
    <div class="px-6 pt-5 pb-3">
      <h2 class="text-sm font-semibold text-ink">
        {{ title }} <span class="ml-1 font-normal text-ink-muted">{{ rows.length }}</span>
      </h2>
      <p class="mt-1 text-xs text-ink-muted">{{ why }}</p>
    </div>
    <DataTable
      embedded
      dense
      :sticky-header="false"
      :columns="columns"
      :rows="rows.map((r) => ({ ...r, name: r.person.name, driverId: r.person.driverId }))"
      row-key="testId"
      :empty-text="emptyText"
    >
      <template #cell-name="{ row }">
        <RouterLink v-if="row.driverId" :to="{ name: 'driver-detail', params: { id: row.driverId } }" class="text-brand-700 hover:underline">{{ row.name }}</RouterLink>
        <span v-else>{{ row.name }}</span>
      </template>
      <template #cell-test="{ row }">{{ kindText(row.kind) }}{{ row.reason ? ` · ${row.reason.toLowerCase()}` : "" }}</template>
      <template #cell-collectedOn="{ row }">{{ row.collectedOn ? formatDate(row.collectedOn) : "—" }}</template>
      <template #cell-outcome="{ row }">
        <span :class="[BADGE_BASE, medstopOutcomeTone(row.outcome)]">{{ MEDSTOP_OUTCOME_LABELS[row.outcome as MedstopResultRow["outcome"]] }}</span>
      </template>
    </DataTable>
  </BaseCard>
</template>
