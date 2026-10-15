import { computed, ref, watch } from "vue";
import { type IdleDateFilter } from "./useIdleScores";
import { useIdleBreakdown, type TruckBreakdown } from "@/composables/useIdleBreakdown";
import { useIdleDrivers } from "./useIdleDrivers";
import { useIdleCostBasis } from "@/composables/useIdleCostBasis";
import { useIdleCapabilities } from "./useIdleCapabilities";
import { useIdleSettings, useAdoptComfortBand } from "./useIdleSettings";
import { useIdleConfidence } from "./useIdleConfidence";
import { avoidableCoverageLine, idlePricingLine, idleScopeLine, reducibleCoverageLine } from "./idleEstimateLines";
import { useToastStore } from "@/stores/toast";
import { toneClass } from "@/lib/badges";
import { sortRows } from "@silvicom/ui";
import { useQueryState } from "@silvicom/ui";
import { SORT_DIRECTIONS, useUrlSort } from "@/composables/useUrlSort";
import {
  APU_TYPE_LABELS,
  BEHAVES_LIKE_LABELS,
  EQUIPMENT_SOURCE_LABELS,
  formatDisplayDate,
  formatDisplayDayShort,
  IDLE_DEFAULT_WINDOW_DAYS,
  type ApuType,
  type BehavesLike,
} from "@silvicom/shared";
import { type DataTableColumn } from "@silvicom/ui";

/** All state + logic for IdlingPage.vue: fleet KPIs, tabs, and the three tab tables. */
export function useIdlingPage() {
const usd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const dateFmt = (iso: string) => formatDisplayDayShort(iso, iso);
const PAGE_SIZE = 20;

// The page's date window, its tab, and each tab's filters, sort and page live in the URL (D-US2), so
// reload, a pasted link and Back from a truck keep what the reader was looking at. The window and the
// tab are the PAGE's (unscoped: `from`, `to`, `tab`); the three tables share one route, so each one's
// list keys are scoped to its tab (`trucks.search`, `drivers.sort`, `capability.page`) — otherwise all
// three would own `?search=` and typing into one would filter the other two.
const qs = useQueryState();
const trkQs = useQueryState("trucks");
const drvQs = useQueryState("drivers");
const capQs = useQueryState("capability");
/** A hand-edited date that is not a calendar day reads as unset — the default window — not as a query. */
const isoDay = (key: string) => {
  const p = qs.param(key);
  return computed<string | undefined>({
    get: () => (/^\d{4}-\d{2}-\d{2}$/.test(p.value) && !Number.isNaN(Date.parse(p.value)) ? p.value : undefined),
    set: (v) => (p.value = v ?? ""),
  });
};

// Date range (drives the driver leaderboard, the fleet KPIs, and the avoidable-idles tab). The picker
// emits YYYY-MM-DD; unset = the default last-30-days window. `to` is made end-of-day inclusive.
const dateFrom = isoDay("from");
const dateTo = isoDay("to");
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
  return IDLE_DEFAULT_WINDOW_DAYS;
});
const annualMultiplier = computed(() => 365 / rangeDays.value);
// Explicit dates so it's unambiguous which window the top cards + tables reflect (the picker lives lower in
// the tabs). Format the YYYY-MM-DD as a UTC instant so the calendar date isn't shifted by the browser tz.
const fmtDay = (d: string, withYear = true) =>
  withYear ? formatDisplayDate(d, d) : formatDisplayDayShort(d, d);
const rangeLabel = computed(() => {
  const f = dateFrom.value, t = dateTo.value;
  if (f && t) return f === t ? fmtDay(f) : `${fmtDay(f, false)} – ${fmtDay(t)}`;
  if (f) return `since ${fmtDay(f)}`;
  if (t) return `through ${fmtDay(t)}`;
  return `last ${IDLE_DEFAULT_WINDOW_DAYS} days`;
});

// Cost basis for idle $: burn rate from idle settings, price from the fleet's daily truck-stop diesel prices.
const costBasis = useIdleCostBasis();
const priceSource = computed(() => costBasis.value.priceSource);
const fuelPricePerGal = computed(() => costBasis.value.fuelPricePerGal);

