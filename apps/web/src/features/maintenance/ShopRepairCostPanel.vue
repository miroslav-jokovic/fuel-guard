<script setup lang="ts">
import { computed, watch } from "vue";
import { useRouter } from "vue-router";
import { parseYmd, ROLLUP_BUCKETS, ROLLUP_KINDS, sumMoney, type RollupBucket, type RollupKind, type RollupUnitRow } from "@silvicom/shared";
import { AppSegmentedControl, DataTable, DataWorkspace, FilterBar, QueryState, StatCard, TablePagination, useQueryState, type DataTableColumn } from "@silvicom/ui";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { REPAIR_COST_PAGE_SIZE, useRepairCostDefaultWindow, useRepairCostQuery, type RepairCostFilter } from "./useRepairCost";
import { boundLabel, KIND_WORD, money, periodLabel, repairsLabel, unitPath, WITH_LABOUR, WITHOUT_LABOUR } from "./repairCostRows";

/**
 * Repair cost — what FleetPal's repairs cost, by week, month or year, and per truck and trailer
 * (FLEETPAL-INTEGRATION-PLAN.md F9d). A tab of the Shop beside Repair bills: FleetPal cost lives in
 * Maintenance and never in Finance (D-FP3), and Repair bills is the ledger's side of the same money.
 *
 * ── WHAT EVERY FIGURE CARRIES ─────────────────────────────────────────────────────────────────
 * Both values, named (D-FP18). The ledger's "at least X%" per month, beside the money and never behind
 * a tooltip (D-FP15, F10's wording). The truck / trailer / not-matched split and how many FleetPal
 * units are not matched (D-FP14) — a total whose missing equipment is invisible reads as the fleet's.
 *
 * ── THE WINDOW OPENS WHERE THE LEDGER HAS BEEN SWEPT ──────────────────────────────────────────
 * The current month always refuses (409), so the default is the newest printable run of months the
 * coverage read finds (`useRepairCostDefaultWindow`), up to twelve. It is each end's FALLBACK, never
 * written to the URL, like Repair bills. A window the reader moves onto an unswept month gets the
 * API's own sentence, which names the months.
 */

const router = useRouter();
const qs = useQueryState();
const fromParam = qs.param("from");
const toParam = qs.param("to");
const bucketParam = qs.param("bucket", ROLLUP_BUCKETS, "month");
const kindParam = qs.param("kind", ROLLUP_KINDS, "all");
const page = qs.page();
/**
 * One table on screen at a time (contract §9 rule 9: one table per tab, every table paged). The periods
 * are the window's shape and the units are the paged list, so the tab switches between them rather
 * than stacking two tables, and the switch is in the URL like every other choice here (D-US2).
 */
const VIEWS = ["periods", "units"] as const;
const VIEW_OPTIONS = [
  { value: "periods", label: "By period" },
  { value: "units", label: "By truck or trailer" },
];
const viewParam = qs.param("view", VIEWS, "periods");
const view = computed(() => viewParam.value as (typeof VIEWS)[number]);

const def = useRepairCostDefaultWindow();
/** Undefined while the coverage loads; null when no month in the last year can be shown. */
const fallback = def.window;
const from = computed(() => parseYmd(fromParam.value) ?? fallback.value?.from);
const to = computed(() => parseYmd(toParam.value) ?? fallback.value?.to);
const bucket = computed(() => bucketParam.value as RollupBucket);
const kind = computed(() => kindParam.value as RollupKind);
watch([from, to, bucket, kind], () => (page.value = 1));

const filter = computed<RepairCostFilter | null>(() =>
  from.value && to.value ? { from: from.value, to: to.value, bucket: bucket.value, kind: kind.value, page: page.value } : null,
);
const q = useRepairCostQuery(filter);
const answer = computed(() => q.data.value?.answer ?? null);
const unavailable = computed(() => q.data.value?.unavailable ?? null);

