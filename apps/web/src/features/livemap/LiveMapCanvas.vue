<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import maplibregl from "maplibre-gl";
import { basemapFor, type BasemapChoice, type LiveMapVehicle } from "@silvicom/shared";
import { useMapLibre, tokenColor } from "@/composables/useMapLibre";
import { useColorScheme } from "@/composables/useColorScheme";
import LiveMapControls from "./LiveMapControls.vue";
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
  // ⚠ The EXISTING tweens go in, because a board that repeats a truck's fix must leave that truck's
  // motion untouched (D-LM8b). Dropping them here is what made the dot crawl for a whole poll.
  tweens = planTweens(places, props.vehicles, performance.now(), tweens);
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

/**
 * The basemap follows the colour scheme the reader already chose (D-DR8).
 *
 * ── IT IS DERIVED, NOT A NEW CONTROL ─────────────────────────────────────────────────────────────
 * Comp (7) draws a dark map and the temptation was a basemap switcher to match it — which §4.2
 * already declined for the four-way `Map/Satellite/Traffic/Weather` version, and which would be a
 * second place where "is this reader in dark mode" gets decided. D-DS2b settled that question once,
 * this file has read `isDark` since LM8, and the answer costs one query parameter. A toggle would
 * ask the dispatcher a question the app already knows the answer to.
 *
 * ⚠ AND IT FIXES A DEFECT THAT WAS ALREADY SHIPPING, not only a comp mismatch. The watcher further
 * down re-installs the truck markers when the scheme flips, so dark mode gave this page dark-mode
 * markers over an `explore.day` basemap — the vendor's light tiles under our dark chrome. That
 * watcher's own comment says "leaves a dark map wearing light-mode markers", which describes a map
 * this product did not have until now; the sentence was true about the markers and wrong about the
 * map. Both halves are true from here.
 *
 * ⚠ The style STRING is never spelled in this file. `basemapFor` and the allowlist the API validates
 * against are one list in `@silvicom/shared` — the two processes cannot drift, and a misspelling here
 * would otherwise be invisible, because the proxy falls back to the light basemap rather than
 * erroring.
 *
 * ── D-DR20: THE READER MAY ALSO CHOOSE SATELLITE OR TERRAIN ──────────────────────────────────────
 * Q-DR2 was answered by asking HERE with our own key rather than by reading its documentation:
 * `satellite.day` and `topo.day` both answer 200 on this plan, and `hybrid.day` — satellite WITH
 * labels, which comp (7) draws — answers 400. So the switcher offers three real basemaps and not the
 * comp's four.
 *
 * ⚠ FORMAT travels with the style. `satellite.day` is 41 KB as jpeg and 488 KB as png on the same
 * tile, so the basemap is a style AND a format, and the proxy takes both. D-DR22 then found the same
 * trade on the ROAD styles — `explore.day` is 286 KB as png and 47 KB as jpeg with the label contrast
 * unchanged — so every basemap this file can ask for is now jpeg.
 *
 * ⚠ The SCHEME still moves only the road map, which is why there is no Day/Night button: HERE
 * publishes no `satellite.night` or `topo.night`, and D-DR8 already ruled that the reader is not
 * asked a question the app can answer.
 */
const basemap = ref<BasemapChoice>("map");
const tiles = computed(() => {
  const { style, format } = basemapFor(basemap.value, isDark.value);
  return `/api/fueling/map-tiles/{z}/{x}/{y}?style=${style}&format=${format}`;
});

const { map } = useMapLibre({
  container: mapEl,
  tiles,
  // D-DR21: our own rail draws the zoom buttons, because maplibre's corner system has no free corner
  // left on this workspace and its control sat under the filters panel. See `useMapLibre`.
  navControl: false,
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
/** Our rail's zoom, replacing maplibre's own control (D-DR21). */
function zoomBy(delta: 1 | -1): void {
  const m = map.value;
  if (!m) return;
  // `easeTo` rather than `zoomIn()`, so a held click does not queue a stack of animations the map
  // then works through after the reader has stopped pressing.
  m.easeTo({ zoom: m.getZoom() + delta, duration: 200 });
}

function resize(): void {
  map.value?.resize();
}

defineExpose({ flyTo, resize });
</script>

<template>
  <div
    class="relative w-full overflow-hidden"
    :class="props.fit === 'fill' ? 'h-full' : 'h-[28rem] rounded-t-surface'"
  >
    <div
      ref="mapEl"
      class="size-full"
      role="img"
      :aria-label="`Live map showing ${props.vehicles.length} trucks. The fleet list gives the same trucks as a table.`"
    />
    <!--
      ⚠ The rail is pinned to the right edge and VERTICALLY CENTRED, which is the one placement that
      needs no knowledge of the floating panels (D-DR21). The panels take the corners — fleet status
      top-left, filters top-right, the truck card bottom-left, HERE's attribution bottom-right — so a
      control in any corner collides with one of them, which is exactly how maplibre's own zoom
      buttons came to sit under the filters panel by 27×56px at every width. The middle of an edge is
      the only real estate this workspace does not otherwise spend, and it is where comp (7) draws its
      controls too.

      It lives inside the CANVAS rather than the workspace's panel layer so both shapes of this map —
      the full workspace and the dashboard widget — get the same controls without either re-declaring
      them, which is the split D-DR5 made when it separated the two.
    -->
    <div class="pointer-events-none absolute inset-y-0 right-3 z-sticky flex items-center">
      <LiveMapControls v-model:basemap="basemap" @zoom="zoomBy" />
    </div>
  </div>
</template>
