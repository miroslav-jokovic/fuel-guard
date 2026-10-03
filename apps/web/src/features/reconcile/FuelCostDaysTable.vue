<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppCard as BaseCard, AppButton as BaseButton } from "@silvicom/ui";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import { downloadCsv } from "@/lib/csv";
import { costDayCells, costDayHeaders, costDaysCsv, type CostDayRow } from "@silvicom/shared";

/**
 * The report's one table (R1): every day of the range, newest first, with that day's trailing-7-day
 * MPG (D-FSV5). One table per page; it pages at 20, and a new range starts again at page one.
 */
const props = defineProps<{
  rows: CostDayRow[];
  /** False under a state, location or network filter: the MPG column has nothing honest to show. */
  withMpg: boolean;
  loading?: boolean;
  /** `fuel-costs-<from>-to-<to>` — the CSV is named after the range it holds. */
  filename: string;
}>();

const PAGE_SIZE = 20;
const page = ref(1);
watch(() => props.rows, () => { page.value = 1; });

// Labels and cell strings come from shared, the same functions the PDF export reads (Q-FSV14).
const KEYS = ["day", "fills", "gallons", "spend", "price", "out", "quote", "reefer", "mpg"] as const;
const columns = computed<DataTableColumn[]>(() =>
  costDayHeaders(props.withMpg).map((label, i) => ({
    key: KEYS[i]!,
    label,
    ...(i === 0 ? { cellClass: "text-ink-secondary" } : { numeric: true }),
    width: i === 1 ? "xs" : "sm",
    ...(KEYS[i] === "reefer" ? { cellClass: "text-ink-tertiary" } : {}),
  })) as DataTableColumn[],
);

const shown = computed(() =>
  props.rows.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE).map((r) => {
    const c = costDayCells(r);
    return {
      id: r.id,
      day: c[0]!, fills: c[1]!, gallons: c[2]!, spend: c[3]!, price: c[4]!, out: c[5]!, quote: c[6]!, reefer: c[7]!, mpg: c[8]!,
      mpgReason: r.mpgReason,
    };
  }),
);

function exportCsv(): void {
  const csv = costDaysCsv(props.rows, props.withMpg);
  downloadCsv(props.filename, csv.headers, csv.rows);
}
</script>

<template>
  <div>
    <div class="mb-2 flex items-center justify-between gap-3">
      <h3 class="text-base font-semibold text-ink">By day</h3>
      <BaseButton variant="ghost" :disabled="rows.length === 0" @click="exportCsv">Export CSV</BaseButton>
    </div>
    <BaseCard padding="none">
      <DataTable :columns="columns" :rows="shown" row-key="id" :loading="loading" empty-text="No days in this range.">
        <!-- A withheld MPG says why on hover rather than leaving a bare dash to be guessed at. -->
        <template #cell-mpg="{ row }">
          <span v-if="row.mpg" class="tabular-nums">{{ row.mpg }}</span>
          <span v-else class="text-ink-tertiary" :title="row.mpgReason ?? undefined">—</span>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" @update:page="page = $event" />
        </template>
      </DataTable>
    </BaseCard>
  </div>
</template>
