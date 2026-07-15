<script setup lang="ts">
import { computed } from "vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import type { PlanResult, PlanStopView } from "./useFuelPlan";

const props = defineProps<{
  route: NonNullable<PlanResult["route"]>;
  stops: PlanStopView[];
  origin?: { lat: number; lng: number };
  destination?: { lat: number; lng: number };
}>();

const W = 800;
const H = 360;
const PAD = 26;

interface XY { x: number; y: number }

const view = computed(() => {
  const pts = props.route.polyline;
  if (pts.length < 2) return null;
  const midLat = pts[Math.floor(pts.length / 2)]!.lat;
  const k = Math.cos((midLat * Math.PI) / 180) || 1;
  // Single-pass extent (a spread over thousands of points overflows the stack).
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    const x = p.lng * k, y = -p.lat;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const spanX = Math.max(maxX - minX, 1e-6), spanY = Math.max(maxY - minY, 1e-6);
  const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
  const offX = PAD + ((W - 2 * PAD) - spanX * scale) / 2;
  const offY = PAD + ((H - 2 * PAD) - spanY * scale) / 2;
  const toXY = (lat: number, lng: number): XY => ({ x: offX + (lng * k - minX) * scale, y: offY + (-lat - minY) * scale });

  const step = Math.max(1, Math.ceil(pts.length / 400));
  let d = "";
  for (let i = 0; i < pts.length; i += step) {
    const { x, y } = toXY(pts[i]!.lat, pts[i]!.lng);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  const last = toXY(pts[pts.length - 1]!.lat, pts[pts.length - 1]!.lng);
  d += `L${last.x.toFixed(1)} ${last.y.toFixed(1)}`;

  return {
    d,
    origin: props.origin ? toXY(props.origin.lat, props.origin.lng) : toXY(pts[0]!.lat, pts[0]!.lng),
    destination: props.destination ? toXY(props.destination.lat, props.destination.lng) : last,
    stops: props.stops.map((s) => ({ ...toXY(s.stationLat, s.stationLng), emergency: s.isEmergency })),
  };
});
</script>

<template>
  <BaseCard padding="none">
    <svg v-if="view" :viewBox="`0 0 ${W} ${H}`" class="h-auto w-full" role="img" aria-label="Planned route with fuel stops">
      <rect x="0" y="0" :width="W" :height="H" class="fill-surface-subtle" />
      <path :d="view.d" fill="none" class="stroke-brand-500" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      <g v-for="(s, i) in view.stops" :key="i">
        <circle :cx="s.x" :cy="s.y" r="6" class="fill-surface" />
        <circle :cx="s.x" :cy="s.y" r="4" :class="s.emergency ? 'fill-warning-500' : 'fill-info-500'" />
      </g>
      <circle :cx="view.origin.x" :cy="view.origin.y" r="8" class="fill-surface" />
      <circle :cx="view.origin.x" :cy="view.origin.y" r="5" class="fill-success-600" />
      <circle :cx="view.destination.x" :cy="view.destination.y" r="8" class="fill-surface" />
      <circle :cx="view.destination.x" :cy="view.destination.y" r="5" class="fill-brand-600" />
    </svg>
    <div class="flex flex-wrap items-center gap-4 border-t border-edge px-4 py-2 text-xs text-ink-muted">
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-success-600" /> Start</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-brand-600" /> Destination</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-info-500" /> Fuel stop</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-warning-500" /> Emergency stop</span>
    </div>
  </BaseCard>
</template>