// Data sources. The driver leaderboard now comes from the new model (avoidable attributed via assignments).
const { data: driverRows, isLoading, isError, error, refetch, isFetching } = useIdleDrivers(dateFilter, costBasis);
// New per-truck engine-time + avoidable breakdown (the reworked model).
const { data: breakdown, isLoading: trkLoading, isError: trkIsError, error: trkError, isFetching: trkFetching, refetch: trkRefetch } = useIdleBreakdown(dateFilter, costBasis);
const fleet = computed(() => breakdown.value?.fleet ?? null);
/** What each total covers, how it was priced, and how far the data reaches — beside it (`idleEstimateLines`). */
const estimate = computed(() => {
  const f = fleet.value;
  if (!f) return null;
  return {
    scope: idleScopeLine(f),
    avoidableCoverage: avoidableCoverageLine(f),
    avoidablePricing: idlePricingLine(f.avoidablePricing, costBasis.value),
    reducibleCoverage: reducibleCoverageLine(f),
    reduciblePricing: idlePricingLine(f.reduciblePricing, costBasis.value),
  };
});
// The HOS duty split (rest vs on-duty idle) now rides on the same pre-aggregated rollup rows the
// breakdown reads — no separate raw-table scan, no silent-failure path.
// The Truck capability tab's own read: its loading and failure belong to its table, or a pending or failed
// read says "No trucks match" (design verdict, E8).
const { data: caps, isLoading: capLoading, isError: capIsError, error: capError, isFetching: capFetching, refetch: capRefetch } = useIdleCapabilities();
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
  // Learned from engine-off time only — an APU and a plain overnight shutdown look identical here, so we do
  // NOT claim "APU". This badge is the truck's observed rest behavior, distinct from the recorded equipment.
  apu: { label: "Engine-off rest", cls: toneClass("success") },
  ecu_optimized: { label: "Optimized idle", cls: toneClass("success") },
  continuous_only: { label: "Continuous idle only", cls: toneClass("warning") },
  unknown: { label: "Unknown", cls: toneClass("neutral") },
};
const capBadge = (c: string) => CAP[c] ?? CAP.unknown!;
// Long-park behaviour (IE1, D-IE7) — evidence, shown beside the declaration and never in its place.
const BEHAVES_TONE: Record<BehavesLike, string> = {
  battery_apu: "success",
  no_apu: "warning",
  mixed: "neutral",
  not_enough_parks: "neutral",
};
const behavesBadge = (b: BehavesLike) => ({ label: BEHAVES_LIKE_LABELS[b], cls: toneClass(BEHAVES_TONE[b]) });
const sourceLabel = (s: string | null) =>
  s ? (EQUIPMENT_SOURCE_LABELS as Record<string, string>)[s] ?? s : "Not entered";

// ── tabs ─────────────────────────────────────────────────────────────────────
// In `AppTabs`' shape: it owns the roles, the roving tabindex and the arrow keys the hand-rolled strip never
// had (design verdict, E8). `AppTabs` emits a plain string, so the key is one. A count shows once its read has
// answered: a pending or failed read is not zero trucks.
const TAB_KEYS = ["trucks", "drivers", "capability"];
const activeTab = qs.param("tab", TAB_KEYS, "trucks");
/** Which reads have answered — the result counts above each table wait on the same thing. */
const answered = computed(() => ({ trucks: breakdown.value != null, drivers: driverRows.value != null, capability: caps.value != null }));
const tabs = computed(() => [
  { value: "trucks", label: "Trucks", badge: breakdown.value?.trucks.length },
  { value: "drivers", label: "Drivers", badge: driverRows.value?.length },
  { value: "capability", label: "Truck capability", badge: caps.value?.length },
]);

// ── tab: Trucks — engine-on = drive + idle, with avoidable (the reworked view) ─────────────────
const trkRows = computed<TruckBreakdown[]>(() => breakdown.value?.trucks ?? []);
const trkSearch = trkQs.param("search");
const trkPage = trkQs.page();
const trkCapOptions = [
  { value: "", label: "All capability" },
  { value: "apu", label: "Engine-off rest" },
  { value: "ecu_optimized", label: "Optimized idle" },
  { value: "continuous_only", label: "Continuous only" },
  { value: "unknown", label: "Unknown" },
];
const trkConfOptions = [
  { value: "", label: "All trucks" },
  { value: "confident", label: "Confident data only" },
];
const trkCapFilter = trkQs.param("capability", trkCapOptions.map((o) => o.value).filter(Boolean));
const trkConfSel = trkQs.param("data", trkConfOptions.map((o) => o.value).filter(Boolean));
const trkConfidentOnly = computed(() => trkConfSel.value === "confident");
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
  trkQs.set({ search: undefined, capability: undefined, data: undefined });
}
// On the inputs, not on `trkFiltered`: the filtered list also changes when the breakdown arrives, and
// watching it would throw a pasted `?trucks.page=2` away the moment the table loaded (D-US2).
watch([trkSearch, trkCapFilter, trkConfSel, dateFrom, dateTo], () => (trkPage.value = 1));
/**
 * The Trucks table leads with money: truck, the two costs and their hours, how much of the running was idle,
 * and whether the data can be trusted — seven columns, so the costs are on screen at a desktop width
 * (design verdict 2026-10-03, E3: thirteen columns put them ninth and eleventh, off the right edge). The time
 * split behind them (engine, driving, idle, off-duty and on-duty idle) and the learned capability open under
 * each truck (`trkExpanded`), where the reader asking "why this figure" goes, instead of competing with it.
 * Rows arrive largest avoidable cost first (`computeIdleBreakdown`), which is the ranking this order serves.
 */
