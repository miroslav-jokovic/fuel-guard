<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { FINANCIAL_CATEGORIES, FINANCIAL_CATEGORY_LABELS, type FinancialCategory } from "@silvicom/shared";
import { useLedgerQuery, useLedgerSummaryQuery, LEDGER_PAGE_SIZE, type LedgerFilter } from "@/features/accounting/useLedger";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useDriversQuery } from "@/composables/useDrivers";
import { trailingDays } from "@/lib/dateWindow";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import TablePagination from "@/components/TablePagination.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import StatCard from "@/components/ui/StatCard.vue";
import ExplainerPanel from "@/components/ui/ExplainerPanel.vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";

// Default window: the trailing 90 days — long enough for a quarter's shape, short enough to load
// fast. Both ends are INCLUSIVE here, which is what the picker shows; `useLedger` converts the end
// to the API's exclusive bound. The old default reached a day into tomorrow to compensate for that
// conversion being missing, which made the default right and every hand-picked range wrong.
const defaultWindow = trailingDays(90);
const search = ref("");
const category = ref("");
const direction = ref("");
const vehicleId = ref("");
const driverId = ref("");
const from = ref<string>(defaultWindow.from);
const to = ref<string>(defaultWindow.to);
const showAll = ref(false);
const page = ref(1);
watch([search, category, direction, vehicleId, driverId, from, to, showAll], () => (page.value = 1));

