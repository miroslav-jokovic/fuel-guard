import { ref, computed, watch } from "vue";
import { useRoute } from "vue-router";
import { ANOMALY_SEVERITIES, type Anomaly, type AnomalyDisposition } from "@fuelguard/shared";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useTrailersQuery } from "@/features/fleet/useTrailers";
import { useDriversQuery } from "@/composables/useDrivers";
import { useAnomaliesQuery, useAnomalyTransition, useAnomalyTxnDrivers, type AnomalyFilters } from "@/features/anomalies/useAnomalies";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { toggleSort, sortRows, type SortState } from "@/lib/sort";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";

/** All state + logic for AnomaliesPage.vue: filters, columns, sorting, pagination, selection, bulk actions. */
export function useAnomaliesPage() {
const PAGE_SIZE = 20;
const session = useSessionStore();
const toast = useToastStore();
const { data: vehicles } = useVehiclesQuery();
const { data: trailers } = useTrailersQuery();
const { data: drivers } = useDriversQuery();
// Deep-link: /anomalies?vehicle=<id> (e.g. from a flagged fuel-log row) opens that truck's cases across
// ALL statuses so the linked case is visible even if it's already resolved; otherwise default to open.
const route = useRoute();
const linkedVehicle = typeof route.query.vehicle === "string" ? route.query.vehicle : undefined;
const filters = ref<AnomalyFilters>(linkedVehicle ? { vehicleId: linkedVehicle } : { status: "open" });
const search = ref("");
const { data: anomalies, isLoading, isError, error, refetch, isFetching } = useAnomaliesQuery(filters);
const { data: txnDriverMap } = useAnomalyTxnDrivers(anomalies);
const transition = useAnomalyTransition();


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

// The trailer currently paired to a truck (prefer the reefer), and the driver on the flagged fill.
const pairedTrailer = (vehicleId: string | null): string => {
  if (!vehicleId) return "—";
  const ts = (trailers.value ?? []).filter((t) => t.assigned_vehicle_id === vehicleId);
  if (!ts.length) return "—";
  return (ts.find((t) => t.is_reefer) ?? ts[0]!).unit_number ?? "—";
};
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
  { key: "vehicle", label: "Truck", sortable: true, headerClass: "min-w-[5rem]", cellClass: "font-medium text-ink" },
  { key: "trailer", label: "Trailer", sortable: true, headerClass: "min-w-[5rem]", cellClass: "text-ink-secondary" },
  { key: "driver", label: "Driver", sortable: true, headerClass: "min-w-[9rem]", cellClass: "text-ink-secondary" },
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

const sort = ref<SortState>({ key: "when", dir: "desc" });
function onSort(key: string) {
  sort.value = toggleSort(sort.value, key);
}
const getVal = (a: Anomaly, key: string): unknown => {
  if (key === "severity") return SEV_RANK[a.severity] ?? 0;
  if (key === "vehicle") return unit(a.vehicle_id);
  if (key === "trailer") return pairedTrailer(a.vehicle_id);
  if (key === "driver") return driverName(a);
  if (key === "when") return a.fueled_at ?? a.created_at;
  if (key === "type") return a.rule_id;
  if (key === "status") return a.status;
  return (a as unknown as Record<string, unknown>)[key];
};
const sorted = computed(() => {
  const rows = sortRows(filtered.value, sort.value, getVal);
  // Keep the work queue on top: open/investigating float up, resolved/false-alarm sink to the bottom —
  // each group still in the chosen sort order — so it's clear at a glance what's handled vs still open.
  const active = rows.filter(isActionable);
  const closed = rows.filter((a) => !isActionable(a));
  return [...active, ...closed];
});

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
// Explicit setter for the table's update:selected — writing the ref through a function (rather than a
// template `selectedIds = $event` assignment on a destructured binding) guarantees the composable's ref
// actually updates, so the bulk bar and bulk actions always see the current selection.
function setSelected(next: Set<string>) {
  selectedIds.value = next instanceof Set ? next : new Set();
}

const busy = ref(false);
async function transitionOne(
  a: Anomaly,
  status: "investigating" | "resolved" | "dismissed",
  note?: string,
  disposition?: AnomalyDisposition,
) {
  await transition.mutateAsync({ id: a.id, status, note, disposition, version: a.version });
}
async function bulkTransition(
  status: "investigating" | "resolved" | "dismissed",
  note?: string,
  confirmMsg?: string,
  disposition?: AnomalyDisposition,
) {
  if (selectedIds.value.size === 0) {
    toast.error("Select one or more alerts first.");
    return;
  }
  // Match on the STRING key (the table stores String(id)); then keep only the rows that can still transition.
  const selected = (anomalies.value ?? []).filter((a) => selectedIds.value.has(String(a.id)));
  const targets = selected.filter(isActionable);
  if (targets.length === 0) {
    // Give a reason instead of silently doing nothing (the old behavior read as "the buttons don't work").
    toast.error(
      selected.length > 0
        ? "Those alerts are already resolved or dismissed — nothing to update."
        : "Your selection is out of date — reselect the alerts and try again.",
    );
    selectedIds.value = new Set();
    return;
  }
  if (confirmMsg && !confirm(confirmMsg.replace("{n}", String(targets.length)))) return;
  busy.value = true;
  let ok = 0;
  let lastError: string | undefined;
  for (const a of targets) {
    try {
      await transitionOne(a, status, note, disposition);
      ok++;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  busy.value = false;
  selectedIds.value = new Set();
  const skipped = selected.length - targets.length;
  const skipNote = skipped > 0 ? ` (${skipped} already closed, skipped)` : "";
  if (ok === targets.length) toast.success(`Updated ${ok} of ${targets.length}${skipNote}`);
  else toast.error(`Updated ${ok} of ${targets.length}${skipNote}`, lastError);
}

async function rowAction(
  a: Anomaly,
  status: "investigating" | "resolved" | "dismissed",
  note?: string,
  disposition?: AnomalyDisposition,
) {
  try {
    await transitionOne(a, status, note, disposition);
    toast.success("Updated");
  } catch (e) {
    toast.error("Update failed", e instanceof Error ? e.message : undefined);
  }
}

// Rebuild + Re-sync Samsara moved to Settings → Data & Sync (with live progress + freshness).

const selectedRow = ref<Anomaly | null>(null);
const fmt = (iso: string) => new Date(iso).toLocaleDateString();
  return {
    filters, search,
    status, severity, vehicleId, statusOptions, severityOptions, unitOptions,
    setFrom, setTo, activeFilterCount, resetFilters,
    session,
    unit, pairedTrailer, driverName,
    columns, sort, onSort,
    total, pageRows, page, PAGE_SIZE,
    isLoading, isError, error, isFetching, refetch,
    selectedIds, setSelected, selectedCount, isActionable, busy, bulkTransition, rowAction,
    selectedRow, fmt,
  };
}
