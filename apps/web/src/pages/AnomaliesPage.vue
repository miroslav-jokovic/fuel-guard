<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { ANOMALY_SEVERITIES, formatRuleId, type Anomaly } from "@fuelguard/shared";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import { useTrailersQuery } from "@/features/fleet/useTrailers";
import { useDriversQuery } from "@/features/fleet/useDrivers";
import { useAnomaliesQuery, useAnomalyTransition, useAnomalyTxnDrivers, type AnomalyFilters } from "@/features/anomalies/useAnomalies";
import { useAiAssessments } from "@/features/ai/useAiVerification";
import SlideOver from "@/components/SlideOver.vue";
import AnomalyDetail from "@/features/anomalies/AnomalyDetail.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import TablePagination from "@/components/TablePagination.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import { apiFetch } from "@/lib/api";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { BADGE_BASE, severityTone, statusTone } from "@/lib/badges";
import { toggleSort, sortRows, type SortState } from "@/lib/sort";

const PAGE_SIZE = 20;
const session = useSessionStore();
const toast = useToastStore();
const { data: vehicles } = useVehiclesQuery();
const { data: trailers } = useTrailersQuery();
const { data: drivers } = useDriversQuery();
const filters = ref<AnomalyFilters>({ status: "open" });
const search = ref("");
const { data: anomalies, isLoading, isError, error, refetch, isFetching } = useAnomaliesQuery(filters);
const { data: aiMap } = useAiAssessments();
const { data: txnDriverMap } = useAnomalyTxnDrivers(anomalies);
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

/** Two-way proxy into the filters object for one key ("" ⇄ undefined). */
const bind = (key: "status" | "severity" | "vehicleId") =>
  computed({
    get: () => filters.value[key] ?? "",
    set: (v: string) => (filters.value = { ...filters.value, [key]: v || undefined }),
  });
const status = bind("status");
const severity = bind("severity");
const vehicleId = bind("vehicleId");

const statusOptions = [
  { value: "", label: "All (active)" },
  { value: "open", label: "Open" },
  { value: "investigating", label: "Investigating" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "False alarm / Dismissed" },
];
const severityOptions = [
  { value: "", label: "All severities" },
  ...ANOMALY_SEVERITIES.map((s) => ({ value: s, label: s })),
];
const unitOptions = computed(() => [
  { value: "", label: "All units" },
  ...[...(vehicles.value ?? [])]
    .sort((a, b) => a.unit_number.localeCompare(b.unit_number))
    .map((v) => ({ value: v.id, label: v.unit_number })),
]);

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

// Reefer tab enrichment: the paired reefer trailer for a truck, and the driver on the flagged fill.
const reeferTrailer = (vehicleId: string | null): string =>
  vehicleId ? ((trailers.value ?? []).find((t) => t.assigned_vehicle_id === vehicleId && t.is_reefer)?.unit_number ?? "—") : "—";
const driverName = (a: Anomaly): string => {
  const did = a.transaction_id ? (txnDriverMap.value?.[a.transaction_id] ?? null) : null;
  return did ? (drivers.value?.find((d) => d.id === did)?.full_name ?? "—") : "—";
};

// Client-side search over the message + vehicle unit.
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  const rows = anomalies.value ?? [];
  if (!q) return rows;
  return rows.filter((a) => a.message.toLowerCase().includes(q) || unit(a.vehicle_id).toLowerCase().includes(q));
});

const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

