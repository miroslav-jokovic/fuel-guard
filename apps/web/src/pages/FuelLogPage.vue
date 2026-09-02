<script setup lang="ts">
import { AppIcon } from "@silvicom/ui";
import {
  PlusIcon,
} from "@silvicom/ui/icons";
import { ref, computed, watch } from "vue";
import { useRouter } from "vue-router";
import { fuelTxnStatus, explainCaseOutcome, formatRuleId, type FillUpInput, type FuelTransaction, type CaseLevel, type CaseSignal } from "@silvicom/shared";
import { BADGE_BASE, txnStatusTone, toneClass } from "@/lib/badges";
import { stationDateTime } from "@/lib/stationTime";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useDriversQuery } from "@/composables/useDrivers";
import { useFuelTransactions, useFuelRangeTotals, useCreateFillUp, FUEL_PAGE_SIZE, type FuelFilters } from "@/features/fuel/useFuelLog";
import SlideOver from "@/components/SlideOver.vue";
import FillUpForm from "@/features/fuel/FillUpForm.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import FilterBar, { type FilterChip } from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import { AppCard as BaseCard } from "@silvicom/ui";
import { AppButton as BaseButton } from "@silvicom/ui";
import TablePagination from "@/components/TablePagination.vue";
import { toggleSort, type SortState } from "@/lib/sort";
import { useToastStore } from "@/stores/toast";

const router = useRouter();
const { data: vehicles } = useVehiclesQuery();
const { data: drivers } = useDriversQuery();

const filters = ref<FuelFilters>({});
const page = ref(1);
watch(filters, () => (page.value = 1), { deep: true });

const sort = ref<SortState>({ key: null, dir: "asc" });
function onSort(key: string) {
  sort.value = toggleSort(sort.value, key);
  filters.value = { ...filters.value, sortKey: sort.value.key ?? undefined, sortDir: sort.value.dir };
}
const { data, isLoading, isError, error, refetch, isFetching } = useFuelTransactions(filters, page);
// Range-wide totals (all matching fills, not just this page) — powers the Total miles stat.
const { data: rangeTotals } = useFuelRangeTotals(filters);

// ── Lookups for the Vehicle / Driver columns ──────────────────────────────────────────────────────
const vehicleLabel = (id: string | null) =>
  id ? (vehicles.value?.find((v) => v.id === id)?.unit_number ?? "—") : "Unattributed";
const driverName = (id: string | null) =>
  id ? (drivers.value?.find((d) => d.id === id)?.full_name ?? "—") : "—";
// NO TRAILER LOOKUP, and that is a decision rather than an omission (D-FUI14, FUEL-T4).
//
// This page used to render the truck's CURRENTLY paired trailer beside every fill, including fills
// from months ago. There is no historical pairing to render instead: `duty_equipment_segments` holds
// 0 rows (re-measured in production 2026-09-02) and `trailers.assigned_vehicle_id` is current-state by
// construction — 157 of 211 trailers carry one. So the column was not approximately right, it was a
// live fact presented as a historical one, which is a confident wrong answer.
//
// It was removed rather than relabelled: a caveat under a wrong number is a workaround with a caveat.
// Current pairing still shows on the vehicle and reefer-coverage surfaces, where it is already labelled
// as current and is true. Restoring trailer-at-fill means a time-ranged pairing table and a source that
// fills it, which is its own plan (Q-FUI8).

// ── Filters ───────────────────────────────────────────────────────────────────────────────────────
// The picker emits YYYY-MM-DD and the query now windows on `business_date`, a DATE — so the day goes
// through untouched, at both ends, and `to` is inclusive because a date compared to a date is.
//
// The `${v}T23:59:59` this used to append is gone with the column it existed for: while the filter
// windowed the `fueled_at` INSTANT, an end date alone meant midnight and silently cut the last day
// down to one second of it. That hack was correct for a timestamp and is a bug against a date, which
// is the general shape of what FUEL-T1 removes — every place the section had to say what a day meant.
const fromDate = computed(() => filters.value.from?.slice(0, 10));
const toDate = computed(() => filters.value.to?.slice(0, 10));
const setFrom = (v: string | undefined) => (filters.value = { ...filters.value, from: v });
const setTo = (v: string | undefined) => (filters.value = { ...filters.value, to: v });

const tankTypeFilter = computed<string>({
  get: () => filters.value.tankType ?? "",
  set: (v) => (filters.value = { ...filters.value, tankType: v === "tractor" || v === "reefer" ? v : undefined }),
});
const tankTypeOptions = [
  { value: "", label: "All fuel" },
  { value: "tractor", label: "Tractor" },
  { value: "reefer", label: "Reefer" },
];

