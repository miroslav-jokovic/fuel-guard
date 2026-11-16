<script setup lang="ts">
/**
 * What did fuel cost — the number, its movement, its days, and where the dollars went, in ONE card
 * (D-FO1, D-FO2, D-FO3; Q-FO2 ruled (a)).
 *
 * This replaces four cards that each drew the same total: the hero tile, the operating-metrics
 * tile, the spend-trend readout and the donut centre. The figure appears here once, the daily bars
 * sit under it with the PREVIOUS period's bars as a grey ghost behind each day (the comparison is
 * the chart), and the composition is a share bar rather than a ring.
 *
 * ── WITHOUT `accounting` THIS CARD IS ABOUT GALLONS ──────────────────────────────────────────────
 * The widget is gated `fuel`, like the tab, so a `fleet_manager` keeps it (Q-LM-F1). For them the
 * readout is gallons with its own pill, the bars are not drawn — `spendTrend` is dollars and there
 * is no daily gallons series to draw honestly — and the composition shows shares alone. Every
 * dollar figure, hover titles included, is behind `canSeeMoney`, and `dashboardEquivalence.test.ts`
 * proves it with
 * "shows a caller without accounting no currency figure anywhere on the tab".
 *
 * ── A NARROW CARD DRAWS WEEKS (SMALL-SCREENS-PLAN.md D-SM15) ─────────────────────────────────────
 * When a day would get less than 25 px of the card (`drawsWeeks`) — a phone, a tablet, the
 * two-column desktop — the 62 daily bars become one bar per calendar week with its dollars written
 * on it, short weeks pale, and last period's full weeks as a grey band, as on the Fleet MPG card. The width is
 * the card's own, measured, not the window's: the same card is full-width on a tablet and half on a
 * desktop. `spendWeeks.ts` has the measurements.
 */
import { computed, ref, useTemplateRef } from "vue";
import { useElementSize } from "@vueuse/core";
import type { ChartConfiguration } from "chart.js";
import { CurrencyDollarIcon, GallonsIcon } from "@silvicom/ui/icons";
import { AppDelta } from "@silvicom/ui";
import { deltaLabel, deltaTone, fuelCostSplit, type PeriodDelta } from "@silvicom/shared";
import BaseChart from "@/components/BaseChart.vue";
import ChartCard from "@/components/ui/ChartCard.vue";
import ShareBar from "../ShareBar.vue";
import DoorLink from "@/components/ui/DoorLink.vue";
import { useFleetWidgetData, fmtInt, type FleetRange } from "../fleetWidgetData";
import { viz, BAR_GEOMETRY, COST_COLORS, trendOptions, fmtDay, fmtMoney, fmtCompact, resolve, resolveAlpha } from "@/lib/chartTheme";
import { barValueLabels, valueBand } from "@/lib/chartMarks";
import { partWeekNote, weekCaption } from "../mpgWeeks";
import { drawsWeeks, fmtMoneyShort, spendBand, spendWeeks } from "../spendWeeks";

const props = defineProps<{ range: FleetRange }>();
const { s, previous, canSeeMoney, deltas, previousLabel, previousPhrase, rangeLabel } = useFleetWidgetData(computed(() => props.range));

const pill = (d: PeriodDelta | null, upIsGood: boolean) =>
  d ? { direction: d.direction, tone: deltaTone(d, upIsGood), label: deltaLabel(d), against: previousLabel.value } : null;

const points = computed(() => s.value?.spendTrend ?? []);
const ghost = computed(() => previous.value?.spendTrend ?? []);
const total = computed(() => points.value.reduce((n, p) => n + (p.value ?? 0), 0));

/** The day under the pointer (D-DT11), else the window's own total. */
const scrub = ref<{ label: string; value: number } | null>(null);

/** The plot's own width; 0 until it is measured, and nothing is drawn until then (no flash of 62 bars). */
const { width } = useElementSize(useTemplateRef<HTMLElement>("plotBox"));
const weekly = computed(() => drawsWeeks(width.value, points.value.length));
const weeks = computed(() => spendWeeks(points.value));
const band = computed(() => spendBand(spendWeeks(ghost.value)));
const note = computed(() => (weekly.value ? partWeekNote(weeks.value) : null));
const scrubbedWeek = computed(() => (weekly.value && scrub.value ? weeks.value.find((w) => w.from === scrub.value!.label) ?? null : null));

