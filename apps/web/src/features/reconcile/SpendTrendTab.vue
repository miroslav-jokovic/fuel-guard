<script setup lang="ts">
import { computed, ref } from "vue";
import { AppCard as BaseCard, AppButton as BaseButton } from "@fuelguard/ui";
import { spendSeries, comparablePeriods, periodTotals, type SpendDay, type SpendGrain, type SpendPeriod } from "@fuelguard/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import StatCard from "@/components/ui/StatCard.vue";
import { apiDownload } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { useToastStore } from "@/stores/toast";
import OperatingBridgeCard from "./OperatingBridgeCard.vue";
import IdleCostCard from "./IdleCostCard.vue";
import { useIdleCostBasis } from "@/composables/useIdleCostBasis";
import { useSpendDaysQuery, type SpendQueryFilters } from "./useSpendDays";
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
const { data, isLoading, isError, error } = useSpendDaysQuery(filters);
const days = computed<SpendDay[]>(() => data.value ?? []);

// The requested window, so an edge bucket is labelled by the days it holds rather than by the
// calendar week it belongs to.
// The org's configured idle burn rate, so this page and the Idling page cost an idle hour identically.
const idleBasis = useIdleCostBasis();
const series = computed(() =>
  spendSeries(days.value, grain.value, { from: props.filters.from, to: props.filters.to }, {
    idleGalPerHour: idleBasis.value.idleGalPerHour,
  }),
);
const comparison = computed(() => comparablePeriods(series.value));
/** Everything in the window, for the tiles — the totals a boss opens the page for. */
const overall = computed(() => periodTotals(days.value, series.value[0]?.from ?? "", series.value[series.value.length - 1]?.to ?? ""));

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

const tiles = computed(() => {
  const c = comparison.value?.current;
  return [
    // `upIsBad` is the whole reason the tone is per-tile: spend rising is bad, MPG rising is good, and a
    // tile that coloured every increase red would call the one genuine saving on this page a problem.
    { label: "Fuel spend", value: usd(c?.spend ?? overall.value.spend), pick: (p: SpendPeriod) => p.spend, upIsBad: true },
    { label: "Gallons", value: gal(c?.gallons ?? overall.value.gallons), pick: (p: SpendPeriod) => p.gallons, upIsBad: true },
    { label: "Paid per gallon", value: usd3(c?.pricePerGal ?? overall.value.pricePerGal), pick: (p: SpendPeriod) => p.pricePerGal, upIsBad: true },
    // Cost per mile is the figure that survives both a market move and a busier fleet, which is why it
    // sits beside them rather than being left for the reader to divide out.
    { label: "Cost per mile", value: usd2(c?.costPerMile ?? overall.value.costPerMile), pick: (p: SpendPeriod) => p.costPerMile, upIsBad: true },
    { label: "Fleet MPG", value: c?.mpg?.toFixed(2) ?? overall.value.mpg?.toFixed(2) ?? "—", pick: (p: SpendPeriod) => p.mpg, upIsBad: false },
    // Idle sits in the headline row because it is bought with the same gallons as the miles beside it.
    // It reads "—" rather than zero when the engine feed did not cover the period; see IdleCostCard.
    { label: "Idle cost", value: c?.idleCost == null ? "—" : usd(c.idleCost), pick: (p: SpendPeriod) => p.idleCost, upIsBad: true },
  ].map((t) => ({
    label: t.label,
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
    idleCost: p.idleCost == null ? "—" : usd(p.idleCost),
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
  { key: "idleCost", label: "Idle cost", numeric: true, width: "sm" },
];

const hasData = computed(() => days.value.length > 0);

// ── export ──────────────────────────────────────────────────────────────────────────────────────
// The PDF is rendered on the SERVER from the same rollup, not from what this component is holding: a
// figure in a document gets quoted back months later, so page and document must come from one source.
const toast = useToastStore();
const exporting = ref(false);
const range = computed(() => ({ from: props.filters.from, to: props.filters.to }));

async function exportPdf() {
  if (exporting.value) return;
  exporting.value = true;
  try {
    const { from, to } = range.value;
    // Every filter goes to the server. A report that quietly covered the whole fleet while the screen
    // showed three trucks is the kind of document somebody acts on and cannot reconcile later.
    await apiDownload(
      `/api/fueling/spend-report.pdf?${props.query}`,
      `fuelguard-fuel-spend-${from}-to-${to}.pdf`,
    );
  } catch (e) {
    toast.error("Could not build the report", e instanceof Error ? e.message : undefined);
  } finally {
    exporting.value = false;
  }
}

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
const rejected = computed(() => days.value.reduce((a, d) => a + d.milesRejected, 0));
</script>

<template>
  <div class="space-y-6">
    <p v-if="isError" class="rounded-surface bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100">
      Couldn't load the spend rollup: {{ error instanceof Error ? error.message : "unknown error" }}
    </p>

    <BaseCard v-else-if="!hasData && !isLoading">
      <h3 class="text-sm font-semibold text-ink">No spend days yet</h3>
      <p class="mt-1 text-sm text-ink-muted">
        This view reads a nightly rollup of your recorded fuel, odometer intervals and engine time. It fills in on the
        first nightly run, or immediately if an admin rebuilds a window.
      </p>
    </BaseCard>

    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-ink-muted">
          {{ series.length }} {{ grainLabel }}{{ series.length === 1 ? "" : "s" }} ·
          {{ days.length.toLocaleString() }} truck-days
        </p>
        <div class="flex items-center gap-2">
          <BaseButton variant="ghost" :disabled="!hasData" @click="exportCsv">Export CSV</BaseButton>
          <BaseButton variant="secondary" :disabled="!hasData || exporting" @click="exportPdf">
            {{ exporting ? "Building…" : "Export report" }}
          </BaseButton>
        </div>
      </div>

      <!-- The one KPI tile (D-UI2). These were hand-rolled BaseCards reproducing StatCard's kpi anatomy
           class for class, which is exactly the drift StatCard was extracted to end. -->
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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

      <IdleCostCard :periods="series" :grain-label="grainLabel" />

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
