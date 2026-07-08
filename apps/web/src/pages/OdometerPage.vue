<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { useOdometerMismatches } from "@/features/fleet/useOdometerMismatches";
import TableSkeleton from "@/components/TableSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";
import TablePagination from "@/components/TablePagination.vue";

const { data, isLoading, isError, error, refetch, isFetching } = useOdometerMismatches();

const tolerance = computed(() => data.value?.toleranceMiles ?? 10);
const rows = computed(() => data.value?.rows ?? []);
const offenders = computed(() => (data.value?.offenders ?? []).slice(0, 5));

// Client-side pagination over the computed mismatch list (reuses the shared jump-to-page control).
const PAGE_SIZE = 20;
const page = ref(1);
watch(rows, () => (page.value = 1));
const paged = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtOdo = (n: number) => `${Math.round(n).toLocaleString()} mi`;
const signed = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n).toLocaleString()} mi`;

const BASIS: Record<string, { label: string; cls: string }> = {
  tank_confirmed: { label: "Tank-confirmed", cls: "bg-green-100 text-green-700" },
  stop_estimated: { label: "Stop-estimated", cls: "bg-blue-100 text-blue-700" },
  reported: { label: "Reported time", cls: "bg-amber-100 text-amber-700" },
  date_only: { label: "Date only", cls: "bg-gray-100 text-gray-600" },
};
const basis = (b: string | null) => BASIS[b ?? ""] ?? { label: "—", cls: "bg-gray-100 text-gray-500" };

const CONF: Record<string, { label: string; cls: string }> = {
  gps_confirmed: { label: "GPS confirmed", cls: "text-green-700" },
  in_state: { label: "In state", cls: "text-green-700" },
  mismatch: { label: "Location mismatch", cls: "text-red-700" },
  unknown: { label: "Unverified", cls: "text-gray-500" },
};
const conf = (c: string | null) => CONF[c ?? ""] ?? CONF.unknown!;
</script>

<template>
  <div class="space-y-6">
    <p class="text-sm text-gray-500">
      <strong>What this shows:</strong> fuel-ups where the odometer the <em>driver typed at the pump</em>
      disagrees with the truck's <em>actual OBD odometer at that same moment</em> by more than ±{{ tolerance }} mi
      (after each truck's learned dash↔OBD calibration). A large or repeated gap means the entered reading is
      wrong — an honest fat-finger, or a driver misreporting mileage to mask fuel use. It's a review list, not
      an alert: start with the <strong>repeat offenders</strong> below and the biggest differences.
    </p>
    <p class="-mt-4 text-xs text-gray-400">
      Only fills where telematics captured the odometer <em>at the confirmed fueling moment</em> (a tank-fill
      event or an at-station stop, shown as the "read" time) are compared — fills we can't pin to the fueling
      moment are left out entirely rather than compared against a wrong-time reading. Coverage of what could
      and couldn't be verified lives on the <RouterLink to="/coverage" class="text-indigo-600 hover:text-indigo-500">Coverage</RouterLink> page.
    </p>

    <div v-if="!isLoading && !isError && data" class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <dt class="text-xs font-medium uppercase tracking-wide text-gray-500">Mismatched fills</dt>
        <dd class="mt-1 text-2xl font-bold text-gray-900">{{ rows.length.toLocaleString() }}<span class="text-base font-normal text-gray-400"> / {{ data.checked.toLocaleString() }} checked</span></dd>
      </div>
      <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <dt class="text-xs font-medium uppercase tracking-wide text-gray-500">Tolerance</dt>
        <dd class="mt-1 text-2xl font-bold text-gray-900">±{{ tolerance }} mi</dd>
        <dd class="mt-0.5 text-xs text-gray-400">configured in Settings → Thresholds</dd>
      </div>
      <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <dt class="text-xs font-medium uppercase tracking-wide text-gray-500">Top repeat driver</dt>
        <dd class="mt-1 text-2xl font-bold text-gray-900">{{ offenders[0]?.label ?? "—" }}</dd>
        <dd v-if="offenders[0]" class="mt-0.5 text-xs text-gray-400">{{ offenders[0].mismatches }} mismatches · max {{ Math.round(offenders[0].maxAbsDiff) }} mi</dd>
      </div>
    </div>

    <!-- Repeat offenders -->
    <div v-if="offenders.length > 1" class="rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200">
      <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Repeat offenders (drivers)</h3>
      <div class="flex flex-wrap gap-2">
        <span v-for="o in offenders" :key="o.key" class="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-3 py-1 text-sm ring-1 ring-gray-200">
          <span class="font-medium text-gray-900">{{ o.label }}</span>
          <span class="text-gray-400">·</span>
          <span class="text-gray-600">{{ o.mismatches }}×</span>
          <span class="text-gray-400">·</span>
          <span class="text-gray-600">max {{ Math.round(o.maxAbsDiff) }} mi</span>
        </span>
      </div>
    </div>

    <div class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <TableSkeleton v-if="isLoading" :cols="9" />
      <ErrorState v-else-if="isError" :message="error instanceof Error ? error.message : 'Failed to load'" :retrying="isFetching" @retry="refetch" />
      <div v-else-if="rows.length === 0" class="px-6 py-10 text-center text-sm text-gray-500">
        <p>No confirmed odometer mismatches in the last 90 days — either driver entries agree with telematics, or no fills have a confirmed fueling-time odometer yet.</p>
        <p class="mt-1 text-gray-400">
          If you just deployed the fueling-time fix, run a <RouterLink to="/settings/data" class="text-indigo-600 hover:text-indigo-500">Samsara re-sync / backfill</RouterLink>
          to re-anchor odometer readings, then check <RouterLink to="/coverage" class="text-indigo-600 hover:text-indigo-500">Coverage</RouterLink> to see how many fills could be verified.
        </p>
      </div>
      <template v-else>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 whitespace-nowrap text-sm">
            <thead class="text-left text-gray-500">
              <tr>
                <th class="px-4 py-3 font-medium">Date</th>
                <th class="px-4 py-3 font-medium">Truck</th>
                <th class="px-4 py-3 font-medium">Driver</th>
                <th class="px-4 py-3 font-medium text-right">Entered</th>
                <th class="px-4 py-3 font-medium text-right">Samsara</th>
                <th class="px-4 py-3 font-medium text-right">Offset</th>
                <th class="px-4 py-3 font-medium text-right">Difference</th>
                <th class="px-4 py-3 font-medium">Time basis</th>
                <th class="px-4 py-3 font-medium">Location</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr v-for="r in paged" :key="r.id">
                <td class="px-4 py-3 text-gray-700">{{ fmtDate(r.fueledAt) }}</td>
                <td class="px-4 py-3 font-medium text-gray-900">
                  <RouterLink v-if="r.vehicleId" :to="`/vehicles/${r.vehicleId}`" class="text-indigo-600 hover:text-indigo-500">{{ r.unit ?? "—" }}</RouterLink>
                  <span v-else>{{ r.unit ?? "—" }}</span>
                </td>
                <td class="px-4 py-3 text-gray-700">{{ r.driverName ?? "—" }}</td>
                <td class="px-4 py-3 text-right text-gray-700">{{ fmtOdo(r.entered) }}</td>
                <td class="px-4 py-3 text-right text-gray-700">
                  {{ fmtOdo(r.samsara) }}
                  <div v-if="r.samsaraOdometerAt" class="text-xs font-normal text-gray-400">read {{ fmtDateTime(r.samsaraOdometerAt) }}</div>
                </td>
                <td class="px-4 py-3 text-right text-gray-500">{{ r.offset ? signed(r.offset) : "—" }}</td>
                <td class="px-4 py-3 text-right font-semibold" :class="Math.abs(r.diff) > tolerance * 3 ? 'text-red-700' : 'text-amber-600'">{{ signed(r.diff) }}</td>
                <td class="px-4 py-3"><span :class="['inline-flex rounded px-1.5 py-0.5 text-xs font-semibold', basis(r.timeBasis).cls]">{{ basis(r.timeBasis).label }}</span></td>
                <td class="px-4 py-3 text-xs font-semibold" :class="conf(r.locationConfidence).cls">{{ conf(r.locationConfidence).label }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" @update:page="page = $event" />
      </template>
    </div>
  </div>
</template>
