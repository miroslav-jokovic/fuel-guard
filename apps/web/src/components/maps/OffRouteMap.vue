<script setup lang="ts">
import { ref, watch } from "vue";
import * as maplibregl from "maplibre-gl";
import type { LatLng, OffRouteView } from "@silvicom/shared";
import { useMapLibre, tokenColor } from "@/composables/useMapLibre";

/**
 * One Out of route warning on our own tiles (OUT-OF-ROUTE-MAP-ANALYSIS option A, D-ORM7). Shared in
 * `components/maps` rather than kept in the follow-up feature, so a live-map layer (option B, Q-ORM5)
 * can mount the same view without reaching into another feature.
 *
 * What is drawn, and why each looks the way it does:
 *   · the planned route — dashed brand, the live map's own word for "planned" (`liveMapRouteLayer.ts`);
 *   · the way to the pickup, when the truck had not left it — the same, fainter: ours, not Samsara's;
 *   · where the truck drove — solid ink, so it never reads as part of the plan;
 *   · three markers only: where it left, its furthest point, where it was back.
 * The map is a picture of the sentence above it (D-ORM3), so it is `role="img"` with that sentence as
 * its name, and a one-finger drag scrolls the drawer rather than the map (`cooperativeGestures`).
 */
const props = defineProps<{ view: OffRouteView; label: string }>();

const mapEl = ref<HTMLElement | null>(null);
let markers: maplibregl.Marker[] = [];

const LINES = [
  { id: "orm-planned", pick: (v: OffRouteView) => v.planned?.route ?? [], colour: "text-brand-600", opacity: 0.85, dashed: true },
  { id: "orm-to-pickup", pick: (v: OffRouteView) => v.planned?.toPickup ?? [], colour: "text-brand-600", opacity: 0.45, dashed: true },
  { id: "orm-driven", pick: (v: OffRouteView) => v.path, colour: "text-ink-secondary", opacity: 0.9, dashed: false },
] as const;

const feature = (line: readonly LatLng[]) => ({
  type: "Feature" as const,
  properties: {},
  geometry: { type: "LineString" as const, coordinates: line.map((p) => [p.lng, p.lat]) },
});

function dot(cls: string, title: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `size-3.5 rounded-full ring-2 ring-white shadow ${cls}`;
  el.title = title;
  return el;
}

function drawMarkers(map: maplibregl.Map) {
  for (const m of markers) m.remove();
  markers = [];
  const v = props.view.verdict;
  const put = (p: LatLng | null | undefined, cls: string, title: string) => {
    if (p) markers.push(new maplibregl.Marker({ element: dot(cls, title) }).setLngLat([p.lng, p.lat]).addTo(map));
  };
  const stops = props.view.planned?.stops ?? [];
  put(stops[0], "bg-success-600", "Pickup");
  put(stops.at(-1), "bg-brand-accent-strong", "Delivery");
  put(v?.left, "bg-warning-500", "Left the planned route");
  put(v?.furthest, "bg-danger-600", "Furthest from it");
  put(v?.back, "bg-info-500", "Back on it");
}

function fit(map: maplibregl.Map) {
  const pts = [...props.view.path, ...(props.view.planned?.toPickup ?? []), ...(props.view.planned?.stops ?? [])];
  // The driven path and the stops frame the view: the whole planned route may run 1,000 miles past them.
  if (pts.length === 0) return;
  const b = new maplibregl.LngLatBounds([pts[0]!.lng, pts[0]!.lat], [pts[0]!.lng, pts[0]!.lat]);
  for (const p of pts) b.extend([p.lng, p.lat]);
  map.fitBounds(b, { padding: 40, duration: 0, maxZoom: 13 });
}

function draw(map: maplibregl.Map) {
  for (const l of LINES) {
    const data = feature(l.pick(props.view));
    const src = map.getSource(l.id) as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(data);
    else {
      map.addSource(l.id, { type: "geojson", data });
      map.addLayer({
        id: l.id,
        type: "line",
        source: l.id,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": tokenColor(l.colour), "line-opacity": l.opacity, "line-width": 4, ...(l.dashed ? { "line-dasharray": [2, 1.5] } : {}) },
      });
    }
  }
  drawMarkers(map);
  fit(map);
}

const { map } = useMapLibre({
  container: mapEl,
  tiles: "/api/fueling/map-tiles/{z}/{x}/{y}",
  authPathFragment: "/api/fueling/map-tiles/",
  attribution: "© HERE",
  onBeforeTeardown: () => {
    for (const m of markers) m.remove();
    markers = [];
  },
  onLoad: (instance) => {
    instance.cooperativeGestures.enable();
    draw(instance);
  },
});

// Guarded on our own layer, never `isStyleLoaded()` — that is false while any tile loads (TRUCK-CARD-ROUTE-PLAN TC3, PR 1417).
watch(() => props.view, () => {
  if (map.value?.getLayer(LINES[0].id)) draw(map.value);
});
</script>

<template>
  <figure class="space-y-2">
    <div ref="mapEl" class="aspect-[16/10] w-full overflow-hidden rounded-detail ring-1 ring-edge" role="img" :aria-label="label" data-test="off-route-map" />
    <figcaption class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
      <span class="inline-flex items-center gap-1.5"><span class="h-0.5 w-4 border-t-2 border-dashed border-brand-600" /> Planned route (ours, from the load's stops)</span>
      <span class="inline-flex items-center gap-1.5"><span class="h-0.5 w-4 bg-ink-secondary" /> Where the truck drove</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-warning-500" /> Left</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-danger-600" /> Furthest</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-info-500" /> Back</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-success-600" /> Pickup</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-brand-accent-strong" /> Delivery</span>
    </figcaption>
  </figure>
</template>
