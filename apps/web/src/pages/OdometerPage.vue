<script setup lang="ts">
import { computed, watch } from "vue";
import GatedLink from "@/components/GatedLink.vue";
import { useOdometerMismatches } from "@/features/roster/useOdometerMismatches";
import { useVehiclesQuery } from "@/composables/useVehicles";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import TablePagination from "@/components/TablePagination.vue";
import DataTable from "@/components/ui/DataTable.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import SamsaraFeedLine from "@/components/SamsaraFeedLine.vue";
import { AppCard as BaseCard } from "@silvicom/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { sortRows } from "@/lib/sort";
import { useQueryState } from "@/composables/useQueryState";
import { SORT_DIRECTIONS, useUrlSort } from "@/composables/useUrlSort";
import { formatDate as fmtDate, formatDateTime as fmtDateTime } from "@/lib/format";

const { data, isLoading, isError, error, refetch, isFetching } = useOdometerMismatches();
const { data: vehicles } = useVehiclesQuery();

const tolerance = computed(() => data.value?.toleranceMiles ?? 10);
const rows = computed(() => data.value?.rows ?? []);
const offenders = computed(() => (data.value?.offenders ?? []).slice(0, 8));

// ── Search + filters (standard toolbar) ──────────────────────────────────────
// Filters, sort and page live in the URL (D-US2), so reload, a pasted link and Back from a truck keep
// the list. The vehicle is not checked against a list: the ids arrive with the roster, after the first
// read, and an id that matches nothing narrows to nothing — which the empty state already explains.
const qs = useQueryState();
const search = qs.param("search");
// Filter by vehicle id (what the rows carry) but show unit numbers.
const vehicleFilter = qs.param("vehicle");
const vehicleId = computed(() => vehicleFilter.value || undefined);
/** A hand-edited date that is not a calendar day reads as unset; it is compared as a string below. */
const isoDay = (key: string) => {
  const p = qs.param(key);
  return computed<string | undefined>({
    get: () => (/^\d{4}-\d{2}-\d{2}$/.test(p.value) ? p.value : undefined),
    set: (v) => (p.value = v ?? ""),
  });
};
const from = isoDay("from");
const to = isoDay("to");
const vehicleOptions = computed(() => [
  { value: "", label: "All vehicles" },
  ...[...(vehicles.value ?? [])]
    .sort((a, b) => a.unit_number.localeCompare(b.unit_number))
    .map((v) => ({ value: v.id, label: v.unit_number })),
]);
// The date range is one filter (FilterBar's convention), however many of its ends are set.
const activeFilterCount = computed(() => (vehicleId.value ? 1 : 0) + (from.value || to.value ? 1 : 0) + (search.value.trim() ? 1 : 0));
function resetFilters() {
  qs.set({ search: undefined, vehicle: undefined, from: undefined, to: undefined });
}
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return rows.value.filter((r) => {
    if (vehicleId.value && r.vehicleId !== vehicleId.value) return false;
    const day = r.fueledAt.slice(0, 10);
    if (from.value && day < from.value) return false;
    if (to.value && day > to.value) return false;
    if (q && !(`${r.unit ?? ""}`.toLowerCase().includes(q) || `${r.driverName ?? ""}`.toLowerCase().includes(q))) return false;
    return true;
  });
});

// Sorting — default newest → oldest; headers are clickable to re-sort. "Difference" sorts by magnitude.
// The sort itself is declared under `columns`, which it is checked against; `sorted` reads it lazily.
const getVal = (r: (typeof rows.value)[number], key: string): unknown => {
  if (key === "fueledAt") return r.fueledAt; // ISO strings sort chronologically
  if (key === "unit") return r.unit ?? "";
  if (key === "driverName") return r.driverName ?? "";
  if (key === "entered") return r.entered ?? 0;
  if (key === "samsara") return r.samsara ?? 0;
  if (key === "offset") return r.offset ?? 0;
  if (key === "diff") return r.absDiff ?? 0; // biggest mismatch first
  return (r as unknown as Record<string, unknown>)[key];
};
const sorted = computed(() => sortRows(filtered.value, sort.value, getVal));