const baseColumns: DataTableColumn[] = [
  { key: "severity", label: "Severity", sortable: true, headerClass: "min-w-[6rem]" },
  { key: "type", label: "Type", sortable: true, headerClass: "min-w-[10rem]", cellClass: "text-ink-secondary" },
  { key: "vehicle", label: "Vehicle", sortable: true, headerClass: "min-w-[6rem]" },
  { key: "ai", label: "AI", sortable: true, headerClass: "min-w-[10rem]" },
  { key: "message", label: "Detail", headerClass: "min-w-[18rem]", cellClass: "max-w-md truncate text-ink-secondary" },
  { key: "status", label: "Status", sortable: true, headerClass: "min-w-[8rem]" },
  { key: "when", label: "When", sortable: true, headerClass: "min-w-[8rem]", cellClass: "text-ink-muted" },
];
// Reefer tab: lead with the assets the reviewer needs — truck, its reefer trailer, and the driver on the fill.
const reeferColumns: DataTableColumn[] = [
  { key: "vehicle", label: "Truck", sortable: true, headerClass: "min-w-[5rem]", cellClass: "font-medium text-ink" },
  { key: "trailer", label: "Trailer", sortable: true, headerClass: "min-w-[5rem]", cellClass: "text-ink-secondary" },
  { key: "driver", label: "Driver", sortable: true, headerClass: "min-w-[9rem]", cellClass: "text-ink-secondary" },
  { key: "severity", label: "Severity", sortable: true, headerClass: "min-w-[6rem]" },
  { key: "message", label: "Detail", headerClass: "min-w-[16rem]", cellClass: "max-w-md truncate text-ink-secondary" },
  { key: "status", label: "Status", sortable: true, headerClass: "min-w-[7rem]" },
  { key: "when", label: "When", sortable: true, headerClass: "min-w-[7rem]", cellClass: "text-ink-muted" },
];
const columns = computed(() => (filters.value.reeferOnly ? reeferColumns : baseColumns));

