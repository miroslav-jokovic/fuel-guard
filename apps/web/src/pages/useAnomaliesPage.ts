import { ref, computed, watch } from "vue";
import { ANOMALY_SEVERITIES, type Anomaly, type AnomalyDisposition } from "@silvicom/shared";
import { useQueryState } from "@/composables/useQueryState";
import { SORT_DIRECTIONS } from "@/composables/useUrlSort";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useTrailersQuery } from "@/composables/useTrailers";
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
/**
 * ── FUEL-C3, D-FUI8: the filters are the URL, and `?vehicle=` is now WRITTEN as well as read ─────
 *
 * `/anomalies?vehicle=<id>` was already a deep link — a flagged row on the Fuel Log sends a reviewer
 * here — but it was READ ONCE at setup and never written back, so the moment the reviewer changed the
 * truck in the picker the address bar described a different screen than the one in front of them.
 * That is the half-adopted shape C3 exists to finish: seeding from a link is not the same capability
 * as producing one.
 *
 * ⚠ **The deep link's second half is the tricky part, and it survives intact.** `?vehicle=` opens
 * that truck's cases across ALL statuses, so a case that has already been resolved is still visible
 * to somebody following the link; without a truck the page defaults to `open`, which is the work
 * queue. Both are what an ABSENT `status` means, and they are different — so "the reader chose All"
 * cannot also be absence. It is written as `status=all`, and `status` resolves the three cases below.
 */
const { param, list, set } = useQueryState();

/**
 * The trucks, as a LIST of vehicle ids (FUEL-P1).
 *
 * ⚠ The parameter keeps its singular name. `/anomalies?vehicle=<id>` is a deep link the Fuel Log
 * writes and reviewers forward, so renaming it would break every one of those in a ticket or an inbox
 * — silently, by widening the queue to the whole fleet rather than erroring. A one-element list is
 * exactly what a single id already meant, so `list()` reads both spellings with no legacy branch.
 * `useFuelLogFilters` keeps `?unit=` for the same reason and says so at more length.
 */
const vehicleIds = computed<string[]>({
  get: () => list("vehicle"),
  set: (v) => set({ vehicle: v.length ? v.join(",") : undefined }),
});
const severity = param("severity", ANOMALY_SEVERITIES);
const search = param("search");
const from = param("from");
const to = param("to");
const reefer = param("reefer", ["1"]);

const STATUS_VALUES = ["open", "investigating", "resolved", "dismissed"] as const;
/** `all` is the reader's explicit "every status"; ABSENT is the default, which depends on the link. */
const statusParam = param("status", [...STATUS_VALUES, "all"]);
const status = computed<string>({
  get: () => {
    if (statusParam.value === "all") return "";
    if (statusParam.value) return statusParam.value;
    // A link that names trucks wants their whole history, resolved cases included.
    return vehicleIds.value.length ? "" : "open";
  },
  set: (v) => (statusParam.value = v || "all"),
});

const filters = computed<AnomalyFilters>(() => ({
  status: status.value || undefined,
  severity: severity.value || undefined,
  vehicleIds: vehicleIds.value.length ? vehicleIds.value : undefined,
  reeferOnly: reefer.value === "1" ? true : undefined,
  from: from.value || undefined,
  to: to.value || undefined,
}));

/** The segmented control at the top of the page. Presence in the URL, not a boolean spelled out. */
const reeferOnly = computed(() => reefer.value === "1");
const setReeferOnly = (on: boolean) => (reefer.value = on ? "1" : "");

const { data: anomalies, isLoading, isError, error, refetch, isFetching } = useAnomaliesQuery(filters);
const { data: txnDriverMap } = useAnomalyTxnDrivers(anomalies);
const transition = useAnomalyTransition();


const setFrom = (v: string | undefined) => (from.value = v ?? "");
const setTo = (v: string | undefined) => (to.value = v ?? "");

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
/**
 * The fleet, by unit number.
 *
 * No `All units` row: `FilterSelect` renders that itself for a multi-select, and a second one in the
 * options would look selectable while meaning the absence of a selection. And no facet union of the
 * kind `unitFilter.ts` builds — `anomalies.vehicle_id` is a foreign key, so a case can only ever name
 * a truck the fleet has, and offering a unit that no case can carry would be a menu wider than its
 * data rather than narrower.
 */