const trkColumns: DataTableColumn[] = [
  { key: "unit", label: "Truck", sortable: true, cellClass: "font-medium text-ink" },
  { key: "avoidableUsd", label: "Avoidable cost", sortable: true, numeric: true, cellClass: "font-semibold text-ink" },
  { key: "avoidableH", label: "Avoidable hours", sortable: true, numeric: true, cellClass: "text-ink-secondary" },
  // Reported for EVERY truck, including the ones with no equipment (where avoidable is a correct zero).
  // This is the pair that stops the page reading as empty for most of the fleet. Worded as the card above
  // names it: "Reducible cost" said the same thing in a second word.
  { key: "reducibleUsd", label: "Needs an APU, cost", sortable: true, numeric: true, cellClass: "text-ink-secondary" },
  { key: "reducibleH", label: "Needs an APU, hours", sortable: true, numeric: true, cellClass: "text-ink-secondary" },
  { key: "idlePct", label: "Idle %", sortable: true, numeric: true, cellClass: "text-ink-muted" },
  { key: "coveragePct", label: "Data completeness", sortable: true, numeric: true, cellClass: "text-ink-muted" },
];
const sortableKeys = (cols: DataTableColumn[]) => cols.filter((c) => c.sortable).map((c) => c.key);
const { sort: trkSort, onSort: onTrkSort } = useUrlSort(
  trkQs.param("sort", sortableKeys(trkColumns)),
  trkQs.param("dir", SORT_DIRECTIONS),
);
const trkExpanded = ref(new Set<string>());
function toggleTrk(row: TruckBreakdown) {
  const next = new Set(trkExpanded.value);
  if (next.has(row.vehicleId)) next.delete(row.vehicleId);
  else next.add(row.vehicleId);
  trkExpanded.value = next;
}
/** What opens under a truck: where its running time went. `null` (no duty split) prints as a dash. */
const hours = (h: number | null) => (h == null ? "—" : `${h.toLocaleString()} h`);
const trkDetail = (t: TruckBreakdown) => [
  { label: "Engine hours", value: hours(t.engineOnH) },
  { label: "Driving", value: hours(t.driveH) },
  { label: "Idling", value: hours(t.idleH) },
  { label: "Idling while off duty or sleeping", value: hours(t.restIdleH) },
  { label: "Idling on duty", value: hours(t.workIdleH) },
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
  agree: { label: "Matches", cls: "text-success-600", title: "The long parks match the recorded equipment" },
  disagree: { label: "Check this truck", cls: "text-danger-600", title: "The long parks say the opposite of the recorded equipment, or the truck has none recorded — check it and correct the Vehicles page if needed" },
  na: { label: "–", cls: "text-ink-tertiary", title: "Mixed or too few long parks to compare" },
};
const xcheck = (c: string) => XCHECK[c] ?? XCHECK.na!;

// ── tab 1: driver scorecard ──────────────────────────────────────────────────
const scoreTone = (s: number) => (s >= 80 ? "text-success-700" : s >= 60 ? "text-warning-600" : "text-danger-700");

const drvSearch = drvQs.param("search");
// The date window is NOT counted or cleared by any tab: it also sets the fleet KPI cards above the
// tabs, so it is the page's scope rather than one table's filter (clearTrk/clearCap never touched it).
const drvFilterCount = computed(() => (drvSearch.value.trim() ? 1 : 0));
function clearDrv() { drvQs.set({ search: undefined }); }
const drvPage = drvQs.page();
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
watch([drvSearch, dateFrom, dateTo], () => (drvPage.value = 1));

