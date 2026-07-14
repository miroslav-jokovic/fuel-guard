<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { useOdometerMismatches } from "@/features/fleet/useOdometerMismatches";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import TableToolbar from "@/components/TableToolbar.vue";
import VehicleSelect from "@/components/VehicleSelect.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import TablePagination from "@/components/TablePagination.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";

const { data, isLoading, isError, error, refetch, isFetching } = useOdometerMismatches();
const { data: vehicles } = useVehiclesQuery();

const tolerance = computed(() => data.value?.toleranceMiles ?? 10);
const rows = computed(() => data.value?.rows ?? []);
const offenders = computed(() => (data.value?.offenders ?? []).slice(0, 8));

// ── Search + filters (standard toolbar) ──────────────────────────────────────
const search = ref("");
const vehicleId = ref<string | undefined>(undefined);
const from = ref<string | undefined>(undefined);
const to = ref<string | undefined>(undefined);
const activeFilterCount = computed(() => [vehicleId.value, from.value, to.value].filter(Boolean).length + (search.value.trim() ? 1 : 0));
function resetFilters() {
  search.value = "";
  vehicleId.value = undefined;
  from.value = undefined;
  to.value = undefined;
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

// Client-side pagination over the filtered mismatch list (reuses the shared jump-to-page control).
const PAGE_SIZE = 20;
const page = ref(1);
watch([filtered], () => (page.value = 1));
const paged = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
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
  { key: "fueledAt", label: "Date", cellClass: "text-ink-secondary" },
  { key: "unit", label: "Truck", cellClass: "font-medium text-ink" },
  { key: "driverName", label: "Driver", cellClass: "text-ink-secondary" },
  { key: "entered", label: "Entered", numeric: true, cellClass: "text-ink-secondary" },
  { key: "samsara", label: "Samsara", numeric: true, cellClass: "text-ink-secondary" },
  { key: "samsaraOdometerSource", label: "Source" },
  { key: "offset", label: "Offset", numeric: true, cellClass: "text-ink-muted" },
  { key: "diff", label: "Difference", numeric: true },
  { key: "timeBasis", label: "Time basis" },
  { key: "locationConfidence", label: "Location" },
];
</script>

<template>
  <div class="space-y-6">
    <TableToolbar
      v-model="search"
      title="Odometer Mismatches"
      :count="filtered.length"
      :subtitle="`±${tolerance} mi tolerance`"
      search-placeholder="Search truck or driver…"
      :active-filter-count="activeFilterCount"
      @clear="resetFilters"
    >
      <VehicleSelect v-model="vehicleId" :vehicles="vehicles ?? []" />
      <div class="sm:col-span-2 lg:col-span-2">
        <DateRangeFilter :from="from" :to="to" @update:from="(v) => (from = v)" @update:to="(v) => (to = v)" />
      </div>
    </TableToolbar>

    <DataTable
      :columns="columns"
      :rows="paged"
      row-key="id"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load') : null"
      :retrying="isFetching"
      @retry="refetch"
    >
      <template #empty>
        <p>No confirmed odometer mismatches in the last 90 days — either driver entries agree with telematics, or no fills have a confirmed fueling-time odometer yet.</p>
        <p class="mt-1 text-ink-subtle">
          If you just deployed the fueling-time fix, run a <RouterLink to="/settings/data" class="text-brand-600 hover:text-brand-500">Samsara re-sync / backfill</RouterLink>
          to re-anchor odometer readings, then check <RouterLink to="/coverage" class="text-brand-600 hover:text-brand-500">Coverage</RouterLink> to see how many fills could be verified.
        </p>
      </template>
      <template #cell-fueledAt="{ value }">{{ fmtDate(value) }}</template>
      <template #cell-unit="{ row }">
        <RouterLink v-if="row.vehicleId" :to="`/vehicles/${row.vehicleId}`" class="text-brand-600 hover:text-brand-500">{{ row.unit ?? "—" }}</RouterLink>
        <span v-else>{{ row.unit ?? "—" }}</span>
      </template>
      <template #cell-entered="{ value }">{{ fmtOdo(value) }}</template>
      <template #cell-samsara="{ row }">
        {{ fmtOdo(row.samsara) }}
        <div v-if="row.samsaraOdometerAt" class="text-xs font-normal text-ink-subtle">read {{ fmtDateTime(row.samsaraOdometerAt) }}</div>
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

    <!-- Repeat offenders (drivers who most often mis-enter the odometer) — coaching list, not alerts. -->
    <BaseCard v-if="offenders.length > 1" padding="sm">
      <h3 class="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">Repeat offenders · drivers who most often mis-enter the odometer</h3>
      <div class="flex flex-wrap gap-2">
        <span v-for="o in offenders" :key="o.key" class="inline-flex items-center gap-1.5 rounded-full bg-surface-subtle px-3 py-1 text-sm ring-1 ring-edge">
          <span class="font-medium text-ink">{{ o.label }}</span>
          <span class="text-ink-subtle">·</span>
          <span class="text-ink-secondary">{{ o.mismatches }}×</span>
          <span class="text-ink-subtle">·</span>
          <span class="text-ink-secondary">max {{ Math.round(o.maxAbsDiff) }} mi</span>
        </span>
      </div>
    </BaseCard>
  </div>
</template>
