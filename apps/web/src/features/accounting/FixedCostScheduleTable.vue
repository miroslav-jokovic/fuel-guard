<script setup lang="ts">
import type { TruckCostScheduleRow } from "@silvicom/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { FIXED_COST_CATEGORY_LABELS } from "./fixedCostLabels";

/**
 * The office's own schedule — the per-truck split of lease, insurance, GPS and permit dollars that
 * McLeod holds in total but cannot break down (T1, TRUCK-COST-ATTRIBUTION-PLAN).
 *
 * Corrections that change history are close-and-replace: end the old row at a month boundary, add
 * its successor. That is why "Stop charging" is offered and editing a past amount is not.
 */
defineProps<{
  rows: TruckCostScheduleRow[];
  page: number;
  total: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  retrying: boolean;
  closing: boolean;
  deleting: boolean;
  /** What the ledger booked in the compared month — the empty state is only honest with it. */
  ledgerTotal: string;
}>();
defineEmits<{
  close: [row: TruckCostScheduleRow];
  remove: [row: TruckCostScheduleRow];
  retry: [];
  "update:page": [n: number];
}>();

const fmtUsd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });

const columns: DataTableColumn[] = [
  { key: "unit_number", label: "Truck", cellClass: "font-mono text-xs" },
  { key: "category", label: "Type of cost" },
  { key: "label", label: "What the contract says" },
  { key: "monthly_amount", label: "Each month", numeric: true },
  { key: "effective_from", label: "Charging from" },
  { key: "effective_to", label: "Charging until" },
  { key: "actions", label: "" },
];
</script>

<template>
  <DataTable
    :columns="columns"
    :rows="rows"
    embedded
    row-key="id"
    :loading="loading"
    :error="error"
    :retrying="retrying"
    @retry="$emit('retry')"
  >
    <template #empty>
      <div class="space-y-1">
        <p>No fixed costs entered yet.</p>
        <p class="text-xs text-ink-tertiary">
          The ledger booked {{ ledgerTotal }} of costs that month, none of it split per truck. Until
          rows exist here, cost per mile shows fuel and driver pay only, and says so.
        </p>
      </div>
    </template>
    <template #cell-category="{ value }">
      {{ FIXED_COST_CATEGORY_LABELS[value as keyof typeof FIXED_COST_CATEGORY_LABELS] ?? value }}
    </template>
    <template #cell-monthly_amount="{ value }">{{ fmtUsd(value) }}</template>
    <template #cell-effective_to="{ value }">
      <span :class="value ? '' : 'text-ink-tertiary'">{{ value ?? "still charging" }}</span>
    </template>
    <template #cell-actions="{ row }">
      <div class="flex justify-end gap-2">
        <BaseButton
          v-if="!row.effective_to"
          size="sm"
          variant="ghost"
          :disabled="closing"
          title="Ends this cost at the start of next month and keeps every month it already charged. Use this when an amount changes."
          @click="$emit('close', row as TruckCostScheduleRow)"
          >Stop charging</BaseButton
        >
        <BaseButton
          size="sm"
          variant="ghost"
          :disabled="deleting"
          title="Removes the row completely, as if it never existed. Only for a row entered by mistake."
          @click="$emit('remove', row as TruckCostScheduleRow)"
          >Delete</BaseButton
        >
      </div>
    </template>
    <template #footer>
      <TablePagination :page="page" :page-size="pageSize" :total="total" @update:page="$emit('update:page', $event)" />
    </template>
  </DataTable>
</template>
