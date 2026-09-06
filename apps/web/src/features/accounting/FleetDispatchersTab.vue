<script setup lang="ts">
import { computed, ref, watch } from "vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import StatCard from "@/components/ui/StatCard.vue";
import TablePagination from "@/components/TablePagination.vue";
import { useDispatcherEarningsQuery, type DispatcherEarnings } from "@/composables/useDispatcherEarnings";
import { sortRows, toggleSort, type SortState } from "@/lib/sort";
import type { FleetReportResponse } from "./useFleetReport";
import type { MileageCoverageResponse } from "./useMileageCoverage";

/**
 * Per dispatcher (plan §2 Tab 3, R7): rank, dispatcher, loads, billed miles, rate per mile, and
 * what was booked — on the fleet report's own clock. It lived on the Revenue & margin page on a
 * trailing-90-day window, where the rate could never be read against the month's spent per mile
 * (FLEET-REPORT-UI-PLAN §0, finding 7). The owner ruled on 2026-09-04 that it moves here (Q1).
 *
 * The rate is revenue over McLeod's BILLED distance — what the loads were priced at — and never
 * per mile driven, which is a fleet figure (G9). The dot plot sets each dispatcher against the
 * fleet's own rate per billed mile, from the coverage read the page already makes (billed revenue
 * over billed miles), so "above the line" means priced above what the fleet as a whole was.
 * Colour is never the only cue: the number sits beside every dot.
 *
 * `unpostedLoads` is the staged-but-unbooked remainder (D-MC12), shown rather than hidden; a
 * dispatcher whose loads carried no distance reads a dash, never $0.00 (D-FIN10).
 */

const props = defineProps<{
  from: string;
  to: string;
  report: FleetReportResponse | null;
  coverage: MileageCoverageResponse | null;
}>();

const from = computed(() => props.from);
const to = computed(() => props.to);
const { data, isLoading, isError, error, refetch, isFetching } = useDispatcherEarningsQuery(from, to);

const PAGE_SIZE = 20;
const search = ref("");
const page = ref(1);
const sort = ref<SortState>({ key: null, dir: "asc" });
const onSort = (key: string) => (sort.value = toggleSort(sort.value, key));
watch([search, from, to], () => (page.value = 1));

interface Row extends DispatcherEarnings {
  key: string;
  rank: number;
  name: string;
  /** 0–100 along the plot's axis; null when the dispatcher has no rate. */
  dot: number | null;
}

/** The fleet's rate per billed mile — the reference line. Null when nothing was billed with a distance. */
const fleetRate = computed(() => {
  const c = props.coverage;
  return c && c.billedMiles > 0 ? c.billedRevenue / c.billedMiles : null;
});

/** The plot's axis: the rates' own range, padded, so the spread reads; the fleet line sits where it falls. */
const axis = computed(() => {
  const rates = (data.value ?? []).map((d) => d.ratePerMile).filter((r): r is number => r != null);
  if (fleetRate.value != null) rates.push(fleetRate.value);
  if (!rates.length) return { lo: 0, hi: 1 };
  const lo = Math.min(...rates);
  const hi = Math.max(...rates);
  const pad = Math.max(0.1, (hi - lo) * 0.15);
  return { lo: Math.max(0, lo - pad), hi: hi + pad };
});
const place = (rate: number | null) =>
  rate == null ? null : Math.round(((rate - axis.value.lo) / (axis.value.hi - axis.value.lo)) * 100);

// Rank is by booked revenue, the API's own order — a sort on any other column keeps the number, so
// the reader can re-sort by rate per mile and still see who booked the most. A bill whose order
// carried no operations user is its own row, for the same reason the unattributed truck was: the
// money exists and hiding it would make the column stop summing.
const rows = computed<Row[]>(() =>
  (data.value ?? []).map((d, i) => ({
    ...d,
    rank: i + 1,
    key: d.dispatcherUserId ?? "(unassigned)",
    name: d.dispatcherName ?? d.dispatcherUserId ?? "Unassigned",
    dot: place(d.ratePerMile),
  })),
);
const q = computed(() => search.value.trim().toLowerCase());
const filtered = computed(() => sortRows(rows.value.filter((r) => !q.value || r.name.toLowerCase().includes(q.value)), sort.value));
const pageRows = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

const booked = computed(() => rows.value.reduce((a, d) => a + d.revenue, 0));
const unposted = computed(() => rows.value.reduce((a, d) => a + d.unpostedLoads, 0));
const loads = computed(() => rows.value.reduce((a, d) => a + d.loads, 0));

const fmtUsd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtRate = (n: number | null) =>
  n == null ? "—" : n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2 });

