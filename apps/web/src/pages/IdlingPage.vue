<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useIdleScores } from "@/features/fleet/useIdleScores";
import { useIdleCapabilities } from "@/features/fleet/useIdleCapabilities";
import { useIdleSettings } from "@/features/fleet/useIdleSettings";
import TableToolbar from "@/components/TableToolbar.vue";
import SortableTh from "@/components/SortableTh.vue";
import TableSkeleton from "@/components/TableSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";
import TablePagination from "@/components/TablePagination.vue";
import { toggleSort, sortRows, type SortState } from "@/lib/sort";

const { data, isLoading, isError, error, refetch, isFetching } = useIdleScores();

const drivers = computed(() => data.value?.drivers ?? []);
const usd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

// ── search + sort + pagination ───────────────────────────────────────────────
const search = ref("");
const activeFilterCount = computed(() => (search.value.trim() ? 1 : 0));
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return q ? drivers.value.filter((d) => d.driverName.toLowerCase().includes(q)) : drivers.value;
});

const sort = ref<SortState>({ key: null, dir: "asc" });
function onSort(key: string) {
  sort.value = toggleSort(sort.value, key);
}
const sorted = computed(() => (sort.value.key ? sortRows(filtered.value, sort.value, (r, k) => (r as unknown as Record<string, unknown>)[k]) : filtered.value));

