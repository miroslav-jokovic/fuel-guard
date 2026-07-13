<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useIdleScores } from "@/features/fleet/useIdleScores";
import { useIdleCapabilities } from "@/features/fleet/useIdleCapabilities";
import { useIdleSettings } from "@/features/fleet/useIdleSettings";
import { useLongIdles } from "@/features/fleet/useLongIdles";
import TableToolbar from "@/components/TableToolbar.vue";
import SortableTh from "@/components/SortableTh.vue";
import TableSkeleton from "@/components/TableSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";
import TablePagination from "@/components/TablePagination.vue";
import { toggleSort, sortRows, type SortState } from "@/lib/sort";
import { APU_TYPE_LABELS, type ApuType } from "@fuelguard/shared";

const usd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const dateFmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const PAGE_SIZE = 20;

// Data sources.
const { data, isLoading, isError, error, refetch, isFetching } = useIdleScores();
const { data: caps } = useIdleCapabilities();
const { data: longIdles } = useLongIdles();
const { data: settings } = useIdleSettings();

const drivers = computed(() => data.value?.drivers ?? []);

// Capability badge styling (shared by the capability + avoidable tabs).
const CAP: Record<string, { label: string; cls: string }> = {
  apu: { label: "APU", cls: "bg-green-100 text-green-700" },
  ecu_optimized: { label: "Optimized idle", cls: "bg-green-100 text-green-700" },
  continuous_only: { label: "Continuous idle only", cls: "bg-amber-100 text-amber-700" },
  unknown: { label: "Unknown", cls: "bg-gray-100 text-gray-500" },
};
const capBadge = (c: string) => CAP[c] ?? CAP.unknown!;

// Equipment badge for the "Biggest idle events to coach" list (from the shared topAvoidableIdles equipment).
const EQUIP: Record<string, { label: string; cls: string; title: string }> = {
  apu: { label: "Engine off was possible (APU)", cls: "bg-red-100 text-red-700", title: "This truck has an APU — the driver could have shut the main engine off and run it" },
  optimized_idle: { label: "Optimized idle (OEM)", cls: "bg-green-100 text-green-700", title: "OEM optimized idle cycles the engine on purpose — the engine running is the feature working, not driver waste" },
  none: { label: "No idle-reduction equipment", cls: "bg-gray-100 text-gray-500", title: "No APU or optimized idle — the main engine was the only way to keep the cab comfortable" },
  unknown: { label: "Equipment not recorded — set it", cls: "bg-amber-50 text-amber-700", title: "Set this truck's equipment on the Vehicles page to enable coaching" },
};
const equipBadge = (e: string) => EQUIP[e] ?? EQUIP.unknown!;

// ── tabs ─────────────────────────────────────────────────────────────────────
type TabKey = "drivers" | "avoidable" | "capability";
const activeTab = ref<TabKey>("drivers");
const tabs = computed(() => [
  { key: "drivers" as const, label: "Drivers", count: drivers.value.length },
  { key: "avoidable" as const, label: "Avoidable idles", count: longIdles.value?.length ?? 0 },
  { key: "capability" as const, label: "Truck capability", count: caps.value?.length ?? 0 },
]);

// ── collapsible "how scoring works" panel (replaces the always-on top blurb) ──
const showInfo = ref(false);
const suggestionDiffers = computed(() => {
  const s = settings.value;
  return !!s && s.suggested_low_f != null && s.suggested_high_f != null && (s.suggested_low_f !== s.comfort_low_f || s.suggested_high_f !== s.comfort_high_f);
});
const fleetOptimizedPct = computed(() => {
  // Average only over trucks with a KNOWN learned capability (exclude 'unknown' so the metric isn't diluted
  // by trucks we couldn't classify yet).
  const rows = (caps.value ?? []).filter((r) => r.idle_capability !== "unknown");
  return rows.length ? Math.round((rows.reduce((s, r) => s + r.idle_optimized_pct, 0) / rows.length) * 10) / 10 : null;
});

