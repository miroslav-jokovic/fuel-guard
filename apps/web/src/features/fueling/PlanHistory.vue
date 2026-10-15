<script setup lang="ts">
import { AppButton as BaseButton } from "@silvicom/ui";
import { computed, ref, watch } from "vue";
import { DataTable, type DataTableColumn } from "@silvicom/ui";
import { DataWorkspace } from "@silvicom/ui";
import { FilterBar } from "@silvicom/ui";
import { BulkActionBar } from "@silvicom/ui";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import { TablePagination } from "@silvicom/ui";
import { BADGE_BASE, toneClass, type BadgeTone } from "@/lib/badges";
import { useFuelPlanHistory, useDeleteFuelPlan, useDeleteFuelPlans, type PlanHistoryRow } from "./useFuelPlan";
import { useToastStore } from "@/stores/toast";
import { useConfirm } from "@silvicom/ui";
import { formatDateTime as fmtDate } from "@/lib/format";
import { useQueryState } from "@silvicom/ui";
import { parseYmd } from "@silvicom/shared";

const toast = useToastStore();
const ask = useConfirm();
const { data, isLoading, error, isFetching, refetch } = useFuelPlanHistory();
const rows = computed(() => data.value ?? []);
const errMsg = computed(() => (error.value ? "Could not load the plan history." : null));

// ── Search + filters (client-side; the list is one cheap capped select) ──────────────────────────────
//
// In the URL (D-US2), scoped `history.` because this is a TAB of Fuel planning and shares its route with
// the Plan tab. The status is checked against `STATUS` below, the same table that names it; the truck
// is not checked, because its options are the units present in the loaded history and a pasted link is
// read before that loads — an unknown unit filters to nothing and the empty state says so. A date that
// is not a real calendar day reads as no bound.
//
// ⚠ The parent page holds WHICH TAB is open in a local ref, so a pasted link carrying `history.*` opens
// on the Plan tab with the history filters waiting behind it. That half is `FuelPlanningPage`'s, not
// this list's, and is not routed around here.
const qs = useQueryState("history");
const search = qs.param("search");
const truckFilter = qs.param("truck");
const fromParam = qs.param("from");
const toParam = qs.param("to");
const fromDate = computed<string | undefined>({
  get: () => parseYmd(fromParam.value) ?? undefined,
  set: (v) => (fromParam.value = v ?? ""),
});
const toDate = computed<string | undefined>({
  get: () => parseYmd(toParam.value) ?? undefined,
  set: (v) => (toParam.value = v ?? ""),
});

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
const statusFilter = qs.param("status", Object.keys(STATUS));

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

const activeFilterCount = computed(
  () =>
    [search.value.trim(), statusFilter.value, truckFilter.value].filter(Boolean).length +
    (fromDate.value || toDate.value ? 1 : 0),
);
function clearAll() {
  qs.set({ search: undefined, status: undefined, truck: undefined, from: undefined, to: undefined });
}

// ── Paging (D-US8) ───────────────────────────────────────────────────────────────────────────────────
// Twenty a page over the filtered list, the page in the URL under the same `history.` scope as the
// filters (`?history.page=`), so it never collides with the Plan tab's keys. A filter change starts
// again at page 1 — watched, not derived from the rows, so a refetch never throws a pasted page away —
// and a list that shrank under the reader (a delete, a refetch) pulls the page back to its last one.
const PAGE_SIZE = 20;
const page = qs.page();
watch([search, statusFilter, truckFilter, fromDate, toDate], () => (page.value = 1));
watch(
  () => filtered.value.length,
  (n) => {
    const last = Math.max(1, Math.ceil(n / PAGE_SIZE));
    if (data.value && page.value > last) page.value = last;
  },
);
const pageRows = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

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
  // The product's confirm, not the browser's (D-US7): the route is what tells two plans apart.
  if (!(await ask({ title: "Delete this plan?", message: routeLabel(row), confirmLabel: "Delete", tone: "danger" }))) return;
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
  const plans = `${ids.length} plan${ids.length > 1 ? "s" : ""}`;
  if (!(await ask({ title: `Delete ${plans}?`, message: "This can't be undone.", confirmLabel: "Delete", tone: "danger" }))) return;
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
  { key: "created_at", label: "Created", width: "lg" },
  { key: "created_by_label", label: "Created by", width: "lg" },
  { key: "unit_number", label: "Truck" },
  { key: "route", label: "Route", width: "2xl" },
  { key: "distance_miles", label: "Distance", numeric: true },
  { key: "stop_count", label: "Stops", numeric: true },
  { key: "total_gallons", label: "Gallons", numeric: true },
  { key: "total_cost", label: "Est. cost", numeric: true },
  { key: "status", label: "Status" },
];

const usd = (n: number | null) => (n == null ? "—" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
</script>

<template>
  <div class="space-y-3">
    <DataWorkspace>
    <FilterBar
      embedded
      v-model:search="search"
      search-placeholder="Search route, truck, creator…"
      :count="filtered.length"
      count-label="plans"
      :active-count="activeFilterCount"
      @clear-all="clearAll"
    >
      <template #filters>
        <FilterSelect v-model="statusFilter" label="Status" :options="statusOptions" />
        <FilterSelect v-model="truckFilter" label="Truck" :options="truckOptions" />
        <DateRangeFilter :from="fromDate" :to="toDate" @update:from="fromDate = $event" @update:to="toDate = $event" />
      </template>
    </FilterBar>

    <BulkActionBar :count="selectedIds.size" @clear="selectedIds = new Set()">
      <BaseButton variant="danger" size="sm" :disabled="bulkBusy" @click="bulkDelete">
        {{ bulkBusy ? "Deleting…" : "Delete" }}
      </BaseButton>
    </BulkActionBar>

    <DataTable
      embedded
      :columns="columns"
      :rows="pageRows"
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
        <span class="mx-1 text-ink-tertiary">→</span>
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
          <BaseButton class="kebab-item kebab-item-danger" @click="deleteOne(row)">Delete plan</BaseButton>
        </KebabMenu>
      </template>
      <template #footer>
        <TablePagination :page="page" :page-size="PAGE_SIZE" :total="filtered.length" :loading="isFetching" @update:page="page = $event" />
      </template>
    </DataTable>
    </DataWorkspace>
  </div>
</template>
