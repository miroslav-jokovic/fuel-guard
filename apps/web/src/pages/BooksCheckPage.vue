<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMonthClosesQuery } from "@/features/accounting/useMonthCloses";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import StatCard from "@/components/ui/StatCard.vue";
import ExplainerPanel from "@/components/ui/ExplainerPanel.vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";

/**
 * Books check — the monthly close as a page (D-FIN14, D-FIN15). One table: every month the
 * McLeod sweep has landed, per company, with the verdict and — for an open month — every reason
 * the API named. Nothing here is computed on the page: the row IS the close, as of its sweep.
 *
 * "Hardened" is the only word that means "these figures tied to the cent"; the finance pages
 * print it in their headers from the same rows. An owner who reads a month as open reads why.
 */
const { data, isLoading, isError, error, refetch, isFetching } = useMonthClosesQuery();

const statusFilter = ref<"all" | "open" | "hardened">("all");
const search = ref("");
const PAGE_SIZE = 20;
const page = ref(1);
watch([statusFilter, search], () => (page.value = 1));

const closes = computed(() => data.value ?? []);
const rows = computed(() => {
  const q = search.value.trim().toLowerCase();
  return closes.value
    .filter((c) => statusFilter.value === "all" || c.status === statusFilter.value)
    .filter((c) => !q || c.period_start.slice(0, 7).includes(q) || c.company_id.toLowerCase().includes(q) || c.open_reasons.join(" ").toLowerCase().includes(q))
    .map((c) => ({ ...c, key: `${c.company_id}|${c.period_start}`, month: monthLabel(c.period_start) }));
});
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

const hardened = computed(() => closes.value.filter((c) => c.status === "hardened").length);
const open = computed(() => closes.value.length - hardened.value);
const latestSweep = computed(() => closes.value.map((c) => c.swept_at).filter((s): s is string => !!s).sort().at(-1) ?? null);

const monthLabel = (periodStart: string) =>
  new Date(`${periodStart}T00:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
const fmtUsd = (v: number | string | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString(undefined, { style: "currency", currency: "USD" });
const fmtWhen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "never";

const statusOptions = [
  { value: "all", label: "All months" },
  { value: "open", label: "Open" },
  { value: "hardened", label: "Hardened" },
];

const columns: DataTableColumn[] = [
  { key: "month", label: "Month", cellClass: "font-medium text-ink" },
  { key: "company_id", label: "Books", cellClass: "font-mono text-xs text-ink-tertiary" },
  { key: "status", label: "Status" },
  { key: "gl_revenue", label: "Earned", numeric: true },
  { key: "gl_expenses", label: "Spent", numeric: true },
  { key: "cpm_residual", label: "Left over", numeric: true },
  { key: "open_reasons", label: "Why it is open" },
  { key: "swept_at", label: "As of" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Whether each month's figures tie to the ledger — and, when they do not, exactly why." />

    <ExplainerPanel summary="What 'hardened' means">
      <p>
        Every month, the McLeod sweep re-reads the books and Silvicom 360 sorts every dollar the ledger
        booked into one named bucket: fuel and pay placed on a truck, the fixed schedule, shared costs
        spread by miles, the contractor pool. It then checks each bucket against the ledger's own
        totals, and the fuel, pay and billing sweeps against the accounts they post to.
      </p>
      <p>
        A month is <strong>hardened</strong> only when it is at least two months old — McLeod's manual
        entries land about a month late — and every one of those checks reads exactly zero. Until then
        it is <strong>open</strong>, and this page says why, in the ledger's own words. A hardened month
        whose figures move on a later sweep is reopened and the office is told.
      </p>
    </ExplainerPanel>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard label="Hardened months" :value="String(hardened)" sub="tie to the ledger to the cent" :loading="isLoading" />
      <StatCard label="Open months" :value="String(open)" :sub="open ? 'each names its reasons below' : 'nothing waiting'" :sub-tone="open ? 'text-warning-700' : undefined" :loading="isLoading" />
      <StatCard label="Last sweep" :value="fmtWhen(latestSweep)" sub="the moment these rows were computed from" :loading="isLoading" />
    </div>

    <DataWorkspace>
      <FilterBar v-model:search="search" embedded search-placeholder="Search a month, books or reason…" :count="rows.length" count-label="months">
        <template #filters>
          <FilterSelect v-model="statusFilter" label="Status" :options="statusOptions" />
        </template>
      </FilterBar>
      <DataTable
        :columns="columns"
        :rows="pageRows"
        embedded
        row-key="key"
        :loading="isLoading"
        :error="isError ? (error instanceof Error ? error.message : 'Failed to load') : null"
        :retrying="isFetching"
        @retry="refetch"
      >
        <template #empty>
          <div class="space-y-1">
            <p>No month has been closed yet.</p>
            <p class="text-xs text-ink-tertiary">A close appears after the McLeod financial sweep has landed a month's ledger totals and the six-hourly check has run.</p>
          </div>
        </template>
        <template #cell-status="{ value }">
          <span :class="[BADGE_BASE, toneClass(value === 'hardened' ? 'success' : 'warning')]">{{ value === "hardened" ? "Hardened" : "Open" }}</span>
        </template>
        <template #cell-gl_revenue="{ value }">{{ fmtUsd(value) }}</template>
        <template #cell-gl_expenses="{ value }">{{ fmtUsd(value) }}</template>
        <template #cell-cpm_residual="{ value }">
          <span :class="value != null && Number(value) !== 0 ? 'text-danger-700 font-semibold' : 'text-ink-tertiary'" title="Ledger expenses minus every bucket — 0.00 when the month ties">{{ fmtUsd(value) }}</span>
        </template>
        <template #cell-open_reasons="{ value }">
          <ul v-if="(value as string[]).length" class="space-y-0.5 text-xs text-ink-secondary">
            <li v-for="r in value as string[]" :key="r">• {{ r }}</li>
          </ul>
          <span v-else class="text-xs text-ink-tertiary">—</span>
        </template>
        <template #cell-swept_at="{ value }">{{ fmtWhen(value) }}</template>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" :loading="isFetching" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>
  </div>
</template>
