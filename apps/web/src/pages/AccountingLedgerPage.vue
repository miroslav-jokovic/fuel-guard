<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { FINANCIAL_CATEGORIES, FINANCIAL_CATEGORY_LABELS, type FinancialCategory } from "@silvicom/shared";
import { useLedgerQuery, useLedgerSummaryQuery, LEDGER_PAGE_SIZE, type LedgerFilter } from "@/features/accounting/useLedger";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import TablePagination from "@/components/TablePagination.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import { AppCard as BaseCard, AppButton as BaseButton } from "@silvicom/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";

// Default window: the trailing 90 days — long enough for a quarter's shape, short enough to load fast.
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const search = ref("");
const category = ref("");
const direction = ref("");
const from = ref<string>(ymd(new Date(Date.now() - 90 * 86_400_000)));
const to = ref<string>(ymd(new Date(Date.now() + 86_400_000)));
const showAll = ref(false);
const page = ref(1);
watch([search, category, direction, from, to, showAll], () => (page.value = 1));

const filter = computed<LedgerFilter>(() => ({
  q: search.value,
  category: category.value,
  direction: direction.value,
  from: from.value,
  to: to.value,
  all: showAll.value,
  page: page.value,
}));
const { data, isLoading, isError, error, refetch, isFetching } = useLedgerQuery(filter);
const { data: summary } = useLedgerSummaryQuery(from, to);

const entries = computed(() => data.value?.entries ?? []);
const total = computed(() => data.value?.total ?? 0);

const categoryOptions = computed(() => [
  { value: "", label: "All categories" },
  ...FINANCIAL_CATEGORIES.map((c) => ({ value: c, label: FINANCIAL_CATEGORY_LABELS[c] })),
]);
const directionOptions = [
  { value: "", label: "Earnings + expenses" },
  { value: "earning", label: "Earnings" },
  { value: "expense", label: "Expenses" },
];
const activeFilterCount = computed(
  () => [category.value, direction.value].filter(Boolean).length + (search.value.trim() ? 1 : 0) + (showAll.value ? 1 : 0),
);
function resetFilters() {
  search.value = "";
  category.value = "";
  direction.value = "";
  showAll.value = false;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtUsd = (n: number | string) =>
  Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });
const categoryLabel = (c: string) => FINANCIAL_CATEGORY_LABELS[c as FinancialCategory] ?? c;

const totals = computed(() => {
  const s = summary.value ?? [];
  const earned = s.filter((x) => x.direction === "earning").reduce((a, x) => a + x.amount, 0);
  const spent = s.filter((x) => x.direction === "expense").reduce((a, x) => a + x.amount, 0);
  return { earned, spent, net: earned - spent };
});

const columns: DataTableColumn[] = [
  { key: "occurred_at", label: "Date", cellClass: "text-ink-secondary" },
  { key: "category", label: "Category" },
  { key: "direction", label: "Direction" },
  { key: "amount", label: "Amount", numeric: true },
  { key: "external_id", label: "Reference", cellClass: "font-mono text-xs text-ink-secondary" },
  { key: "source", label: "Source", cellClass: "text-ink-tertiary" },
  { key: "flags", label: "", align: "center" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Every earning and expense, from every source, counted once — search a payment by its own reference, or slice the window by category." />

    <!-- The window's shape at a glance: earned, spent, net — from the canonical predicate only. -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <BaseCard padding="sm">
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Earned</p>
        <p class="text-2xl font-bold text-ink">{{ fmtUsd(totals.earned) }}</p>
      </BaseCard>
      <BaseCard padding="sm">
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Spent</p>
        <p class="text-2xl font-bold text-ink">{{ fmtUsd(totals.spent) }}</p>
      </BaseCard>
      <BaseCard padding="sm">
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Net</p>
        <p class="text-2xl font-bold" :class="totals.net >= 0 ? 'text-success-700' : 'text-danger-700'">{{ fmtUsd(totals.net) }}</p>
      </BaseCard>
    </div>

    <FilterBar v-model:search="search" search-placeholder="Search by reference or GL account…" :count="total" count-label="entries">
      <template #filters>
        <FilterSelect v-model="category" label="Category" :options="categoryOptions" />
        <FilterSelect v-model="direction" label="Direction" :options="directionOptions" />
        <DateRangeFilter :from="from" :to="to" @update:from="(v) => (from = v ?? from)" @update:to="(v) => (to = v ?? to)" />
      </template>
      <template #actions>
        <!-- Drill-down: include the non-canonical twins and voids behind a number. Never a report view. -->
        <BaseButton :variant="showAll ? 'secondary' : 'ghost'" size="sm" @click="showAll = !showAll">
          {{ showAll ? "Hiding nothing" : "Canonical only" }}
        </BaseButton>
        <BaseButton v-if="activeFilterCount" variant="ghost" size="sm" @click="resetFilters">Clear filters</BaseButton>
      </template>
    </FilterBar>

    <DataTable
      :columns="columns"
      :rows="entries"
      row-key="id"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load') : null"
      :retrying="isFetching"
      @retry="refetch"
    >
      <template #empty>
        <p>No entries in this window yet. The ledger fills as the McLeod financial sweeps and the nightly projection run — check the window, or widen it.</p>
      </template>
      <template #cell-occurred_at="{ value }">{{ fmtDate(value) }}</template>
      <template #cell-category="{ value }">
        <span :class="[BADGE_BASE, toneClass('neutral')]">{{ categoryLabel(value) }}</span>
      </template>
      <template #cell-direction="{ value }">
        <span class="text-xs font-semibold" :class="value === 'earning' ? 'text-success-700' : 'text-ink-secondary'">
          {{ value === "earning" ? "Earning" : "Expense" }}
        </span>
      </template>
      <template #cell-amount="{ row }">
        <span class="font-semibold" :class="row.direction === 'earning' ? 'text-success-700' : 'text-ink'">{{ fmtUsd(row.amount) }}</span>
      </template>
      <template #cell-flags="{ row }">
        <span v-if="row.is_void" :class="[BADGE_BASE, toneClass('danger')]" title="Money that never moved — kept for audit, excluded from every report.">Void</span>
        <span v-else-if="!row.is_canonical" :class="[BADGE_BASE, toneClass('warning')]" title="A second view of money counted elsewhere — kept for drill-down, excluded from sums.">Twin</span>
      </template>
      <template #footer>
        <TablePagination :page="page" :page-size="LEDGER_PAGE_SIZE" :total="total" @update:page="page = $event" />
      </template>
    </DataTable>
  </div>
</template>
