<script setup lang="ts">
import { computed, ref, watch } from "vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import { BADGE_BASE, toneClass, type BadgeTone } from "@/lib/badges";
import { useFuelPlanHistory, useDeleteFuelPlan, useDeleteFuelPlans, type PlanHistoryRow } from "./useFuelPlan";
import { useToastStore } from "@/stores/toast";

const toast = useToastStore();
const { data, isLoading, error, isFetching, refetch } = useFuelPlanHistory();
const rows = computed(() => data.value ?? []);
const errMsg = computed(() => (error.value ? error.value.message : null));

// ── Search + filters (client-side; the list is one cheap capped select) ──────────────────────────────
const search = ref("");
const statusFilter = ref("");
const truckFilter = ref("");
const fromDate = ref<string | undefined>(undefined);
const toDate = ref<string | undefined>(undefined);

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  ok: { label: "OK", tone: "success" },
  emergency_used: { label: "Emergency", tone: "warning" },
  infeasible: { label: "Infeasible", tone: "danger" },
  no_stations: { label: "No stations", tone: "neutral" },
  telematics_unavailable: { label: "No telematics", tone: "neutral" },
  routing_unavailable: { label: "No routing", tone: "neutral" },
  error: { label: "Error", tone: "danger" },
};
const statusOf = (s: string) => STATUS[s] ?? { label: s, tone: "neutral" as BadgeTone };

const statusOptions = computed(() => [
  { value: "", label: "All statuses" },
  ...Object.entries(STATUS).map(([value, { label }]) => ({ value, label })),
]);
// Trucks actually present in the history, sorted.
const truckOptions = computed(() => [
  { value: "", label: "All trucks" },
  ...[...new Set(rows.value.map((r) => r.unit_number).filter((u): u is string => !!u))]
    .sort((a, b) => a.localeCompare(b))
    .map((u) => ({ value: u, label: u })),
]);

const filtered = computed<PlanHistoryRow[]>(() => {
  let out = rows.value;
  const q = search.value.trim().toLowerCase();
  if (q) {
    out = out.filter((r) =>
      [r.origin_label, r.destination_label, r.unit_number, r.created_by_label].some((v) => (v ?? "").toLowerCase().includes(q)),
    );
  }
  if (statusFilter.value) out = out.filter((r) => r.status === statusFilter.value);
  if (truckFilter.value) out = out.filter((r) => (r.unit_number ?? "") === truckFilter.value);
  if (fromDate.value) out = out.filter((r) => r.created_at.slice(0, 10) >= fromDate.value!);
  if (toDate.value) out = out.filter((r) => r.created_at.slice(0, 10) <= toDate.value!);
  return out;
});

const anyFilter = computed(() => !!(search.value || statusFilter.value || truckFilter.value || fromDate.value || toDate.value));
function clearAll() {
  search.value = "";
  statusFilter.value = "";
  truckFilter.value = "";
  fromDate.value = undefined;
  toDate.value = undefined;
}

// ── Multi-select (DataTable owns the checkboxes) ─────────────────────────────────────────────────────
const selectedIds = ref<Set<string>>(new Set());
// Keep the selection honest: drop any ids that filters (or a refetch) removed from view, so the
// "N selected" count and the bulk delete only ever act on rows the user can currently see.
watch(filtered, (list) => {
  const visible = new Set(list.map((r) => r.id));
  const next = new Set([...selectedIds.value].filter((id) => visible.has(id)));
  if (next.size !== selectedIds.value.size) selectedIds.value = next;
});

// ── Delete (single + bulk) ───────────────────────────────────────────────────────────────────────────
const delOne = useDeleteFuelPlan();
const delMany = useDeleteFuelPlans();
const bulkBusy = ref(false);

const routeLabel = (r: PlanHistoryRow) => `${r.origin_label ?? "—"} → ${r.destination_label ?? "—"}`;

async function deleteOne(row: PlanHistoryRow) {
  if (!confirm(`Delete this plan?\n\n${routeLabel(row)}`)) return;
  try {
    await delOne.mutateAsync(row.id);
    const next = new Set(selectedIds.value);
    next.delete(row.id);
    selectedIds.value = next;
    toast.success("Plan deleted");
  } catch (e) {
    toast.error("Could not delete plan", e instanceof Error ? e.message : undefined);
  }
}

