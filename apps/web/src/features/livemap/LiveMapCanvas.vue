<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import maplibregl from "maplibre-gl";
import type { LiveMapVehicle } from "@silvicom/shared";
import { useMapLibre, tokenColor } from "@/composables/useMapLibre";
import { useColorScheme } from "@/composables/useColorScheme";
import { installLiveMapIcons } from "./liveMapIcons";
import { toFeatureCollection, type RenderedPlace } from "./liveMapLayer";
import { planTweens, sampleTweens, tweensSettled, type Tween } from "./liveMapMotion";

/**
 * The fleet, drawn (LIVE-MAP-PLAN.md LM8, D-LM7/D-LM8).
 *
 * One GeoJSON source and one symbol layer for every truck — never one DOM node each. The plumbing
 * (the authenticated tile proxy, the oklch→sRGB conversion, the teardown order) is `useMapLibre`,
 * extracted at LM7 against the working fuel-planning map so this file could be its second caller
 * rather than its first copy.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────────────────────────
 * No state is recomputed. `state` and `ageSeconds` arrive on the board, computed server-side against
 * one clock, and a component that re-derived either would be a second answer disagreeing with the
 * same server that drew the last frame. `deriveVehicleState` exists in `@silvicom/shared` for the
 * places that genuinely need it locally; this is not one.
 */
const props = withDefaults(
  defineProps<{
    vehicles: LiveMapVehicle[];
    /** Changes once per poll. It is the ANIMATION's clock: a new board starts a new tween. */
    generatedAt: string;
    selectedId: string | null;
    /**
     * `card` is the figure-in-a-report height the dashboard widget wants; `fill` takes whatever the
     * parent gives it (D-DR5). A prop rather than a class passed in, because the two differ in the
     * corner radius as well as the height — a canvas filling a full-bleed page has no card to round
     * itself to, and rounding it anyway leaves four slivers of canvas showing through at the
     * corners.
     */
    fit?: "card" | "fill";
  }>(),
  { fit: "card" },
);

const emit = defineEmits<{ select: [vehicleId: string | null] }>();

const mapEl = ref<HTMLElement | null>(null);
const { isDark } = useColorScheme();

const SOURCE = "live-fleet";
const SYMBOL_LAYER = "live-fleet-markers";
const SELECTED_LAYER = "live-fleet-selected";

/**
 * Tween state, held OUTSIDE Vue's reactivity on purpose: these are rewritten sixty times a second
 * and nothing in the template reads them. A `ref` here would schedule a component re-render per
 * frame to change nothing a user can see.
 */
let tweens = new Map<string, Tween>();
let places = new Map<string, RenderedPlace>();
let frame: number | null = null;
let fitted = false;

function source(): maplibregl.GeoJSONSource | undefined {
  return map.value?.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined;
}

function redraw(): void {
  source()?.setData(toFeatureCollection(props.vehicles, places, props.selectedId));
}

/**
 * One animation frame.
 *
 * It stops itself once every dot has arrived. A permanent rAF loop over a parked fleet would keep a
 * laptop's GPU awake for a picture that is not changing — and the browser already stops calling this
 * entirely while the tab is hidden, which is the other half of D-LM8's "pauses on a hidden tab".
 */
function step(): void {
  const now = performance.now();
  places = sampleTweens(tweens, now);
  redraw();
  frame = tweensSettled(tweens, now) ? null : requestAnimationFrame(step);
}

function startMotion(): void {
  tweens = planTweens(places, props.vehicles, performance.now());
  if (frame == null) frame = requestAnimationFrame(step);
}

function stopMotion(): void {
  if (frame != null) cancelAnimationFrame(frame);
  frame = null;
}

/** Frame the whole fleet ONCE. Re-fitting on every poll would yank the view out from under a reader. */
function fitToFleet(instance: maplibregl.Map): void {
  if (fitted || props.vehicles.length === 0) return;
  const first = props.vehicles[0]!.position;
  const bounds = new maplibregl.LngLatBounds([first.lng, first.lat], [first.lng, first.lat]);
  for (const v of props.vehicles) bounds.extend([v.position.lng, v.position.lat]);
  instance.fitBounds(bounds, { padding: 56, duration: 0, maxZoom: 9 });
  fitted = true;
}