const moved = computed(() => Boolean(fromParam.value || toParam.value) || bucket.value !== "month" || kind.value !== "all");
const activeFilterCount = computed(() => [Boolean(fromParam.value || toParam.value), bucket.value !== "month", kind.value !== "all"].filter(Boolean).length);
function resetFilters() {
  qs.set({ from: undefined, to: undefined, bucket: undefined, kind: undefined });
}

const BUCKET_OPTIONS = [
  { value: "week", label: "By week" },
  { value: "month", label: "By month" },
  { value: "year", label: "By year" },
];
const KIND_OPTIONS = [
  { value: "all", label: "Trucks and trailers" },
  { value: "tractor", label: "Trucks" },
  { value: "trailer", label: "Trailers" },
];

const totals = computed(() => {
  const b = answer.value?.buckets ?? [];
  return {
    fleet: sumMoney(b.map((x) => x.fleet)),
    tractor: sumMoney(b.map((x) => x.byKind.tractor)),
    trailer: sumMoney(b.map((x) => x.byKind.trailer)),
    unmatched: sumMoney(b.map((x) => x.byKind.unmatched)),
  };
});

const periodRows = computed(() =>
  (answer.value?.buckets ?? []).map((b) => ({
    key: b.key,
    period: periodLabel(b, bucket.value),
    operational: b.fleet.operational,
    external: b.fleet.external,
    repairs: repairsLabel(b.fleet),
    bound: boundLabel(b.months, answer.value!.coverage),
  })),
);
const PERIOD_COLUMNS: DataTableColumn[] = [
  { key: "period", label: "Period", card: "title", cellClass: "font-medium text-ink" },
  // `figure`, not `meta`: a card labels a figure, and both values must be named on every row (D-FP18).
  { key: "operational", label: WITH_LABOUR, card: "figure", numeric: true },
  { key: "external", label: WITHOUT_LABOUR, card: "figure", numeric: true, headerClass: "max-w-40" },
  { key: "bound", label: "Ledger seen", card: "figure", cellClass: "text-ink-secondary" },
  { key: "repairs", label: "Repairs", card: "sentence", cellClass: "text-ink-secondary" },
];

