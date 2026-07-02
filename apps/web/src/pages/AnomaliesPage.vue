<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { MagnifyingGlassIcon } from "@heroicons/vue/20/solid";
import { ANOMALY_SEVERITIES, formatRuleId, type Anomaly } from "@fuelguard/shared";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import { useAnomaliesQuery, useAnomalyTransition, type AnomalyFilters } from "@/features/anomalies/useAnomalies";
import { useAiAssessments } from "@/features/ai/useAiVerification";
import SlideOver from "@/components/SlideOver.vue";
import AnomalyDetail from "@/features/anomalies/AnomalyDetail.vue";
import AppSelect from "@/components/AppSelect.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import SortableTh from "@/components/SortableTh.vue";
import TableSkeleton from "@/components/TableSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";
import TablePagination from "@/components/TablePagination.vue";
import { apiFetch } from "@/lib/api";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { BADGE_BASE, severityTone, statusTone } from "@/lib/badges";
import { toggleSort, sortRows, type SortState } from "@/lib/sort";

const PAGE_SIZE = 20;
const session = useSessionStore();
const toast = useToastStore();
const { data: vehicles } = useVehiclesQuery();
const filters = ref<AnomalyFilters>({ status: "open" });
const search = ref("");
const { data: anomalies, isLoading, isError, error, refetch, isFetching } = useAnomaliesQuery(filters);
const { data: aiMap } = useAiAssessments();
const transition = useAnomalyTransition();

const ai = (a: Anomaly) => (a.transaction_id ? (aiMap.value?.[a.transaction_id] ?? null) : null);
const ACTION_LABEL: Record<string, string> = {
  block_card: "Block card",
  contact_driver: "Contact driver",
  investigate: "Investigate",
  monitor: "Monitor",
  none: "No action",
};
const isLikelyFalseAlarm = (a: Anomaly) => {
  const v = ai(a);
  return !!v && (v.risk_level === "low" || v.recommended_action === "monitor" || v.recommended_action === "none");
};

const triaging = ref(false);
async function runTriage() {
  triaging.value = true;
  const res = await apiFetch("/api/anomalies/triage", { method: "POST" });
  triaging.value = false;
  if (res.ok) toast.success("AI triage started", "Assessing open cases in the background — refresh in a moment.");
  else toast.error("Could not start triage", res.error?.message);
}

const setFrom = (v: string | undefined) => (filters.value = { ...filters.value, from: v });
const setTo = (v: string | undefined) => (filters.value = { ...filters.value, to: v });
const activeFilterCount = computed(() => {
  const f = filters.value;
  return [f.severity, f.vehicleId, f.from, f.to].filter(Boolean).length + (search.value.trim() ? 1 : 0);
});
function resetFilters() {
  filters.value = { status: "open" };
  search.value = "";
}

const unit = (vehicleId: string | null) =>
  vehicleId ? (vehicles.value?.find((v) => v.id === vehicleId)?.unit_number ?? "—") : "Unattributed";

// Client-side search over the message + vehicle unit.
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  const rows = anomalies.value ?? [];
  if (!q) return rows;
  return rows.filter((a) => a.message.toLowerCase().includes(q) || unit(a.vehicle_id).toLowerCase().includes(q));
});

const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const sort = ref<SortState>({ key: null, dir: "asc" });
function onSort(key: string) {
  sort.value = toggleSort(sort.value, key);
}
const getVal = (a: Anomaly, key: string): unknown => {
  if (key === "severity") return SEV_RANK[a.severity] ?? 0;
  if (key === "vehicle") return unit(a.vehicle_id);
  if (key === "when") return a.fueled_at ?? a.created_at;
  if (key === "type") return a.rule_id;
  if (key === "status") return a.status;
  if (key === "ai") return ai(a)?.risk_score ?? -1;
  return (a as unknown as Record<string, unknown>)[key];
};
const sorted = computed(() => sortRows(filtered.value, sort.value, getVal));

