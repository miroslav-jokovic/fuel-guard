<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { TrophyIcon, ArrowDownTrayIcon } from "@heroicons/vue/24/outline";
import { useSessionStore } from "@/stores/session";
import { useDriverPerformance, type PerformanceDisplayRow } from "@/features/drivers/useDriverPerformance";
import { useDriverPerformanceWeeksList, useDriverPerformanceWeek } from "@/features/drivers/useDriverPerformanceWeeks";
import { useSyncDriverScores } from "@/features/drivers/useSyncDriverScores";
import { useToastStore } from "@/stores/toast";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import TablePagination from "@/components/TablePagination.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import { toneClass } from "@/lib/badges";
import { toggleSort, sortRows, type SortState } from "@/lib/sort";

const session = useSessionStore();
const toast = useToastStore();

const PAGE_SIZE = 20;

const selectedWeek = ref<string | null>(null); // null = "This week (live)"
const isLive = computed(() => selectedWeek.value === null);

const live = useDriverPerformance();
const { data: weeksList } = useDriverPerformanceWeeksList();
const selectedWeekRef = computed(() => selectedWeek.value);
const frozen = useDriverPerformanceWeek(selectedWeekRef);

const REASON_LABEL: Record<string, string> = {
  below_min_miles: "Below miles gate",
  below_min_hours: "Below hours gate",
  no_safety: "No safety data",
};

const rows = computed<PerformanceDisplayRow[]>(() => {
  if (isLive.value) return live.data.value?.rows ?? [];
  return (frozen.data.value ?? []).map((r) => ({
    driverId: r.driver_id ?? "",
    driverName: r.driver_name,
    rank: r.rank,
    trailingFinal: r.trailing_final,
    weekFinal: r.week_final,
    isWinner: r.is_winner,
    safetyScore: r.safety_score,
    efficiencyScore: r.efficiency_score,
    idleScore: r.idle_score,
    safetyPct: r.safety_pct,
    efficiencyPct: r.efficiency_pct,
    idlePct: r.idle_pct,
    miles: r.drive_distance_mi,
    driveHours: r.drive_time_hours,
    eligible: r.eligible,
    ineligibleReason: r.ineligible_reason,
  }));
});
const winners = computed(() => rows.value.filter((r) => r.isWinner).slice(0, 3));
const isLoading = computed(() => (isLive.value ? live.isLoading.value : frozen.isLoading.value));
const isError = computed(() => (isLive.value ? live.isError.value : frozen.isError.value));

// ── Toolbar: Week + Status filters, driver search (standard FilterBar, per docs/DESIGN-SYSTEM.md §3) ──
const weekProxy = computed({
  get: () => selectedWeek.value ?? "",
  set: (v: string) => (selectedWeek.value = v || null),
});
const weekOptions = computed(() => [
  { value: "", label: "This week (live)" },
  ...(weeksList.value ?? []).map((w) => ({ value: w.weekStart, label: `${w.weekStart} → ${w.weekEnd}` })),
]);
const statusSel = ref("");
const statusOptions = [
  { value: "", label: "All drivers" },
  { value: "eligible", label: "Eligible only" },
  { value: "ineligible", label: "Not ranked" },
];
const search = ref("");

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  let out = rows.value;
  if (q) out = out.filter((r) => (r.driverName ?? "").toLowerCase().includes(q));
  if (statusSel.value === "eligible") out = out.filter((r) => r.eligible);
  else if (statusSel.value === "ineligible") out = out.filter((r) => !r.eligible);
  return out;
});

// Column keys are display groupings, so map each to the underlying row field for sorting.
const sortAccessor = (r: PerformanceDisplayRow, k: string): unknown => {
  switch (k) {
    case "rank": return r.rank;
    case "driverName": return r.driverName;
    case "safety": return r.safetyScore;
    case "efficiency": return r.efficiencyScore;
    case "idling": return r.idleScore;
    case "final": return r.trailingFinal;
    case "exposure": return r.miles;
    case "status": return r.eligible ? 0 : 1;
    default: return (r as unknown as Record<string, unknown>)[k];
  }
};
const sort = ref<SortState>({ key: null, dir: "asc" });
const sorted = computed(() => (sort.value.key ? sortRows(filtered.value, sort.value, sortAccessor) : filtered.value));

