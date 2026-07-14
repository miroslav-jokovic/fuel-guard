<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useIdleScores } from "@/features/fleet/useIdleScores";
import { useIdleCapabilities } from "@/features/fleet/useIdleCapabilities";
import { useIdleSettings, useAdoptComfortBand } from "@/features/fleet/useIdleSettings";
import { useToastStore } from "@/stores/toast";
import { useLongIdles } from "@/features/fleet/useLongIdles";
import { useIdleConfidence } from "@/features/fleet/useIdleConfidence";
import TablePagination from "@/components/TablePagination.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import { toneClass } from "@/lib/badges";
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
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Avoidable idling costs, driver idle scores, and truck idle-reduction capability — last 30 days." />

    <!-- Fleet money summary (KPIs, always visible) -->
    <div v-if="!isLoading && !isError && data" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <BaseCard>
        <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Money wasted idling (last 30 days)</dt>
        <dd class="mt-1 text-2xl font-bold text-danger-700">{{ usd(data.fleetDiscretionaryCost) }}</dd>
        <dd class="mt-0.5 text-xs text-ink-subtle">{{ data.fleetDiscretionaryGal.toLocaleString() }} gal of avoidable idle</dd>
      </BaseCard>
      <BaseCard>
        <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Avoidable idle hours</dt>
        <dd class="mt-1 text-2xl font-bold text-ink">{{ data.fleetDiscretionaryHours.toLocaleString() }}<span class="text-base font-normal text-ink-subtle"> / {{ data.fleetIdleHours.toLocaleString() }} total</span></dd>
      </BaseCard>
      <BaseCard>
        <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Projected yearly waste</dt>
        <dd class="mt-1 text-2xl font-bold text-ink">{{ usd(data.fleetDiscretionaryCost * 12) }}</dd>
        <dd class="mt-0.5 text-xs text-ink-subtle">at the current 30-day rate</dd>
      </BaseCard>
    </div>

    <!-- Tab strip + info toggle -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex gap-1 rounded-lg bg-surface-muted p-1 text-sm">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="rounded-md px-3 py-1.5 font-medium transition"
          :class="activeTab === t.key ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink-secondary'"
          @click="activeTab = t.key"
        >
          {{ t.label }} <span class="ml-0.5 text-ink-subtle">{{ t.count }}</span>
        </button>
      </div>
      <div class="flex items-center gap-4">
        <BaseButton variant="ghost" size="sm" @click="showConfidence = !showConfidence">
          Data confidence
          <span v-if="confidence && confidence.overall != null" class="font-bold" :class="confTone(confidence.overall)">{{ confidence.overall }}%</span>
        </BaseButton>
        <BaseButton variant="ghost" size="sm" @click="showInfo = !showInfo">
          {{ showInfo ? "Hide" : "How idle is scored" }}
        </BaseButton>
      </div>
    </div>

    <!-- Collapsible explanation + comfort band (was the always-on top blurb) -->
    <BaseCard v-if="showInfo" padding="sm" class="space-y-3 text-sm">
      <p class="text-ink-secondary">
        We only count idling that could have been avoided: the engine running while parked, in comfortable
        weather, with no work being done. We don't count short stops, idling to run equipment (PTO), or idling to
        heat or cool the cab in extreme weather. Only <strong>avoidable</strong> idle affects a driver's score and
        the wasted-money total.
      </p>
      <p v-if="settings" class="text-ink-secondary">
        <span class="text-ink-muted">Comfortable-weather range (idle outside it counts as weather-excused — heating or cooling the cab):</span>
        <span class="ml-1 font-medium text-ink">{{ settings.comfort_low_f }}–{{ settings.comfort_high_f }}°F</span>
        <span class="ml-1 text-ink-subtle">· idle ≥ {{ settings.min_idle_minutes }} min scored</span>
        <span v-if="suggestionDiffers" class="ml-2 text-brand-600">
          · learned from your data: <strong>{{ settings.suggested_low_f }}–{{ settings.suggested_high_f }}°F</strong>
          <button
            type="button"
            :disabled="adoptBand.isPending.value"
            class="ml-1 rounded bg-brand-600 px-2 py-0.5 text-xs font-medium text-ink-inverse hover:bg-brand-500 disabled:opacity-50"
            @click="onAdoptBand"
          >
            {{ adoptBand.isPending.value ? "Adopting…" : "Adopt" }}
          </button>
          <span class="ml-1 text-ink-subtle">then re-sync to re-classify</span>
        </span>
      </p>
      <p v-if="fleetOptimizedPct != null" class="text-ink-secondary">
        <span class="text-ink-muted">Optimized-idle adoption:</span>
        <span class="ml-1 font-medium text-ink">{{ fleetOptimizedPct }}%</span>
        <span class="ml-1 text-ink-subtle">of parked time on APU or optimized idle (learned per truck)</span>
      </p>
    </BaseCard>

    <!-- Data confidence: how complete the inputs behind these numbers are -->
    <BaseCard v-if="showConfidence && confidence" padding="sm" class="space-y-3 text-sm">
      <div class="flex items-center justify-between">
        <p class="font-medium text-ink">Data confidence</p>
        <p v-if="confidence.overall != null" class="text-lg font-bold" :class="confTone(confidence.overall)">{{ confidence.overall }}%</p>
      </div>
      <p class="text-xs text-ink-muted">How complete the inputs behind these numbers are. Raise the low bars to raise your confidence — each note says how.</p>
      <div v-for="m in confidence.metrics" :key="m.key" class="space-y-1">
        <div class="flex items-center justify-between text-xs">
          <span class="text-ink-secondary">{{ m.label }}</span>
          <span class="font-medium tabular-nums" :class="confTone(m.pct)">
            {{ m.total ? m.pct + "%" : "no data yet" }}
            <span class="ml-1 font-normal text-ink-subtle">({{ m.covered }}/{{ m.total }})</span>
          </span>
        </div>
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
          <div class="h-full rounded-full" :class="confBar(m.pct)" :style="{ width: (m.total ? m.pct : 0) + '%' }"></div>
        </div>
        <p class="text-xs text-ink-subtle">{{ m.note }}</p>
      </div>
    </BaseCard>

    <!-- ── TAB: Drivers ──────────────────────────────────────────────────────── -->
    <template v-if="activeTab === 'drivers'">
      <FilterBar
        v-model:search="drvSearch"
        search-placeholder="Search driver…"
        :count="drvFiltered.length"
        count-label="drivers"
      />
      <DataTable
        :columns="drvColumns"
        :rows="drvPaged"
        row-key="driverId"
        :loading="isLoading"
        :error="isError ? (error instanceof Error ? error.message : 'Failed to load') : null"
        :retrying="isFetching"
        :sort="drvSort"
        empty-text="No idle events yet — run a Samsara sync from Settings → Data &amp; Sync to pull idling data."
        :row-class="(d) => (d.driverId === '__unattributed__' ? 'bg-surface-subtle/60' : '')"
        @sort="drvSort = toggleSort(drvSort, $event)"
        @retry="refetch"
      >
        <template #cell-driverName="{ row }">
          <span class="font-medium" :class="row.driverId === '__unattributed__' ? 'text-ink-subtle italic' : 'text-ink'">
            {{ row.driverName }}<span v-if="row.driverId === '__unattributed__'" class="ml-1 text-xs font-normal">(no driver assigned by Samsara)</span>
          </span>
        </template>
        <template #cell-score="{ row }">
          <span class="font-bold" :class="scoreTone(row.score)">{{ row.score }}</span>
        </template>
        <template #cell-discretionaryCost="{ value }">{{ usd2(value) }}</template>
        <template #cell-discretionaryPct="{ value }">{{ value }}%</template>
        <template #cell-trend="{ row }">
          <span class="font-bold" :class="trendCell(row.trend).cls" :title="trendCell(row.trend).title">{{ trendCell(row.trend).icon }}</span>
        </template>
        <template #footer>
          <TablePagination :page="drvPage" :page-size="PAGE_SIZE" :total="drvFiltered.length" @update:page="drvPage = $event" />
        </template>
      </DataTable>
    </template>

    <!-- ── TAB: Avoidable idles ──────────────────────────────────────────────── -->
    <template v-else-if="activeTab === 'avoidable'">
      <FilterBar
        v-model:search="avSearch"
        search-placeholder="Search driver or truck…"
        :count="avFiltered.length"
        count-label="sessions"
      >
        <template #filters>
          <FilterSelect v-model="avAvoidableSel" label="Avoidable" :options="avAvoidableOptions" />
        </template>
        <template #actions>
          <BaseButton v-if="avFilterCount" variant="ghost" size="sm" @click="clearAv">Clear filters</BaseButton>
        </template>
      </FilterBar>
      <DataTable
        :columns="avColumns"
        :rows="avPaged"
        :row-key="avRowKey"
        :sort="avSort"
        empty-text="No long avoidable idles in the last 30 days (2 hours or more)."
        :row-class="(r) => (r.avoidable ? 'bg-danger-50/40' : '')"
        @sort="avSort = toggleSort(avSort, $event)"
      >
        <template #cell-startedAt="{ value }">{{ dateFmt(value) }}</template>
        <template #cell-costUsd="{ value }">{{ usd2(value) }}</template>
        <template #cell-equipment="{ value }">
          <span :class="['inline-flex rounded px-1.5 py-0.5 text-xs font-semibold', equipBadge(value).cls]" :title="equipBadge(value).title">{{ equipBadge(value).label }}</span>
        </template>
        <template #footer>
          <TablePagination :page="avPage" :page-size="PAGE_SIZE" :total="avFiltered.length" @update:page="avPage = $event" />
        </template>
      </DataTable>
    </template>

    <!-- ── TAB: Truck capability ─────────────────────────────────────────────── -->
    <template v-else>
      <FilterBar
        v-model:search="capSearch"
        search-placeholder="Search truck…"
        :count="capFiltered.length"
        count-label="trucks"
      >
        <template #filters>
          <FilterSelect v-model="capFilter" label="Capability" :options="capOptions" />
        </template>
        <template #actions>
          <BaseButton v-if="capFilterCount" variant="ghost" size="sm" @click="clearCap">Clear filters</BaseButton>
        </template>
      </FilterBar>
      <DataTable
        :columns="capColumns"
        :rows="capPaged"
        row-key="unit_number"
        :sort="capSort"
        empty-text="No trucks match. Set each truck's idle-reduction equipment on the Vehicles page; the data column fills in after a Samsara sync."
        :row-class="(t) => (t.cross_check === 'disagree' ? 'bg-danger-50/40' : '')"
        @sort="capSort = toggleSort(capSort, $event)"
      >
        <template #cell-recorded="{ row }">
          <span :class="['inline-flex rounded px-1.5 py-0.5 text-xs font-semibold', recordedCls(row)]" title="What you recorded on the Vehicles page">{{ recordedLabel(row) }}</span>
          <span v-if="row.has_optimized_idle === true" :class="['ml-1 inline-flex rounded px-1.5 py-0.5 text-xs font-semibold', toneClass('success')]" title="OEM optimized idle recorded">Optimized idle</span>
        </template>
        <template #cell-idle_capability="{ value }">
          <span :class="['inline-flex rounded px-1.5 py-0.5 text-xs font-semibold', capBadge(value).cls]" title="Learned from the truck's engine on/off pattern">{{ capBadge(value).label }}</span>
        </template>
        <template #cell-idle_optimized_pct="{ value }">{{ value }}%</template>
        <template #cell-cross_check="{ value }">
          <span class="font-semibold" :class="xcheck(value).cls" :title="xcheck(value).title">{{ xcheck(value).label }}</span>
        </template>
        <template #footer>
          <TablePagination :page="capPage" :page-size="PAGE_SIZE" :total="capFiltered.length" @update:page="capPage = $event" />
        </template>
      </DataTable>
    </template>
  </div>
</template>
