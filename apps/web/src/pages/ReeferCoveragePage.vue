<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import { useReeferCoverage } from "@/features/fuel/useReeferCoverage";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import { useTrailersQuery } from "@/features/fleet/useTrailers";
import { useDriversQuery } from "@/features/fleet/useDrivers";
import TableToolbar from "@/components/TableToolbar.vue";
import AppSelect from "@/components/AppSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";

const { data, isLoading, isError, error, refetch, isFetching } = useReeferCoverage();
const { data: vehicles } = useVehiclesQuery();
const { data: trailers } = useTrailersQuery();
const { data: drivers } = useDriversQuery();

const unit = (id: string) => vehicles.value?.find((v) => v.id === id)?.unit_number ?? id;
const driverName = (id: string | null) => (id ? (drivers.value?.find((d) => d.id === id)?.full_name ?? "—") : "—");
const median = computed(() => data.value?.fleetMedianSharePct ?? null);

// Only reefer-active trucks (bought ULSR in the window). Sorted by reefer gallons (from the aggregator).
const activeAll = computed(() => (data.value?.perTruck ?? []).filter((t) => t.reeferActive));

/**
 * Reefer trailers CURRENTLY paired to each truck (Samsara/manual assignment). Keyed by vehicle id.
 * This is the present pairing, not the pairing at each historical fill — so it identifies the likely
 * trailer, and flags the ambiguous case (2+ reefers) where fuel can't be attributed to one trailer.
 */
const reefersByVehicle = computed(() => {
  const map = new Map<string, { unit_number: string; reefer_tank_capacity_gal: number }[]>();
  for (const tr of trailers.value ?? []) {
    if (!tr.is_reefer || tr.status === "retired" || !tr.assigned_vehicle_id) continue;
    const list = map.get(tr.assigned_vehicle_id) ?? [];
    list.push({ unit_number: tr.unit_number, reefer_tank_capacity_gal: Number(tr.reefer_tank_capacity_gal) });
    map.set(tr.assigned_vehicle_id, list);
  }
  return map;
});

/** Trailer identity cell: the paired reefer's unit #, "unpaired" when none, or ambiguous when 2+. */
function trailerFor(vehicleId: string): { text: string; tone: string; title: string } {
  const list = reefersByVehicle.value.get(vehicleId) ?? [];
  if (list.length === 0) return { text: "unpaired", tone: "text-warning-600", title: "No reefer trailer is assigned to this truck in the fleet list." };
  if (list.length === 1) return { text: list[0]!.unit_number, tone: "text-ink font-medium", title: "Reefer trailer currently paired to this truck." };
  return {
    text: list.map((t) => t.unit_number).join(", "),
    tone: "text-warning-600 font-medium",
    title: "Multiple reefer trailers are assigned — fuel can't be attributed to one trailer, so the reefer capacity checks stay off for this truck.",
  };
}
/** Tank capacity only when the pairing is unambiguous (exactly one reefer trailer). */
function tankCapFor(vehicleId: string): number | null {
  const list = reefersByVehicle.value.get(vehicleId) ?? [];
  return list.length === 1 ? list[0]!.reefer_tank_capacity_gal : null;
}

