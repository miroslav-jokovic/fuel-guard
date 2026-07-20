import { computed, ref, watch } from "vue";
import { useIdleScores } from "./useIdleScores";
import { useIdleCapabilities } from "./useIdleCapabilities";
import { useIdleSettings, useAdoptComfortBand } from "./useIdleSettings";
import { useLongIdles } from "./useLongIdles";
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

// Data sources.
const { data, isLoading, isError, error, refetch, isFetching } = useIdleScores();
const { data: caps } = useIdleCapabilities();
const { data: longIdles } = useLongIdles();
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

const drivers = computed(() => data.value?.drivers ?? []);

// Capability badge styling (shared by the capability + avoidable tabs).
const CAP: Record<string, { label: string; cls: string }> = {
  apu: { label: "APU", cls: toneClass("success") },
  ecu_optimized: { label: "Optimized idle", cls: toneClass("success") },
  continuous_only: { label: "Continuous idle only", cls: toneClass("warning") },
  unknown: { label: "Unknown", cls: toneClass("neutral") },
};
const capBadge = (c: string) => CAP[c] ?? CAP.unknown!;

// Equipment badge for the "Biggest idle events to coach" list (from the shared topAvoidableIdles equipment).
const EQUIP: Record<string, { label: string; cls: string; title: string }> = {
  apu: { label: "Engine off was possible (APU)", cls: toneClass("danger"), title: "This truck has an APU — the driver could have shut the main engine off and run it" },
  optimized_idle: { label: "Optimized idle (OEM)", cls: toneClass("success"), title: "OEM optimized idle cycles the engine on purpose — the engine running is the feature working, not driver waste" },
  none: { label: "No idle-reduction equipment", cls: toneClass("neutral"), title: "No APU or optimized idle — the main engine was the only way to keep the cab comfortable" },
  unknown: { label: "Equipment not recorded — set it", cls: toneClass("warning"), title: "Set this truck's equipment on the Vehicles page to enable coaching" },
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
const TREND: Record<string, { icon: string; cls: string; title: string }> = {
  down: { icon: "▼", cls: "text-success-600", title: "Improving — less avoidable idle than the prior week" },
  up: { icon: "▲", cls: "text-danger-600", title: "Worsening — more avoidable idle than the prior week" },
  flat: { icon: "▬", cls: "text-ink-subtle", title: "About the same as the prior week" },
  na: { icon: "–", cls: "text-ink-subtle", title: "Not enough recent data" },
};
const trendCell = (t: string) => TREND[t] ?? TREND.na!;

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
  { key: "discretionaryCost", label: "Money wasted", sortable: true, numeric: true, cellClass: "font-semibold text-ink" },
  { key: "discretionaryHours", label: "Avoidable hrs", sortable: true, numeric: true, cellClass: "text-ink-secondary" },
  { key: "totalIdleHours", label: "Total idle hrs", sortable: true, numeric: true, cellClass: "text-ink-muted" },
  { key: "discretionaryPct", label: "% avoidable", sortable: true, numeric: true, cellClass: "text-ink-secondary" },
  { key: "longIdleCount", label: "Long idles (1h+)", sortable: true, numeric: true, cellClass: "text-ink-muted" },
  { key: "trend", label: "Trend vs last week", align: "center" },
];

// ── tab 2: longest avoidable idles ───────────────────────────────────────────
const avSearch = ref("");
const avAvoidableOnly = ref(false);
const avSort = ref<SortState>({ key: null, dir: "asc" });
const avPage = ref(1);
const avFilterCount = computed(() => (avSearch.value.trim() ? 1 : 0) + (avAvoidableOnly.value ? 1 : 0));
// FilterSelect works with string option values ("" = no filter) — proxy the boolean "avoidable only" flag.
const avAvoidableOptions = [
  { value: "", label: "All long idles" },
  { value: "avoidable", label: "Avoidable only (has APU)" },
];
const avAvoidableSel = computed({
  get: () => (avAvoidableOnly.value ? "avoidable" : ""),
  set: (v) => (avAvoidableOnly.value = v === "avoidable"),
});
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

const avRowKey = (r: { unitNumber: string; startedAt: string; driverName: string }) => `${r.unitNumber}|${r.startedAt}|${r.driverName}`;
const avColumns: DataTableColumn[] = [
  { key: "driverName", label: "Driver", cellClass: "font-medium text-ink" },
  { key: "unitNumber", label: "Truck", cellClass: "text-ink-secondary" },
  { key: "startedAt", label: "Date", sortable: true, cellClass: "text-ink-muted" },
  { key: "hours", label: "Hours", sortable: true, numeric: true, cellClass: "text-ink-secondary" },
  { key: "costUsd", label: "Estimated cost", sortable: true, numeric: true, cellClass: "font-semibold text-ink" },
  { key: "equipment", label: "Equipment" },
];

// ── tab 3: truck idle capability ─────────────────────────────────────────────
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
  { key: "recorded", label: "Engine-off capable (recorded)" },
  { key: "idle_capability", label: "What the data shows" },
  { key: "idle_optimized_pct", label: "% time engine off/optimized", sortable: true, numeric: true, cellClass: "text-ink-secondary" },
  { key: "cross_check", label: "Cross-check", align: "center" },
];
  return {
    data, isLoading, isError, error, isFetching, refetch,
    usd, usd2, dateFmt, PAGE_SIZE,
    settings, confidence, adoptBand, onAdoptBand,
    tabs, activeTab, showInfo, showConfidence,
    confTone, confBar, suggestionDiffers, fleetOptimizedPct,
    capBadge, equipBadge, xcheck, trendCell, scoreTone, recordedLabel, recordedCls,
    drvSearch, drvSort, drvPage, drvFiltered, drvPaged, drvColumns,
    avSearch, avAvoidableSel, avAvoidableOptions, avSort, avPage, avFilterCount, avFiltered, avPaged, avRowKey, clearAv, avColumns,
    capSearch, capFilter, capOptions, capSort, capPage, capFilterCount, capFiltered, capPaged, clearCap, capColumns,
  };
}
