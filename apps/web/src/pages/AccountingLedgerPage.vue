<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { FINANCIAL_CATEGORIES, FINANCIAL_CATEGORY_LABELS, type FinancialCategory } from "@silvicom/shared";
import { useLedgerQuery, useLedgerSummaryQuery, LEDGER_PAGE_SIZE, type LedgerFilter } from "@/features/accounting/useLedger";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useDriversQuery } from "@/composables/useDrivers";
import { trailingDays } from "@/lib/dateWindow";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import FilterBar, { type FilterChip } from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import TablePagination from "@/components/TablePagination.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import StatCard from "@/components/ui/StatCard.vue";
import ExplainerPanel from "@/components/ui/ExplainerPanel.vue";
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
/**
 * Which lines the table shows.
 *
 * Cancelled lines and duplicates are OUT of every total and out of the table by default, and this
 * exists so somebody checking a figure against McLeod can see the rows that were left out. It used
 * to be a button on the toolbar reading "Canonical only" / "Hiding nothing", which said neither
 * what it did nor why it was there (owner, 2026-08-29). It is now a named option in the Filters
 * popover with the plain words in it, and it announces itself as a chip when it is on.
 */
const lines = ref("");
const linesOptions = [
  { value: "", label: "Only lines that count" },
  { value: "all", label: "Also cancelled and duplicates" },
];
const page = ref(1);
watch([search, category, direction, vehicleId, driverId, from, to, lines], () => (page.value = 1));

const filter = computed<LedgerFilter>(() => ({
  q: search.value,
  category: category.value,
  direction: direction.value,
  vehicleId: vehicleId.value,
  driverId: driverId.value,
  from: from.value,
  to: to.value,
  all: lines.value === "all",
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

/**
 * Truck, driver and the cancelled-lines option live in the Filters popover, so the toolbar is one
 * row rather than two. The contract's rule: 2–4 primary dimensions inline, the rest in `#more`,
 * and every secondary filter that is ON says so as a removable chip — otherwise a narrowed table
 * looks like the whole ledger.
 */
const labelFor = (options: { value: string; label: string }[], value: string) =>
  options.find((o) => o.value === value)?.label ?? value;
const chips = computed<FilterChip[]>(() => {
  const out: FilterChip[] = [];
  if (vehicleId.value) out.push({ key: "truck", label: "Truck", value: labelFor(vehicleOptions.value, vehicleId.value) });
  if (driverId.value) out.push({ key: "driver", label: "Driver", value: labelFor(driverOptions.value, driverId.value) });
  if (lines.value === "all") out.push({ key: "lines", label: "Showing", value: "Cancelled and duplicates" });
  return out;
});
const moreCount = computed(() => chips.value.length);
function removeChip(key: string) {
  if (key === "truck") vehicleId.value = "";
  if (key === "driver") driverId.value = "";
  if (key === "lines") lines.value = "";
}
function clearAll() {
  search.value = "";
  category.value = "";
  direction.value = "";
  vehicleId.value = "";
  driverId.value = "";
  lines.value = "";
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

/**
 * The flags column only exists to mark the cancelled lines and duplicates, and those cannot appear
 * unless the reader asked for them — so in the default view it was a permanently empty column
 * taking width from the six that carry something.
 */
const columns = computed<DataTableColumn[]>(() => [
  { key: "occurred_at", label: "Date", cellClass: "text-ink-secondary" },
  { key: "category", label: "What for" },
  { key: "direction", label: "In or out" },
  { key: "amount", label: "Amount", numeric: true },
  { key: "external_id", label: "Reference", cellClass: "font-mono text-xs text-ink-secondary" },
  { key: "source", label: "Came from", cellClass: "text-ink-tertiary" },
  ...(lines.value === "all" ? [{ key: "flags", label: "", align: "center" } as DataTableColumn] : []),
]);
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
        Cancelled lines and duplicates are <span class="font-medium text-ink">not in this table</span>
        and not in any total. A cancelled line is money that never actually moved; a duplicate is a
        second view of money already counted on another line — a fuel purchase that also appears on
        the card statement, for example. Both are kept in the database because an audit needs them,
        and you can bring them into view under <span class="font-medium text-ink">Filters → Lines to
        show</span> when you are checking a figure against McLeod. They arrive marked
        <span class="font-medium text-ink">Cancelled</span> or
        <span class="font-medium text-ink">Counted elsewhere</span> in the last column.
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
        :chips="chips"
        :more-count="moreCount"
        @remove="removeChip"
        @clear-all="clearAll"
      >
        <template #filters>
          <FilterSelect v-model="direction" label="In or out" :options="directionOptions" />
          <FilterSelect v-model="category" label="What for" :options="categoryOptions" />
          <DateRangeFilter :from="from" :to="to" @update:from="(v) => (from = v ?? from)" @update:to="(v) => (to = v ?? to)" />
        </template>
        <template #more>
          <FilterSelect v-model="vehicleId" label="Truck" :options="vehicleOptions" block />
          <FilterSelect v-model="driverId" label="Driver" :options="driverOptions" block />
          <!-- Drill-down: show the cancelled lines and the duplicates behind a number. Never the
               default, because neither is part of any total. -->
          <FilterSelect v-model="lines" label="Lines to show" :options="linesOptions" block />
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
