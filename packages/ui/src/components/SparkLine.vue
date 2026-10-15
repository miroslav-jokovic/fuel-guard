<script setup lang="ts">
import { computed } from "vue";

/**
 * Dependency-free SVG sparkline for stat tiles. Null points render as honest gaps
 * (the polyline splits), matching how the full-size trend charts treat missing days.
 * Each segment gets a soft top-down gradient fill so the tiles read like the big trend
 * charts (transparent area under the line).
 */
const props = defineProps<{
  points: (number | null)[];
  color: string;
}>();

const W = 120;
const H = 36;
const PAD = 3;

// Unique gradient id per instance so multiple sparklines on a page don't share one <defs>.
let seq = 0;
function nextSeq(): number {
  seq += 1;
  return seq;
}
const gradId = `spark-grad-${nextSeq()}`;

const segments = computed<string[]>(() => {
  const pts = props.points;
  const vals = pts.filter((p): p is number => p != null);
  if (vals.length < 2) return [];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const step = pts.length > 1 ? (W - PAD * 2) / (pts.length - 1) : 0;

  const segs: string[] = [];
  let current: string[] = [];
  pts.forEach((p, i) => {
    if (p == null) {
      if (current.length > 1) segs.push(current.join(" "));
      current = [];
      return;
    }
    const x = PAD + i * step;
    const y = PAD + (1 - (p - min) / span) * (H - PAD * 2);
    current.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (current.length > 1) segs.push(current.join(" "));
  return segs;
});

// Area path per segment: trace the line, drop to the baseline, close — filled with the gradient.
const areas = computed<string[]>(() =>
  segments.value.map((seg) => {
    const pairs = seg.split(" ");
    const firstX = pairs[0]!.split(",")[0];
    const lastX = pairs[pairs.length - 1]!.split(",")[0];
    return `M ${pairs.join(" L ")} L ${lastX},${H} L ${firstX},${H} Z`;
  }),
);

const endDot = computed<{ x: number; y: number } | null>(() => {
  const last = segments.value.at(-1)?.split(" ").at(-1);
  if (!last) return null;
  const [x, y] = last.split(",").map(Number);
  return { x: x!, y: y! };
});
</script>

<template>
  <svg
    v-if="segments.length"
    :viewBox="`0 0 ${W} ${H}`"
    class="h-9 w-full"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <defs>
      <linearGradient :id="gradId" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="color" stop-opacity="0.22" />
        <stop offset="100%" :stop-color="color" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path v-for="(d, i) in areas" :key="`a${i}`" :d="d" :fill="`url(#${gradId})`" stroke="none" />
    <polyline
      v-for="(seg, i) in segments"
      :key="i"
      :points="seg"
      fill="none"
      :stroke="color"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      vector-effect="non-scaling-stroke"
    />
    <circle v-if="endDot" :cx="endDot.x" :cy="endDot.y" r="2.5" :fill="color" stroke="white" stroke-width="1.5" />
  </svg>
</template>
