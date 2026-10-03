<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppCard as BaseCard, AppButton as BaseButton } from "@silvicom/ui";
import { formatDisplayDate } from "@silvicom/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import { downloadCsv } from "@/lib/csv";
import { costDaysCsv, type CostDayRow } from "@silvicom/shared";
import { gal, usd, usd3, wholeUsd } from "./format";

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

const columns = computed<DataTableColumn[]>(() => [
  { key: "day", label: "Day", width: "sm", cellClass: "text-ink-secondary" },
  { key: "fills", label: "Fills", numeric: true, width: "xs" },
  { key: "gallons", label: "Gallons", numeric: true, width: "sm" },
  { key: "spend", label: "Fuel spend", numeric: true, width: "sm" },
  { key: "price", label: "Avg price / gal", numeric: true, width: "sm" },
  { key: "out", label: "Out of network", numeric: true, width: "sm" },
  { key: "quote", label: "Paid vs Pilot quote", numeric: true, width: "sm" },
  { key: "reefer", label: "Reefer", numeric: true, width: "sm", cellClass: "text-ink-tertiary" },
  ...(props.withMpg ? [{ key: "mpg", label: "MPG — previous 7 days", numeric: true, width: "sm" } as DataTableColumn] : []),
]);

const shown = computed(() =>
  props.rows.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE).map((r) => ({
    id: r.id,
    day: formatDisplayDate(r.day),
    fills: r.fills.toLocaleString("en-US"),
    gallons: gal(r.gallons),
    spend: usd(r.spend),
    price: usd3(r.pricePerGal),
    out: r.outOfNetwork > 0 ? usd(r.outOfNetwork) : "",
    quote: r.paidVsQuote == null ? "" : wholeUsd(r.paidVsQuote),
    reefer: r.reefer > 0 ? usd(r.reefer) : "",
    mpg: r.mpg == null ? "" : r.mpg.toFixed(2),
    mpgReason: r.mpgReason,
  })),
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