const readout = computed(() => {
  if (!canSeeMoney.value) return s.value ? `${fmtInt(s.value.totalGallons)} gal` : "—";
  if (scrub.value) return fmtMoney(scrub.value.value);
  return s.value ? fmtMoney(total.value) : "—";
});
const delta = computed(() => (canSeeMoney.value ? pill(deltas.value.spend, false) : pill(deltas.value.gallons, false)));
const caption = computed(() => {
  if (scrubbedWeek.value) return weekCaption(scrubbedWeek.value);
  if (scrub.value) return fmtDay(scrub.value.label);
  if (!delta.value) return rangeLabel.value;
  const prev = canSeeMoney.value
    ? previous.value ? fmtMoney(previous.value.totalSpend) : null
    : previous.value ? `${fmtInt(previous.value.totalGallons)} gal` : null;
  return prev ? `vs ${previousPhrase.value} · ${prev}` : `vs ${previousPhrase.value}`;
});

/**
 * Bars, not a line (DR3): `spendTrend` is a discrete daily total, zero-filled, so a bar loses
 * nothing. The ghost is a second dataset drawn BEHIND (`order: 2` draws first) and not grouped, so
 * the two bars share one x rather than standing side by side; `onScrub` reads `elements[0]`, which
 * is this period's bar because it is dataset 0.
 */
const chart = computed<ChartConfiguration>(() => ({
  type: "bar",
  data: {
    labels: points.value.map((p) => p.date),
    datasets: [
      {
        label: "This period", data: points.value.map((p) => p.value), order: 1,
        backgroundColor: viz.spend, hoverBackgroundColor: viz.spendHover, ...BAR_GEOMETRY, barPercentage: 0.6,
      },
      {
        label: "Previous period, same day", data: ghost.value.map((p) => p.value), order: 2, grouped: false,
        backgroundColor: resolve("--ramp-neutral-200"), hoverBackgroundColor: resolve("--ramp-neutral-200"), ...BAR_GEOMETRY,
      },
    ],
  },
  options: trendOptions({
    series: "Spend",
    format: (v) => fmtMoney(v),
    dataMax: Math.max(0, ...points.value.map((p) => p.value ?? 0), ...ghost.value.map((p) => p.value ?? 0)),
    onScrub: (p) => { scrub.value = p; },
  }),
}));

/** A full week in the spend colour, a short one in a 30% wash of it — the legend's swatches are these. */
const swatch = { get full() { return viz.spend; }, get part() { return resolveAlpha("--viz-spend", 0.3); } };

/**
 * The narrow card's weeks. The band rides in the options, which `BaseChart` updates in place — see
 * `valueBand`; the plot is keyed on the mode, so days and weeks are two charts, never one patched.
 */
const weekChart = computed<ChartConfiguration<"bar">>(() => {
  const { full, part } = swatch;
  const colors = weeks.value.map((w) => (w.full ? full : part));
  const options = trendOptions({
    series: "Spend",
    format: (v) => fmtMoney(v),
    tickFormat: fmtMoneyShort,
    dataMax: Math.max(0, ...weeks.value.map((w) => w.total ?? 0), band.value?.hi ?? 0),
    onScrub: (p) => { scrub.value = p; },
  }) as ChartConfiguration<"bar">["options"];
  return {
    type: "bar",
    data: {
      labels: weeks.value.map((w) => w.from),
      datasets: [{ label: "Spend", data: weeks.value.map((w) => w.total), backgroundColor: colors, hoverBackgroundColor: colors, ...BAR_GEOMETRY, maxBarThickness: 44 }],
    },
    options: {
      ...options,
      plugins: {
        ...options?.plugins,
        valueBand: { band: band.value },
        // The tooltip names the week the way the readout does — "week of 10/19", "10/17 – 10/18 · 2 days" —
        // while the axis keeps the short "10/19".
        tooltip: { ...options?.plugins?.tooltip, callbacks: { ...options?.plugins?.tooltip?.callbacks, title: (items) => (items[0] ? weekCaption(weeks.value[items[0].dataIndex]!) : "") } },
      },
    } as ChartConfiguration<"bar">["options"],
    plugins: [valueBand, barValueLabels(fmtMoneyShort)],
  };
});

/**
 * The Moving / Idle / Reefer bar is withheld when the idle estimate is larger than every tractor
 * gallon bought — `fuelCostSplit` has the measurements. A sentence takes its place; dollars in it
 * only for a reader who may see money, like every other figure on this card.
 */
const split = computed(() => (s.value ? fuelCostSplit(s.value) : { kind: "split" as const }));
const withheldNote = computed(() => {
  const v = split.value;
  if (v.kind !== "withheld") return null;
  const why = "Usually the fuel import is missing days, so the split is not shown.";
  return canSeeMoney.value
    ? `Idle is estimated at ${fmtMoney(v.idleCostUsd)}, more than the ${fmtMoney(v.tractorSpend)} of tractor fuel bought in these dates. ${why}`
    : `The idle estimate is larger than the tractor fuel bought in these dates. ${why}`;
});