const sort = ref<SortState>({ key: null, dir: "asc" });
function onSort(key: string) {
  sort.value = toggleSort(sort.value, key);
}
const getVal = (a: Anomaly, key: string): unknown => {
  if (key === "severity") return SEV_RANK[a.severity] ?? 0;
  if (key === "vehicle") return unit(a.vehicle_id);
  if (key === "trailer") return reeferTrailer(a.vehicle_id);
  if (key === "driver") return driverName(a);
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
// DataTable owns the checkboxes + select-all; bulk actions filter to actionable rows.
const selectedIds = ref<Set<string>>(new Set());
const isActionable = (a: Anomaly) => a.status === "open" || a.status === "investigating";
const selectedCount = computed(() => selectedIds.value.size);
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

// Rebuild + Re-sync Samsara moved to Settings → Data & Sync (with live progress + freshness).

const selectedRow = ref<Anomaly | null>(null);
const fmt = (iso: string) => new Date(iso).toLocaleDateString();
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Fuel-card alerts from anomaly detection — theft, misuse, and data-quality signals across your fleet." />

    <!-- Tabs: all alerts vs reefer-fueling cases (design-system segmented control) -->
    <div class="flex w-fit gap-1 rounded-lg bg-surface-muted p-1 text-sm">
      <button
        class="rounded-md px-3 py-1.5 font-medium transition"
        :class="!filters.reeferOnly ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink-secondary'"
        @click="filters = { ...filters, reeferOnly: undefined }"
      >
        All alerts
      </button>
      <button
        class="rounded-md px-3 py-1.5 font-medium transition"
        :class="filters.reeferOnly ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink-secondary'"
        @click="filters = { ...filters, reeferOnly: true }"
      >
        Reefer fueling
      </button>
    </div>

    <BaseCard v-if="filters.reeferOnly" as="div">
      <p class="text-sm text-ink-secondary">
        Reefer-fueling alerts flag trucks that haul a reefer but may be fueling it with ULSD selected at the pump —
        a reefer-hauling truck buying little or no reefer (ULSR) fuel, or a ULSD fill that didn't fully enter the
        tractor tank. Each row shows the truck, its paired reefer trailer, and the driver on the flagged fill.
      </p>
    </BaseCard>

    <FilterBar
      v-model:search="search"
      search-placeholder="Search message or vehicle…"
      :count="total"
      count-label="alerts"
    >
      <template #filters>
        <FilterSelect v-model="status" label="Status" :options="statusOptions" />
        <FilterSelect v-model="severity" label="Severity" :options="severityOptions" />
        <FilterSelect v-model="vehicleId" label="Unit" :options="unitOptions" />
        <DateRangeFilter :from="filters.from" :to="filters.to" @update:from="setFrom" @update:to="setTo" />
      </template>
      <template #actions>
        <BaseButton v-if="activeFilterCount" variant="ghost" size="sm" @click="resetFilters">Clear filters</BaseButton>
        <BaseButton
          v-if="session.canManage"
          size="sm"
          :disabled="triaging"
          title="Run the AI investigator across open cases and rank them by theft likelihood"
          @click="runTriage"
        >
          {{ triaging ? "Triaging…" : "AI triage" }}
        </BaseButton>
        <BaseButton
          v-if="session.canManage"
          variant="ghost"
          size="sm"
          to="/settings/data"
          title="Rebuild and Re-sync Samsara moved to Settings → Data & Sync (with live progress)"
        >
          Rebuild / Re-sync →
        </BaseButton>
      </template>
    </FilterBar>

    <!-- Bulk action bar -->
    <div
      v-if="selectedCount > 0"
      class="flex flex-col gap-2 rounded-lg bg-brand-50 px-4 py-3 ring-1 ring-brand-200 sm:flex-row sm:items-center sm:justify-between"
    >
      <span class="text-sm font-medium text-brand-900">{{ selectedCount }} selected</span>
      <div class="flex flex-wrap gap-2">
        <BaseButton size="sm" :disabled="busy" @click="bulkTransition('investigating')">Investigate</BaseButton>
        <BaseButton size="sm" :disabled="busy" @click="bulkTransition('dismissed', 'False alarm', 'Mark {n} alerts as false alarm?')">False alarm</BaseButton>
        <BaseButton size="sm" :disabled="busy" @click="bulkTransition('resolved', undefined, 'Resolve {n} alerts?')">Resolve</BaseButton>
        <BaseButton variant="ghost" size="sm" @click="selectedIds = new Set()">Clear</BaseButton>
      </div>
    </div>

    <!-- Table -->
    <DataTable
      :columns="columns"
      :rows="pageRows"
      row-key="id"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load anomalies') : null"
      :retrying="isFetching"
      empty-text="Nothing here — no alerts match these filters."
      :sort="sort"
      :selectable="session.canManage"
      :selected="selectedIds"
      :row-class="() => 'cursor-pointer'"
      @update:selected="selectedIds = $event"
      @sort="onSort"
      @row-click="selectedRow = $event"
      @retry="refetch"
    >
      <template #cell-severity="{ row }">
        <span :class="[BADGE_BASE, severityTone(row.severity)]">{{ row.severity }}</span>
      </template>
      <template #cell-type="{ row }">{{ formatRuleId(row.rule_id) }}</template>
      <template #cell-vehicle="{ row }">{{ unit(row.vehicle_id) }}</template>
      <template #cell-trailer="{ row }">{{ reeferTrailer(row.vehicle_id) }}</template>
      <template #cell-driver="{ row }">{{ driverName(row) }}</template>
      <template #cell-ai="{ row }">
        <div v-if="ai(row)" class="flex items-center gap-1.5">
          <span :class="[BADGE_BASE, severityTone(ai(row)!.risk_level)]" :title="`AI risk ${ai(row)!.risk_score}/100`">{{ ai(row)!.risk_level }}</span>
          <span v-if="isLikelyFalseAlarm(row)" class="text-xs text-ink-subtle">likely false alarm</span>
          <span v-else class="text-xs text-ink-muted">{{ ACTION_LABEL[ai(row)!.recommended_action] ?? ai(row)!.recommended_action }}</span>
        </div>
        <span v-else class="text-xs text-ink-subtle">—</span>
      </template>
      <template #cell-status="{ row }">
        <span :class="[BADGE_BASE, statusTone(row.status)]">{{ row.status }}</span>
      </template>
      <template #cell-when="{ row }">
        <span :title="`Detected ${fmt(row.created_at)}`">{{ fmt(row.fueled_at ?? row.created_at) }}</span>
      </template>
      <template #actions="{ row }">
        <KebabMenu v-if="session.canManage && isActionable(row)">
          <button class="kebab-item" @click="selectedRow = row">Review details</button>
          <button v-if="row.status === 'open'" class="kebab-item" @click="rowAction(row, 'investigating')">Start investigating</button>
          <button class="kebab-item" @click="rowAction(row, 'resolved')">Resolve</button>
          <button class="kebab-item kebab-item-danger" @click="rowAction(row, 'dismissed', 'False alarm')">False alarm</button>
        </KebabMenu>
        <button v-else class="text-sm font-medium text-brand-600 hover:text-brand-500" @click="selectedRow = row">Review</button>
      </template>
      <template #footer>
        <TablePagination :page="page" :page-size="PAGE_SIZE" :total="total" @update:page="page = $event" />
      </template>
    </DataTable>

    <SlideOver :open="!!selectedRow" title="Alert" @close="selectedRow = null">
      <AnomalyDetail v-if="selectedRow" :anomaly="selectedRow" :vehicle-unit="unit(selectedRow.vehicle_id)" @changed="selectedRow = null" />
    </SlideOver>
  </div>
</template>