const PAGE_SIZE = 20;
const page = ref(1);
watch([filtered], () => (page.value = 1));
const paged = computed(() => sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

// Score tone: green ≥80, amber 60–79, red <60.
const scoreTone = (s: number) => (s >= 80 ? "text-green-700" : s >= 60 ? "text-amber-600" : "text-red-700");
const rank = (i: number) => (page.value - 1) * PAGE_SIZE + i + 1;

// ── per-truck idle capability (Phase 2) ──────────────────────────────────────
const { data: caps } = useIdleCapabilities();
const CAP: Record<string, { label: string; cls: string }> = {
  apu: { label: "APU", cls: "bg-green-100 text-green-700" },
  ecu_optimized: { label: "Optimized idle", cls: "bg-green-100 text-green-700" },
  continuous_only: { label: "No optimization", cls: "bg-amber-100 text-amber-700" },
  unknown: { label: "Unknown", cls: "bg-gray-100 text-gray-500" },
};
const capBadge = (c: string) => CAP[c] ?? CAP.unknown!;
const fleetOptimizedPct = computed(() => {
  const rows = caps.value ?? [];
  return rows.length ? Math.round((rows.reduce((s, r) => s + r.idle_optimized_pct, 0) / rows.length) * 10) / 10 : null;
});

// ── comfort band (Phase 3): configured + learned suggestion ─────────────────
const { data: settings } = useIdleSettings();
const suggestionDiffers = computed(() => {
  const s = settings.value;
  return !!s && s.suggested_low_f != null && s.suggested_high_f != null && (s.suggested_low_f !== s.comfort_low_f || s.suggested_high_f !== s.comfort_high_f);
});
</script>

<template>
  <div class="space-y-6">
    <p class="text-sm text-gray-500">
      Avoidable engine idling over the last 30 days, by driver. Idle while PTO is active (work) or in extreme
      temperatures (cab climate) is excluded — only <strong>discretionary</strong> idle (engine running in
      comfortable weather, e.g. sleeping/waiting) counts against the score and the wasted-fuel total.
    </p>

    <!-- Fleet money summary -->
    <div v-if="!isLoading && !isError && data" class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <dt class="text-xs font-medium tracking-wide text-gray-500 uppercase">Wasted on idle (30 d)</dt>
        <dd class="mt-1 text-2xl font-bold text-red-700">{{ usd(data.fleetDiscretionaryCost) }}</dd>
        <dd class="mt-0.5 text-xs text-gray-400">{{ data.fleetDiscretionaryGal.toLocaleString() }} gal of discretionary idle</dd>
      </div>
      <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <dt class="text-xs font-medium tracking-wide text-gray-500 uppercase">Discretionary idle hours</dt>
        <dd class="mt-1 text-2xl font-bold text-gray-900">{{ data.fleetDiscretionaryHours.toLocaleString() }}<span class="text-base font-normal text-gray-400"> / {{ data.fleetIdleHours.toLocaleString() }} total</span></dd>
      </div>
      <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <dt class="text-xs font-medium tracking-wide text-gray-500 uppercase">Projected annual waste</dt>
        <dd class="mt-1 text-2xl font-bold text-gray-900">{{ usd(data.fleetDiscretionaryCost * 12) }}</dd>
        <dd class="mt-0.5 text-xs text-gray-400">at the current 30-day rate</dd>
      </div>
      <div v-if="fleetOptimizedPct != null" class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200 sm:col-span-3">
        <dt class="text-xs font-medium tracking-wide text-gray-500 uppercase">Optimized-idle adoption</dt>
        <dd class="mt-1 text-2xl font-bold text-gray-900">{{ fleetOptimizedPct }}%<span class="text-base font-normal text-gray-400"> of parked time on APU or optimized idle</span></dd>
        <dd class="mt-0.5 text-xs text-gray-400">learned per truck from engine-state park sessions</dd>
      </div>
    </div>

    <!-- Comfort band: what counts as climate-justified idle, + the data-driven suggestion. -->
    <div v-if="settings" class="rounded-lg bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-gray-200">
      <span class="text-gray-500">Comfort band (idle outside it is treated as climate-justified):</span>
      <span class="ml-1 font-medium text-gray-900">{{ settings.comfort_low_f }}–{{ settings.comfort_high_f }}°F</span>
      <span class="ml-1 text-gray-400">· idle ≥ {{ settings.min_idle_minutes }} min scored</span>
      <span v-if="suggestionDiffers" class="ml-2 text-indigo-600">
        · learned from your data: <strong>{{ settings.suggested_low_f }}–{{ settings.suggested_high_f }}°F</strong>
        <span class="text-gray-400">(update idle_settings to adopt, then re-sync)</span>
      </span>
    </div>

    <TableToolbar
      v-model="search"
      title="Driver Idle Scorecard"
      :count="filtered.length"
      search-placeholder="Search driver…"
      :active-filter-count="activeFilterCount"
      @clear="search = ''"
    />

    <div class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <TableSkeleton v-if="isLoading" :cols="8" />
      <ErrorState v-else-if="isError" :message="error instanceof Error ? error.message : 'Failed to load'" :retrying="isFetching" @retry="refetch" />
      <div v-else-if="filtered.length === 0" class="px-6 py-10 text-center text-sm text-gray-500">
        No idle events yet — run a Samsara sync from Settings → Data & Sync to pull idling data.
      </div>
      <template v-else>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 text-sm whitespace-nowrap">
            <thead class="bg-gray-50 text-left text-gray-500">
              <tr>
                <th class="px-4 py-3 font-medium">#</th>
                <th class="px-4 py-3 font-medium">Driver</th>
                <SortableTh label="Score" sort-key="score" :active="sort.key" :dir="sort.dir" th-class="px-4 py-3 font-medium text-right" @sort="onSort" />
                <SortableTh label="$ wasted" sort-key="discretionaryCost" :active="sort.key" :dir="sort.dir" th-class="px-4 py-3 font-medium text-right" @sort="onSort" />
                <SortableTh label="Discretionary hrs" sort-key="discretionaryHours" :active="sort.key" :dir="sort.dir" th-class="px-4 py-3 font-medium text-right" @sort="onSort" />
                <SortableTh label="Total idle hrs" sort-key="totalIdleHours" :active="sort.key" :dir="sort.dir" th-class="px-4 py-3 font-medium text-right" @sort="onSort" />
                <SortableTh label="Discr. %" sort-key="discretionaryPct" :active="sort.key" :dir="sort.dir" th-class="px-4 py-3 font-medium text-right" @sort="onSort" />
                <SortableTh label="Long idles" sort-key="longIdleCount" :active="sort.key" :dir="sort.dir" th-class="px-4 py-3 font-medium text-right" @sort="onSort" />
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr v-for="(d, i) in paged" :key="d.driverId" class="hover:bg-gray-50">
                <td class="px-4 py-3 text-gray-400">{{ rank(i) }}</td>
                <td class="px-4 py-3 font-medium text-gray-900">{{ d.driverName }}</td>
                <td class="px-4 py-3 text-right font-bold tabular-nums" :class="scoreTone(d.score)">{{ d.score }}</td>
                <td class="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">{{ usd2(d.discretionaryCost) }}</td>
                <td class="px-4 py-3 text-right text-gray-700 tabular-nums">{{ d.discretionaryHours }}</td>
                <td class="px-4 py-3 text-right text-gray-500 tabular-nums">{{ d.totalIdleHours }}</td>
                <td class="px-4 py-3 text-right text-gray-700 tabular-nums">{{ d.discretionaryPct }}%</td>
                <td class="px-4 py-3 text-right text-gray-500 tabular-nums">{{ d.longIdleCount }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <TablePagination :page="page" :page-size="PAGE_SIZE" :total="filtered.length" @update:page="page = $event" />
      </template>
    </div>

    <!-- Per-truck idle capability (learned) — trucks with no APU/optimized idle can't avoid some idle. -->
    <div v-if="caps && caps.length" class="rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200">
      <h3 class="mb-3 text-xs font-semibold tracking-wide text-gray-500 uppercase">Truck idle capability · lowest optimized-idle first</h3>
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm whitespace-nowrap">
          <thead class="text-left text-gray-500">
            <tr>
              <th class="px-3 py-2 font-medium">Truck</th>
              <th class="px-3 py-2 font-medium">Capability</th>
              <th class="px-3 py-2 font-medium text-right">Optimized idle %</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="t in caps" :key="t.unit_number" class="hover:bg-gray-50">
              <td class="px-3 py-2 font-medium text-gray-900">{{ t.unit_number }}</td>
              <td class="px-3 py-2"><span :class="['inline-flex rounded px-1.5 py-0.5 text-xs font-semibold', capBadge(t.idle_capability).cls]">{{ capBadge(t.idle_capability).label }}</span></td>
              <td class="px-3 py-2 text-right tabular-nums text-gray-700">{{ t.idle_optimized_pct }}%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