const slices = computed(() => {
  const m = s.value?.movingSpend ?? 0, i = s.value?.idleCostUsd ?? 0, r = s.value?.reeferSpend ?? 0;
  const label = (v: number) => (canSeeMoney.value ? `$${fmtCompact(v)}` : "");
  return [
    { key: "moving", label: "Moving", value: m, valueLabel: label(m), color: COST_COLORS.moving },
    { key: "idle", label: "Idle", value: i, valueLabel: label(i), color: COST_COLORS.idle },
    { key: "reefer", label: "Reefer", value: r, valueLabel: label(r), color: COST_COLORS.reefer },
  ];
});
</script>

<template>
  <ChartCard
    :title="canSeeMoney ? 'Fuel spend' : 'Fuel bought'"
    :subtitle="canSeeMoney ? `${weekly ? 'Weekly' : 'Daily'} total across the fleet · tractor and reefer` : 'Gallons across the fleet · tractor and reefer'"
    :icon="canSeeMoney ? CurrencyDollarIcon : GallonsIcon"
    tone="success"
    :readout="readout"
    :caption="caption"
    class="h-full"
  >
    <!-- The fills live on the Fuel log (FUEL-C2); `/transactions` is a compatibility redirect and a
         door should name where the thing is. -->
    <template #door><DoorLink to="/fuel-log?tab=fills">Fuel log</DoorLink></template>
    <template #beside-readout><AppDelta v-if="delta" v-bind="delta" /></template>

    <template v-if="canSeeMoney">
      <div ref="plotBox" class="min-h-[200px]" data-test="spend-plot">
        <template v-if="width > 0">
          <BaseChart v-if="weekly" key="weeks" :config="weekChart as ChartConfiguration" :height="200" data-test="spend-weeks" />
          <BaseChart v-else key="days" :config="chart" :height="200" data-test="spend-days" />
        </template>
      </div>
      <ul v-if="weekly" class="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-ink-tertiary" aria-hidden="true" data-test="spend-week-legend">
        <li class="flex items-center gap-1.5"><span class="size-2 rounded-detail" :style="{ backgroundColor: swatch.full }" /> Full week</li> <!-- token-check-disable-line: token-resolved chart color -->
        <li v-if="note" class="flex items-center gap-1.5"><span class="size-2 rounded-detail" :style="{ backgroundColor: swatch.part }" /> Part of a week</li> <!-- token-check-disable-line: token-resolved chart color -->
        <li v-if="band" class="flex items-center gap-1.5" data-test="spend-band">
          <span class="h-2 w-3 rounded-detail bg-surface-muted" /> Grey band: {{ previousPhrase }}, {{ fmtMoneyShort(band.lo) }} – {{ fmtMoneyShort(band.hi) }}
        </li>
      </ul>
      <ul v-else class="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-ink-tertiary" aria-hidden="true">
        <li class="flex items-center gap-1.5"><span class="size-2 rounded-detail" :style="{ backgroundColor: viz.spend }" /> This period</li> <!-- token-check-disable-line: token-resolved chart color -->
        <li class="flex items-center gap-1.5"><span class="size-2 rounded-detail bg-surface-muted" /> Previous period, same day</li>
      </ul>
      <p v-if="note" class="mt-2 text-xs text-ink-tertiary" data-test="spend-part-weeks">{{ note }}</p>
      <!-- The wrapper is `sr-only`, not the table: a table sizes to its content and ignores the
           1 px box, so this one stood 541 px wide inside a 390 px phone and the whole Fleet overview
           scrolled sideways (SMALL-SCREENS-PLAN.md M4, measured 2026-11-14). The table keeps the
           class as well: it is how `lint:ui-adoption` tells a reader's table from a visible one. -->
      <div class="sr-only">
        <table class="sr-only">
          <caption>Fuel spend by day, this period and the same day of the previous period</caption>
          <thead><tr><th scope="col">Day</th><th scope="col">Spend</th><th scope="col">Previous period</th></tr></thead>
          <tbody>
            <tr v-for="(p, i) in points" :key="p.date">
              <th scope="row">{{ fmtDay(p.date) }}</th>
              <td>{{ p.value == null ? "no data" : fmtMoney(p.value) }}</td>
              <td>{{ ghost[i]?.value == null ? "no data" : fmtMoney(ghost[i]!.value!) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <p v-if="withheldNote" class="mt-4 rounded-control bg-surface-subtle px-3 py-2.5 text-xs text-ink-muted" data-test="fuel-split-withheld">{{ withheldNote }}</p>
    <ShareBar v-else class="mt-4" :items="slices" :name="canSeeMoney ? 'Where fuel dollars go' : 'Where fuel goes'" />
  </ChartCard>
</template>