// Filter by vehicle id (what the query uses) but show unit numbers.
const vehicleFilter = computed<string>({
  get: () => filters.value.vehicleId ?? "",
  set: (v) => (filters.value = { ...filters.value, vehicleId: v || undefined }),
});
const vehicleOptions = computed(() => [
  { value: "", label: "All vehicles" },
  ...[...(vehicles.value ?? [])]
    .sort((a, b) => a.unit_number.localeCompare(b.unit_number))
    .map((v) => ({ value: v.id, label: v.unit_number })),
]);

// Driver is a secondary (popover) filter.
const driverFilter = computed<string>({
  get: () => filters.value.driverId ?? "",
  set: (v) => (filters.value = { ...filters.value, driverId: v || undefined }),
});
const driverOptions = computed(() => [
  { value: "", label: "All drivers" },
  ...[...(drivers.value ?? [])]
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
    .map((d) => ({ value: d.id, label: d.full_name })),
]);

// Smart search: matches location & card server-side, plus vehicle unit / driver name resolved here (so the
// box narrows by any of those). Resolved id-lists ride along in the filters for the query's OR term.
const searchBind = computed<string>({
  get: () => filters.value.search ?? "",
  set: (raw) => {
    const t = raw.trim();
    if (!t) {
      filters.value = { ...filters.value, search: undefined, searchVehicleIds: undefined, searchDriverIds: undefined };
      return;
    }
    const low = t.toLowerCase();
    const vIds = (vehicles.value ?? []).filter((v) => v.unit_number.toLowerCase().includes(low)).map((v) => v.id);
    const dIds = (drivers.value ?? []).filter((d) => d.full_name.toLowerCase().includes(low)).map((d) => d.id);
    filters.value = {
      ...filters.value,
      search: t,
      searchVehicleIds: vIds.length ? vIds : undefined,
      searchDriverIds: dIds.length ? dIds : undefined,
    };
  },
});

// Chips surface the secondary (popover) filter; inline triggers show their own value.
const chips = computed<FilterChip[]>(() => {
  const out: FilterChip[] = [];
  if (filters.value.driverId) out.push({ key: "driver", label: "Driver", value: driverName(filters.value.driverId) });
  return out;
});
const moreCount = computed(() => (filters.value.driverId ? 1 : 0));
function removeChip(key: string) {
  if (key === "driver") filters.value = { ...filters.value, driverId: undefined };
}
function clearAll() {
  filters.value = { sortKey: filters.value.sortKey, sortDir: filters.value.sortDir };
}

const rows = computed(() => data.value?.rows ?? []);
const total = computed(() => data.value?.total ?? 0);
const totalMiles = computed(() => rangeTotals.value?.totalMiles ?? 0);

const toast = useToastStore();
const drawerOpen = ref(false);
const createFillUp = useCreateFillUp();

async function onSubmit(payload: { input: FillUpInput; file: File | null }) {
  try {
    await createFillUp.mutateAsync(payload);
    drawerOpen.value = false;
    toast.success("Fill-up logged");
  } catch (e) {
    toast.error("Could not save fill-up", e instanceof Error ? e.message : undefined);
  }
}

// A flagged row opens that truck's cases (all statuses) on the Alerts page; clear rows aren't interactive.
function onRowClick(row: FuelTransaction) {
  if (row.has_anomaly && row.vehicle_id) router.push({ path: "/anomalies", query: { vehicle: row.vehicle_id } });
}
// `group` is DataTable's, via `pin-first-column`; this only adds what is specific to a fill.
const rowClass = (row: FuelTransaction) => (row.has_anomaly ? "cursor-pointer" : "");

// Station-local (matches the EFS report), not the browser's timezone.
const fmtDate = (iso: string, state: string | null) => stationDateTime(iso, state);

// Summary stats reflect the WHOLE filtered range (not just this page) — sourced from useFuelRangeTotals
// so applying a filter updates every tile, not only the rows currently visible.
const flaggedCount = computed(() => rangeTotals.value?.flagged ?? 0);
const clearCount   = computed(() => rangeTotals.value?.clear ?? 0);
const totalGallons = computed(() => rangeTotals.value?.totalGallons ?? 0);
const totalCost    = computed(() => rangeTotals.value?.totalCost ?? 0);
const hasCost      = computed(() => rangeTotals.value?.hasCost ?? false);
const avgMpg       = computed(() => rangeTotals.value?.fleetMpg ?? null);
const fmtNum = (n: number, dec = 0) => n.toLocaleString("en-US", { maximumFractionDigits: dec });
const fmtUsd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// Vehicle leads (sticky on small screens, like the Transactions table); Driver follows.
/** WP2 "why" surface — sub-threshold signals persisted on the fill (case_signals) explained in plain
 *  language, so a clear fill with a fired-but-weak signal (e.g. a lone odometer regression) is visible. */
