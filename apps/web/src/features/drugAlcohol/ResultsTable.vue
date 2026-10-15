<script setup lang="ts">
import { computed } from "vue";
import { MEDSTOP_OUTCOME_LABELS, type MedstopResultRow } from "@silvicom/shared";
import { AppCard as BaseCard, DataTable, type DataTableColumn, TablePagination } from "@silvicom/ui";
import { useClientPage } from "@/composables/useClientPage";
import { BADGE_BASE, medstopOutcomeTone } from "@/lib/badges";
import { formatDate } from "@/lib/format";

/**
 * A list of Med-Stop results on Safety › Drug & Alcohol (MEDSTOP-PLAN.md §6 F-5, MS2c). Only ever
 * given rows by a page whose API answered `results` — i.e. a reader `canReadTestingRecords` admits.
 */
const props = defineProps<{ title: string; why: string; rows: MedstopResultRow[]; emptyText: string }>();

const columns: DataTableColumn[] = [
  { key: "name", label: "Person", cellClass: "font-medium text-ink" },
  { key: "test", label: "Test" },
  { key: "collectedOn", label: "Collected" },
  { key: "outcome", label: "Result" },
];
// Paged (F26): a year of results is one response, and the first read's history has no bound at all.
// Keyed by source too: a test and an order are numbered by Med-Stop separately and may share an id.
const tableRows = computed(() => props.rows.map((r) => ({ ...r, key: `${r.source}:${r.medstopId}`, name: r.person.name, driverId: r.person.driverId })));
const { page, pageRows, total, paged, pageSize } = useClientPage(tableRows);
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
      :rows="pageRows"
      row-key="key"
      :empty-text="emptyText"
    >
      <template #cell-name="{ row }">
        <RouterLink v-if="row.driverId" :to="{ name: 'driver-detail', params: { id: row.driverId } }" class="text-brand-700 hover:underline">{{ row.name }}</RouterLink>
        <span v-else>{{ row.name }}</span>
      </template>
      <template #cell-test="{ row }">
        {{ kindText(row.kind) }}{{ row.reason ? ` · ${row.reason.toLowerCase()}` : "" }}
        <!-- §7A.16: no specimen, so no test — the day in "Collected" is the visit's. -->
        <span v-if="row.source === 'order'" class="block text-xs text-ink-muted">Refused before a specimen was collected</span>
      </template>
      <template #cell-collectedOn="{ row }">{{ row.collectedOn ? formatDate(row.collectedOn) : "—" }}</template>
      <template #cell-outcome="{ row }">
        <span :class="[BADGE_BASE, medstopOutcomeTone(row.outcome)]">{{ MEDSTOP_OUTCOME_LABELS[row.outcome as MedstopResultRow["outcome"]] }}</span>
      </template>
      <template v-if="paged" #footer>
        <TablePagination :page="page" :page-size="pageSize" :total="total" @update:page="page = $event" />
      </template>
    </DataTable>
  </BaseCard>
</template>
