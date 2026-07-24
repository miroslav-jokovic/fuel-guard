<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useRouter } from "vue-router";
import { PlusIcon } from "@heroicons/vue/20/solid";
import { fuelTxnStatus, explainCaseOutcome, formatRuleId, type FillUpInput, type FuelTransaction, type CaseLevel, type CaseSignal } from "@fuelguard/shared";
import { BADGE_BASE, txnStatusTone, toneClass } from "@/lib/badges";
import { stationDateTime } from "@/lib/stationTime";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useDriversQuery } from "@/composables/useDrivers";
import { useTrailersQuery } from "@/features/fleet/useTrailers";
import { useFuelTransactions, useFuelRangeTotals, useCreateFillUp, FUEL_PAGE_SIZE, type FuelFilters } from "@/features/fuel/useFuelLog";
import SlideOver from "@/components/SlideOver.vue";
import FillUpForm from "@/features/fuel/FillUpForm.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import FilterBar, { type FilterChip } from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import TablePagination from "@/components/TablePagination.vue";
import { toggleSort, type SortState } from "@/lib/sort";
import { useToastStore } from "@/stores/toast";

const router = useRouter();
const { data: vehicles } = useVehiclesQuery();
const { data: drivers } = useDriversQuery();
const { data: trailers } = useTrailersQuery();

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

// ── Lookups for the Vehicle / Trailer / Driver columns ────────────────────────────────────────────
const vehicleLabel = (id: string | null) =>
  id ? (vehicles.value?.find((v) => v.id === id)?.unit_number ?? "—") : "Unattributed";
const driverName = (id: string | null) =>
  id ? (drivers.value?.find((d) => d.id === id)?.full_name ?? "—") : "—";
// Currently-paired trailer for a truck (best available; reflects today's pairing, not the fill date).
const trailerForVehicle = (vehicleId: string | null) => {
  if (!vehicleId) return null;
  return (trailers.value ?? []).find((t) => t.assigned_vehicle_id === vehicleId && t.status !== "retired")?.unit_number ?? null;
};

// ── Filters ───────────────────────────────────────────────────────────────────────────────────────
// Date inputs emit YYYY-MM-DD; make `to` inclusive of the whole day for the timestamped column.
const fromDate = computed(() => filters.value.from?.slice(0, 10));
const toDate = computed(() => filters.value.to?.slice(0, 10));
const setFrom = (v: string | undefined) => (filters.value = { ...filters.value, from: v });
const setTo = (v: string | undefined) =>
  (filters.value = { ...filters.value, to: v ? `${v}T23:59:59` : undefined });

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
const rowClass = (row: FuelTransaction) => ["group", row.has_anomaly ? "cursor-pointer" : ""].filter(Boolean).join(" ");

// Station-local (matches the EFS report), not the browser's timezone.
const fmtDate = (iso: string, state: string | null) => stationDateTime(iso, state);

const flaggedCount = computed(() => rows.value.filter((t) => t.has_anomaly).length);
const clearCount   = computed(() => rows.value.filter((t) => !t.has_anomaly).length);
const totalGallons = computed(() => rows.value.reduce((s, t) => s + t.gallons, 0));
const pageCost     = computed(() => rows.value.reduce((s, t) => s + (t.total_cost ?? 0), 0));
const hasCost      = computed(() => rows.value.some((t) => t.total_cost != null));
const mpgValues    = computed(() => rows.value.map((t) => t.computed_mpg).filter((v): v is number => v != null));
const avgMpg       = computed(() => mpgValues.value.length ? mpgValues.value.reduce((a, b) => a + b, 0) / mpgValues.value.length : null);
const fmtNum = (n: number, dec = 0) => n.toLocaleString("en-US", { maximumFractionDigits: dec });
const fmtUsd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// Vehicle leads (sticky on small screens, like the Transactions table); Trailer + Driver follow.
/** WP2 "why" surface — sub-threshold signals persisted on the fill (case_signals) explained in plain
 *  language, so a clear fill with a fired-but-weak signal (e.g. a lone odometer regression) is visible. */
function weakSignals(row: FuelTransaction): CaseSignal[] {
  if (row.has_anomaly) return []; // flagged fills explain themselves on the Alerts page
  return (row.case_signals ?? []) as CaseSignal[];
}
function whyTitle(row: FuelTransaction): string {
  const sigs = weakSignals(row);
  const names = sigs.map((s) => formatRuleId(s.ruleId)).join(", ");
  return `${names}\n\n${explainCaseOutcome((row.case_level ?? "clear") as CaseLevel, Number(row.case_score ?? 0), sigs)}`;
}

