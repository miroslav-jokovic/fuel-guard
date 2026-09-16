<script setup lang="ts">
import { ref, watch } from "vue";
import maplibregl from "maplibre-gl";
import { AppCard as BaseCard } from "@silvicom/ui";
import { useMapLibre, tokenColor } from "@/composables/useMapLibre";
import type { PlanResult, PlanStopView } from "./useFuelPlan";

/**
 * The planned route, drawn on our own tiles.
 *
 * Map plumbing — the token colour conversion, the Bearer token on every tile request, the style, and
 * the teardown — moved to `@/composables/useMapLibre` with LM7. What is left here is the only part
 * that is about a ROUTE: the line, the four markers, and fitting the view to them.
 */
const props = defineProps<{
  route: NonNullable<PlanResult["route"]>;
  stops: PlanStopView[];
  origin?: { lat: number; lng: number };
  destination?: { lat: number; lng: number };
}>();

const mapEl = ref<HTMLElement | null>(null);
let markers: maplibregl.Marker[] = [];

function markerEl(dotClass: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `size-3.5 rounded-full ring-2 ring-white shadow ${dotClass}`;
  return el;
}

type RouteFeature = {
  type: "Feature";
  properties: Record<string, never>;
  geometry: { type: "LineString"; coordinates: number[][] };
};
function routeGeoJson(): RouteFeature {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: props.route.polyline.map((p) => [p.lng, p.lat] as number[]) },
  };
}

function boundsOfRoute(): maplibregl.LngLatBounds | null {
  const pts = props.route.polyline;
  if (pts.length < 2) return null;
  const b = new maplibregl.LngLatBounds([pts[0]!.lng, pts[0]!.lat], [pts[0]!.lng, pts[0]!.lat]);
  for (const p of pts) b.extend([p.lng, p.lat]);
  return b;
}

function drawMarkers() {
  for (const m of markers) m.remove();
  markers = [];
  if (!map.value) return;
  const pts = props.route.polyline;
  const start = props.origin ?? pts[0];
  const end = props.destination ?? pts[pts.length - 1];
  if (start) markers.push(new maplibregl.Marker({ element: markerEl("bg-success-600") }).setLngLat([start.lng, start.lat]).addTo(map.value));
  if (end) markers.push(new maplibregl.Marker({ element: markerEl("bg-brand-accent-strong") }).setLngLat([end.lng, end.lat]).addTo(map.value));
  for (const s of props.stops) {
    if (s.stationLng == null || s.stationLat == null) continue;
    markers.push(
      new maplibregl.Marker({ element: markerEl(s.isEmergency ? "bg-warning-500" : "bg-info-500") })
        .setLngLat([s.stationLng, s.stationLat])
        .addTo(map.value),
    );
  }
}

function syncRoute() {
  if (!map.value) return;
  const src = map.value.getSource("route") as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(routeGeoJson());
  drawMarkers();
  const b = boundsOfRoute();
  if (b) map.value.fitBounds(b, { padding: 48, duration: 0 });
}

const { map } = useMapLibre({
  container: mapEl,
  tiles: "/api/fueling/map-tiles/{z}/{x}/{y}",
  authPathFragment: "/api/fueling/map-tiles/",
  attribution: "© HERE",
  // Markers are this component's; maplibre does not remove them for you when the map goes, and they
  // must go while it is still there — which is what `onBeforeTeardown` guarantees.
  onBeforeTeardown: () => {
    for (const m of markers) m.remove();
    markers = [];
  },
  onLoad: (instance) => {
    instance.addSource("route", { type: "geojson", data: routeGeoJson() });
    instance.addLayer({
      id: "route-line",
      type: "line",
      source: "route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": tokenColor("text-brand-500"), "line-width": 4 },
    });
    drawMarkers();
    const b = boundsOfRoute();
    if (b) instance.fitBounds(b, { padding: 48, duration: 0 });
  },
});

watch(() => props.route, syncRoute);
</script>

<template>
  <BaseCard padding="none">
    <div ref="mapEl" class="h-[380px] w-full overflow-hidden rounded-t-surface" role="img" aria-label="Planned route with fuel stops" />
    <div class="flex flex-wrap items-center gap-4 border-t border-edge px-4 py-2 text-xs text-ink-muted">
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-success-600" /> Start</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-brand-accent-strong" /> Destination</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-info-500" /> Fuel stop</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-warning-500" /> Emergency stop</span>
    </div>
  </BaseCard>
</template>
