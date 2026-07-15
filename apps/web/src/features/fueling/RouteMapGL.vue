<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import BaseCard from "@/components/ui/BaseCard.vue";
import { supabase } from "@/lib/supabase";
import type { PlanResult, PlanStopView } from "./useFuelPlan";

const props = defineProps<{
  route: NonNullable<PlanResult["route"]>;
  stops: PlanStopView[];
  origin?: { lat: number; lng: number };
  destination?: { lat: number; lng: number };
}>();

const mapEl = ref<HTMLElement | null>(null);
let map: maplibregl.Map | null = null;
let markers: maplibregl.Marker[] = [];
let authSub: { unsubscribe(): void } | null = null;

// Resolve a semantic token to a concrete color at runtime (no hex literals in source): render a hidden
// element with the token class, read its computed color, then normalize through a canvas — the design
// tokens are authored in oklch(), which maplibre's style parser rejects; canvas returns rgb/hex it accepts.
function tokenColor(cls: string): string {
  const el = document.createElement("span");
  el.className = cls;
  el.style.display = "none";
  document.body.appendChild(el);
  const raw = window.getComputedStyle(el).color;
  el.remove();
  const cv = document.createElement("canvas");
  const ctx = cv.getContext("2d");
  if (!ctx) return "rgb(37, 99, 235)";
  ctx.fillStyle = "rgb(37, 99, 235)"; // fallback if the browser rejects the source color string
  try {
    ctx.fillStyle = raw;
  } catch {
    // keep fallback
  }
  return ctx.fillStyle;
}

// The tile proxy is authenticated (Bearer JWT). maplibre fetches tiles from a worker with no auth header,
// so we attach the current Supabase access token via transformRequest. Kept fresh on token refresh.
let accessToken: string | null = null;
function attachAuth(url: string): maplibregl.RequestParameters {
  if (accessToken && url.includes("/api/fueling/map-tiles/")) {
    return { url, headers: { Authorization: `Bearer ${accessToken}` } };
  }
  return { url };
}

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
  if (!map) return;
  const pts = props.route.polyline;
  const start = props.origin ?? pts[0];
  const end = props.destination ?? pts[pts.length - 1];
  if (start) markers.push(new maplibregl.Marker({ element: markerEl("bg-success-600") }).setLngLat([start.lng, start.lat]).addTo(map));
  if (end) markers.push(new maplibregl.Marker({ element: markerEl("bg-brand-600") }).setLngLat([end.lng, end.lat]).addTo(map));
  for (const s of props.stops) {
    markers.push(
      new maplibregl.Marker({ element: markerEl(s.isEmergency ? "bg-warning-500" : "bg-info-500") })
        .setLngLat([s.stationLng, s.stationLat])
        .addTo(map),
    );
  }
}

function syncRoute() {
  if (!map) return;
  const src = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(routeGeoJson());
  drawMarkers();
  const b = boundsOfRoute();
  if (b) map.fitBounds(b, { padding: 48, duration: 0 });
}

onMounted(async () => {
  if (!mapEl.value) return;
  const { data: sess } = await supabase.auth.getSession();
  accessToken = sess.session?.access_token ?? null;
  authSub = supabase.auth.onAuthStateChange((_e, session) => {
    accessToken = session?.access_token ?? null;
  }).data.subscription;
  map = new maplibregl.Map({
    container: mapEl.value,
    transformRequest: attachAuth,
    style: {
      version: 8,
      sources: {
        here: {
          type: "raster",
          tiles: ["/api/fueling/map-tiles/{z}/{x}/{y}"],
          tileSize: 512,
          attribution: "© HERE",
        },
      },
      layers: [{ id: "here", type: "raster", source: "here" }],
    },
    attributionControl: { compact: true },
    dragRotate: false,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.on("load", () => {
    if (!map) return;
    map.addSource("route", { type: "geojson", data: routeGeoJson() });
    map.addLayer({
      id: "route-line",
      type: "line",
      source: "route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": tokenColor("text-brand-500"), "line-width": 4 },
    });
    drawMarkers();
    const b = boundsOfRoute();
    if (b) map.fitBounds(b, { padding: 48, duration: 0 });
  });
});

watch(() => props.route, syncRoute);

onBeforeUnmount(() => {
  authSub?.unsubscribe();
  authSub = null;
  for (const m of markers) m.remove();
  markers = [];
  map?.remove();
  map = null;
});
</script>

<template>
  <BaseCard padding="none">
    <div ref="mapEl" class="h-[380px] w-full overflow-hidden rounded-t-xl" role="img" aria-label="Planned route with fuel stops" />
    <div class="flex flex-wrap items-center gap-4 border-t border-edge px-4 py-2 text-xs text-ink-muted">
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-success-600" /> Start</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-brand-600" /> Destination</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-info-500" /> Fuel stop</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-warning-500" /> Emergency stop</span>
    </div>
  </BaseCard>
</template>