const drvColumns: DataTableColumn[] = [
  { key: "rank", label: "#", cellClass: "text-ink-tertiary" },
  { key: "driverName", label: "Driver" },
  { key: "score", label: "Idle score", sortable: true, numeric: true },
  { key: "engineOnH", label: "Engine hours", sortable: true, numeric: true, cellClass: "text-ink-secondary" },
  { key: "idleH", label: "Idle hours", sortable: true, numeric: true, cellClass: "text-ink-secondary" },
  { key: "idlePct", label: "Idle %", sortable: true, numeric: true, cellClass: "text-ink-muted" },
  { key: "avoidableH", label: "Avoidable hours", sortable: true, numeric: true, cellClass: "text-ink-secondary" },
  { key: "avoidableUsd", label: "Estimated avoidable fuel cost", sortable: true, numeric: true, cellClass: "font-semibold text-ink" },
];
// Declared after the columns it derives from; `drvSorted` above reads it lazily, so the order is safe.
const { sort: drvSort, onSort: onDrvSort } = useUrlSort(
  drvQs.param("sort", sortableKeys(drvColumns)),
  drvQs.param("dir", SORT_DIRECTIONS),
);

// ── tab: truck idle capability ───────────────────────────────────────────────
const capSearch = capQs.param("search");
const capPage = capQs.page();
const capOptions = [
  { value: "", label: "All trucks" },
  { value: "review", label: "Check this truck" },
  ...(Object.keys(BEHAVES_LIKE_LABELS) as BehavesLike[]).map((b) => ({ value: b, label: BEHAVES_LIKE_LABELS[b] })),
];
const capFilter = capQs.param("parks", capOptions.map((o) => o.value).filter(Boolean));
const capFilterCount = computed(() => (capSearch.value.trim() ? 1 : 0) + (capFilter.value ? 1 : 0));
const capFiltered = computed(() => {
  const q = capSearch.value.trim().toLowerCase();
  return (caps.value ?? []).filter(
    (t) =>
      (!capFilter.value || (capFilter.value === "review" ? t.cross_check === "disagree" : t.behaves_like === capFilter.value)) &&
      (!q || t.unit_number.toLowerCase().includes(q) || (t.batch ?? "").toLowerCase().includes(q)),
  );
});
const capSorted = computed(() => (capSort.value.key ? sortRows(capFiltered.value, capSort.value, (r, k) => (r as unknown as Record<string, unknown>)[k]) : capFiltered.value));
const capPaged = computed(() => capSorted.value.slice((capPage.value - 1) * PAGE_SIZE, capPage.value * PAGE_SIZE));
function clearCap() { capQs.set({ search: undefined, parks: undefined }); }
watch([capSearch, capFilter], () => (capPage.value = 1));

const capColumns: DataTableColumn[] = [
  { key: "unit_number", label: "Truck", sortable: true, cellClass: "font-medium text-ink" },
  { key: "batch", label: "Bought as", sortable: true, cellClass: "text-ink-secondary" },
  { key: "recorded", label: "Recorded equipment" },
  { key: "behaves_like", label: "Long parks, last 45 days" },
  { key: "idling_pct", label: "Parks mostly running", sortable: true, numeric: true, cellClass: "text-ink-secondary" },
  { key: "off_pct", label: "Parks mostly off", sortable: true, numeric: true, cellClass: "text-ink-secondary" },
  { key: "cross_check", label: "Cross-check" },
];
const { sort: capSort, onSort: onCapSort } = useUrlSort(
  capQs.param("sort", sortableKeys(capColumns)),
  capQs.param("dir", SORT_DIRECTIONS),
);
  return {
    isLoading, isError, error, isFetching, refetch,
    breakdown, fleet, trkLoading, trkIsError, trkError, trkFetching, trkRefetch,
    trkSearch, trkCapFilter, trkCapOptions, trkConfSel, trkConfOptions, trkSort, onTrkSort, trkPage,
    trkFilterCount, trkFiltered, trkPaged, clearTrk, trkColumns, trkExpanded, toggleTrk, trkDetail,
    usd, usd2, dateFmt, PAGE_SIZE,
    settings, confidence, adoptBand, onAdoptBand,
    tabs, answered, activeTab, showInfo, showConfidence,
    confTone, confBar, suggestionDiffers, fleetOptimizedPct,
    capBadge, behavesBadge, sourceLabel, xcheck, scoreTone, recordedLabel, recordedCls,
    dateFrom, dateTo, rangeDays, annualMultiplier, rangeLabel,
    priceSource, fuelPricePerGal, estimate,
    drvSearch, drvFilterCount, clearDrv, drvSort, onDrvSort, drvPage, drvFiltered, drvPaged, drvColumns,
    capSearch, capFilter, capOptions, capSort, onCapSort, capPage, capFilterCount, capFiltered, capPaged, clearCap, capColumns,
    capLoading, capIsError, capError, capFetching, capRefetch,
  };
}
