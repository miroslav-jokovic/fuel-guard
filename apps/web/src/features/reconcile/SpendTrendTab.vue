<script setup lang="ts">
import { computed, ref } from "vue";
import { AppCard as BaseCard } from "@fuelguard/ui";
import { spendSeries, comparablePeriods, periodTotals, type SpendDay, type SpendGrain } from "@fuelguard/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import OperatingBridgeCard from "./OperatingBridgeCard.vue";
import { SPEND_WINDOWS, useSpendDaysQuery } from "./useSpendDays";
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
const grain = ref<SpendGrain>("week");
// FilterSelect models a string, so the window lives as one and is converted where it is used. Keeping
// the ref numeric and leaning on `.number` puts a number into a string-typed model and only fails at
// the boundary, in a component that would render either way.
const weeksChoice = ref<string>("13");
const weeks = computed(() => Number(weeksChoice.value));
const grainOptions = [
  { value: "day", label: "By day" },
  { value: "week", label: "By week" },
  { value: "month", label: "By month" },
];
const grainLabel = computed(() => (grain.value === "day" ? "day" : grain.value === "month" ? "month" : "week"));
const windowOptions = SPEND_WINDOWS.map((w) => ({ value: w.value, label: w.label }));

const { data, isLoading, isError, error } = useSpendDaysQuery(weeks);
const days = computed<SpendDay[]>(() => data.value ?? []);

const series = computed(() => spendSeries(days.value, grain.value));
const today = new Date().toISOString().slice(0, 10);
const comparison = computed(() => comparablePeriods(series.value, today));
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

const tiles = computed(() => {
  const c = comparison.value?.current;
  return [
    { label: "Fuel spend", value: usd(c?.spend ?? overall.value.spend), hint: delta((p) => p.spend), tone: deltaTone((p) => p.spend) },
    { label: "Gallons", value: gal(c?.gallons ?? overall.value.gallons), hint: delta((p) => p.gallons), tone: deltaTone((p) => p.gallons) },
    { label: "Paid per gallon", value: usd3(c?.pricePerGal ?? overall.value.pricePerGal), hint: delta((p) => p.pricePerGal), tone: deltaTone((p) => p.pricePerGal) },
    // Cost per mile is the figure that survives both a market move and a busier fleet, which is why it
    // sits beside them rather than being left for the reader to divide out.
    { label: "Cost per mile", value: usd2(c?.costPerMile ?? overall.value.costPerMile), hint: delta((p) => p.costPerMile), tone: deltaTone((p) => p.costPerMile) },
    { label: "Fleet MPG", value: c?.mpg?.toFixed(2) ?? overall.value.mpg?.toFixed(2) ?? "—", hint: delta((p) => p.mpg), tone: deltaTone((p) => p.mpg, false) },
  ];
});

const rows = computed(() =>
  [...series.value].reverse().map((p) => ({
    id: p.from,
    period: grain.value === "day" ? p.from : `${p.from} → ${p.to}`,
    trucks: p.activeTrucks,
    fills: p.fills,
    gallons: gal(p.gallons),
    spend: usd(p.spend),
    perGal: usd3(p.pricePerGal),
    miles: gal(p.miles),
    mpg: p.mpg?.toFixed(2) ?? "—",
    perMile: usd2(p.costPerMile),
    idle: pct1(p.idleShare),
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

const hasData = computed(() => days.value.length > 0);
const rejected = computed(() => days.value.reduce((a, d) => a + d.milesRejected, 0));
</script>

<template>
  <div class="space-y-6">
    <FilterBar>
      <FilterSelect v-model="grain" :options="grainOptions" label="Grain" />
      <FilterSelect v-model="weeksChoice" :options="windowOptions" label="Window" />
      <span class="text-sm text-ink-muted">
        <template v-if="isLoading">Loading…</template>
        <template v-else-if="hasData">
          {{ series.length }} {{ grainLabel }}{{ series.length === 1 ? "" : "s" }} · {{ days.length.toLocaleString() }} truck-days
        </template>
      </span>
    </FilterBar>

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
      <dl class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <BaseCard v-for="t in tiles" :key="t.label" padding="sm">
          <dt class="text-xs uppercase tracking-wide text-ink-muted">{{ t.label }}</dt>
          <dd class="mt-1 text-2xl font-bold text-ink">{{ t.value }}</dd>
          <dd class="text-2xs" :class="t.tone">{{ t.hint ?? "no prior period" }}</dd>
        </BaseCard>
      </dl>

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
