<script setup lang="ts">
import type { ChartConfiguration } from "chart.js";
import { computed, ref } from "vue";
import BaseChart from "@/components/BaseChart.vue";
import { resolve } from "@/lib/chartTheme";

export interface DonutBreakdownItem {
  key: string;
  label: string;
  value: number;
  valueLabel: string;
  color: string;
}

const props = defineProps<{
  items: DonutBreakdownItem[];
  centerValue: string;
  centerLabel: string;
  chartLabel: string;
}>();

/**
 * ── THE RING'S GEOMETRY, ONCE (D-DT14) ──────────────────────────────────────────────────────────
 * The track behind the arcs is an SVG circle rather than a second Chart.js dataset, because a
 * second dataset in a doughnut is a second CONCENTRIC ring — it sits beside the first, not behind
 * it. These four numbers are what make the two agree, so they are stated once and read by both:
 * Chart.js draws its arc band between `SIZE/2 - PAD` and that times `CUTOUT`, and the track is a
 * stroked circle down the middle of the same band.
 */
const SIZE = 192;
const PAD = 7;
const CUTOUT = 0.74;
/**
 * The arc's border, painted in `--surface` INSIDE the arc — which is what separates neighbouring
 * slices. It has to be subtracted from the track or the track reads as a halo around the ring
 * rather than as the ground under it: the first build of this showed 3px of grey outside every
 * coloured arc, all the way round, which looks like a mis-sized ring and not like a track.
 */
const BORDER = 3;
const OUTER = SIZE / 2 - PAD;
const BAND = OUTER * (1 - CUTOUT);
/** Centre-line radius and stroke width of the track — the PAINTED band, expressed as one stroke. */
const TRACK_R = OUTER - BAND / 2;
const TRACK_W = BAND - BORDER * 2;

const total = computed(() => props.items.reduce((sum, item) => sum + Math.max(0, item.value), 0));
const hasData = computed(() => total.value > 0);
const visibleSlices = computed(() => props.items.filter((item) => item.value > 0));

/**
 * Which slice the pointer is on (D-DT14), set by the ring and read by the ring, the centre and the
 * legend.
 *
 * Keyed by `item.key` rather than by index because the ring is drawn from `visibleSlices` (a
 * zero-value slice is dropped) while the legend lists every item — two different index spaces, and
 * using one for the other is how the wrong row lights up.
 */
const activeKey = ref<string | null>(null);
const activeItem = computed(() => props.items.find((i) => i.key === activeKey.value) ?? null);

/**
 * The track's colour, resolved the way every other chart colour in this app is.
 *
 * ⚠ Not a Tailwind class on the `<circle>`: `stroke-edge-subtle` would need Tailwind to emit a
 * stroke utility for a semantic role it has no stroke scale for, and `lint:tokens` reads raw colour
 * in an SVG attribute as a violation. `resolve()` reads the custom property the tokens already
 * define, which is what `DonutBreakdown` does for the empty-state arc directly below.
 */
const trackColor = computed(() => resolve("--edge-subtle"));

const shareLabel = (value: number) => {
  if (total.value === 0 || value <= 0) return "0%";
  const share = (value / total.value) * 100;
  return share < 1 ? "<1%" : `${Math.round(share)}%`;
};

/**
 * ⚠ `ChartConfiguration` and NOT `ChartConfiguration<"doughnut">`, since LM9.
 *
 * `BaseChart` declares `config: ChartConfiguration` — the union over every chart type — and a
 * doughnut-specific configuration is not assignable to it (its `data` is `number[]` where the union
 * admits `null` and point objects). The mismatch was always here; it began FAILING when LM9 moved
 * this component's only caller into its own widget, which is the kind of latent error a refactor
 * surfaces rather than causes. The object literal below still narrows on `type: "doughnut"`, so
 * nothing inside it loses checking.
 */