// Recorded idle-reduction equipment (capability tab): the equipment type + an optimized-idle chip.
const recordedLabel = (t: { has_apu: boolean | null; apu_type: string | null }) =>
  t.apu_type && t.apu_type !== "none" ? APU_TYPE_LABELS[t.apu_type as ApuType] ?? "APU" : t.has_apu === true ? "APU" : t.has_apu === false || t.apu_type === "none" ? "None" : "Unknown";
const recordedCls = (t: { has_apu: boolean | null }) =>
  t.has_apu === true ? "bg-green-100 text-green-700" : t.has_apu === false ? "bg-gray-100 text-gray-500" : "bg-amber-50 text-amber-700";
const XCHECK: Record<string, { label: string; cls: string; title: string }> = {
  agree: { label: "Matches", cls: "text-green-600", title: "The data matches the recorded equipment" },
  disagree: { label: "Doesn't match", cls: "text-red-600", title: "The data disagrees with the recorded equipment — worth a look" },
  na: { label: "–", cls: "text-gray-300", title: "Not enough data to compare" },
};
const xcheck = (c: string) => XCHECK[c] ?? XCHECK.na!;

// ── tab 1: driver scorecard ──────────────────────────────────────────────────
const scoreTone = (s: number) => (s >= 80 ? "text-green-700" : s >= 60 ? "text-amber-600" : "text-red-700");
const TREND: Record<string, { icon: string; cls: string; title: string }> = {
  down: { icon: "▼", cls: "text-green-600", title: "Improving — less avoidable idle than the prior week" },
  up: { icon: "▲", cls: "text-red-600", title: "Worsening — more avoidable idle than the prior week" },
  flat: { icon: "▬", cls: "text-gray-400", title: "About the same as the prior week" },
  na: { icon: "–", cls: "text-gray-300", title: "Not enough recent data" },
};
const trendCell = (t: string) => TREND[t] ?? TREND.na!;

const drvSearch = ref("");
const drvSort = ref<SortState>({ key: null, dir: "asc" });
const drvPage = ref(1);
const drvFilterCount = computed(() => (drvSearch.value.trim() ? 1 : 0));
const drvFiltered = computed(() => {
  const q = drvSearch.value.trim().toLowerCase();
  return q ? drivers.value.filter((d) => d.driverName.toLowerCase().includes(q)) : drivers.value;
});
const drvSorted = computed(() => (drvSort.value.key ? sortRows(drvFiltered.value, drvSort.value, (r, k) => (r as unknown as Record<string, unknown>)[k]) : drvFiltered.value));
const drvPaged = computed(() => drvSorted.value.slice((drvPage.value - 1) * PAGE_SIZE, drvPage.value * PAGE_SIZE));
const drvRank = (i: number) => (drvPage.value - 1) * PAGE_SIZE + i + 1;
watch(drvFiltered, () => (drvPage.value = 1));

// ── tab 2: longest avoidable idles ───────────────────────────────────────────
const avSearch = ref("");
const avAvoidableOnly = ref(false);
const avSort = ref<SortState>({ key: null, dir: "asc" });
const avPage = ref(1);
const avFilterCount = computed(() => (avSearch.value.trim() ? 1 : 0) + (avAvoidableOnly.value ? 1 : 0));
const avFiltered = computed(() => {
  const q = avSearch.value.trim().toLowerCase();
  return (longIdles.value ?? []).filter(
    (r) =>
      (!avAvoidableOnly.value || r.avoidable) &&
      (!q || r.driverName.toLowerCase().includes(q) || r.unitNumber.toLowerCase().includes(q)),
  );
});
const avSorted = computed(() => (avSort.value.key ? sortRows(avFiltered.value, avSort.value, (r, k) => (r as unknown as Record<string, unknown>)[k]) : avFiltered.value));
const avPaged = computed(() => avSorted.value.slice((avPage.value - 1) * PAGE_SIZE, avPage.value * PAGE_SIZE));
function clearAv() { avSearch.value = ""; avAvoidableOnly.value = false; }
watch(avFiltered, () => (avPage.value = 1));