const page = ref(1);
watch([filters, search], () => (page.value = 1), { deep: true });
const total = computed(() => sorted.value.length);
const pageRows = computed(() => sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

// ── selection + bulk actions ────────────────────────────────────────────────
const selectedIds = ref<Set<string>>(new Set());
const isActionable = (a: Anomaly) => a.status === "open" || a.status === "investigating";
const pageActionable = computed(() => pageRows.value.filter(isActionable));
const allChecked = computed(() => pageActionable.value.length > 0 && pageActionable.value.every((a) => selectedIds.value.has(a.id)));
const selectedCount = computed(() => selectedIds.value.size);

function toggleRow(id: string) {
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds.value = next;
}
function toggleAll() {
  const next = new Set(selectedIds.value);
  if (allChecked.value) pageActionable.value.forEach((a) => next.delete(a.id));
  else pageActionable.value.forEach((a) => next.add(a.id));
  selectedIds.value = next;
}
watch([filters, search, page], () => (selectedIds.value = new Set()));

const busy = ref(false);
async function transitionOne(a: Anomaly, status: "investigating" | "resolved" | "dismissed", note?: string) {
  await transition.mutateAsync({ id: a.id, status, note, version: a.version });
}
async function bulkTransition(status: "investigating" | "resolved" | "dismissed", note?: string, confirmMsg?: string) {
  const targets = (anomalies.value ?? []).filter((a) => selectedIds.value.has(a.id) && isActionable(a));
  if (targets.length === 0) return;
  if (confirmMsg && !confirm(confirmMsg.replace("{n}", String(targets.length)))) return;
  busy.value = true;
  let ok = 0;
  for (const a of targets) {
    try {
      await transitionOne(a, status, note);
      ok++;
    } catch {
      /* keep going; report at end */
    }
  }
  busy.value = false;
  selectedIds.value = new Set();
  toast.success(`Updated ${ok} of ${targets.length}`);
}

async function rowAction(a: Anomaly, status: "investigating" | "resolved" | "dismissed", note?: string) {
  try {
    await transitionOne(a, status, note);
    toast.success("Updated");
  } catch (e) {
    toast.error("Update failed", e instanceof Error ? e.message : undefined);
  }
}

const rebuilding = ref(false);
async function rebuild() {
  if (!confirm("Re-score every transaction with the current rules? Existing false flags will clear; your notes are kept.")) return;
  rebuilding.value = true;
  const res = await apiFetch("/api/transactions/rebuild", { method: "POST" });
  rebuilding.value = false;
  if (res.ok) toast.success("Rebuild started", "Re-scoring in the background — refresh in a minute to see the cleaned-up list.");
  else toast.error("Could not start rebuild", res.error?.message);
}

const resyncing = ref(false);
async function resync() {
  if (!confirm("Re-check every fill against Samsara live? This recomputes exact fueling location and odometer (the tz-proof + geocoding logic), fixing false location/odometer flags. It's slower — a few minutes in the background.")) return;
  resyncing.value = true;
  const res = await apiFetch("/api/transactions/backfill", { method: "POST" });
  resyncing.value = false;
  if (res.ok) toast.success("Samsara re-sync started", "Re-reconciling every fill in the background — refresh in a few minutes.");
  else toast.error("Could not start re-sync", res.error?.message);
}

const selectedRow = ref<Anomaly | null>(null);
const fmt = (iso: string) => new Date(iso).toLocaleDateString();
</script>

<template>
  <div class="space-y-6">
    <!-- Filter bar -->
    <div class="rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 class="text-sm font-semibold text-gray-900">
          Anomalies
          <span class="ml-1 font-normal text-gray-400">· {{ total }}</span>
          <span v-if="activeFilterCount" class="ml-1 font-normal text-indigo-600">· {{ activeFilterCount }} filter{{ activeFilterCount > 1 ? "s" : "" }}</span>
        </h2>
        <div class="flex items-center gap-2">
          <button v-if="activeFilterCount" class="text-sm font-medium text-gray-500 hover:text-gray-700" @click="resetFilters">Clear filters</button>
          <button
            v-if="session.canManage"
            :disabled="triaging"
            class="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-indigo-700 ring-1 ring-indigo-300 ring-inset hover:bg-indigo-50 disabled:opacity-50"
            title="Run the AI investigator across open cases and rank them by theft likelihood"
            @click="runTriage"
          >
            {{ triaging ? "Triaging…" : "AI triage" }}
          </button>
          <button
            v-if="session.canManage"
            :disabled="resyncing"
            class="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 disabled:opacity-50"
            title="Re-check every fill against Samsara live — fixes false location/odometer flags"
            @click="resync"
          >
            {{ resyncing ? "Re-syncing…" : "Re-sync Samsara" }}
          </button>
          <button
            v-if="session.canManage"
            :disabled="rebuilding"
            class="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 disabled:opacity-50"
            title="Re-score every transaction with the current rules — clears stale/false flags"
            @click="rebuild"
          >
            {{ rebuilding ? "Rebuilding…" : "Rebuild" }}
          </button>
        </div>
      </div>

      <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div class="relative sm:col-span-2 lg:col-span-1">
          <MagnifyingGlassIcon class="pointer-events-none absolute top-2.5 left-2.5 size-4 text-gray-400" />
          <input
            v-model="search"
            type="search"
            placeholder="Search message or vehicle…"
            class="w-full rounded-md border-0 py-1.5 pr-3 pl-8 text-sm text-gray-900 ring-1 ring-gray-300 ring-inset focus:ring-2 focus:ring-indigo-600"
          />
        </div>
        <AppSelect
          v-model="filters.status"
          :options="[
            { value: 'open', label: 'Open' },
            { value: 'investigating', label: 'Investigating' },
            { value: 'resolved', label: 'Resolved' },
            { value: 'dismissed', label: 'False alarm / Dismissed' },
            { value: undefined, label: 'All (active)' },
          ]"
        />
        <AppSelect
          v-model="filters.severity"
          :options="[{ value: undefined, label: 'All severities' }, ...ANOMALY_SEVERITIES.map((s) => ({ value: s, label: s }))]"
        />
        <AppSelect
          v-model="filters.vehicleId"
          :options="[{ value: undefined, label: 'All vehicles' }, ...(vehicles ?? []).map((v) => ({ value: v.id, label: v.unit_number }))]"
        />
      </div>
      <div class="mt-2">
        <DateRangeFilter :from="filters.from" :to="filters.to" @update:from="setFrom" @update:to="setTo" />
      </div>
    </div>

    <!-- Bulk action bar -->
    <div
      v-if="selectedCount > 0"
      class="flex flex-col gap-2 rounded-lg bg-indigo-50 px-4 py-3 ring-1 ring-indigo-200 sm:flex-row sm:items-center sm:justify-between"
    >
      <span class="text-sm font-medium text-indigo-900">{{ selectedCount }} selected</span>
      <div class="flex flex-wrap gap-2">
        <button :disabled="busy" class="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 disabled:opacity-50" @click="bulkTransition('investigating')">Investigate</button>
        <button :disabled="busy" class="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 disabled:opacity-50" @click="bulkTransition('dismissed', 'False alarm', 'Mark {n} anomalies as false alarm?')">False alarm</button>
        <button :disabled="busy" class="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 disabled:opacity-50" @click="bulkTransition('resolved', undefined, 'Resolve {n} anomalies?')">Resolve</button>
        <button :disabled="busy" class="text-sm font-medium text-gray-500 hover:text-gray-700" @click="selectedIds = new Set()">Clear</button>
      </div>
    </div>

    <!-- Table -->
    <div class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <TableSkeleton v-if="isLoading" :cols="8" />
      <ErrorState v-else-if="isError" :message="error instanceof Error ? error.message : 'Failed to load anomalies'" :retrying="isFetching" @retry="refetch" />
      <div v-else-if="total === 0" class="px-6 py-10 text-center text-sm text-gray-500">Nothing here — no anomalies match these filters.</div>
      <div v-else class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 whitespace-nowrap text-sm">
          <thead class="sticky top-16 z-10 bg-gray-50 text-left text-gray-500">
            <tr>
              <th class="w-10 px-4 py-3">
                <input v-if="session.canManage" type="checkbox" :checked="allChecked" class="size-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" @change="toggleAll" />
              </th>
              <SortableTh label="Severity" sort-key="severity" :active="sort.key" :dir="sort.dir" th-class="px-4 py-3 font-medium min-w-[6rem]" @sort="onSort" />
              <SortableTh label="Type" sort-key="type" :active="sort.key" :dir="sort.dir" th-class="px-4 py-3 font-medium min-w-[10rem]" @sort="onSort" />
              <SortableTh label="Vehicle" sort-key="vehicle" :active="sort.key" :dir="sort.dir" th-class="px-4 py-3 font-medium min-w-[6rem]" @sort="onSort" />
              <SortableTh label="AI" sort-key="ai" :active="sort.key" :dir="sort.dir" th-class="px-4 py-3 font-medium min-w-[10rem]" @sort="onSort" />
              <th class="px-4 py-3 font-medium min-w-[18rem]">Detail</th>
              <SortableTh label="Status" sort-key="status" :active="sort.key" :dir="sort.dir" th-class="px-4 py-3 font-medium min-w-[8rem]" @sort="onSort" />
              <SortableTh label="When" sort-key="when" :active="sort.key" :dir="sort.dir" th-class="px-4 py-3 font-medium min-w-[8rem]" @sort="onSort" />
              <th class="px-4 py-3 w-12"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="a in pageRows" :key="a.id" class="cursor-pointer hover:bg-gray-50" @click="selectedRow = a">
              <td class="px-4 py-3" @click.stop>
                <input
                  v-if="session.canManage && isActionable(a)"
                  type="checkbox"
                  :checked="selectedIds.has(a.id)"
                  class="size-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  @change="toggleRow(a.id)"
                />
              </td>
              <td class="px-4 py-3"><span :class="[BADGE_BASE, severityTone(a.severity)]">{{ a.severity }}</span></td>
              <td class="px-4 py-3 text-gray-700">{{ formatRuleId(a.rule_id) }}</td>
              <td class="px-4 py-3 text-gray-900">{{ unit(a.vehicle_id) }}</td>
              <td class="px-4 py-3">
                <div v-if="ai(a)" class="flex items-center gap-1.5">
                  <span :class="[BADGE_BASE, severityTone(ai(a)!.risk_level)]" :title="`AI risk ${ai(a)!.risk_score}/100`">{{ ai(a)!.risk_level }}</span>
                  <span v-if="isLikelyFalseAlarm(a)" class="text-xs text-gray-400">likely false alarm</span>
                  <span v-else class="text-xs text-gray-500">{{ ACTION_LABEL[ai(a)!.recommended_action] ?? ai(a)!.recommended_action }}</span>
                </div>
                <span v-else class="text-xs text-gray-300">—</span>
              </td>
              <td class="max-w-md truncate px-4 py-3 text-gray-700">{{ a.message }}</td>
              <td class="px-4 py-3"><span :class="[BADGE_BASE, statusTone(a.status)]">{{ a.status }}</span></td>
              <td class="px-4 py-3 whitespace-nowrap text-gray-500" :title="`Detected ${fmt(a.created_at)}`">{{ fmt(a.fueled_at ?? a.created_at) }}</td>
              <td class="px-4 py-3 text-right" @click.stop>
                <KebabMenu v-if="session.canManage && isActionable(a)">
                  <button class="kebab-item" @click="selectedRow = a">Review details</button>
                  <button v-if="a.status === 'open'" class="kebab-item" @click="rowAction(a, 'investigating')">Start investigating</button>
                  <button class="kebab-item" @click="rowAction(a, 'resolved')">Resolve</button>
                  <button class="kebab-item kebab-item-danger" @click="rowAction(a, 'dismissed', 'False alarm')">False alarm</button>
                </KebabMenu>
                <button v-else class="text-sm font-medium text-indigo-600 hover:text-indigo-500" @click="selectedRow = a">Review</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <TablePagination v-if="!isLoading && !isError && total > 0" :page="page" :page-size="PAGE_SIZE" :total="total" @update:page="page = $event" />
    </div>

    <SlideOver :open="!!selectedRow" title="Anomaly" @close="selectedRow = null">
      <AnomalyDetail v-if="selectedRow" :anomaly="selectedRow" :vehicle-unit="unit(selectedRow.vehicle_id)" @changed="selectedRow = null" />
    </SlideOver>
  </div>
</template>
