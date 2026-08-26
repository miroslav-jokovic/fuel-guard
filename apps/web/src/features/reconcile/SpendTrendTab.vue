<script setup lang="ts">
import { computed, ref } from "vue";
import { AppCard as BaseCard, AppButton as BaseButton } from "@fuelguard/ui";
import { comparablePeriods, type SpendGrain, type SpendPeriod } from "@fuelguard/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import StatCard from "@/components/ui/StatCard.vue";
import { downloadCsv } from "@/lib/csv";
import { apiFetch } from "@/lib/api";
import { useToastStore } from "@/stores/toast";
import { useQueryClient } from "@tanstack/vue-query";
import OperatingBridgeCard from "./OperatingBridgeCard.vue";
import IdleCostCard from "./IdleCostCard.vue";
import { useIdleCostBasis } from "@/composables/useIdleCostBasis";
import { type SpendQueryFilters } from "./useSpendDays";
import { useSpendPeriodsQuery } from "./useSpendPeriods";
import { usd, usd2, usd3, gal, pct1 } from "./format";

/**
 * What fuel cost, and why it moved — read from the daily rollup rather than from an uploaded file.
 *
 * This is the tab that answers the question the carrier actually asks, at the grain they ask it: day,
 * week or month, this period against the one before. Everything on it is computed by the pure functions
 * in `@fuelguard/shared`, so the tiles, the bridge and the table cannot disagree with each other or with
 * the tests.
 *
 * The comparison deliberately uses the last COMPLETE period. A Tuesday is not a week, and comparing a
 * two-day week against a finished one is the easiest way to publish a 60% collapse in spend that never
 * happened.
 */
/**
 * Dates, trucks and grain are the PAGE's, not this tab's — see `useSpendFilters`. Two tabs holding
 * their own idea of the period is how a figure gets quoted against the wrong weeks.
 */
const props = defineProps<{ filters: SpendQueryFilters; grain: SpendGrain; query: string }>();
const grain = computed(() => props.grain);
const grainLabel = computed(() => (grain.value === "day" ? "day" : grain.value === "month" ? "month" : "week"));

const filters = computed(() => props.filters);
/** The org's configured idle burn rate, so this page and the Idling page cost an idle hour identically. */
const idleBasis = useIdleCostBasis();
const periodOpts = computed(() => ({ idleGalPerHour: idleBasis.value.idleGalPerHour }));

/*
 * Summed in the database (0252), derived here — see `useSpendPeriods`.
 *
 * This used to page every truck-day in the window into the browser and fold them: 13,095 rows over
 * fourteen sequential round trips, to display thirteen weekly figures, none of which is a truck-day.
 * Only the SUMMATION moved; every judgement `periodTotalsFromSums` makes is the same code it always
 * was, and a parity test runs both implementations over the same rows.
 */
const { data, isLoading, isError, error } = useSpendPeriodsQuery(filters, grain, periodOpts);
const series = computed<SpendPeriod[]>(() => data.value?.periods ?? []);
const comparison = computed(() => comparablePeriods(series.value));
/** Everything in the window, for the tiles — the totals a boss opens the page for. */
const overall = computed<SpendPeriod | null>(() => data.value?.overall ?? null);

/** Signed change against the prior period, as a percentage — null when there is nothing to compare. */
const delta = (pick: (p: (typeof series.value)[number]) => number | null): string | null => {
  const c = comparison.value;
  if (!c) return null;
  const a = pick(c.prior);
  const b = pick(c.current);
  if (a == null || b == null || a === 0) return null;
  const pc = ((b - a) / Math.abs(a)) * 100;
  return `${pc >= 0 ? "+" : "−"}${Math.abs(pc).toFixed(1)}% vs prior ${grainLabel.value}`;
};
const deltaTone = (pick: (p: (typeof series.value)[number]) => number | null, upIsBad = true): string => {
  const c = comparison.value;
  if (!c) return "text-ink-tertiary";
  const a = pick(c.prior);
  const b = pick(c.current);
  if (a == null || b == null || a === b) return "text-ink-tertiary";
  const up = b > a;
  return up === upIsBad ? "text-danger-700" : "text-success-700";
};

/** The last 30 periods of a measure, for the tile's sparkline. */
const trail = (pick: (p: (typeof series.value)[number]) => number | null): (number | null)[] =>
  series.value.slice(-30).map(pick);

/**
 * L13 — which period the tiles are describing.
 *
 * `comparablePeriods` returns the last two COMPLETE periods, which is right: comparing a two-day week
 * against a finished one is the easiest way to publish a 60% collapse in spend that never happened.
 * The consequence nobody stated is that on a 90-day, week-grain view the headline is the week ending
 * about ten days ago — sitting above a table of every week, beside a fill count spanning all ninety
 * days. Three denominators on one screen, and only the table said which was which.
 */
const tilePeriod = computed(() => {
  const c = comparison.value?.current;
  if (!c) return null;
  return grain.value === "day" || c.from === c.to ? c.from : `${grainLabel.value} of ${c.from}`;
});