const { map } = useMapLibre({
  container: mapEl,
  tiles: "/api/fueling/map-tiles/{z}/{x}/{y}",
  authPathFragment: "/api/fueling/map-tiles/",
  attribution: "© HERE",
  onBeforeTeardown: stopMotion,
  onLoad: (instance) => {
    installLiveMapIcons(instance);
    instance.addSource(SOURCE, {
      type: "geojson",
      data: toFeatureCollection(props.vehicles, places, props.selectedId),
      // Clustering is off at this fleet size and that is D-LM7's ruling, not an omission: a
      // dispatcher wants to see each of ~200 trucks, not a disc reading "47". The GeoJSON source
      // makes turning it on a one-line change at whatever zoom markers actually start colliding.
      cluster: false,
    });
    // Beneath the markers, so the ring frames the selected truck instead of covering it.
    instance.addLayer({
      id: SELECTED_LAYER,
      type: "circle",
      source: SOURCE,
      filter: ["==", ["get", "selected"], true],
      paint: {
        "circle-radius": 18,
        "circle-color": tokenColor("text-brand-500"),
        "circle-opacity": 0.18,
        "circle-stroke-color": tokenColor("text-brand-600"),
        "circle-stroke-width": 2,
      },
    });
    instance.addLayer({
      id: SYMBOL_LAYER,
      type: "symbol",
      source: SOURCE,
      layout: {
        "icon-image": ["get", "icon"],
        "icon-rotate": ["get", "heading"],
        "icon-rotation-alignment": "map",
        // ⚠ Both `allow-overlap` flags are TRUE and that is the point of the surface: maplibre's
        // default collision detection would silently hide the trucks parked on top of each other in
        // a yard, and a board that omits trucks is worse than a crowded one.
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        // Faded rather than a fifth colour. An offline truck is a position we no longer stand
        // behind, and "we are less sure about this one" is what translucency says.
        "icon-opacity": ["match", ["get", "state"], "offline", 0.65, 1],
      },
    });
    instance.on("click", SYMBOL_LAYER, (event) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === "string") emit("select", id);
    });
    // A click on empty water or road clears the selection — the same gesture a map user expects
    // from every other map they have used.
    instance.on("click", (event) => {
      const hit = instance.queryRenderedFeatures(event.point, { layers: [SYMBOL_LAYER] });
      if (hit.length === 0) emit("select", null);
    });
    instance.on("mouseenter", SYMBOL_LAYER, () => { instance.getCanvas().style.cursor = "pointer"; });
    instance.on("mouseleave", SYMBOL_LAYER, () => { instance.getCanvas().style.cursor = ""; });
    fitToFleet(instance);
    startMotion();
  },
});

// One tween per poll. Keyed on `generatedAt` rather than on the array, because vue-query hands back
// a new array object on every fetch whether or not a single truck moved.
watch(() => props.generatedAt, () => {
  if (map.value) fitToFleet(map.value);
  startMotion();
});

// Selection is not animated — it is a ring appearing, and it must appear on the click rather than
// on whichever poll happens next.
watch(() => props.selectedId, redraw);

// The markers are drawn in token colours, and every ramp in this product is a `light-dark()` pair.
// Without this, flipping the theme leaves a dark map wearing light-mode markers until a reload.
watch(isDark, () => {
  if (map.value) installLiveMapIcons(map.value);
});

onBeforeUnmount(stopMotion);

/**
 * Centre on one truck, called when a row in the table beneath is clicked.
 *
 * Zoom is raised to 11 only if the view is further out than that. A dispatcher who has zoomed into a
 * corridor and clicks a truck inside it wants to keep their own zoom, not be thrown to a preset.
 */
function flyTo(vehicleId: string): void {
  const vehicle = props.vehicles.find((v) => v.vehicleId === vehicleId);
  if (!vehicle || !map.value) return;
  const place = places.get(vehicleId);
  map.value.easeTo({
    center: [place?.lng ?? vehicle.position.lng, place?.lat ?? vehicle.position.lat],
    zoom: Math.max(map.value.getZoom(), 11),
    duration: 600,
  });
}

/**
 * Tell maplibre its box changed.
 *
 * The workspace's fleet dock is a sibling of the map rather than an overlay, so opening it makes the
 * map SHORTER instead of covering it — and a WebGL canvas does not notice that by itself. maplibre's
 * own `trackResize` listens to the window, which never fired here: the window is exactly the size it
 * was. Without this the map keeps rendering at its old height and the bottom band of it sits behind
 * the dock, which looks like a rendering bug and is really a missing call.
 */
function resize(): void {
  map.value?.resize();
}

defineExpose({ flyTo, resize });
</script>

<template>
  <div
    ref="mapEl"
    class="w-full overflow-hidden"
    :class="props.fit === 'fill' ? 'h-full' : 'h-[28rem] rounded-t-surface'"
    role="img"
    :aria-label="`Live map showing ${props.vehicles.length} trucks. The fleet list gives the same trucks as a table.`"
  />
</template>
