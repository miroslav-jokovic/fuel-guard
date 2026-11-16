<script setup lang="ts">
/**
 * How efficiently — the window's MPG, its movement, its weeks, and its caveat, in ONE card
 * (D-FO1, D-FO2, D-FO3). Replaces the hero tile, the operating-metrics tile and the trend card,
 * which carried the same figure three times and the "97% of fuel measured" caption twice.
 *
 * WEEKLY, not daily, and that is a measurement decision rather than a rendering one (D-MPG6): a
 * day's fuel purchases are not that day's consumption. The readout at rest is the WINDOW's own MPG,
 * not the mean of the weeks under it — the same figure the pill compares.
 *
 * ── ONE BAR PER WEEK, AND A WEEK SAYS HOW LONG IT IS (SMALL-SCREENS-PLAN.md D-SM13) ─────────────
 * Until 2026-11-16 this was a smoothed line through the weeks. A line says there is a value between
 * two weeks and there is not, and it drew a two-day weekend bucket as a week — the dip the owner
 * read as a bad week (`mpgWeeks.ts` has the measurements). Now each week is a bar from zero with its
 * figure written on it; a part-week is pale and named under the plot; last period's FULL weeks are
 * a grey band behind the bars, so "is this week normal" is answered by where the bar's top sits.
 *
 * Every figure prints with ONE decimal (`formatFleetMpg`): the readout, the bars, the band and the
 * pill now agree, which "6.62 MPG … vs 6.95 … ↓ 0.3" did not.
 */
import { computed, ref } from "vue";
import type { ChartConfiguration } from "chart.js";
import { GaugeIcon } from "@silvicom/ui/icons";
import { AppDelta } from "@silvicom/ui";
import { deltaLabel, deltaTone, fleetMpgWindowNote, formatFleetMpg } from "@silvicom/shared";
import BaseChart from "@/components/BaseChart.vue";
import ChartCard from "@/components/ui/ChartCard.vue";
import DoorLink from "@/components/ui/DoorLink.vue";
import { useFleetWidgetData, type FleetRange } from "../fleetWidgetData";
import { bandOf, mpgText, partWeekNote, readWeeks, weekCaption } from "../mpgWeeks";
import { viz, BAR_GEOMETRY, trendOptions, fmtDay, resolveAlpha } from "@/lib/chartTheme";
import { barValueLabels, valueBand } from "@/lib/chartMarks";

const props = defineProps<{ range: FleetRange }>();
const { mpgWeeks, mpgTotal, mpgSub, mpgPrevious, mpgPreviousWeeks, deltas, previousLabel, previousPhrase } =
  useFleetWidgetData(computed(() => props.range));

const weeks = computed(() => readWeeks(mpgWeeks.value));
const band = computed(() => bandOf(readWeeks(mpgPreviousWeeks.value)));
const note = computed(() => partWeekNote(weeks.value));
const windowNote = computed(() => fleetMpgWindowNote(mpgTotal.value ?? { partial: false, to: "", requestedTo: "" }));

/**
 * The read has answered and no week in it has an MPG (SMALL-SCREENS-PLAN.md D-SM11). The card then
 * says so ONCE, in the plot's place: until 2026-11-16 the readout row also printed "— not enough
 * measured distance" above the same sentence. ⚠ `mpgTotal` is null until the read answers, and
 * stays the condition — a loading card must not claim there is no data.
 */
const nothingMeasured = computed(() => mpgTotal.value != null && weeks.value.every((w) => w.mpg == null));

const scrub = ref<{ label: string; value: number } | null>(null);
const scrubbed = computed(() => (scrub.value ? weeks.value.find((w) => w.from === scrub.value!.label) ?? null : null));

const readout = computed(() => {
  if (nothingMeasured.value) return undefined;
  if (scrub.value) return mpgText(scrub.value.value);
  return mpgTotal.value?.mpg != null ? mpgText(mpgTotal.value.mpg) : "—";
});
const delta = computed(() => {
  const d = deltas.value.mpg;
  return d ? { direction: d.direction, tone: deltaTone(d, true), label: deltaLabel(d, "abs"), against: previousLabel.value } : null;
});
const caption = computed(() => {
  if (scrubbed.value) return weekCaption(scrubbed.value);
  const prev = mpgPrevious.value?.mpg != null ? `vs ${formatFleetMpg(mpgPrevious.value.mpg)} ${previousPhrase.value}` : null;
  // "measured to 11/15" is the tile-length form of `windowNote`'s sentence; when the sentence is on
  // the card the short form would say the same thing twice, a phone's width apart.
  return [prev, windowNote.value ? null : mpgSub.value].filter(Boolean).join(" · ");
});

/** A full week in the brand colour, a part-week in a 30% wash of it — the legend's swatches are these. */
const swatch = { get full() { return viz.brand; }, get part() { return resolveAlpha("--viz-brand", 0.3); } };