const tiles = computed(() => {
  const c = comparison.value?.current;
  return [
    // `upIsBad` is the whole reason the tone is per-tile: spend rising is bad, MPG rising is good, and a
    // tile that coloured every increase red would call the one genuine saving on this page a problem.
    { label: "Fuel spend", value: usd(c?.spend ?? overall.value?.spend ?? 0), pick: (p: SpendPeriod) => p.spend, upIsBad: true, note: "tractor fuel only" },
    { label: "Gallons", value: gal(c?.gallons ?? overall.value?.gallons ?? 0), pick: (p: SpendPeriod) => p.gallons, upIsBad: true },
    { label: "Paid per gallon", value: usd3(c?.pricePerGal ?? overall.value?.pricePerGal ?? null), pick: (p: SpendPeriod) => p.pricePerGal, upIsBad: true },
    // Cost per mile is the figure that survives both a market move and a busier fleet, which is why it
    // sits beside them rather than being left for the reader to divide out.
    { label: "Cost per mile", value: usd2(c?.costPerMile ?? overall.value?.costPerMile ?? null), pick: (p: SpendPeriod) => p.costPerMile, upIsBad: true, note: "includes reefer and DEF" },
    { label: "Fleet MPG", value: c?.mpg?.toFixed(2) ?? overall.value?.mpg?.toFixed(2) ?? "—", pick: (p: SpendPeriod) => p.mpg, upIsBad: false },
    // Idle is NOT a headline tile. Total idle cost is a fact about running trucks, not an accusation,
    // and a tile that reddens when it rises says the opposite. The idle card below carries the number
    // that IS actionable — avoidable idle, on trucks that had an alternative.
  ].map((t) => ({
    // `Fuel spend` is tractor fuel; `Cost per mile` divides tractor + reefer + DEF by implied miles.
    // Both are deliberate and neither is derivable from the other, so the pair that cannot be
    // reconciled says which is which rather than leaving a reader to find out by dividing (L12).
    label: (t as { note?: string }).note ? `${t.label} · ${(t as { note?: string }).note}` : t.label,
    value: t.value,
    sub: delta(t.pick) ?? `no prior ${grainLabel.value}`,
    subTone: deltaTone(t.pick, t.upIsBad),
    spark: trail(t.pick),
  }));
});

/**
 * Newest period first. A spend table is read for what just happened; opening on the oldest week of a
 * ninety-day window makes the reader scroll before they can start.
 */
/** "2026-08-17 → 2026-08-23", or just the date when a clamped period covers a single day. */
const periodLabel = (p: SpendPeriod): string =>
  grain.value === "day" || p.from === p.to ? p.from : `${p.from} → ${p.to}`;

const rows = computed(() =>
  [...series.value].reverse().map((p) => ({
    id: p.from,
    period: periodLabel(p) + (p.partial ? " (in progress)" : ""),
    trucks: p.activeTrucks,
    fills: p.fills,
    gallons: gal(p.gallons),
    spend: usd(p.spend),
    perGal: usd3(p.pricePerGal),
    miles: gal(p.miles),
    mpg: p.mpg?.toFixed(2) ?? "—",
    perMile: usd2(p.costPerMile),
    idle: p.idleUsable ? pct1(p.idleShare) : "—",
  })),
);
const columns: DataTableColumn[] = [
  { key: "period", label: "Period", width: "lg" },
  { key: "trucks", label: "Trucks", numeric: true, width: "xs" },
  { key: "fills", label: "Fills", numeric: true, width: "xs" },
  { key: "gallons", label: "Gallons", numeric: true, width: "sm" },
  { key: "spend", label: "Fuel spend", numeric: true, width: "sm" },
  { key: "perGal", label: "Paid / gal", numeric: true, width: "sm" },
  { key: "miles", label: "Miles", numeric: true, width: "sm" },
  { key: "mpg", label: "MPG", numeric: true, width: "xs" },
  { key: "perMile", label: "Cost / mile", numeric: true, width: "sm" },
  { key: "idle", label: "Idle", numeric: true, width: "xs" },
];

const hasData = computed(() => series.value.length > 0);

const toast = useToastStore();
const qc = useQueryClient();
const rebuilding = ref(false);
/** Re-derive the rollup for exactly the window on screen — the endpoint bounds it at 400 days. */
async function rebuild() {
  if (rebuilding.value) return;
  rebuilding.value = true;
  try {
    const res = await apiFetch<{ ok: boolean; written: number }>("/api/fueling/spend-rollup", {
      method: "POST",
      body: { from: props.filters.from, to: props.filters.to },
    });
    if (!res.ok) throw new Error(res.error?.message ?? "The rebuild was refused.");
    toast.success("Rebuilt", `${res.data?.written?.toLocaleString() ?? 0} truck-days re-derived`);
    void qc.invalidateQueries({ queryKey: ["fuel_spend_days"] });
  } catch (e) {
    toast.error("Could not rebuild that window", e instanceof Error ? e.message : undefined);
  } finally {
    rebuilding.value = false;
  }
}