const page = ref(1);
const paged = computed(() => sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
watch([filtered, () => selectedWeek.value], () => (page.value = 1));

const weekLabel = computed(() => {
  if (isLive.value) {
    const v = live.data.value;
    return v ? `${v.weekStart} → ${v.weekEnd} · live` : "This week (live)";
  }
  const w = (weeksList.value ?? []).find((x) => x.weekStart === selectedWeek.value);
  return w ? `${w.weekStart} → ${w.weekEnd} · final` : (selectedWeek.value ?? "");
});
const methodLabel = computed(() => {
  const m = isLive.value ? live.data.value?.methodUsed : frozen.data.value?.[0]?.method_used;
  return m === "percentile" ? "fleet percentile" : m === "zscore" ? "normalized (z-score)" : m === "raw" ? "raw scores" : "—";
});
const weights = computed(() => live.data.value?.weights ?? { safety: 0.5, efficiency: 0.25, idling: 0.25 });
const trailingWeeks = computed(() => live.data.value?.trailingWeeks ?? 3);

const syncScores = useSyncDriverScores();
async function onSync() {
  try {
    const r = await syncScores.mutateAsync();
    toast.success(`Synced ${r.upserted} driver scores`, `safety ${r.safetyOk ? "ok" : "—"}, efficiency ${r.efficiencyOk ? "ok" : "—"}`);
  } catch (e) {
    toast.error("Could not sync driver scores", e instanceof Error ? e.message : undefined);
  }
}

const showInfo = ref(false);
const num = (n: number | null, d = 0) => (n == null ? "—" : n.toFixed(d));
const rankTone = (rank: number | null) => (rank === 1 ? "success" : rank != null && rank <= 3 ? "brand" : "neutral");

const columns: DataTableColumn[] = [
  { key: "rank", label: "#", sortable: true, headerClass: "w-12" },
  { key: "driverName", label: "Driver", sortable: true, headerClass: "min-w-[12rem]", cellClass: "font-medium text-ink" },
  { key: "safety", label: "Safety", sortable: true, numeric: true, headerClass: "min-w-[7rem]" },
  { key: "efficiency", label: "Efficiency", sortable: true, numeric: true, headerClass: "min-w-[7rem]" },
  { key: "idling", label: "Idling", sortable: true, numeric: true, headerClass: "min-w-[7rem]" },
  { key: "final", label: "Final", sortable: true, numeric: true, headerClass: "min-w-[6rem]" },
  { key: "exposure", label: "Miles / hrs", sortable: true, numeric: true, headerClass: "min-w-[8rem]", cellClass: "text-ink-secondary" },
  { key: "status", label: "Status", sortable: true, headerClass: "min-w-[8rem]" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Weekly driver grade combining Samsara safety, Samsara efficiency, and idling discipline. The top 3 each week earn rewards.">
      <template #actions>
        <BaseButton v-if="session.canManage" :disabled="syncScores.isPending.value" @click="onSync">
          <ArrowDownTrayIcon class="-ml-0.5 size-5" aria-hidden="true" />
          {{ syncScores.isPending.value ? "Syncing…" : "Sync scores" }}
        </BaseButton>
      </template>
    </PageHeader>

    <FilterBar
      v-model:search="search"
      search-placeholder="Search driver…"
      :count="filtered.length"
      count-label="drivers"
    >
      <template #filters>
        <FilterSelect v-model="weekProxy" label="Week" :options="weekOptions" />
        <FilterSelect v-model="statusSel" label="Status" :options="statusOptions" />
      </template>
    </FilterBar>

    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm text-ink-muted">{{ weekLabel }} · ranked on {{ trailingWeeks }}-week trailing average · {{ methodLabel }}</p>
      <button class="text-sm text-ink-muted underline-offset-2 hover:underline" @click="showInfo = !showInfo">How scoring works</button>
    </div>

    <div v-if="showInfo" class="rounded-lg border border-edge bg-surface p-4 text-sm text-ink-secondary">
      Each driver's three sub-scores (0–100, higher is better) are ranked across the fleet for the week, then blended
      with the configured weights (safety {{ weights.safety }}, efficiency {{ weights.efficiency }}, idling {{ weights.idling }}).
      Drivers must clear the weekly miles + hours gate to be ranked, and the final rank uses a {{ trailingWeeks }}-week
      trailing average so one lucky week can't win. A week is frozen for rewards a few days after it ends, once Samsara
      data settles.
    </div>

    <div v-if="winners.length" class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <BaseCard v-for="w in winners" :key="w.driverId" as="div">
        <div class="flex items-center gap-3">
          <span :class="['inline-flex size-9 items-center justify-center rounded-full', toneClass(rankTone(w.rank))]">
            <TrophyIcon class="size-5" aria-hidden="true" />
          </span>
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold text-ink">{{ w.driverName ?? "—" }}</p>
            <p class="text-xs text-ink-muted">Rank {{ w.rank }} · final {{ num(w.trailingFinal, 1) }}</p>
          </div>
        </div>
        <div class="mt-3 flex justify-between text-xs text-ink-secondary">
          <span>Safety {{ num(w.safetyScore) }}</span>
          <span>Eff {{ num(w.efficiencyScore) }}</span>
          <span>Idle {{ num(w.idleScore) }}</span>
        </div>
      </BaseCard>
    </div>

    <DataTable
      :columns="columns"
      :rows="paged"
      row-key="driverId"
      :loading="isLoading"
      :error="isError ? 'Failed to load driver performance' : null"
      :sort="sort"
      empty-text="No driver scores yet. Use “Sync scores” to pull this week from Samsara."
      @sort="sort = toggleSort(sort, $event)"
    >
      <template #cell-rank="{ row }">
        <span v-if="row.rank" :class="['inline-flex min-w-[1.5rem] justify-center rounded px-1 text-xs font-semibold', toneClass(rankTone(row.rank))]">{{ row.rank }}</span>
        <span v-else class="text-ink-subtle">—</span>
      </template>
      <template #cell-safety="{ row }">
        <span class="text-ink">{{ num(row.safetyScore) }}</span>
        <span v-if="row.safetyPct != null" class="ml-1 text-xs text-ink-muted">· {{ num(row.safetyPct) }}%</span>
      </template>
      <template #cell-efficiency="{ row }">
        <span class="text-ink">{{ num(row.efficiencyScore) }}</span>
        <span v-if="row.efficiencyPct != null" class="ml-1 text-xs text-ink-muted">· {{ num(row.efficiencyPct) }}%</span>
      </template>
      <template #cell-idling="{ row }">
        <span class="text-ink">{{ num(row.idleScore) }}</span>
        <span v-if="row.idlePct != null" class="ml-1 text-xs text-ink-muted">· {{ num(row.idlePct) }}%</span>
      </template>
      <template #cell-final="{ row }">
        <span class="font-semibold text-ink">{{ num(row.trailingFinal, 1) }}</span>
      </template>
      <template #cell-exposure="{ row }">{{ num(row.miles) }} mi · {{ num(row.driveHours) }} h</template>
      <template #cell-status="{ row }">
        <span v-if="row.eligible" :class="['inline-flex rounded px-1.5 py-0.5 text-xs', toneClass('success')]">Eligible</span>
        <span v-else :class="['inline-flex rounded px-1.5 py-0.5 text-xs', toneClass('neutral')]" :title="row.ineligibleReason ?? ''">{{ REASON_LABEL[row.ineligibleReason ?? ''] ?? 'Not ranked' }}</span>
      </template>
      <template #footer>
        <TablePagination :page="page" :page-size="PAGE_SIZE" :total="filtered.length" @update:page="page = $event" />
      </template>
    </DataTable>
  </div>
</template>
