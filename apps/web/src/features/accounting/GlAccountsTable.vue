<script setup lang="ts">
import type { SortState } from "@/lib/sort";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import type { CostGrain, GlMonthlyCostAccount } from "./useCostSchedules";

/**
 * McLeod's own expense accounts for one month — its descriptions, its classes (0272). No category
 * is inferred here: which of our five categories an account belongs to is a human judgement, and
 * guessing it from an account name is exactly the invented attribution D-MC12 rules out.
 *
 * EVERY account, not a top slice. The page showed `.slice(0, 12)` until 2026-08-28 and the owner
 * caught it: June posts 69 expense accounts totalling $3,634,060.11, so office payroll, salaries,
 * payroll tax and rent were all present in the data and cut off the screen.
 */
defineProps<{
  rows: GlMonthlyCostAccount[];
  page: number;
  total: number;
  /** Accounts in the month before filtering — separates "no match" from "nothing swept". */
  totalUnfiltered: number;
  pageSize: number;
  sort: SortState;
  loading: boolean;
  /** The query's failure, shown in the table rather than swallowed (D-FIN15). */
  error: string | null;
  swept: boolean;
  accountsStaged: boolean;
}>();
defineEmits<{ sort: [key: string]; "update:page": [n: number] }>();

/**
 * How finely McLeod itself can place each account's money. Deliberately a property of the SOURCE
 * and not a backlog: GJ and RJ journal lines carry no payee at all, so lease, insurance, officer
 * salaries and payroll tax are company-level in McLeod no matter what anyone collects.
 */
const GRAIN_LABELS: Record<CostGrain, string> = {
  per_truck: "To a truck",
  per_person: "To a person",
  per_vendor: "To a supplier",
  company: "Company only",
};
const GRAIN_HINTS: Record<CostGrain, string> = {
  per_truck: "McLeod records a truck on these lines, so this cost can be split per truck.",
  per_person: "McLeod records a person on these lines — payroll, per diem and the like.",
  per_vendor: "McLeod records a supplier on these lines, but no truck.",
  company: "McLeod records no truck, person or supplier on these lines, so nobody can split them.",
};

const fmtUsd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });

const columns: DataTableColumn[] = [
  { key: "descr", label: "Account", sortable: true },
  { key: "typeId", label: "Class", cellClass: "text-ink-tertiary", sortable: true },
  { key: "modules", label: "Entered through", cellClass: "font-mono text-xs text-ink-tertiary" },
  { key: "grain", label: "Can be split", sortable: true },
  { key: "amount", label: "This month", numeric: true, sortable: true },
];
</script>

<template>
  <DataTable
    :columns="columns"
    :rows="rows"
    embedded
    row-key="glid"
    :loading="loading"
    :error="error"
    :sort="sort"
    @sort="$emit('sort', $event)"
  >
    <template #empty>
      <div v-if="!swept" class="space-y-1">
        <p>The ledger has not been read for this month yet.</p>
        <p class="text-xs text-ink-tertiary">Run the McLeod financial sweep, then this table fills in.</p>
      </div>
      <div v-else-if="!accountsStaged" class="space-y-1">
        <p>The list of accounts has not been read, so the month's costs cannot be sorted into classes.</p>
        <p class="text-xs text-ink-tertiary">Run the McLeod financial sweep — it reads the account list whole.</p>
      </div>
      <div v-else class="space-y-1">
        <p>No account matches these filters.</p>
        <p class="text-xs text-ink-tertiary">{{ totalUnfiltered }} accounts posted this month. Clear the filters to see them.</p>
      </div>
    </template>
    <template #cell-descr="{ row }">{{ row.descr ?? row.glid }}</template>
    <template #cell-modules="{ value }">{{ (value as string[]).join(" · ") }}</template>
    <template #cell-grain="{ value }">
      <span
        :class="value === 'company' ? 'text-ink-tertiary' : 'text-ink-secondary'"
        :title="GRAIN_HINTS[value as CostGrain]"
        >{{ GRAIN_LABELS[value as CostGrain] }}</span
      >
    </template>
    <template #cell-amount="{ value }">{{ fmtUsd(value as number) }}</template>
    <template #footer>
      <TablePagination :page="page" :page-size="pageSize" :total="total" @update:page="$emit('update:page', $event)" />
    </template>
  </DataTable>
</template>