function weakSignals(row: FuelTransaction): CaseSignal[] {
  if (row.has_anomaly) return []; // flagged fills explain themselves on the Alerts page
  return (row.case_signals ?? []) as CaseSignal[];
}
function whyTitle(row: FuelTransaction): string {
  const sigs = weakSignals(row);
  const names = sigs.map((s) => formatRuleId(s.ruleId)).join(", ");
  return `${names}\n\n${explainCaseOutcome((row.case_level ?? "clear") as CaseLevel, Number(row.case_score ?? 0), sigs)}${gatesNote(row)}`;
}
/** WP6 — honest-absence note: which rule groups were INELIGIBLE for this fill and why. */
function gatesNote(row: FuelTransaction): string {
  const g = row.case_gates;
  if (!g?.ineligible?.length) return "";
  const why: string[] = [];
  if (g.tankSensor !== "reliable") why.push("tank sensor not learned-reliable");
  if (g.odoSource === "other") why.push("odometer cross-check is GPS-derived");
  if (g.fillSize === "too_small") why.push("fill too small for the sensor to read");
  return `\n\nChecks limited on this fill (${why.join("; ") || "confidence gates"}): ${g.ineligible.map((r) => formatRuleId(r)).join(", ")} did not run.`;
}
/** Show the marker when sub-threshold signals fired OR meaningful checks were gated off. */
function hasWhy(row: FuelTransaction): boolean {
  return weakSignals(row).length > 0 || !!row.case_gates?.ineligible?.length;
}