const unitOptions = computed(() =>
  [...(vehicles.value ?? [])]
    .sort((a, b) => a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true }))
    .map((v) => ({ value: v.id, label: v.unit_number })),
);

const activeFilterCount = computed(() => {
  const f = filters.value;
  return [f.severity, f.vehicleIds?.length, f.from, f.to].filter(Boolean).length + (search.value.trim() ? 1 : 0);
});
/**
 * Back to the work queue. Clearing `status` rather than writing `open` is what makes this correct
 * for BOTH entry points: with no truck, absence already means `open`; with one, absence means that
 * truck's whole history — and the truck is cleared here too, so absence resolves to `open` either
 * way. Writing `open` explicitly would have left `?status=open` in a URL that says nothing new.
 * `reefer` is deliberately NOT cleared: it is the tab, not a filter, and the button beside it says so.
 */
function resetFilters() {
  statusParam.value = "";
  severity.value = "";
  vehicleIds.value = [];
  from.value = "";
  to.value = "";
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
  { key: "severity", label: "Severity", sortable: true, width: "sm" },
  { key: "type", label: "Type", sortable: true, width: "lg", cellClass: "text-ink-secondary" },
  { key: "vehicle", label: "Truck", sortable: true, width: "sm", cellClass: "font-medium text-ink" },
  { key: "trailer", label: "Trailer", sortable: true, width: "sm", cellClass: "text-ink-secondary" },
  { key: "driver", label: "Driver", sortable: true, width: "lg", cellClass: "text-ink-secondary" },
  { key: "message", label: "Detail", width: "2xl", cellClass: "max-w-md truncate text-ink-secondary" },
  { key: "status", label: "Status", sortable: true, width: "md" },
  { key: "when", label: "When", sortable: true, width: "md", cellClass: "text-ink-muted" },
];
// Reefer tab: lead with the assets the reviewer needs — truck, its reefer trailer, and the driver on the fill.
const reeferColumns: DataTableColumn[] = [
  { key: "vehicle", label: "Truck", sortable: true, width: "sm", cellClass: "font-medium text-ink" },
  { key: "trailer", label: "Trailer", sortable: true, width: "sm", cellClass: "text-ink-secondary" },
  { key: "driver", label: "Driver", sortable: true, width: "lg", cellClass: "text-ink-secondary" },
  { key: "severity", label: "Severity", sortable: true, width: "sm" },
  { key: "message", label: "Detail", width: "2xl", cellClass: "max-w-md truncate text-ink-secondary" },
  { key: "status", label: "Status", sortable: true, width: "md" },
  { key: "when", label: "When", sortable: true, width: "md", cellClass: "text-ink-muted" },
];
const columns = computed(() => (filters.value.reeferOnly ? reeferColumns : baseColumns));

/**
 * The sort, in the URL, with the page's own default and its own explicit "unsorted".
 *
 * ⚠ Three states have to be distinguishable and only two are expressible as presence/absence: the
 * page's default (`when`, newest first), a column the reader picked, and the third click of
 * `toggleSort`'s none → asc → desc → none cycle, which drops back to the order the API returned
 * (severity, then recency). Absence is the default, so "unsorted" needs a name — hence `sort=none`,
 * and hence this page not using `useUrlSort`, whose contract is that absence IS unsorted.
 */
const SORTABLE = [...new Set([...baseColumns, ...reeferColumns].filter((c) => c.sortable).map((c) => c.key))];
const sortKey = param("sort", [...SORTABLE, "none"]);
const sortDir = param("dir", SORT_DIRECTIONS);
const sort = computed<SortState>(() => ({
  key: sortKey.value === "none" ? null : sortKey.value || "when",
  dir: sortKey.value ? (sortDir.value === "desc" ? "desc" : "asc") : "desc",
}));
function onSort(key: string) {
  const next = toggleSort(sort.value, key);
  sortKey.value = next.key ?? "none";
  sortDir.value = next.key ? next.dir : "";
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
    filters, search, reeferOnly, setReeferOnly,
    status, severity, vehicleIds, statusOptions, severityOptions, unitOptions,
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
