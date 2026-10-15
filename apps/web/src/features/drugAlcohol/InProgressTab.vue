<script setup lang="ts">
import type { InProgressRow } from "@silvicom/shared";
import { AppCard as BaseCard, DataTable, type DataTableColumn } from "@silvicom/ui";
import PersonCell from "@/features/drugAlcohol/PersonCell.vue";
import { formatDate } from "@/lib/format";

/**
 * In progress (MEDSTOP-PLAN.md §7A.3): every order Med-Stop has not collected and every test whose
 * result is not final, any reason, longest-waiting first. No result is shown here — a test with a
 * final result has left this list. A random order is in the data only for the DER (§382.305(l)).
 */
defineProps<{ rows: InProgressRow[] }>();

const columns: DataTableColumn[] = [
  { key: "name", label: "Person", cellClass: "font-medium text-ink" },
  { key: "test", label: "Test" },
  { key: "stage", label: "Stage" },
  { key: "since", label: "Ordered / collected" },
  { key: "expectedOn", label: "Result expected by" },
  { key: "daysWaiting", label: "Waiting", numeric: true },
];
const kindText = (kind: string) => (kind === "drug" ? "Drug" : kind === "alcohol" ? "Alcohol" : "Medical");
</script>

<template>
  <BaseCard as="section" padding="none">
    <div class="px-6 pt-5 pb-3">
      <h2 class="text-sm font-semibold text-ink">Tests in progress</h2>
      <p class="mt-1 text-xs text-ink-muted">
        Ordered and not collected yet, or collected and waiting on the lab or the medical review officer. A drug result usually closes within four days of collection.
      </p>
    </div>
    <DataTable embedded dense :sticky-header="false" :columns="columns" :rows="rows.map((r) => ({ ...r, name: r.person.name }))" row-key="key" empty-text="No tests are in progress.">
      <template #cell-name="{ row }"><PersonCell :person="row.person" /></template>
      <template #cell-test="{ row }">{{ kindText(row.kind) }}{{ row.reason ? ` · ${row.reason.toLowerCase()}` : "" }}</template>
      <template #cell-since="{ row }">{{ row.collectedOn ? `Collected ${formatDate(row.collectedOn)}` : row.orderedOn ? `Ordered ${formatDate(row.orderedOn)}` : "—" }}</template>
      <template #cell-expectedOn="{ row }">{{ row.expectedOn ? formatDate(row.expectedOn) : "—" }}</template>
      <template #cell-daysWaiting="{ row }">{{ row.daysWaiting === 0 ? "today" : `${row.daysWaiting} d` }}</template>
    </DataTable>
  </BaseCard>
</template>