const columns: DataTableColumn[] = [
  {
    key: "vehicle_id",
    label: "Vehicle",
    width: "md",
  },
  { key: "fueled_at", label: "When", sortable: true, width: "lg", cellClass: "text-ink-secondary" },
  { key: "driver", label: "Driver", width: "lg", cellClass: "text-ink-secondary" },
  { key: "odometer", label: "Odometer", sortable: true, numeric: true, width: "md", cellClass: "text-ink-secondary" },
  { key: "miles_since_last", label: "Miles", sortable: true, numeric: true, width: "sm", cellClass: "text-ink-secondary" },
  { key: "gallons", label: "Gallons", sortable: true, numeric: true, width: "md", cellClass: "text-ink-secondary" },
  { key: "price_per_gal", label: "$/gal", sortable: true, numeric: true, width: "sm", cellClass: "text-ink-secondary" },
  { key: "computed_mpg", label: "MPG", sortable: true, numeric: true, width: "sm", cellClass: "text-ink-secondary" },
  { key: "status", label: "Status", width: "lg" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Every recorded fill-up with computed MPG and anomaly status.">
      <template #actions>
        <BaseButton variant="primary" @click="drawerOpen = true">
          <AppIcon :icon="PlusIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Log fill-up
        </BaseButton>
      </template>
    </PageHeader>

    <FilterBar
      v-model:search="searchBind"
      search-placeholder="Search vehicle, driver, location, card…"
      :count="total"
      count-label="fill-ups"
      :chips="chips"
      :more-count="moreCount"
      @remove="removeChip"
      @clear-all="clearAll"
    >
      <template #filters>
        <FilterSelect v-model="vehicleFilter" label="Vehicle" :options="vehicleOptions" />
        <FilterSelect v-model="tankTypeFilter" label="Fuel" :options="tankTypeOptions" />
        <DateRangeFilter :from="fromDate" :to="toDate" @update:from="setFrom" @update:to="setTo" />
      </template>
      <template #more>
        <FilterSelect v-model="driverFilter" label="Driver" :options="driverOptions" block />
      </template>
    </FilterBar>

    <!-- D-FUI11: one date contract, and each control says which day it means. Before FUEL-T1
         the section had four answers to “what is a day” and no surface admitted to having one. -->
    <p class="-mt-3 text-xs text-ink-tertiary">Dates are the day of the fill at the station that sold it — the day EFS prints, and the day the
        row beside it shows.</p>

    <!-- Summary stats block -->
    <BaseCard v-if="!isLoading && !isError && total > 0" padding="none">
      <dl class="grid grid-cols-2 divide-y divide-edge-subtle sm:grid-cols-3 sm:divide-y-0 sm:divide-x lg:grid-cols-6">
        <div class="px-5 py-4">
          <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Total fill-ups</dt>
          <dd class="mt-1 text-2xl font-bold text-ink">{{ total.toLocaleString() }}</dd>
          <dd class="mt-0.5 text-xs text-ink-tertiary">matching current filters</dd>
        </div>
        <div class="px-5 py-4">
          <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Total miles</dt>
          <dd class="mt-1 text-2xl font-bold text-ink">{{ fmtNum(totalMiles, 0) }}</dd>
          <dd class="mt-0.5 text-xs text-ink-tertiary">driven in selected range</dd>
        </div>
        <div class="px-5 py-4">
          <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Flagged</dt>
          <dd class="mt-1 text-2xl font-bold" :class="flaggedCount ? 'text-danger-600' : 'text-ink-tertiary'">{{ flaggedCount }}</dd>
          <dd class="mt-0.5 text-xs" :class="flaggedCount ? 'text-danger-400' : 'text-ink-tertiary'">
            {{ flaggedCount ? 'anomalies need review' : 'none in selected range' }}
          </dd>
        </div>
        <div class="px-5 py-4">
          <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Clear</dt>
          <dd class="mt-1 text-2xl font-bold" :class="clearCount ? 'text-success-600' : 'text-ink-tertiary'">{{ clearCount }}</dd>
          <dd class="mt-0.5 text-xs text-ink-tertiary">transactions with no flags</dd>
        </div>
        <div class="px-5 py-4">
          <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Gallons</dt>
          <dd class="mt-1 text-2xl font-bold text-ink">{{ fmtNum(totalGallons, 0) }}</dd>
          <dd class="mt-0.5 text-xs text-ink-tertiary">in selected range</dd>
        </div>
        <div class="px-5 py-4">
          <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Avg MPG</dt>
          <dd class="mt-1 text-2xl font-bold text-ink">{{ avgMpg != null ? avgMpg.toFixed(1) : '—' }}</dd>
          <dd class="mt-0.5 text-xs text-ink-tertiary">{{ hasCost ? fmtUsd(totalCost) + ' total cost' : 'gallon-weighted' }}</dd>
        </div>
      </dl>
    </BaseCard>

    <DataTable
      :columns="columns"
      :rows="rows"
      row-key="id"
      dense
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load fuel log') : null"
      :retrying="isFetching"
      :sort="sort"
      pin-first-column
      :row-class="rowClass"
      empty-text="No fill-ups match these filters."
      @sort="onSort"
      @retry="refetch"
      @row-click="onRowClick"
    >
      <template #cell-vehicle_id="{ row }">{{ vehicleLabel(row.vehicle_id) }}</template>
      <template #cell-fueled_at="{ row }">{{ fmtDate(row.fueled_at, row.state ?? null) }}</template>
      <template #cell-driver="{ row }">{{ driverName(row.driver_id) }}</template>
      <template #cell-miles_since_last="{ row }">{{ row.miles_since_last != null ? fmtNum(row.miles_since_last, 0) : "—" }}</template>
      <template #cell-gallons="{ row }">
        <span>{{ row.gallons }}</span>
        <!-- Reefer = the FUEL is reefer (ULSR), tagged on the gallons — NOT a property of the truck. -->
        <span v-if="row.tank_type === 'reefer'" class="ml-1.5" :class="[BADGE_BASE, toneClass('info')]">Reefer</span>
      </template>
      <template #cell-status="{ row }">
        <div class="flex items-center gap-1.5">
          <span
            :class="[BADGE_BASE, txnStatusTone(fuelTxnStatus(row).status)]"
            :title="fuelTxnStatus(row).locationConfirmed ? 'Location confirmed by Samsara' : undefined"
            >{{ fuelTxnStatus(row).label }}</span
          >
          <span
            v-if="fuelTxnStatus(row).locationConfirmed && !row.has_anomaly"
            class="text-success-600"
            title="Location confirmed by Samsara"
            >✓</span
          >
          <span
            v-if="row.ai_risk_level"
            :class="[BADGE_BASE, toneClass('brand')]"
            title="AI risk level"
            >AI: {{ row.ai_risk_level }}</span
          >
          <span
            v-if="hasWhy(row)"
            :class="[BADGE_BASE, toneClass('neutral')]"
            class="cursor-help"
            :title="whyTitle(row)"
            >{{ weakSignals(row).length ? `${weakSignals(row).length} weak signal${weakSignals(row).length > 1 ? "s" : ""}` : "ⓘ" }}</span
          >
        </div>
      </template>
      <template #footer>
        <TablePagination
          :page="page"
          :page-size="FUEL_PAGE_SIZE"
          :total="total"
          :loading="isFetching"
          @update:page="page = $event"
        />
      </template>
    </DataTable>

    <SlideOver :open="drawerOpen" title="Log fill-up" @close="drawerOpen = false">
      <FillUpForm
        :vehicles="vehicles ?? []"
        :submitting="createFillUp.isPending.value"
        @submit="onSubmit"
        @cancel="drawerOpen = false"
      />
    </SlideOver>
  </div>
</template>
