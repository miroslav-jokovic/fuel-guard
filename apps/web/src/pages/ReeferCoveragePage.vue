<script setup lang="ts">
import { computed, ref } from "vue";
import { useReeferCoverage } from "@/features/fuel/useReeferCoverage";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import { useTrailersQuery } from "@/features/fleet/useTrailers";
import { useDriversQuery } from "@/features/fleet/useDrivers";
import TableToolbar from "@/components/TableToolbar.vue";
import AppSelect from "@/components/AppSelect.vue";
import TableSkeleton from "@/components/TableSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";

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
  if (list.length === 0) return { text: "unpaired", tone: "text-amber-600", title: "No reefer trailer is assigned to this truck in the fleet list." };
  if (list.length === 1) return { text: list[0]!.unit_number, tone: "text-gray-900 font-medium", title: "Reefer trailer currently paired to this truck." };
  return {
    text: list.map((t) => t.unit_number).join(", "),
    tone: "text-amber-600 font-medium",
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
  if (m == null) return "text-gray-700";
  if (pct < m * 0.4) return "text-amber-600"; // much less reefer than peers
  if (pct > m * 2) return "text-cyan-700"; // much more reefer than peers
  return "text-gray-700";
}
function staleTone(days: number | null): string {
  return days != null && days > 7 ? "text-amber-600 font-medium" : "text-gray-700";
}
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

    <div class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <TableSkeleton v-if="isLoading" :cols="10" />
      <ErrorState v-else-if="isError" :message="error instanceof Error ? error.message : 'Failed to load'" :retrying="isFetching" @retry="refetch" />
      <div v-else-if="active.length === 0" class="px-6 py-10 text-center text-sm text-gray-500">
        No reefer (ULSR) fuel purchases in the last 90 days.
      </div>
      <div v-else class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 whitespace-nowrap text-sm">
          <thead class="text-left text-gray-500">
            <tr>
              <th class="px-4 py-3 font-medium">Truck</th>
              <th class="px-4 py-3 font-medium">Reefer trailer</th>
              <th class="px-4 py-3 font-medium text-right">Tank cap</th>
              <th class="px-4 py-3 font-medium text-right">Reefer gal</th>
              <th class="px-4 py-3 font-medium text-right">Fills</th>
              <th class="px-4 py-3 font-medium text-right">Avg / fill</th>
              <th class="px-4 py-3 font-medium text-right">Reefer spend</th>
              <th class="px-4 py-3 font-medium text-right">Share</th>
              <th class="px-4 py-3 font-medium text-right">vs fleet</th>
              <th class="px-4 py-3 font-medium text-right">Cadence</th>
              <th class="px-4 py-3 font-medium">Last reefer</th>
              <th class="px-4 py-3 font-medium text-right">Days since</th>
              <th class="px-4 py-3 font-medium">Primary driver</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="t in active" :key="t.vehicleId">
              <td class="px-4 py-3 font-medium text-gray-900">{{ unit(t.vehicleId) }}</td>
              <td class="px-4 py-3" :class="trailerFor(t.vehicleId).tone" :title="trailerFor(t.vehicleId).title">{{ trailerFor(t.vehicleId).text }}</td>
              <td class="px-4 py-3 text-right text-gray-700">{{ tankCapFor(t.vehicleId) != null ? tankCapFor(t.vehicleId) + " gal" : "—" }}</td>
              <td class="px-4 py-3 text-right text-gray-700">{{ t.reeferGal.toLocaleString() }}</td>
              <td class="px-4 py-3 text-right text-gray-700">{{ t.reeferFills }}</td>
              <td class="px-4 py-3 text-right text-gray-700">{{ t.avgGalPerFill.toLocaleString() }}</td>
              <td class="px-4 py-3 text-right text-gray-700">{{ usd(t.reeferSpend) }}</td>
              <td class="px-4 py-3 text-right font-medium" :class="shareTone(t.reeferSharePct)">{{ t.reeferSharePct }}%</td>
              <td class="px-4 py-3 text-right text-gray-500">
                <span v-if="median != null">{{ t.reeferSharePct > median ? "+" : "" }}{{ Math.round(t.reeferSharePct - median) }} pts</span>
                <span v-else>—</span>
              </td>
              <td class="px-4 py-3 text-right text-gray-700">{{ t.avgCadenceDays != null ? "~" + t.avgCadenceDays + "d" : "—" }}</td>
              <td class="px-4 py-3 text-gray-700">{{ shortDate(t.lastReeferAt) }}</td>
              <td class="px-4 py-3 text-right" :class="staleTone(t.daysSinceReefer)">{{ t.daysSinceReefer ?? "—" }}</td>
              <td class="px-4 py-3 text-gray-700">{{ driverName(t.primaryDriverId) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
