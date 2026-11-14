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
 * ── THE PREVIOUS PERIOD IS A BAND, NOT A SECOND LINE (D-FO3) ─────────────────────────────────────
 * Where last period's weeks sat, drawn as a quiet band from their lowest to their highest, behind
 * this period's line. One axis, one series with a context (dataviz: emphasis, never two competing
 * lines), and the pill then has a picture to point at. A previous period with no measured week
 * draws no band and says nothing.
 */
import { computed, ref } from "vue";
import type { ChartConfiguration } from "chart.js";
import { GaugeIcon } from "@silvicom/ui/icons";
import { AppDelta } from "@silvicom/ui";
import { deltaLabel, deltaTone, fleetMpgWindowNote } from "@silvicom/shared";
import BaseChart from "@/components/BaseChart.vue";
import ChartCard from "@/components/ui/ChartCard.vue";
import DoorLink from "@/components/ui/DoorLink.vue";
import { useFleetWidgetData, type FleetRange } from "../fleetWidgetData";
import { viz, areaFill, lastPointRadius, trendOptions, fmtDay, resolveAlpha } from "@/lib/chartTheme";

const props = defineProps<{ range: FleetRange }>();
const { mpgWeeks, mpgTotal, mpgSub, mpgPrevious, mpgPreviousWeeks, deltas, previousLabel, previousPhrase } =
  useFleetWidgetData(computed(() => props.range));

const windowNote = computed(() => fleetMpgWindowNote(mpgTotal.value ?? { partial: false, to: "", requestedTo: "" }));

const scrub = ref<{ label: string; value: number } | null>(null);

const readout = computed(() => {
  if (scrub.value) return `${scrub.value.value} MPG`;
  return mpgTotal.value?.mpg != null ? `${mpgTotal.value.mpg} MPG` : "—";
});
const delta = computed(() => {
  const d = deltas.value.mpg;
  return d ? { direction: d.direction, tone: deltaTone(d, true), label: deltaLabel(d, "abs"), against: previousLabel.value } : null;
});
const caption = computed(() => {
  if (scrub.value) return `week of ${fmtDay(scrub.value.label)}`;
  const prev = mpgPrevious.value?.mpg != null ? `vs ${mpgPrevious.value.mpg} ${previousPhrase.value}` : null;
  return [prev, mpgSub.value].filter(Boolean).join(" · ");
});

/** Last period's weeks, as a band from lowest to highest — null when it had no measured week. */
const band = computed(() => {
  const vals = mpgPreviousWeeks.value.map((p) => p.mpg).filter((v): v is number => v != null);
  return vals.length ? { lo: Math.min(...vals), hi: Math.max(...vals) } : null;
});

/**
 * The read has answered and no week in it has an MPG (SMALL-SCREENS-PLAN.md D-SM11). The card then
 * says so in the plot's place: until 2026-11-14 it drew 200 px of gridlines from 0 to 1 with nothing
 * on them, which reads as a chart that failed to load. ⚠ `mpgTotal` is null until the read
 * answers, and stays the condition — a loading card must not claim there is no data.
 */
const nothingMeasured = computed(() => mpgTotal.value != null && mpgWeeks.value.every((p) => p.mpg == null));

const chart = computed<ChartConfiguration>(() => {
  const labels = mpgWeeks.value.map((p) => p.from);
  const datasets: ChartConfiguration["data"]["datasets"] = [{
    label: "Fleet MPG", data: mpgWeeks.value.map((p) => p.mpg), order: 1,
    borderColor: viz.brand, backgroundColor: areaFill("--viz-brand") as unknown as string,
    fill: true, tension: 0.4, spanGaps: false, borderWidth: 2.5, borderCapStyle: "round", borderJoinStyle: "round",
    pointRadius: lastPointRadius(mpgWeeks.value.length - 1),
    pointBackgroundColor: viz.brand, pointBorderColor: viz.pointHalo, pointBorderWidth: 2,
    pointHitRadius: 12, pointHoverRadius: 5, pointHoverBackgroundColor: viz.brand, pointHoverBorderColor: viz.pointHalo, pointHoverBorderWidth: 2,
  }];
  if (band.value) {
    const flat = (v: number) => labels.map(() => v);
    datasets.push(
      { label: "Previous period, highest week", data: flat(band.value.hi), order: 2, fill: "+1", borderWidth: 0, pointRadius: 0, pointHitRadius: 0, backgroundColor: resolveAlpha("--ramp-neutral-500", 0.1) },
      { label: "Previous period, lowest week", data: flat(band.value.lo), order: 3, borderWidth: 0, pointRadius: 0, pointHitRadius: 0 },
    );
  }
  return {
    type: "line",
    data: { labels, datasets },
    options: trendOptions({
      series: "Fleet MPG",
      format: (v) => `${v} MPG`,
      tickFormat: (v) => String(v),
      beginAtZero: false,
      onScrub: (p) => { scrub.value = p; },
    }),
  };
});
</script>

<template>
  <ChartCard
    title="Fleet MPG"
    subtitle="Measured miles ÷ the fuel behind them · by week · gaps mean too little measured distance"
    :icon="GaugeIcon"
    tone="brand"
    :readout="readout"
    :caption="caption"
    class="h-full"
  >
    <template #meta><DoorLink to="/driver-performance">Driver performance</DoorLink></template>
    <template #beside-readout><AppDelta v-if="delta" v-bind="delta" /></template>

    <p v-if="nothingMeasured" class="rounded-control bg-surface-subtle px-4 py-6 text-center text-sm text-ink-muted" data-test="mpg-nothing-measured">
      No week in these dates has enough measured distance for an MPG.
    </p>
    <BaseChart v-else :config="chart" :height="200" />
    <p v-if="band && !nothingMeasured" class="mt-1.5 text-2xs text-ink-tertiary">Grey band: where {{ previousPhrase }}' weeks sat ({{ band.lo }} – {{ band.hi }}).</p>
    <!-- The wrapper is `sr-only`, not the table: a table sizes to its content and ignores the
         1 px box, so this one stood 541 px wide inside a 390 px phone and the whole Fleet overview
         scrolled sideways (SMALL-SCREENS-PLAN.md M4, measured 2026-11-14). -->
    <div class="sr-only">
      <table>
        <caption>Fleet MPG by week</caption>
        <thead><tr><th scope="col">Week beginning</th><th scope="col">MPG</th></tr></thead>
        <tbody>
          <tr v-for="p in mpgWeeks" :key="p.from">
            <th scope="row">{{ fmtDay(p.from) }}</th>
            <td>{{ p.mpg ?? "no data" }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- The roll-up's reach, stated on the card: this is the card that made the 2026-09-13 outage
         visible at all (a headline of 8.61 above five weeks of 6.3–7.1). -->
    <p v-if="windowNote" class="mt-3 text-xs text-ink-tertiary">{{ windowNote }}</p>
    <p v-else-if="mpgTotal?.reason" class="mt-3 text-xs text-ink-tertiary">{{ mpgTotal.reason }}</p>
  </ChartCard>
</template>