/** The band rides in the options, which `BaseChart` updates in place — see `valueBand`. */
const withBand = (options: ChartConfiguration<"bar">["options"], b: { lo: number; hi: number } | null) =>
  ({ ...options, plugins: { ...options?.plugins, valueBand: { band: b } } }) as ChartConfiguration<"bar">["options"];

const chart = computed<ChartConfiguration<"bar">>(() => {
  const { full, part } = swatch;
  const max = Math.max(0, ...weeks.value.map((w) => w.mpg ?? 0), band.value?.hi ?? 0);
  return {
    type: "bar",
    data: {
      labels: weeks.value.map((w) => w.from),
      datasets: [{
        label: "Fleet MPG",
        data: weeks.value.map((w) => w.mpg),
        backgroundColor: weeks.value.map((w) => (w.full ? full : part)),
        hoverBackgroundColor: weeks.value.map((w) => (w.full ? full : part)),
        ...BAR_GEOMETRY,
        maxBarThickness: 44,
      }],
    },
    options: withBand(trendOptions({
      series: "Fleet MPG",
      format: mpgText,
      tickFormat: (v) => String(v),
      dataMax: max,
      onScrub: (p) => { scrub.value = p; },
    }) as ChartConfiguration<"bar">["options"], band.value),
    plugins: [valueBand, barValueLabels(formatFleetMpg)],
  };
});
</script>

<template>
  <ChartCard
    title="Fleet MPG"
    subtitle="Measured miles ÷ the fuel behind them, by week"
    :icon="GaugeIcon"
    tone="brand"
    :readout="readout"
    :caption="caption"
    class="h-full"
  >
    <template #door><DoorLink to="/driver-performance">Driver performance</DoorLink></template>
    <template #beside-readout><AppDelta v-if="delta" v-bind="delta" /></template>

    <p v-if="nothingMeasured" class="rounded-control bg-surface-subtle px-4 py-6 text-center text-sm text-ink-muted" data-test="mpg-nothing-measured">
      No week in these dates has enough measured distance for an MPG.
      <span v-if="mpgTotal?.reason" class="mt-1 block text-xs text-ink-tertiary">{{ mpgTotal.reason }}</span>
    </p>
    <template v-else>
      <BaseChart :config="chart as ChartConfiguration" :height="190" />
      <ul class="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-ink-tertiary" aria-hidden="true" data-test="mpg-legend">
        <li class="flex items-center gap-1.5"><span class="size-2 rounded-detail" :style="{ backgroundColor: swatch.full }" /> Full week</li> <!-- token-check-disable-line: token-resolved chart color -->
        <li v-if="note" class="flex items-center gap-1.5"><span class="size-2 rounded-detail" :style="{ backgroundColor: swatch.part }" /> Part of a week</li> <!-- token-check-disable-line: token-resolved chart color -->
        <li v-if="band" class="flex items-center gap-1.5" data-test="mpg-band">
          <span class="h-2 w-3 rounded-detail bg-surface-muted" /> Grey band: {{ previousPhrase }}, {{ formatFleetMpg(band.lo) }} – {{ formatFleetMpg(band.hi) }}
        </li>
      </ul>
      <p v-if="note" class="mt-2 text-xs text-ink-tertiary" data-test="mpg-part-weeks">{{ note }}</p>
    </template>
    <!-- The wrapper is `sr-only`, not the table: a table sizes to its content and ignores the
         1 px box, so this one stood 541 px wide inside a 390 px phone and the whole Fleet overview
         scrolled sideways (SMALL-SCREENS-PLAN.md M4, measured 2026-11-14). The table keeps the
         class as well: it is how `lint:ui-adoption` tells a reader's table from a visible one. -->
    <div class="sr-only">
      <table class="sr-only">
        <caption>Fleet MPG by week</caption>
        <thead><tr><th scope="col">Week</th><th scope="col">Days</th><th scope="col">MPG</th></tr></thead>
        <tbody>
          <tr v-for="w in weeks" :key="w.from">
            <th scope="row">{{ fmtDay(w.from) }} – {{ fmtDay(w.to) }}</th>
            <td>{{ w.days }}</td>
            <td>{{ w.mpg == null ? "no data" : formatFleetMpg(w.mpg) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- The roll-up's reach, stated on the card: this is the card that made the 2026-09-13 outage
         visible at all (a headline of 8.61 above five weeks of 6.3–7.1). -->
    <p v-if="windowNote" class="mt-3 text-xs text-ink-tertiary">{{ windowNote }}</p>
    <p v-else-if="mpgTotal?.reason && !nothingMeasured" class="mt-3 text-xs text-ink-tertiary">{{ mpgTotal.reason }}</p>
  </ChartCard>
</template>