async function bulkDelete() {
  const ids = [...selectedIds.value];
  if (ids.length === 0) return;
  if (!confirm(`Delete ${ids.length} plan${ids.length > 1 ? "s" : ""}? This can't be undone.`)) return;
  bulkBusy.value = true;
  try {
    const n = await delMany.mutateAsync(ids);
    selectedIds.value = new Set();
    toast.success(`${n} plan${n > 1 ? "s" : ""} deleted`);
  } catch (e) {
    toast.error("Could not delete plans", e instanceof Error ? e.message : undefined);
  } finally {
    bulkBusy.value = false;
  }
}

const columns: DataTableColumn[] = [
  { key: "created_at", label: "Created", headerClass: "min-w-[9rem]" },
  { key: "created_by_label", label: "Created by", headerClass: "min-w-[10rem]" },
  { key: "unit_number", label: "Truck" },
  { key: "route", label: "Route", headerClass: "min-w-[16rem]" },
  { key: "distance_miles", label: "Distance", numeric: true },
  { key: "stop_count", label: "Stops", numeric: true },
  { key: "total_gallons", label: "Gallons", numeric: true },
  { key: "total_cost", label: "Est. cost", numeric: true },
  { key: "status", label: "Status" },
];

const fmtDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const usd = (n: number | null) => (n == null ? "—" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
</script>

<template>
  <div class="space-y-3">
    <FilterBar
      v-model:search="search"
      search-placeholder="Search route, truck, creator…"
      :count="filtered.length"
      count-label="plans"
    >
      <template #filters>
        <FilterSelect v-model="statusFilter" label="Status" :options="statusOptions" />
        <FilterSelect v-model="truckFilter" label="Truck" :options="truckOptions" />
        <DateRangeFilter :from="fromDate" :to="toDate" @update:from="fromDate = $event" @update:to="toDate = $event" />
        <button
          v-if="anyFilter"
          type="button"
          class="text-sm font-medium text-ink-muted hover:text-ink-secondary"
          @click="clearAll"
        >
          Clear all
        </button>
      </template>
    </FilterBar>

    <div
      v-if="selectedIds.size > 0"
      class="flex items-center justify-between rounded-lg bg-brand-50 px-4 py-2.5 text-sm ring-1 ring-brand-100"
    >
      <span class="font-medium text-brand-800">{{ selectedIds.size }} selected</span>
      <div class="flex items-center gap-3">
        <button
          :disabled="bulkBusy"
          class="font-medium text-danger-600 hover:text-danger-500 disabled:opacity-50"
          @click="bulkDelete"
        >
          {{ bulkBusy ? "Deleting…" : "Delete" }}
        </button>
        <button class="font-medium text-ink-muted hover:text-ink-secondary" @click="selectedIds = new Set()">Clear</button>
      </div>
    </div>

    <DataTable
      :columns="columns"
      :rows="filtered"
      row-key="id"
      :loading="isLoading"
      :error="errMsg"
      :retrying="isFetching"
      selectable
      :selected="selectedIds"
      :empty-text="rows.length === 0 ? 'No plans yet — generate one on the Plan tab and it\'ll be saved here.' : 'No plans match these filters.'"
      @update:selected="selectedIds = $event"
      @retry="refetch"
    >
      <template #cell-created_at="{ row }">
        <span class="whitespace-nowrap text-ink-secondary">{{ fmtDate(row.created_at) }}</span>
      </template>
      <template #cell-created_by_label="{ row }">{{ row.created_by_label ?? "—" }}</template>
      <template #cell-unit_number="{ row }">{{ row.unit_number ?? "—" }}</template>
      <template #cell-route="{ row }">
        <span class="text-ink">{{ row.origin_label ?? "—" }}</span>
        <span class="mx-1 text-ink-subtle">→</span>
        <span class="text-ink">{{ row.destination_label ?? "—" }}</span>
      </template>
      <template #cell-distance_miles="{ row }">{{ row.distance_miles != null ? `${row.distance_miles.toLocaleString()} mi` : "—" }}</template>
      <template #cell-total_gallons="{ row }">{{ row.total_gallons != null ? `${row.total_gallons.toLocaleString()} gal` : "—" }}</template>
      <template #cell-total_cost="{ row }">{{ usd(row.total_cost) }}</template>
      <template #cell-status="{ row }">
        <span :class="[BADGE_BASE, toneClass(statusOf(row.status).tone)]">{{ statusOf(row.status).label }}</span>
      </template>
      <template #actions="{ row }">
        <KebabMenu>
          <button class="kebab-item kebab-item-danger" @click="deleteOne(row)">Delete plan</button>
        </KebabMenu>
      </template>
    </DataTable>
  </div>
</template>