// ── tab 3: truck idle capability ─────────────────────────────────────────────
const capSearch = ref("");
const capFilter = ref<string>("");
const capSort = ref<SortState>({ key: null, dir: "asc" });
const capPage = ref(1);
const capFilterCount = computed(() => (capSearch.value.trim() ? 1 : 0) + (capFilter.value ? 1 : 0));
const capFiltered = computed(() => {
  const q = capSearch.value.trim().toLowerCase();
  return (caps.value ?? []).filter(
    (t) => (!capFilter.value || t.idle_capability === capFilter.value) && (!q || t.unit_number.toLowerCase().includes(q)),
  );
});
const capSorted = computed(() => (capSort.value.key ? sortRows(capFiltered.value, capSort.value, (r, k) => (r as unknown as Record<string, unknown>)[k]) : capFiltered.value));
const capPaged = computed(() => capSorted.value.slice((capPage.value - 1) * PAGE_SIZE, capPage.value * PAGE_SIZE));
function clearCap() { capSearch.value = ""; capFilter.value = ""; }
watch(capFiltered, () => (capPage.value = 1));
</script>

<template>
  <div class="space-y-6">
    <!-- Fleet money summary (KPIs, always visible) -->
    <div v-if="!isLoading && !isError && data" class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <dt class="text-xs font-medium tracking-wide text-gray-500 uppercase">Money wasted idling (last 30 days)</dt>
        <dd class="mt-1 text-2xl font-bold text-red-700">{{ usd(data.fleetDiscretionaryCost) }}</dd>
        <dd class="mt-0.5 text-xs text-gray-400">{{ data.fleetDiscretionaryGal.toLocaleString() }} gal of avoidable idle</dd>
      </div>
      <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <dt class="text-xs font-medium tracking-wide text-gray-500 uppercase">Avoidable idle hours</dt>
        <dd class="mt-1 text-2xl font-bold text-gray-900">{{ data.fleetDiscretionaryHours.toLocaleString() }}<span class="text-base font-normal text-gray-400"> / {{ data.fleetIdleHours.toLocaleString() }} total</span></dd>
      </div>
      <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <dt class="text-xs font-medium tracking-wide text-gray-500 uppercase">Projected yearly waste</dt>
        <dd class="mt-1 text-2xl font-bold text-gray-900">{{ usd(data.fleetDiscretionaryCost * 12) }}</dd>
        <dd class="mt-0.5 text-xs text-gray-400">at the current 30-day rate</dd>
      </div>
    </div>

    <!-- Tab strip + info toggle -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex gap-1 rounded-lg bg-gray-100 p-1 text-sm">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="rounded-md px-3 py-1.5 font-medium transition"
          :class="activeTab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'"
          @click="activeTab = t.key"
        >
          {{ t.label }} <span class="ml-0.5 text-gray-400">{{ t.count }}</span>
        </button>
      </div>
      <button class="text-sm font-medium text-gray-500 hover:text-gray-700" @click="showInfo = !showInfo">
        {{ showInfo ? "Hide" : "How idle is scored" }}
      </button>
    </div>

    <!-- Collapsible explanation + comfort band (was the always-on top blurb) -->
    <div v-if="showInfo" class="space-y-3 rounded-lg bg-white p-4 text-sm shadow-sm ring-1 ring-gray-200">
      <p class="text-gray-600">
        We only count idling that could have been avoided: the engine running while parked, in comfortable
        weather, with no work being done. We don't count short stops, idling to run equipment (PTO), or idling to
        heat or cool the cab in extreme weather. Only <strong>avoidable</strong> idle affects a driver's score and
        the wasted-money total.
      </p>
      <p v-if="settings" class="text-gray-600">
        <span class="text-gray-500">Comfortable-weather range (idle outside it counts as weather-excused — heating or cooling the cab):</span>
        <span class="ml-1 font-medium text-gray-900">{{ settings.comfort_low_f }}–{{ settings.comfort_high_f }}°F</span>
        <span class="ml-1 text-gray-400">· idle ≥ {{ settings.min_idle_minutes }} min scored</span>
        <span v-if="suggestionDiffers" class="ml-2 text-indigo-600">
          · learned from your data: <strong>{{ settings.suggested_low_f }}–{{ settings.suggested_high_f }}°F</strong>
          <span class="text-gray-400">(update idle_settings to adopt, then re-sync)</span>
        </span>
      </p>
      <p v-if="fleetOptimizedPct != null" class="text-gray-600">
        <span class="text-gray-500">Optimized-idle adoption:</span>
        <span class="ml-1 font-medium text-gray-900">{{ fleetOptimizedPct }}%</span>
        <span class="ml-1 text-gray-400">of parked time on APU or optimized idle (learned per truck)</span>
      </p>
    </div>

    <!-- ── TAB: Drivers ──────────────────────────────────────────────────────── -->
    <template v-if="activeTab === 'drivers'">
      <TableToolbar
        v-model="drvSearch"
        title="Driver idle scorecard"
        :count="drvFiltered.length"
        :subtitle="data && data.attributedPct < 100 ? `${data.attributedPct}% of wasted money traced to a driver` : null"
        search-placeholder="Search driver…"
        :active-filter-count="drvFilterCount"
        @clear="drvSearch = ''"
      />
      <div class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
        <TableSkeleton v-if="isLoading" :cols="9" />
        <ErrorState v-else-if="isError" :message="error instanceof Error ? error.message : 'Failed to load'" :retrying="isFetching" @retry="refetch" />
        <div v-else-if="drvFiltered.length === 0" class="px-6 py-10 text-center text-sm text-gray-500">
          No idle events yet — run a Samsara sync from Settings → Data &amp; Sync to pull idling data.
        </div>
        <template v-else>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200 text-sm whitespace-nowrap">
              <thead class="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th class="px-4 py-3 font-medium">#</th>
                  <th class="px-4 py-3 font-medium">Driver</th>
                  <SortableTh label="Idle score" sort-key="score" :active="drvSort.key" :dir="drvSort.dir" th-class="px-4 py-3 font-medium text-right" @sort="drvSort = toggleSort(drvSort, $event)" />
                  <SortableTh label="Money wasted" sort-key="discretionaryCost" :active="drvSort.key" :dir="drvSort.dir" th-class="px-4 py-3 font-medium text-right" @sort="drvSort = toggleSort(drvSort, $event)" />
                  <SortableTh label="Avoidable hrs" sort-key="discretionaryHours" :active="drvSort.key" :dir="drvSort.dir" th-class="px-4 py-3 font-medium text-right" @sort="drvSort = toggleSort(drvSort, $event)" />
                  <SortableTh label="Total idle hrs" sort-key="totalIdleHours" :active="drvSort.key" :dir="drvSort.dir" th-class="px-4 py-3 font-medium text-right" @sort="drvSort = toggleSort(drvSort, $event)" />
                  <SortableTh label="% avoidable" sort-key="discretionaryPct" :active="drvSort.key" :dir="drvSort.dir" th-class="px-4 py-3 font-medium text-right" @sort="drvSort = toggleSort(drvSort, $event)" />
                  <SortableTh label="Long idles (1h+)" sort-key="longIdleCount" :active="drvSort.key" :dir="drvSort.dir" th-class="px-4 py-3 font-medium text-right" @sort="drvSort = toggleSort(drvSort, $event)" />
                  <th class="px-4 py-3 font-medium text-center" title="Avoidable idle this week vs last week">Trend vs last week</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                <tr v-for="(d, i) in drvPaged" :key="d.driverId" class="hover:bg-gray-50" :class="d.driverId === '__unattributed__' ? 'bg-gray-50/60' : ''">
                  <td class="px-4 py-3 text-gray-400">{{ d.driverId === '__unattributed__' ? '—' : drvRank(i) }}</td>
                  <td class="px-4 py-3 font-medium" :class="d.driverId === '__unattributed__' ? 'text-gray-400 italic' : 'text-gray-900'">
                    {{ d.driverName }}<span v-if="d.driverId === '__unattributed__'" class="ml-1 text-xs font-normal">(no driver assigned by Samsara)</span>
                  </td>
                  <td class="px-4 py-3 text-right font-bold tabular-nums" :class="scoreTone(d.score)">{{ d.score }}</td>
                  <td class="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">{{ usd2(d.discretionaryCost) }}</td>
                  <td class="px-4 py-3 text-right text-gray-700 tabular-nums">{{ d.discretionaryHours }}</td>
                  <td class="px-4 py-3 text-right text-gray-500 tabular-nums">{{ d.totalIdleHours }}</td>
                  <td class="px-4 py-3 text-right text-gray-700 tabular-nums">{{ d.discretionaryPct }}%</td>
                  <td class="px-4 py-3 text-right text-gray-500 tabular-nums">{{ d.longIdleCount }}</td>
                  <td class="px-4 py-3 text-center font-bold" :class="trendCell(d.trend).cls" :title="trendCell(d.trend).title">{{ trendCell(d.trend).icon }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <TablePagination :page="drvPage" :page-size="PAGE_SIZE" :total="drvFiltered.length" @update:page="drvPage = $event" />
        </template>
      </div>
    </template>

    <!-- ── TAB: Avoidable idles ──────────────────────────────────────────────── -->
    <template v-else-if="activeTab === 'avoidable'">
      <TableToolbar
        v-model="avSearch"
        title="Biggest idle events to coach · last 30 days"
        :count="avFiltered.length"
        search-placeholder="Search driver or truck…"
        :active-filter-count="avFilterCount"
        @clear="clearAv"
      >
        <select v-model="avAvoidableOnly" class="rounded-md border-gray-300 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
          <option :value="false">All long idles</option>
          <option :value="true">Avoidable only (has APU)</option>
        </select>
      </TableToolbar>
      <div class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
        <div v-if="avFiltered.length === 0" class="px-6 py-10 text-center text-sm text-gray-500">
          No long avoidable idles in the last 30 days (2 hours or more).
        </div>
        <template v-else>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200 text-sm whitespace-nowrap">
              <thead class="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th class="px-4 py-3 font-medium">Driver</th>
                  <th class="px-4 py-3 font-medium">Truck</th>
                  <SortableTh label="Date" sort-key="startedAt" :active="avSort.key" :dir="avSort.dir" th-class="px-4 py-3 font-medium" @sort="avSort = toggleSort(avSort, $event)" />
                  <SortableTh label="Hours" sort-key="hours" :active="avSort.key" :dir="avSort.dir" th-class="px-4 py-3 font-medium text-right" @sort="avSort = toggleSort(avSort, $event)" />
                  <SortableTh label="Estimated cost" sort-key="costUsd" :active="avSort.key" :dir="avSort.dir" th-class="px-4 py-3 font-medium text-right" @sort="avSort = toggleSort(avSort, $event)" />
                  <th class="px-4 py-3 font-medium">Equipment</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                <tr v-for="(r, i) in avPaged" :key="i" class="hover:bg-gray-50" :class="r.avoidable ? 'bg-red-50/40' : ''">
                  <td class="px-4 py-3 font-medium text-gray-900">{{ r.driverName }}</td>
                  <td class="px-4 py-3 text-gray-700">{{ r.unitNumber }}</td>
                  <td class="px-4 py-3 text-gray-500">{{ dateFmt(r.startedAt) }}</td>
                  <td class="px-4 py-3 text-right tabular-nums text-gray-700">{{ r.hours }}</td>
                  <td class="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">{{ usd2(r.costUsd) }}</td>
                  <td class="px-4 py-3">
                    <span :class="['inline-flex rounded px-1.5 py-0.5 text-xs font-semibold', equipBadge(r.equipment).cls]" :title="equipBadge(r.equipment).title">{{ equipBadge(r.equipment).label }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <TablePagination :page="avPage" :page-size="PAGE_SIZE" :total="avFiltered.length" @update:page="avPage = $event" />
        </template>
      </div>
    </template>

    <!-- ── TAB: Truck capability ─────────────────────────────────────────────── -->
    <template v-else>
      <TableToolbar
        v-model="capSearch"
        title="Truck idle capability"
        :count="capFiltered.length"
        search-placeholder="Search truck…"
        :active-filter-count="capFilterCount"
        @clear="clearCap"
      >
        <select v-model="capFilter" class="rounded-md border-gray-300 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
          <option value="">All capabilities</option>
          <option value="apu">APU</option>
          <option value="ecu_optimized">Optimized idle</option>
          <option value="continuous_only">Continuous idle only</option>
          <option value="unknown">Unknown</option>
        </select>
      </TableToolbar>
      <div class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
        <div v-if="capFiltered.length === 0" class="px-6 py-10 text-center text-sm text-gray-500">
          No trucks match. Set each truck's idle-reduction equipment on the Vehicles page; the data column fills in after a Samsara sync.
        </div>
        <template v-else>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200 text-sm whitespace-nowrap">
              <thead class="bg-gray-50 text-left text-gray-500">
                <tr>
                  <SortableTh label="Truck" sort-key="unit_number" :active="capSort.key" :dir="capSort.dir" th-class="px-4 py-3 font-medium" @sort="capSort = toggleSort(capSort, $event)" />
                  <th class="px-4 py-3 font-medium" title="What you recorded on the Vehicles page">Engine-off capable (recorded)</th>
                  <th class="px-4 py-3 font-medium" title="Learned from the truck's engine on/off pattern">What the data shows</th>
                  <SortableTh label="% time engine off/optimized" sort-key="idle_optimized_pct" :active="capSort.key" :dir="capSort.dir" th-class="px-4 py-3 font-medium text-right" @sort="capSort = toggleSort(capSort, $event)" />
                  <th class="px-4 py-3 font-medium text-center">Cross-check</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                <tr v-for="t in capPaged" :key="t.unit_number" class="hover:bg-gray-50" :class="t.cross_check === 'disagree' ? 'bg-red-50/40' : ''">
                  <td class="px-4 py-3 font-medium text-gray-900">{{ t.unit_number }}</td>
                  <td class="px-4 py-3">
                    <span :class="['inline-flex rounded px-1.5 py-0.5 text-xs font-semibold', recordedCls(t)]">{{ recordedLabel(t) }}</span>
                    <span v-if="t.has_optimized_idle === true" class="ml-1 inline-flex rounded bg-green-100 px-1.5 py-0.5 text-xs font-semibold text-green-700" title="OEM optimized idle recorded">Optimized idle</span>
                  </td>
                  <td class="px-4 py-3"><span :class="['inline-flex rounded px-1.5 py-0.5 text-xs font-semibold', capBadge(t.idle_capability).cls]">{{ capBadge(t.idle_capability).label }}</span></td>
                  <td class="px-4 py-3 text-right tabular-nums text-gray-700">{{ t.idle_optimized_pct }}%</td>
                  <td class="px-4 py-3 text-center font-semibold" :class="xcheck(t.cross_check).cls" :title="xcheck(t.cross_check).title">{{ xcheck(t.cross_check).label }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <TablePagination :page="capPage" :page-size="PAGE_SIZE" :total="capFiltered.length" @update:page="capPage = $event" />
        </template>
      </div>
    </template>
  </div>
</template>
