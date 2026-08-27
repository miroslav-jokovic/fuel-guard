<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard, AppButton as BaseButton } from "@silvicom/ui";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import { useToastStore } from "@/stores/toast";
import { downloadCsv } from "@/lib/csv";
import { statementSourceUrl, type StatementSummary } from "./useStatements";
import { usd, usd3, gal } from "./format";

/**
 * The weeks we hold. This is the answer to "where do I see it after refresh" — the upload card renders
 * the file you just dropped, and this renders everything kept, so a reload lands on history rather
 * than an empty dropzone.
 *
 * The original PDF is reachable per row: every figure on the surface traces back to the document it
 * came from, which is the point of storing it. It opens through a short-lived signed URL because the
 * bucket has no client policies — the API is the only door.
 */
const props = defineProps<{ statements: StatementSummary[]; loading?: boolean; error?: string | null }>();
const toast = useToastStore();

const rows = computed(() =>
  props.statements.map((s) => ({
    id: s.id,
    period: `${s.periodStart} → ${s.periodEnd}`,
    invoice: s.invoiceNo,
    lines: s.lineCount.toLocaleString(),
    gallons: gal(s.totalGallons),
    paid: usd(s.invoiceTotal),
    perGal: usd3(s.totalGallons > 0 ? s.fuelAmount / s.totalGallons : null),
    saved: usd(s.savings),
    hasSource: s.hasSource,
  })),
);
const cols: DataTableColumn[] = [
  { key: "period", label: "Week", width: "md" },
  { key: "invoice", label: "Invoice", width: "sm", cellClass: "font-mono text-ink-secondary" },
  { key: "lines", label: "Lines", numeric: true, width: "xs" },
  { key: "gallons", label: "Gallons", numeric: true, width: "sm" },
  { key: "paid", label: "Billed", numeric: true, width: "sm" },
  { key: "perGal", label: "Fuel / gal", numeric: true, width: "sm" },
  { key: "saved", label: "Saved vs posted", numeric: true, width: "md" },
  { key: "source", label: "Original", width: "sm" },
];

async function openSource(id: string) {
  try {
    window.open(await statementSourceUrl(id), "_blank", "noopener");
  } catch (e) {
    toast.error("Couldn't open the statement", e instanceof Error ? e.message : undefined);
  }
}

function exportSummary() {
  downloadCsv(
    "fuel-statements",
    ["Period start", "Period end", "Invoice", "Lines", "Gallons", "Fuel $", "Misc + tax $", "Billed $", "Posted $", "Saved $"],
    props.statements.map((s) => [
      s.periodStart, s.periodEnd, s.invoiceNo, s.lineCount, s.totalGallons.toFixed(1),
      s.fuelAmount.toFixed(2), (s.invoiceTotal - s.fuelAmount).toFixed(2),
      s.invoiceTotal.toFixed(2), s.retailTotal.toFixed(2), s.savings.toFixed(2),
    ]),
  );
}
</script>

<template>
  <div>
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h3 class="text-sm font-semibold text-ink">Statements on file</h3>
      <BaseButton v-if="statements.length" variant="ghost" @click="exportSummary">Download summary (CSV)</BaseButton>
    </div>
    <BaseCard padding="none">
      <DataTable
        :columns="cols"
        :rows="rows"
        :loading="loading"
        :error="error ?? null"
        empty-text="No statements kept yet. Upload a weekly Pilot statement above and it stays here."
      >
        <template #cell-source="{ row }">
          <BaseButton v-if="row.hasSource" variant="ghost" class="px-0" @click="openSource(String(row.id))">
            Open PDF
          </BaseButton>
          <span v-else class="text-ink-tertiary">—</span>
        </template>
      </DataTable>
    </BaseCard>
  </div>
</template>