const columns: DataTableColumn[] = [
  {
    key: "vehicle_id",
    label: "Vehicle",
    headerClass: "sticky left-0 z-20 bg-surface-subtle min-w-[7rem] border-r border-edge",
    cellClass: "sticky left-0 z-[1] border-r border-edge bg-surface font-medium text-ink group-hover:bg-surface-subtle",
  },
  { key: "fueled_at", label: "When", sortable: true, headerClass: "min-w-[11rem]", cellClass: "text-ink-secondary" },
  { key: "trailer", label: "Trailer", headerClass: "min-w-[7rem]", cellClass: "text-ink-secondary" },
  { key: "driver", label: "Driver", headerClass: "min-w-[9rem]", cellClass: "text-ink-secondary" },
  { key: "odometer", label: "Odometer", sortable: true, numeric: true, headerClass: "min-w-[8rem]", cellClass: "text-ink-secondary" },
  { key: "miles_since_last", label: "Miles", sortable: true, numeric: true, headerClass: "min-w-[6rem]", cellClass: "text-ink-secondary" },
  { key: "gallons", label: "Gallons", sortable: true, numeric: true, headerClass: "min-w-[7rem]", cellClass: "text-ink-secondary" },
  { key: "price_per_gal", label: "$/gal", sortable: true, numeric: true, headerClass: "min-w-[6rem]", cellClass: "text-ink-secondary" },
  { key: "computed_mpg", label: "MPG", sortable: true, numeric: true, headerClass: "min-w-[5rem]", cellClass: "text-ink-secondary" },
  { key: "status", label: "Status", headerClass: "min-w-[11rem]" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Every recorded fill-up with computed MPG and anomaly status.">
      <template #actions>
        <BaseButton variant="primary" @click="drawerOpen = true">
          <PlusIcon class="-ml-0.5 size-5" aria-hidden="true" /> Log fill-up
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

    <!-- Summary stats block -->
    <BaseCard v-if="!isLoading && !isError && total > 0" padding="none">
      <dl class="grid grid-cols-2 divide-y divide-edge-subtle sm:grid-cols-3 sm:divide-y-0 sm:divide-x lg:grid-cols-6">
        <div class="px-5 py-4">
          <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Total fill-ups</dt>
          <dd class="mt-1 text-2xl font-bold text-ink">{{ total.toLocaleString() }}</dd>
          <dd class="mt-0.5 text-xs text-ink-subtle">matching current filters</dd>
        </div>
        <div class="px-5 py-4">
          <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Total miles</dt>
          <dd class="mt-1 text-2xl font-bold text-ink">{{ fmtNum(totalMiles, 0) }}</dd>
          <dd class="mt-0.5 text-xs text-ink-subtle">driven in selected range</dd>
        </div>
        <div class="px-5 py-4">
          <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Flagged</dt>
          <dd class="mt-1 text-2xl font-bold" :class="flaggedCount ? 'text-danger-600' : 'text-ink-subtle'">{{ flaggedCount }}</dd>
          <dd class="mt-0.5 text-xs" :class="flaggedCount ? 'text-danger-400' : 'text-ink-subtle'">
            {{ flaggedCount ? 'anomalies need review' : 'no anomalies this page' }}
          </dd>
        </div>
        <div class="px-5 py-4">
          <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Clear</dt>
          <dd class="mt-1 text-2xl font-bold" :class="clearCount ? 'text-success-600' : 'text-ink-subtle'">{{ clearCount }}</dd>
          <dd class="mt-0.5 text-xs text-ink-subtle">transactions with no flags</dd>
        </div>
        <div class="px-5 py-4">
          <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Gallons</dt>
          <dd class="mt-1 text-2xl font-bold text-ink">{{ fmtNum(totalGallons, 0) }}</dd>
          <dd class="mt-0.5 text-xs text-ink-subtle">total this page</dd>
        </div>
        <div class="px-5 py-4">
          <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Avg MPG</dt>
          <dd class="mt-1 text-2xl font-bold text-ink">{{ avgMpg != null ? avgMpg.toFixed(1) : '—' }}</dd>
          <dd class="mt-0.5 text-xs text-ink-subtle">{{ hasCost ? fmtUsd(pageCost) + ' total cost' : 'this page' }}</dd>
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
      :row-class="rowClass"
      empty-text="No fill-ups match these filters."
      @sort="onSort"
      @retry="refetch"
      @row-click="onRowClick"
    >
      <template #cell-vehicle_id="{ row }">{{ vehicleLabel(row.vehicle_id) }}</template>
      <template #cell-fueled_at="{ row }">{{ fmtDate(row.fueled_at, row.state ?? null) }}</template>
      <template #cell-trailer="{ row }">{{ trailerForVehicle(row.vehicle_id) ?? "—" }}</template>
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
            v-if="weakSignals(row).length"
            :class="[BADGE_BASE, toneClass('neutral')]"
            class="cursor-help"
            :title="whyTitle(row)"
            >{{ weakSignals(row).length }} weak signal{{ weakSignals(row).length > 1 ? "s" : "" }}</span
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