const filter = computed<LedgerFilter>(() => ({
  q: search.value,
  category: category.value,
  direction: direction.value,
  vehicleId: vehicleId.value,
  driverId: driverId.value,
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
// "Earning" and "expense" are what the API stores; "money in" and "money out" is what the page
// says, here and in the column, so the filter and the rows use one vocabulary (owner ruling
// 2026-08-29: plain words on the surface, the accounting term kept as the hover explanation).
const directionOptions = [
  { value: "", label: "Money in and out" },
  { value: "earning", label: "Money in only" },
  { value: "expense", label: "Money out only" },
];

// Truck and driver: the API has accepted `vehicleId`/`driverId` since the router was written, but
// nothing on the page ever sent them, so the ledger could only be read as one undifferentiated
// list. These are the two dimensions an accountant actually asks it about — "what did 754 cost me",
// "what did this driver draw" — so they belong on the toolbar, not in a hand-built URL.
const { data: vehicles } = useVehiclesQuery();
const { data: drivers } = useDriversQuery();
const vehicleOptions = computed(() => [
  { value: "", label: "All trucks" },
  ...(vehicles.value ?? []).map((v) => ({ value: v.id, label: v.unit_number })),
]);
const driverOptions = computed(() => [
  { value: "", label: "All drivers" },
  ...(drivers.value ?? []).map((d) => ({ value: d.id, label: d.full_name })),
]);

const activeFilterCount = computed(
  () =>
    [category.value, direction.value, vehicleId.value, driverId.value].filter(Boolean).length +
    (search.value.trim() ? 1 : 0) +
    (showAll.value ? 1 : 0),
);
function resetFilters() {
  search.value = "";
  category.value = "";
  direction.value = "";
  vehicleId.value = "";
  driverId.value = "";
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
  { key: "category", label: "What for" },
  { key: "direction", label: "In or out" },
  { key: "amount", label: "Amount", numeric: true },
  { key: "external_id", label: "Reference", cellClass: "font-mono text-xs text-ink-secondary" },
  { key: "source", label: "Came from", cellClass: "text-ink-tertiary" },
  { key: "flags", label: "", align: "center" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Every payment received and every cost charged, counted once." />

    <!--
      The method, one click away rather than in the header. What this page must not lose is WHY a
      number can be trusted: which rows count, which are kept for the audit trail only, and where
      the money came from.
    -->
    <ExplainerPanel summary="What is on this page">
      <p>
        One line for every movement of money, from every system that reports one — fuel cards, driver
        settlements, McLeod invoices and the general ledger. The three figures at the top cover the
        whole date range you picked, not just the page you are looking at.
      </p>
      <p>
        Some lines are kept for the audit trail but left out of the totals, and they say so in the
        last column: <span class="font-medium text-ink">Cancelled</span> is money that never actually
        moved, and <span class="font-medium text-ink">Counted elsewhere</span> is a second view of
        money already counted on another line — a fuel purchase that also appears on the card
        statement, for example. Turn on “Show cancelled and duplicates” to see them in the table.
      </p>
    </ExplainerPanel>

    <!-- The window's shape at a glance: in, out, difference — from the canonical predicate only. -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard label="Money in" :value="fmtUsd(totals.earned)" sub="paid to us in this period" />
      <StatCard label="Money out" :value="fmtUsd(totals.spent)" sub="charged to us in this period" />
      <StatCard
        label="Difference"
        :value="fmtUsd(totals.net)"
        :sub="totals.net >= 0 ? 'we kept this much' : 'we spent more than we earned'"
        :sub-tone="totals.net >= 0 ? 'text-success-700' : 'text-danger-700'"
      />
    </div>

    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search by reference or account number…"
        :count="total"
        count-label="lines"
      >
        <template #filters>
          <FilterSelect v-model="category" label="What for" :options="categoryOptions" />
          <FilterSelect v-model="direction" label="In or out" :options="directionOptions" />
          <FilterSelect v-model="vehicleId" label="Truck" :options="vehicleOptions" />
          <FilterSelect v-model="driverId" label="Driver" :options="driverOptions" />
          <DateRangeFilter :from="from" :to="to" @update:from="(v) => (from = v ?? from)" @update:to="(v) => (to = v ?? to)" />
        </template>
        <template #actions>
          <!-- Drill-down: include the non-canonical twins and voids behind a number. Never a report view. -->
          <BaseButton
            :variant="showAll ? 'secondary' : 'ghost'"
            size="sm"
            title="Cancelled lines and duplicates are hidden by default because they are not part of any total. Turning this on shows them so you can check a figure."
            @click="showAll = !showAll"
          >
            {{ showAll ? "Showing cancelled and duplicates" : "Show cancelled and duplicates" }}
          </BaseButton>
          <BaseButton v-if="activeFilterCount" variant="ghost" size="sm" @click="resetFilters">Clear filters</BaseButton>
        </template>
      </FilterBar>

      <DataTable
        :columns="columns"
        :rows="entries"
        embedded
        row-key="id"
        :loading="isLoading"
        :error="isError ? (error instanceof Error ? error.message : 'Failed to load') : null"
        :retrying="isFetching"
        @retry="refetch"
      >
        <template #empty>
          <p>Nothing in this date range yet. Try a wider range — the lines arrive as the McLeod sweeps and the nightly run finish.</p>
        </template>
        <template #cell-occurred_at="{ value }">{{ fmtDate(value) }}</template>
        <template #cell-category="{ value }">
          <span :class="[BADGE_BASE, toneClass('neutral')]">{{ categoryLabel(value) }}</span>
        </template>
        <template #cell-direction="{ value }">
          <span
            class="text-xs font-semibold"
            :class="value === 'earning' ? 'text-success-700' : 'text-ink-secondary'"
            :title="value === 'earning' ? 'Earning — money paid to the carrier.' : 'Expense — money the carrier paid out.'"
          >
            {{ value === "earning" ? "In" : "Out" }}
          </span>
        </template>
        <template #cell-amount="{ row }">
          <span class="font-semibold" :class="row.direction === 'earning' ? 'text-success-700' : 'text-ink'">{{ fmtUsd(row.amount) }}</span>
        </template>
        <template #cell-flags="{ row }">
          <span v-if="row.is_void" :class="[BADGE_BASE, toneClass('danger')]" title="Void — money that never moved. Kept for the audit trail, left out of every total.">Cancelled</span>
          <span v-else-if="!row.is_canonical" :class="[BADGE_BASE, toneClass('warning')]" title="Twin — a second view of money already counted on another line. Kept so you can check it, left out of the totals.">Counted elsewhere</span>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="LEDGER_PAGE_SIZE" :total="total" :loading="isFetching" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>
  </div>
</template>