// The PDF is a PAGE-level action (see ReportExportButton) because it covers every tab. What stays here
// is this tab's own series as CSV.
const range = computed(() => ({ from: props.filters.from, to: props.filters.to }));


function exportCsv() {
  const { from, to } = range.value;
  downloadCsv(
    `fuelguard-fuel-spend-${from}-to-${to}.csv`,
    ["Period start", "Period end", "In progress", "Trucks", "Fills", "Gallons", "Fuel spend", "Paid per gal", "Miles", "MPG", "Cost per mile", "Idle hours", "Idle gallons", "Idle cost", "Idle share", "Engine coverage"],
    series.value.map((p) => [
      p.from, p.to, p.partial ? "yes" : "", p.activeTrucks, p.fills, p.gallons, p.spend,
      p.pricePerGal, p.miles, p.mpg, p.costPerMile,
      // Blank, not zero, where coverage cannot support the claim — a zero in a spreadsheet gets summed.
      p.idleUsable ? Math.round(p.idleSec / 36) / 100 : "", p.idleGallons ?? "", p.idleCost ?? "", p.idleShare ?? "",
      p.idleCoverage ?? "",
    ]),
  );
}
const rejected = computed(() => data.value?.rejected ?? 0);
</script>

<template>
  <div class="space-y-6">
    <p v-if="isError" class="rounded-surface bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100">
      Couldn't load the spend rollup: {{ error instanceof Error ? error.message : "unknown error" }}
    </p>

    <BaseCard v-else-if="!hasData && !isLoading">
      <h3 class="text-sm font-semibold text-ink">No spend days yet</h3>
      <p class="mt-1 max-w-2xl text-sm text-ink-muted">
        This view reads a nightly rollup of your recorded fuel, odometer intervals and engine time. It fills in on the
        first nightly run — or now, if you rebuild this window.
      </p>
      <!-- X10. The copy has always said "or immediately if an admin rebuilds a window",
           `POST /api/fueling/spend-rollup` has always existed, and nothing anywhere in the app could
           ask for one. An empty state naming an action nobody can take is worse than one naming none. -->
      <div class="mt-3">
        <BaseButton variant="secondary" :disabled="rebuilding" @click="rebuild">
          {{ rebuilding ? "Rebuilding…" : `Rebuild ${props.filters.from} → ${props.filters.to}` }}
        </BaseButton>
      </div>
    </BaseCard>

    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-ink-muted">
          {{ series.length }} {{ grainLabel }}{{ series.length === 1 ? "" : "s" }} ·
          {{ (data?.truckDays ?? 0).toLocaleString() }} truck-days
        </p>
        <div class="flex items-center gap-2">
          <!-- The PDF is a PAGE-level action now (it covers every tab), so only this tab's own series
               CSV stays here. -->
          <BaseButton variant="ghost" :disabled="!hasData" @click="exportCsv">Export CSV</BaseButton>
        </div>
      </div>

      <!-- The one KPI tile (D-UI2). These were hand-rolled BaseCards reproducing StatCard's kpi anatomy
           class for class, which is exactly the drift StatCard was extracted to end. -->
      <div>
        <p v-if="tilePeriod" class="mb-2 text-xs text-ink-tertiary">
          These describe the last complete {{ grainLabel }} — <strong class="text-ink-secondary">{{ tilePeriod }}</strong>.
          The {{ grainLabel }} in progress is excluded, and the table below covers the whole window.
        </p>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          v-for="t in tiles"
          :key="t.label"
          :label="t.label"
          :value="t.value"
          :sub="t.sub"
          :sub-tone="t.subTone"
          :spark="t.spark"
          spark-color="currentColor"
          :loading="isLoading"
        />
        </div>
      </div>

      <OperatingBridgeCard
        v-if="comparison"
        :prior="comparison.prior"
        :current="comparison.current"
        :grain-label="grainLabel"
      />
      <BaseCard v-else padding="sm">
        <p class="text-sm text-ink-muted">
          Two complete {{ grainLabel }}s are needed before spend can be explained against anything. Widen the window, or
          come back once the current {{ grainLabel }} has finished.
        </p>
      </BaseCard>

      <IdleCostCard :from="props.filters.from" :to="props.filters.to" />

      <div>
        <h4 class="mb-2 text-sm font-semibold text-ink">{{ grainLabel === "day" ? "Day" : grainLabel === "month" ? "Month" : "Week" }} by {{ grainLabel }}</h4>
        <BaseCard padding="none">
          <DataTable :columns="columns" :rows="rows" row-key="id" :loading="isLoading" empty-text="No periods in this window." />
        </BaseCard>
        <p v-if="rejected > 0" class="mt-2 text-xs text-ink-tertiary">
          {{ rejected.toLocaleString() }} odometer interval{{ rejected === 1 ? " was" : "s were" }} refused as implausible in
          this window. Their fuel is still counted; only their mileage is left out, so MPG reflects the trucks whose
          odometers can be trusted.
        </p>
      </div>
    </template>
  </div>
</template>
