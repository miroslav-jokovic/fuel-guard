import { computed, ref, watch } from "vue";
import { type IdleDateFilter } from "./useIdleScores";
import { useIdleBreakdown, type TruckBreakdown } from "./useIdleBreakdown";
import { useIdleDrivers } from "./useIdleDrivers";
import { useIdleCostBasis } from "./useIdleCostBasis";
import { useIdleCapabilities } from "./useIdleCapabilities";
import { useIdleSettings, useAdoptComfortBand } from "./useIdleSettings";
import { useIdleConfidence } from "./useIdleConfidence";
import { useToastStore } from "@/stores/toast";
import { toneClass } from "@/lib/badges";
import { sortRows, type SortState } from "@/lib/sort";
import { APU_TYPE_LABELS, type ApuType } from "@fuelguard/shared";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";

/** All state + logic for IdlingPage.vue: fleet KPIs, tabs, and the three tab tables. */
export function useIdlingPage() {
const usd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const dateFmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const PAGE_SIZE = 20;

// Date range (drives the driver leaderboard, the fleet KPIs, and the avoidable-idles tab). The picker
// emits YYYY-MM-DD; unset = the default last-30-days window. `to` is made end-of-day inclusive.
const dateFrom = ref<string | undefined>(undefined);
const dateTo = ref<string | undefined>(undefined);
const dateFilter = computed<IdleDateFilter>(() => ({
  from: dateFrom.value ? `${dateFrom.value}T00:00:00` : undefined,
  to: dateTo.value ? `${dateTo.value}T23:59:59` : undefined,
}));
// Range length (days) for precise annualization; defaults to 30 when no explicit range is set.
const rangeDays = computed(() => {
  if (dateFrom.value && dateTo.value) {
    const d = (Date.parse(`${dateTo.value}T23:59:59`) - Date.parse(`${dateFrom.value}T00:00:00`)) / 86_400_000;
    return Math.max(1, Math.round(d));
  }
  return 30;
});
const annualMultiplier = computed(() => 365 / rangeDays.value);
// Explicit dates so it's unambiguous which window the top cards + tables reflect (the picker lives lower in
// the tabs). Format the YYYY-MM-DD as a UTC instant so the calendar date isn't shifted by the browser tz.
const fmtDay = (d: string, withYear = true) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC", ...(withYear ? { year: "numeric" } : {}) });
const rangeLabel = computed(() => {
  const f = dateFrom.value, t = dateTo.value;
  if (f && t) return f === t ? fmtDay(f) : `${fmtDay(f, false)} – ${fmtDay(t)}`;
  if (f) return `since ${fmtDay(f)}`;
  if (t) return `through ${fmtDay(t)}`;
  return "last 30 days";
});

// Cost basis for idle $: burn rate from idle settings, price from the fleet's daily truck-stop diesel prices.
const costBasis = useIdleCostBasis();
const priceSource = computed(() => costBasis.value.priceSource);
const fuelPricePerGal = computed(() => costBasis.value.fuelPricePerGal);
const priceNote = computed(() => {
  const p = usd2(costBasis.value.fuelPricePerGal) + "/gal";
  return costBasis.value.priceSource === "truck_stops"
    ? `${p} · live truck-stop prices`
    : costBasis.value.priceSource === "settings"
      ? `${p} · from idle settings`
      : `${p} · default estimate`;
});

// Data sources. The driver leaderboard now comes from the new model (avoidable attributed via assignments).
const { data: driverRows, isLoading, isError, error, refetch, isFetching } = useIdleDrivers(dateFilter, costBasis);
// New per-truck engine-time + avoidable breakdown (the reworked model).
const { data: breakdown, isLoading: trkLoading, isError: trkIsError, error: trkError, isFetching: trkFetching, refetch: trkRefetch } = useIdleBreakdown(dateFilter, costBasis);
const fleet = computed(() => breakdown.value?.fleet ?? null);
const { data: caps } = useIdleCapabilities();
const { data: settings } = useIdleSettings();
const { data: confidence } = useIdleConfidence();
const adoptBand = useAdoptComfortBand();
const toast = useToastStore();
async function onAdoptBand() {
  const s = settings.value;
  if (!s || s.suggested_low_f == null || s.suggested_high_f == null) return;
  try {
    await adoptBand.mutateAsync({ low: s.suggested_low_f, high: s.suggested_high_f });
    toast.success("Comfort band adopted", "Re-sync idle to re-classify past events with the new band.");
  } catch (e) {
    toast.error("Couldn't adopt band", e instanceof Error ? e.message : undefined);
  }
}

const drivers = computed(() => driverRows.value ?? []);

// Capability badge styling (shared by the capability + avoidable tabs).
const CAP: Record<string, { label: string; cls: string }> = {
  apu: { label: "APU", cls: toneClass("success") },
  ecu_optimized: { label: "Optimized idle", cls: toneClass("success") },
  continuous_only: { label: "Continuous idle only", cls: toneClass("warning") },
  unknown: { label: "Unknown", cls: toneClass("neutral") },
};
const capBadge = (c: string) => CAP[c] ?? CAP.unknown!;

// ── tabs ─────────────────────────────────────────────────────────────────────
type TabKey = "trucks" | "drivers" | "capability";
const activeTab = ref<TabKey>("trucks");
const tabs = computed(() => [
  { key: "trucks" as const, label: "Trucks", count: breakdown.value?.trucks.length ?? 0 },
  { key: "drivers" as const, label: "Drivers", count: drivers.value.length },
  { key: "capability" as const, label: "Truck capability", count: caps.value?.length ?? 0 },
]);

// ── tab: Trucks — engine-on = drive + idle, with avoidable (the reworked view) ─────────────────
const trkRows = computed<TruckBreakdown[]>(() => breakdown.value?.trucks ?? []);
const trkSearch = ref("");
const trkCapFilter = ref("");
const trkConfidentOnly = ref(false);
const trkSort = ref<SortState>({ key: null, dir: "asc" });
const trkPage = ref(1);
const trkCapOptions = [
  { value: "", label: "All capability" },
  { value: "apu", label: "APU" },
  { value: "ecu_optimized", label: "Optimized idle" },
  { value: "continuous_only", label: "Continuous only" },
  { value: "unknown", label: "Unknown" },
];
const trkConfOptions = [
  { value: "", label: "All trucks" },
  { value: "confident", label: "Confident data only" },
];
const trkConfSel = computed({
  get: () => (trkConfidentOnly.value ? "confident" : ""),
  set: (v: string) => (trkConfidentOnly.value = v === "confident"),
});
const trkFilterCount = computed(() => (trkSearch.value.trim() ? 1 : 0) + (trkCapFilter.value ? 1 : 0) + (trkConfidentOnly.value ? 1 : 0));
const trkFiltered = computed(() => {
  const q = trkSearch.value.trim().toLowerCase();
  return trkRows.value.filter(
    (t) =>
      (!q || t.unit.toLowerCase().includes(q)) &&
      (!trkCapFilter.value || t.capability === trkCapFilter.value) &&
      (!trkConfidentOnly.value || t.confident),
  );
});
const trkSorted = computed(() =>
  trkSort.value.key ? sortRows(trkFiltered.value, trkSort.value, (r, k) => (r as unknown as Record<string, unknown>)[k]) : trkFiltered.value,
);
const trkPaged = computed(() => trkSorted.value.slice((trkPage.value - 1) * PAGE_SIZE, trkPage.value * PAGE_SIZE));
function clearTrk() {
  trkSearch.value = "";
  trkCapFilter.value = "";
  trkConfidentOnly.value = false;
}
watch(trkFiltered, () => (trkPage.value = 1));
const trkColumns: DataTableColumn[] = [
  { key: "unit", label: "Truck", sortable: true, cellClass: "font-medium text-ink" },
  { key: "engineOnH", label: "Engine hours", sortable: true, numeric: true },
  { key: "driveH", label: "Driving hours", sortable: true, numeric: true, cellClass: "text-ink-secondary" },
  { key: "idleH", label: "Idle hours", sortable: true, numeric: true, cellClass: "text-ink-secondary" },
  { key: "idlePct", label: "Idle %", sortable: true, numeric: true, cellClass: "text-ink-muted" },
  { key: "avoidableH", label: "Avoidable hours", sortable: true, numeric: true, cellClass: "font-semibold text-ink" },
  { key: "avoidableUsd", label: "Avoidable cost", sortable: true, numeric: true, cellClass: "font-semibold text-ink" },
  { key: "capability", label: "Idle capability" },
  { key: "coveragePct", label: "Data confidence", sortable: true, numeric: true, cellClass: "text-ink-muted" },
];

// ── collapsible "how scoring works" panel (replaces the always-on top blurb) ──
const showInfo = ref(false);
// ── collapsible data-confidence panel (coverage of the inputs behind the numbers) ──
const showConfidence = ref(false);
const confTone = (p: number) => (p >= 95 ? "text-success-700" : p >= 80 ? "text-warning-600" : "text-danger-700");
const confBar = (p: number) => (p >= 95 ? "bg-success-500" : p >= 80 ? "bg-warning-500" : "bg-danger-500");
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
  t.has_apu === true ? toneClass("success") : t.has_apu === false ? toneClass("neutral") : toneClass("warning");
const XCHECK: Record<string, { label: string; cls: string; title: string }> = {
  agree: { label: "Matches", cls: "text-success-600", title: "The data matches the recorded equipment" },
  disagree: { label: "Doesn't match", cls: "text-danger-600", title: "The data disagrees with the recorded equipment — worth a look" },
  na: { label: "–", cls: "text-ink-subtle", title: "Not enough data to compare" },
};
const xcheck = (c: string) => XCHECK[c] ?? XCHECK.na!;

// ── tab 1: driver scorecard ──────────────────────────────────────────────────
const scoreTone = (s: number) => (s >= 80 ? "text-success-700" : s >= 60 ? "text-warning-600" : "text-danger-700");

const drvSearch = ref("");
const drvSort = ref<SortState>({ key: null, dir: "asc" });
const drvPage = ref(1);
const drvFiltered = computed(() => {
  const q = drvSearch.value.trim().toLowerCase();
  return q ? drivers.value.filter((d) => d.driverName.toLowerCase().includes(q)) : drivers.value;
});
const drvSorted = computed(() => (drvSort.value.key ? sortRows(drvFiltered.value, drvSort.value, (r, k) => (r as unknown as Record<string, unknown>)[k]) : drvFiltered.value));
const drvRank = (i: number) => (drvPage.value - 1) * PAGE_SIZE + i + 1;
const drvPaged = computed(() =>
  drvSorted.value
    .slice((drvPage.value - 1) * PAGE_SIZE, drvPage.value * PAGE_SIZE)
    .map((d, i) => ({ ...d, rank: d.driverId === "__unattributed__" ? null : drvRank(i) })),
);
watch(drvFiltered, () => (drvPage.value = 1));

const drvColumns: DataTableColumn[] = [
  { key: "rank", label: "#", cellClass: "text-ink-subtle" },
  { key: "driverName", label: "Driver" },
  { key: "score", label: "Idle score", sortable: true, numeric: true },
  { key: "engineOnH", label: "Engine hours", sortable: true, numeric: true, cellClass: "text-ink-secondary" },
  { key: "idleH", label: "Idle hours", sortable: true, numeric: true, cellClass: "text-ink-secondary" },
  { key: "idlePct", label: "Idle %", sortable: true, numeric: true, cellClass: "text-ink-muted" },
  { key: "avoidableH", label: "Avoidable hours", sortable: true, numeric: true, cellClass: "text-ink-secondary" },
  { key: "avoidableUsd", label: "Money wasted", sortable: true, numeric: true, cellClass: "font-semibold text-ink" },
];

// ── tab: truck idle capability ───────────────────────────────────────────────
const capSearch = ref("");
const capFilter = ref<string>("");
const capSort = ref<SortState>({ key: null, dir: "asc" });
const capPage = ref(1);
const capOptions = [
  { value: "", label: "All capabilities" },
  { value: "apu", label: "APU" },
  { value: "ecu_optimized", label: "Optimized idle" },
  { value: "continuous_only", label: "Continuous idle only" },
  { value: "unknown", label: "Unknown" },
];
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

const capColumns: DataTableColumn[] = [
  { key: "unit_number", label: "Truck", sortable: true, cellClass: "font-medium text-ink" },
  { key: "recorded", label: "Recorded equipment" },
  { key: "idle_capability", label: "What the data shows" },
  { key: "idle_optimized_pct", label: "Engine off / optimized %", sortable: true, numeric: true, cellClass: "text-ink-secondary" },
  { key: "cross_check", label: "Cross-check", align: "center" },
];
  return {
    isLoading, isError, error, isFetching, refetch,
    breakdown, fleet, trkLoading, trkIsError, trkError, trkFetching, trkRefetch,
    trkSearch, trkCapFilter, trkCapOptions, trkConfSel, trkConfOptions, trkSort, trkPage,
    trkFilterCount, trkFiltered, trkPaged, clearTrk, trkColumns,
    usd, usd2, dateFmt, PAGE_SIZE,
    settings, confidence, adoptBand, onAdoptBand,
    tabs, activeTab, showInfo, showConfidence,
    confTone, confBar, suggestionDiffers, fleetOptimizedPct,
    capBadge, xcheck, scoreTone, recordedLabel, recordedCls,
    dateFrom, dateTo, rangeDays, annualMultiplier, rangeLabel,
    priceSource, fuelPricePerGal, priceNote,
    drvSearch, drvSort, drvPage, drvFiltered, drvPaged, drvColumns,
    capSearch, capFilter, capOptions, capSort, capPage, capFilterCount, capFiltered, capPaged, clearCap, capColumns,
  };
}