const chart = computed<ChartConfiguration>(() => {
  const slices = hasData.value
    ? visibleSlices.value
    : [{ key: "empty", label: "No data", value: 1, valueLabel: "0", color: resolve("--edge-subtle") }];

  return {
    type: "doughnut",
    data: {
      labels: slices.map((item) => item.label),
      datasets: [
        {
          data: slices.map((item) => item.value),
          backgroundColor: slices.map((item) => item.color),
          hoverBackgroundColor: slices.map((item) => item.color),
          borderColor: resolve("--surface"),
          borderWidth: hasData.value ? BORDER : 0,
          spacing: hasData.value ? 2 : 0,
          borderRadius: hasData.value ? 7 : 0,
          hoverOffset: hasData.value ? 4 : 0,
          // The lift is DATA, not a hover state, so a legend row can cause it too. Chart.js applies
          // `hoverOffset` only to what the pointer is over; `offset` is the same displacement under
          // the component's own control.
          offset: slices.map((item) => (hasData.value && item.key === activeKey.value ? 4 : 0)),
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "74%",
      layout: { padding: 7 },
      animation:
        typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
          ? false
          : { duration: 450 },
      /**
       * ⚠ The pointer's slice reaches the component here, and the floating tooltip is GONE with it
       * (D-DT11's rule, applied to the ring): the centre of a donut is a readout that is already
       * on screen, so a box beside the cursor repeating it is the second reading of one number.
       */
      onHover: (_event, elements) => {
        if (!hasData.value) return;
        const hit = elements[0];
        activeKey.value = hit ? (visibleSlices.value[hit.index]?.key ?? null) : null;
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
    },
  };
});
</script>

<template>
  <!--
    ⚠ `@container`, not `sm:` — and this is a DEFECT the viewport rule was hiding, not a refinement.
    Measured 2026-09-20 with `scrollWidth - clientWidth` at six widths: at **1024** every legend
    label on both donuts was clipped ("Moving fuel" by 72px, "Idle waste" by 62px), and at 1280 and
    1440 none of them was. `sm:` turns the two-column layout on at a 640px VIEWPORT, but what
    decides whether the legend fits is the CARD: at 1024 the dashboard grid is already two-up, so
    the card body is 300px — 192 of it donut — and the labels were being squeezed into ~20px with
    `truncate` reporting nothing. 26rem is the body width at which the legend gets its ~200px back
    (label ~90 + value ~80 + gap), so below it the ring and its legend stack, as they do on a phone.
    The same class of error as D-DR17: a viewport breakpoint asked about a container question.
  -->
  <!--
    ⚠ The `@container` is the WRAPPER and the query is on the child, which is not a style choice: a
    container query matches DESCENDANTS of the container, never the container itself. The first
    build of this put both on one element, so the query never matched and both donuts stacked at
    every width — and the truncation audit that was supposed to catch it reported "none" for the
    happiest possible reason, because a stacked legend has the whole card to itself. A measurement
    that can pass by the layout collapsing is not a measurement of the layout.
  -->
  <div class="@container">
    <div class="grid min-h-52 grid-cols-1 items-center gap-5 @[26rem]:grid-cols-[12rem_minmax(0,1fr)] @[26rem]:gap-6">
    <div class="relative mx-auto size-48 shrink-0" role="img" :aria-label="chartLabel">
      <!--
        The TRACK (D-DT14). Without it a ring that is 60% full reads as an arc that stopped rather
        than as a share of a whole — the commonest misreading of a doughnut. It is behind the canvas
        rather than in it for the reason `TRACK_R` gives: a second Chart.js dataset would be a
        second ring beside this one.
      -->
      <svg class="absolute inset-0" :viewBox="`0 0 ${SIZE} ${SIZE}`" aria-hidden="true">
        <circle
          :cx="SIZE / 2"
          :cy="SIZE / 2"
          :r="TRACK_R"
          fill="none"
          :stroke="trackColor"
          :stroke-width="TRACK_W"
        />
      </svg>
      <div class="relative" aria-hidden="true">
        <BaseChart :config="chart" :height="192" />
      </div>
      <!--
        The centre TRADES the total for the part, reversibly (D-DT14). Same slot, same type, and it
        comes back the way it went out — you never lose the total, and there is no second surface
        for the hovered value to appear on. `transition` on opacity alone: the two figures are
        different lengths, and animating anything that reflows makes the centre wobble.
      -->
      <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
        <span
          class="max-w-full truncate text-lg font-semibold tabular-nums text-ink transition-opacity duration-150"
          :title="activeItem ? activeItem.valueLabel : centerValue"
        >
          {{ activeItem ? activeItem.valueLabel : centerValue }}
        </span>
        <span class="mt-0.5 max-w-full truncate text-2xs font-medium text-ink-tertiary">
          {{ activeItem ? activeItem.label : centerLabel }}
        </span>
      </div>
    </div>

    <ul class="min-w-0 divide-y divide-edge-subtle self-stretch" :aria-label="`${chartLabel} details`">
      <!--
        ⚠ ONE DIRECTION, deliberately: the ring lights its legend row, and the row does NOT drive
        the ring. D-DT14 asks for both, and the second half is deferred rather than bodged, because
        the accessible form of it is a decision this change should not take on its own. A row that
        responds to a pointer has to respond to a keyboard (`mouse-events-have-key-events`), a
        focusable row has to do something when it is activated (`no-static-element-interactions`),
        and the only honest "something" is a click that PINS the slice — a new affordance, on touch
        as well, that no comp draws and nobody has asked for. Recorded in the plan's open questions
        instead. The row still carries the value and the share as text, so nothing is lost to a
        reader who cannot hover; what they lose is an echo.
      -->
      <li
        v-for="item in items"
        :key="item.key"
        class="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-control px-2 py-2.5 transition-colors"
        :class="activeKey === item.key ? 'bg-surface-subtle' : ''"
      >
        <span class="flex min-w-0 items-center gap-2.5">
          <span class="size-2.5 shrink-0 rounded-detail" :style="{ backgroundColor: item.color }" aria-hidden="true" /> <!-- token-check-disable-line: token-resolved chart color -->
          <span :class="item.value > 0 ? 'text-ink-secondary' : 'text-ink-tertiary'" class="truncate text-sm">
            {{ item.label }}
          </span>
        </span>
        <span class="text-right">
          <span :class="item.value > 0 ? 'text-ink' : 'text-ink-tertiary'" class="block text-sm font-semibold tabular-nums">
            {{ item.valueLabel }}
          </span>
          <span class="block text-2xs tabular-nums text-ink-tertiary">{{ shareLabel(item.value) }}</span>
        </span>
      </li>
    </ul>
  </div>
  </div>
</template>