const unitRows = computed(() =>
  (answer.value?.units ?? []).map((u) => ({
    id: u.vehicleId ?? u.trailerId ?? u.fleetpalUnitIds.join(","),
    label: u.label ?? "No number",
    kindWord: KIND_WORD[u.kind],
    operational: u.total.operational,
    external: u.total.external,
    repairs: repairsLabel(u.total),
    to: unitPath(u as RollupUnitRow),
  })),
);
const UNIT_COLUMNS: DataTableColumn[] = [
  { key: "label", label: "Unit", card: "title", cellClass: "font-medium text-ink" },
  { key: "kindWord", label: "Type", card: "meta", cellClass: "text-ink-secondary" },
  { key: "operational", label: WITH_LABOUR, card: "figure", numeric: true },
  { key: "external", label: WITHOUT_LABOUR, card: "figure", numeric: true, headerClass: "max-w-40" },
  { key: "repairs", label: "Repairs", card: "sentence", cellClass: "text-ink-secondary" },
];
function openUnit(row: { to: string | null }) {
  if (row.to) void router.push(row.to);
}
const unmatchedUnits = computed(() => answer.value?.unmatchedUnits ?? 0);
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-ink-tertiary">
      What FleetPal's repairs cost, by period and by truck or trailer. Each figure is shown with shop labour, and without it — the
      one to compare with the ledger, where shop labour is payroll.
    </p>

    <DataWorkspace>
      <FilterBar embedded :count="view === 'units' ? answer?.unitTotal ?? 0 : periodRows.length" :count-label="view === 'units' ? 'units' : 'periods'" :active-count="activeFilterCount" @clear-all="resetFilters">
        <template #filters>
          <DateRangeFilter
            :from="from"
            :to="to"
            :presets="false"
            @update:from="(v) => (fromParam = v ?? fromParam)"
            @update:to="(v) => (toParam = v ?? toParam)"
          />
          <FilterSelect v-model="bucketParam" label="Period" :options="BUCKET_OPTIONS" />
          <FilterSelect v-model="kindParam" label="Units" :options="KIND_OPTIONS" />
        </template>
      </FilterBar>

      <QueryState
        :loading="def.query.isPending.value || (filter !== null && q.isPending.value)"
        :error="def.query.isError.value || q.isError.value"
        :retrying="def.query.isFetching.value || q.isFetching.value"
        loading-text="Adding up the repair cost…"
        error-text="Could not load the repair cost."
        @retry="def.query.isError.value ? def.query.refetch() : q.refetch()"
      >
        <p v-if="fallback === null && !moved" class="px-4 py-6 text-sm text-ink-secondary" data-test="repair-cost-none">
          No month in the last year can be shown yet: the ledger's maintenance total has not been swept for any of them, so
          there is nothing to measure FleetPal's share against.
        </p>
        <p v-else-if="unavailable" class="px-4 py-6 text-sm text-ink-secondary" data-test="repair-cost-unavailable">{{ unavailable }}</p>
        <template v-else-if="answer">
          <section aria-label="Repair cost for the window" class="grid grid-cols-1 divide-y divide-edge-subtle sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
            <StatCard embedded class="px-5 py-4" :label="WITH_LABOUR" :value="money(totals.fleet.operational)" :sub="repairsLabel(totals.fleet)" />
            <StatCard embedded class="px-5 py-4" :label="WITHOUT_LABOUR" :value="money(totals.fleet.external)" sub="what the ledger's maintenance should show" />
            <StatCard embedded class="px-5 py-4" label="Trucks · Trailers" :value="`${money(totals.tractor.operational)} · ${money(totals.trailer.operational)}`"
              :sub="`without labour ${money(totals.tractor.external)} · ${money(totals.trailer.external)}`" />
            <StatCard embedded class="px-5 py-4" label="Not matched to a unit" :value="money(totals.unmatched.operational)"
              :sub="`${unmatchedUnits.toLocaleString()} FleetPal unit${unmatchedUnits === 1 ? '' : 's'} not matched to a truck or trailer`" />
          </section>

          <div class="border-t border-edge-subtle px-4 py-3">
            <AppSegmentedControl v-model="viewParam" :options="VIEW_OPTIONS" label="Show the repair cost" />
          </div>

          <!-- ui-adoption: unpaged — the periods of the window, twelve on the default view; the paged list is the units view. -->
          <!-- ui-adoption: never-paged — one row per period of the window (`bucketsOf` draws every one, empty ones included): twelve on the default month view, at most 53 a year by week. -->
          <DataTable v-if="view === 'periods'" embedded :columns="PERIOD_COLUMNS" :rows="periodRows" row-key="key" aria-label="Repair cost by period">
            <template #cell-operational="{ value }"><span class="font-semibold">{{ money(value) }}</span></template>
            <template #cell-external="{ value }">{{ money(value) }}</template>
            <template #empty><p>No period in this window.</p></template>
          </DataTable>
          <DataTable
            v-else
            embedded
            :columns="UNIT_COLUMNS"
            :rows="unitRows"
            row-key="id"
            :row-class="(r) => (r.to ? 'cursor-pointer' : '')"
            :retrying="q.isFetching.value"
            aria-label="Repair cost by unit"
            @row-click="openUnit"
          >
            <template #cell-label="{ row, value }">
              <RouterLink v-if="row.to" :to="row.to" class="text-link hover:text-link-hover" @click.stop>{{ value }}</RouterLink>
              <span v-else>{{ value }}</span>
            </template>
            <template #cell-operational="{ value }"><span class="font-semibold">{{ money(value) }}</span></template>
            <template #cell-external="{ value }">{{ money(value) }}</template>
            <template #empty><p>No FleetPal repairs in this window.</p></template>
            <template #footer>
              <TablePagination :page="page" :page-size="REPAIR_COST_PAGE_SIZE" :total="answer.unitTotal" @update:page="page = $event" />
            </template>
          </DataTable>
        </template>
      </QueryState>
    </DataWorkspace>
  </div>
</template>
