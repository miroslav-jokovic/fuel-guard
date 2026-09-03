<script setup lang="ts">
import type { OwnerOperatorSummary } from "@silvicom/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";

/**
 * Contractors, kept apart from the company trucks because the arithmetic is a different question.
 *
 * A company truck's cost is our fuel and the driver's pay; a contractor's is a SHARE of the load —
 * measured at 88%, 90% and 95% across five payees in June 2026, three different deals — and our
 * earning is the remainder. Averaging the two describes neither, which is why this is its own tab
 * rather than a second table under the first one. The deal percentage is read back from what
 * actually settled, so a renegotiation shows up without anyone editing a table.
 */
defineProps<{
  /** The visible slice — paged by the page. */
  rows: OwnerOperatorSummary[];
  page: number;
  total: number;
  pageSize: number;
  loading: boolean;
  /** The query's failure, shown in the table rather than swallowed (D-FIN15). */
  error: string | null;
}>();
defineEmits<{ "update:page": [n: number] }>();

const fmtUsd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });
const unitLabel = (units: string[]) =>
  units.length === 0 ? "—" : units.length <= 3 ? units.join(", ") : `${units.length} trucks`;

const columns: DataTableColumn[] = [
  // McLeod's own payee code. It is what the settlement and the cheque say, so it is the name to
  // quote back at the office — a friendlier one would not match anything they can look up.
  { key: "payeeId", label: "Contractor", cellClass: "font-mono text-xs" },
  { key: "units", label: "Trucks", cellClass: "text-ink-tertiary" },
  { key: "settlements", label: "Payments", numeric: true, cellClass: "text-ink-tertiary" },
  { key: "revenue", label: "Hauled", numeric: true },
  { key: "dealPct", label: "Their share", numeric: true },
  { key: "pay", label: "Paid to them", numeric: true },
  { key: "grossMargin", label: "Kept on loads", numeric: true },
  { key: "deductionIncome", label: "Rental + fees", numeric: true },
  { key: "netMargin", label: "We keep", numeric: true },
];
</script>

<template>
  <DataTable :columns="columns" :rows="rows" embedded row-key="payeeId" :loading="loading" :error="error">
    <template #empty>
      <p>No contractor settlements in this period.</p>
    </template>
    <!-- One contractor ran nine tractors in the July window. Spelling all nine into a cell turns
         the row into a paragraph, so past three it counts them and keeps the list in the hover. -->
    <template #cell-units="{ value }">
      <span :title="(value as string[]).join(', ')">{{ unitLabel(value as string[]) }}</span>
    </template>
    <template #cell-dealPct="{ value }">
      <span
        :class="value === null ? 'text-ink-tertiary' : ''"
        title="Read back from what actually settled — pay divided by the revenue on that contractor's own loads. It is not configured anywhere."
        >{{ value === null ? "—" : `${value}%` }}</span
      >
    </template>
    <template #cell-revenue="{ value }">{{ fmtUsd(value) }}</template>
    <template #cell-pay="{ value }">{{ fmtUsd(value) }}</template>
    <template #cell-grossMargin="{ value }">{{ fmtUsd(value) }}</template>
    <!-- Only deductions that posted to a REVENUE account: equipment rental, insurance collection,
         installment sale. A Fuel Advance repayment is a receivable settling and an expense-account
         credit already reduced that expense in the ledger — neither is income. -->
    <template #cell-deductionIncome="{ value }">
      <span
        :class="value ? '' : 'text-ink-tertiary'"
        title="Equipment rental, insurance collection and installment sale — deductions that post to a revenue account. Fuel advanced on the card is a loan they repay, not income, and is not here."
        >{{ fmtUsd(value) }}</span
      >
    </template>
    <template #cell-netMargin="{ value }">
      <span class="font-semibold" :class="value >= 0 ? 'text-success-700' : 'text-danger-700'">{{ fmtUsd(value) }}</span>
    </template>
    <template #footer>
      <TablePagination :page="page" :page-size="pageSize" :total="total" @update:page="$emit('update:page', $event)" />
    </template>
  </DataTable>
</template>