// ── Search + pairing filter (standard toolbar) ───────────────────────────────
const search = ref("");
const pairing = ref<string | undefined>(undefined); // 'paired' | 'unpaired' | 'ambiguous'
const pairingOf = (vehicleId: string) => {
  const n = (reefersByVehicle.value.get(vehicleId) ?? []).length;
  return n === 0 ? "unpaired" : n === 1 ? "paired" : "ambiguous";
};
// True once at least one reefer-active truck has a reefer trailer paired to it. When false, the pairing data
// is missing entirely (no Samsara auto-pairing + nothing assigned manually) — surface how to fix it.
const anyReeferPaired = computed(() => activeAll.value.some((t) => reefersByVehicle.value.has(t.vehicleId)));
const activeFilterCount = computed(() => (pairing.value ? 1 : 0) + (search.value.trim() ? 1 : 0));
function resetFilters() {
  search.value = "";
  pairing.value = undefined;
}
const active = computed(() => {
  const q = search.value.trim().toLowerCase();
  return activeAll.value.filter((t) => {
    if (pairing.value && pairingOf(t.vehicleId) !== pairing.value) return false;
    if (q) {
      const hay = `${unit(t.vehicleId)} ${trailerFor(t.vehicleId).text} ${driverName(t.primaryDriverId)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
});

const usd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

/** Flag trucks whose reefer share is far from the fleet baseline (informational, not an alert). */
function shareTone(pct: number): string {
  const m = median.value;
  if (m == null) return "text-ink-secondary";
  if (pct < m * 0.4) return "text-warning-600"; // much less reefer than peers
  if (pct > m * 2) return "text-info-700"; // much more reefer than peers
  return "text-ink-secondary";
}
function staleTone(days: number | null): string {
  return days != null && days > 7 ? "text-warning-600 font-medium" : "text-ink-secondary";
}

const columns: DataTableColumn[] = [
  { key: "vehicleId", label: "Truck", cellClass: "font-medium text-ink" },
  { key: "trailer", label: "Reefer trailer" },
  { key: "tankCap", label: "Tank cap", numeric: true, cellClass: "text-ink-secondary" },
  { key: "reeferGal", label: "Reefer gal", numeric: true, cellClass: "text-ink-secondary" },
  { key: "reeferFills", label: "Fills", numeric: true, cellClass: "text-ink-secondary" },
  { key: "avgGalPerFill", label: "Avg / fill", numeric: true, cellClass: "text-ink-secondary" },
  { key: "reeferSpend", label: "Reefer spend", numeric: true, cellClass: "text-ink-secondary" },
  { key: "reeferSharePct", label: "Share", numeric: true },
  { key: "vsFleet", label: "vs fleet", numeric: true, cellClass: "text-ink-muted" },
  { key: "avgCadenceDays", label: "Cadence", numeric: true, cellClass: "text-ink-secondary" },
  { key: "lastReeferAt", label: "Last reefer", cellClass: "text-ink-secondary" },
  { key: "daysSinceReefer", label: "Days since", numeric: true },
  { key: "primaryDriverId", label: "Primary driver", cellClass: "text-ink-secondary" },
];
</script>

<template>
  <div class="space-y-6">
    <TableToolbar
      v-model="search"
      title="Reefer Coverage"
      :count="active.length"
      :subtitle="median != null ? `fleet median ${median}% reefer share` : null"
      search-placeholder="Search truck, trailer or driver…"
      :active-filter-count="activeFilterCount"
      @clear="resetFilters"
    >
      <AppSelect
        v-model="pairing"
        :options="[
          { value: undefined, label: 'All pairings' },
          { value: 'paired', label: 'Paired (1 reefer)' },
          { value: 'unpaired', label: 'Unpaired' },
          { value: 'ambiguous', label: 'Ambiguous (2+ reefers)' },
        ]"
      />
    </TableToolbar>

    <!-- No reefer↔truck pairing data at all → tell the user how to establish it. -->
    <div v-if="!isLoading && !isError && activeAll.length && !anyReeferPaired" class="rounded-lg bg-warning-50 px-4 py-3 text-sm text-warning-800 ring-1 ring-warning-200">
      <p class="font-medium">No reefer trailers are paired to trucks yet.</p>
      <p class="mt-0.5 text-warning-700">
        Reefer fuel can't be attributed to a specific trailer until each reefer is identified and paired. On the
        <RouterLink to="/trailers" class="font-medium underline">Trailers</RouterLink> page, mark each refrigerated
        trailer as a reefer and set its paired tractor. Samsara auto-pairs trailers that have a powered Asset
        Gateway; trucks/reefers without one must be paired manually here.
      </p>
    </div>

    <DataTable
      :columns="columns"
      :rows="active"
      row-key="vehicleId"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load') : null"
      :retrying="isFetching"
      empty-text="No reefer (ULSR) fuel purchases in the last 90 days."
      @retry="refetch"
    >
      <template #cell-vehicleId="{ row }">{{ unit(row.vehicleId) }}</template>
      <template #cell-trailer="{ row }">
        <span :class="trailerFor(row.vehicleId).tone" :title="trailerFor(row.vehicleId).title">{{ trailerFor(row.vehicleId).text }}</span>
      </template>
      <template #cell-tankCap="{ row }">{{ tankCapFor(row.vehicleId) != null ? tankCapFor(row.vehicleId) + " gal" : "—" }}</template>
      <template #cell-reeferGal="{ value }">{{ value.toLocaleString() }}</template>
      <template #cell-avgGalPerFill="{ value }">{{ value.toLocaleString() }}</template>
      <template #cell-reeferSpend="{ value }">{{ usd(value) }}</template>
      <template #cell-reeferSharePct="{ value }">
        <span class="font-medium" :class="shareTone(value)">{{ value }}%</span>
      </template>
      <template #cell-vsFleet="{ row }">
        <span v-if="median != null">{{ row.reeferSharePct > median ? "+" : "" }}{{ Math.round(row.reeferSharePct - median) }} pts</span>
        <span v-else>—</span>
      </template>
      <template #cell-avgCadenceDays="{ value }">{{ value != null ? "~" + value + "d" : "—" }}</template>
      <template #cell-lastReeferAt="{ value }">{{ shortDate(value) }}</template>
      <template #cell-daysSinceReefer="{ value }">
        <span :class="staleTone(value)">{{ value ?? "—" }}</span>
      </template>
      <template #cell-primaryDriverId="{ row }">{{ driverName(row.primaryDriverId) }}</template>
    </DataTable>
  </div>
</template>