const columns: DataTableColumn[] = [
  { key: "rank", label: "#", numeric: true, cellClass: "text-ink-tertiary", sortable: true },
  { key: "name", label: "Dispatcher", cellClass: "font-medium text-ink", sortable: true },
  { key: "loads", label: "Loads", numeric: true, sortable: true },
  { key: "miles", label: "Billed miles", numeric: true, cellClass: "text-ink-tertiary", sortable: true },
  { key: "ratePerMile", label: "Rate / mile", numeric: true, sortable: true },
  { key: "dot", label: "Against the fleet" },
  { key: "linehaul", label: "Freight", numeric: true, sortable: true },
  { key: "accessorial", label: "Extras", numeric: true, sortable: true },
  { key: "revenue", label: "Total booked", numeric: true, sortable: true },
  { key: "unpostedLoads", label: "Not booked yet", numeric: true, cellClass: "text-ink-tertiary", sortable: true },
];
</script>

<template>
  <div class="space-y-6">
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard
        label="Booked in this period"
        :value="fmtUsd(booked)"
        :sub="`${loads.toLocaleString()} loads across ${rows.length} ${rows.length === 1 ? 'dispatcher' : 'dispatchers'}${unposted ? ` · ${unposted} not booked yet, held out` : ''}`"
        :loading="isLoading"
      />
      <StatCard
        label="Fleet rate per billed mile"
        :value="fmtRate(fleetRate)"
        :sub="coverage ? `${Math.round(coverage.billedMiles).toLocaleString()} billed miles — the line every dispatcher is read against` : 'billed miles not available for this period'"
      />
      <StatCard
        label="Spent per mile driven"
        :value="fmtRate(report?.total.costPerMile ?? null)"
        :sub="report?.total.costPerMile == null ? (report?.mileageReason ?? 'per-mile figure not available for this period') : 'from the overview, same period — a load priced under this loses money'"
        :sub-tone="report?.total.costPerMile == null ? 'text-warning-700' : undefined"
      />
    </div>

    <DataWorkspace>
      <FilterBar v-model:search="search" embedded search-placeholder="Search by dispatcher…" :count="filtered.length" count-label="dispatchers" />
      <DataTable
        :columns="columns"
        :rows="pageRows"
        embedded
        row-key="key"
        :loading="isLoading"
        :error="isError ? (error instanceof Error ? error.message : 'Failed to load') : null"
        :retrying="isFetching"
        :sort="sort"
        @sort="onSort"
        @retry="refetch"
      >
        <template #empty>
          <p>No dispatcher earnings for this period. The dispatcher's name arrives with the McLeod billing sweep, so bills swept before that ran carry none.</p>
        </template>
        <template #cell-name="{ row }">
          <span :class="row.dispatcherName ? '' : 'text-ink-tertiary'" :title="row.dispatcherName ? undefined : 'The bill\'s order carried no operations user'">{{ row.name }}</span>
        </template>
        <template #cell-linehaul="{ value }">{{ fmtUsd(value) }}</template>
        <template #cell-accessorial="{ value }">{{ fmtUsd(value) }}</template>
        <template #cell-revenue="{ value }"><span class="font-semibold">{{ fmtUsd(value) }}</span></template>
        <template #cell-miles="{ value, row }">
          <span :title="row.loadsWithoutMiles > 0 ? `${row.loadsWithoutMiles} booked load(s) carried no distance in McLeod and are not in these miles` : `McLeod's billed distance — the miles the loads were priced on`">{{ Math.round(value).toLocaleString() }}</span>
        </template>
        <template #cell-ratePerMile="{ value }">
          <span v-if="value == null" class="text-ink-tertiary" title="No booked load carried a distance — no rate">—</span>
          <span v-else class="font-semibold">{{ fmtRate(value) }}</span>
        </template>
        <!-- The dot plot: a soft track, the fleet's rate as a firm line, the dispatcher as a dot in
             the good hue above the line and the spend hue below it. Decorative to a screen reader;
             the rate column beside it carries the figure. -->
        <template #cell-dot="{ row }">
          <span class="relative block h-4 w-40" aria-hidden="true">
            <span class="absolute inset-y-1.5 inset-x-0 rounded-detail bg-brand-500/10" />
            <span v-if="fleetRate != null" class="absolute inset-y-0 w-0.5 rounded-detail bg-ink-tertiary" :style="{ left: `${place(fleetRate)}%` }" />
            <span
              v-if="row.dot != null"
              :class="['absolute top-0.5 size-3 -translate-x-1/2 rounded-full ring-2 ring-surface', fleetRate != null && (row.ratePerMile ?? 0) < fleetRate ? 'bg-caution-500/85' : 'bg-success-500/85']"
              :style="{ left: `${row.dot}%` }"
            />
          </span>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="filtered.length" :loading="isFetching" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>
  </div>
</template>