const fmtOdo = (n: number) => `${Math.round(n).toLocaleString()} mi`;
const signed = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n).toLocaleString()} mi`;

const BASIS: Record<string, { label: string; cls: string }> = {
  tank_confirmed: { label: "Tank-confirmed", cls: toneClass("success") },
  stop_estimated: { label: "Stop-estimated", cls: toneClass("info") },
  reported: { label: "Reported time", cls: toneClass("warning") },
  date_only: { label: "Date only", cls: toneClass("neutral") },
};
const basis = (b: string | null) => BASIS[b ?? ""] ?? { label: "—", cls: toneClass("neutral") };

const CONF: Record<string, { label: string; cls: string }> = {
  gps_confirmed: { label: "GPS confirmed", cls: "text-success-700" },
  in_state: { label: "In state", cls: "text-success-700" },
  mismatch: { label: "Location mismatch", cls: "text-danger-700" },
  unknown: { label: "Unverified", cls: "text-ink-muted" },
};
const conf = (c: string | null) => CONF[c ?? ""] ?? CONF.unknown!;

// Where the Samsara odometer came from — OBD (ECU, best), GPS (Samsara estimate), or reconstructed
// (rebuilt from the nearest reading + driven distance, lowest confidence).
const SOURCE: Record<string, { label: string; cls: string; title: string }> = {
  obd: { label: "OBD", cls: toneClass("success"), title: "Read from the truck's ECU — most accurate." },
  gps: { label: "GPS", cls: toneClass("info"), title: "Samsara's GPS-derived odometer (no ECU odometer on this truck)." },
  reconstructed: { label: "Est.", cls: toneClass("warning"), title: "Reconstructed from the nearest reading + driven distance — lowest confidence." },
};
const source = (s: string | null) => SOURCE[s ?? ""] ?? { label: "—", cls: toneClass("neutral"), title: "Unknown source" };

const columns: DataTableColumn[] = [
  { key: "fueledAt", label: "Date", sortable: true, cellClass: "text-ink-secondary" },
  { key: "unit", label: "Truck", sortable: true, cellClass: "font-medium text-ink" },
  { key: "driverName", label: "Driver", sortable: true, cellClass: "text-ink-secondary" },
  { key: "entered", label: "Entered", sortable: true, numeric: true, cellClass: "text-ink-secondary" },
  { key: "samsara", label: "Samsara", sortable: true, numeric: true, cellClass: "text-ink-secondary" },
  { key: "samsaraOdometerSource", label: "Source" },
  { key: "offset", label: "Offset", sortable: true, numeric: true, cellClass: "text-ink-muted" },
  { key: "diff", label: "Difference", sortable: true, numeric: true },
  { key: "timeBasis", label: "Time basis" },
  { key: "locationConfidence", label: "Location" },
];
// The default (newest first) is the fallback of both parameters, so a plain link opens on it and it
// never reaches the URL. The third click on Date — "no sort" — is still a state of its own: choosing
// "" against a fallback writes `any` for both, which reads back as unsorted rather than snapping back
// to newest-first (D-US2).
const { sort, onSort } = useUrlSort(
  qs.param("sort", columns.filter((c) => c.sortable).map((c) => c.key), "fueledAt"),
  qs.param("dir", SORT_DIRECTIONS, "desc"),
);

// Client-side pagination over the filtered mismatch list (reuses the shared jump-to-page control).
const PAGE_SIZE = 20;
const page = qs.page();
// On the inputs, not on `filtered`: `filtered` also changes when the readings arrive, and watching it
// would throw a pasted `?page=2` away the moment the list loaded (D-US2).
watch([search, vehicleFilter, from, to, () => sort.value.key, () => sort.value.dir], () => (page.value = 1));
const paged = computed(() => sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

</script>

<template>
  <div class="space-y-6">
    <PageHeader :description="`Driver-entered odometer readings that disagree with Samsara (±${tolerance} mi tolerance).`" />

    <!-- SAM-S5: how current the telematics behind this page is, before its numbers are believed.
         `samsara_odometer_at` is stamped by the per-fill recon path (scoring/persist.ts), not by the
         daily odometer tier — this table is empty for a fill telematics has not reached. -->
    <SamsaraFeedLine :feeds="['telematics']" />

    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search truck or driver…"
        :count="filtered.length"
        count-label="readings"
        :active-count="activeFilterCount"
        @clear-all="resetFilters"
      >
      <template #filters>
        <FilterSelect v-model="vehicleFilter" label="Vehicle" :options="vehicleOptions" />
        <DateRangeFilter v-model:from="from" v-model:to="to" />
      </template>
      </FilterBar>

      <DataTable
        embedded
        :columns="columns"
        :rows="paged"
        row-key="id"
        :loading="isLoading"
        :error="isError ? (error instanceof Error ? error.message : 'Failed to load') : null"
        :retrying="isFetching"
        :sort="sort"
        @sort="onSort($event)"
        @retry="refetch"
      >
      <template #empty>
        <p>No confirmed odometer mismatches in the last 90 days — either driver entries agree with telematics, or no fills have a confirmed fueling-time odometer yet.</p>
        <p class="mt-1 text-ink-tertiary">
          <!-- Both are Settings screens that start off for everyone but the admin (Q-SET2); SP5 makes them text where they do not open. -->
          If you just deployed the fueling-time fix, run a <GatedLink to="/settings/data" class="text-link hover:text-link-hover">Samsara re-sync / backfill</GatedLink>
          to re-anchor odometer readings, then check <GatedLink to="/coverage" class="text-link hover:text-link-hover">Coverage</GatedLink> to see how many fills could be verified.
        </p>
      </template>
      <template #cell-fueledAt="{ value }">{{ fmtDate(value) }}</template>
      <template #cell-unit="{ row }">
        <GatedLink v-if="row.vehicleId" :to="`/vehicles/${row.vehicleId}`" class="text-link hover:text-link-hover">{{ row.unit ?? "—" }}</GatedLink>
        <span v-else>{{ row.unit ?? "—" }}</span>
      </template>
      <template #cell-entered="{ value }">{{ fmtOdo(value) }}</template>
      <template #cell-samsara="{ row }">
        {{ fmtOdo(row.samsara) }}
        <div v-if="row.samsaraOdometerAt" class="text-xs font-normal text-ink-tertiary">read {{ fmtDateTime(row.samsaraOdometerAt) }}</div>
      </template>
      <template #cell-samsaraOdometerSource="{ value }">
        <span :class="[BADGE_BASE, source(value).cls]" :title="source(value).title">{{ source(value).label }}</span>
      </template>
      <template #cell-offset="{ value }">{{ value ? signed(value) : "—" }}</template>
      <template #cell-diff="{ row }">
        <span class="font-semibold" :class="Math.abs(row.diff) > tolerance * 3 ? 'text-danger-700' : 'text-warning-600'">{{ signed(row.diff) }}</span>
      </template>
      <template #cell-timeBasis="{ value }">
        <span :class="[BADGE_BASE, basis(value).cls]">{{ basis(value).label }}</span>
      </template>
      <template #cell-locationConfidence="{ value }">
        <span class="text-xs font-semibold" :class="conf(value).cls">{{ conf(value).label }}</span>
      </template>
      <template #footer>
        <TablePagination :page="page" :page-size="PAGE_SIZE" :total="filtered.length" @update:page="page = $event" />
      </template>
      </DataTable>
    </DataWorkspace>

    <!-- Repeat offenders (drivers who most often mis-enter the odometer) — coaching list, not alerts. -->
    <BaseCard v-if="offenders.length > 1" padding="sm">
      <h3 class="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">Repeat offenders · drivers who most often mis-enter the odometer</h3>
      <div class="flex flex-wrap gap-2">
        <span v-for="o in offenders" :key="o.key" class="inline-flex items-center gap-1.5 rounded-full bg-surface-subtle px-3 py-1 text-sm ring-1 ring-edge">
          <span class="font-medium text-ink">{{ o.label }}</span>
          <span class="text-ink-tertiary">·</span>
          <span class="text-ink-secondary">{{ o.mismatches }}×</span>
          <span class="text-ink-tertiary">·</span>
          <span class="text-ink-secondary">max {{ Math.round(o.maxAbsDiff) }} mi</span>
        </span>
      </div>
    </BaseCard>
  </div>
</template>
