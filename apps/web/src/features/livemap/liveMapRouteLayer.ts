import maplibregl from "maplibre-gl";
import type { LiveMapLoadRoute, LiveMapRouteEnd, LiveMapRouteFuelStop } from "@silvicom/shared";
import { tokenColor } from "@/composables/useMapLibre";

/**
 * A load's route on the live map (TRUCK-CARD-ROUTE-PLAN D-TC3, D-TC4, D-TC7).
 *
 * Out of `LiveMapCanvas.vue` because that file is 30 lines from its budget, and because what is here
 * is about a ROUTE, not about the fleet's markers: two lines and a handful of fuel stops, drawn under
 * the trucks, cleared the moment the card closes.
 *
 * ── THE DRIVEN PART IS THE SAME COLOUR, LIGHTER (the owner's ask, 2026-10-09) ────────────────────
 * "Like in navigation": the road behind the truck stays visible but steps back. One brand colour for
 * both halves, the covered half at a third of the opacity, so the eye reads one route with a "you are
 * here" in it rather than two routes. The colours come from tokens and are re-read on a theme flip,
 * since every ramp here is a `light-dark()` pair.
 */
const COVERED = "load-route-covered";
const AHEAD = "load-route-ahead";

type Line = { lat: number; lng: number }[];
type LineFeature = { type: "Feature"; properties: Record<string, never>; geometry: { type: "LineString"; coordinates: number[][] } };

/** A polyline as GeoJSON — maplibre's coordinates are [lng, lat], the reverse of ours. */
export function lineFeature(line: Line): LineFeature {
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line.map((p) => [p.lng, p.lat]) } };
}

/** The rectangle that shows the whole route and every fuel stop, as maplibre's [[w, s], [e, n]]. */
export function routeBounds(route: Pick<LiveMapLoadRoute, "covered" | "ahead" | "fuelStops">): [[number, number], [number, number]] | null {
  const pts = [...route.covered, ...route.ahead, ...route.fuelStops];
  if (pts.length === 0) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of pts) {
    w = Math.min(w, p.lng); e = Math.max(e, p.lng);
    s = Math.min(s, p.lat); n = Math.max(n, p.lat);
  }
  return [[w, s], [e, n]];
}

/** "Pilot Travel Center · Exit 10" then the street address, for the fuel stop's popup. Null parts are left out. */
export function fuelStopLines(stop: LiveMapRouteFuelStop): { title: string; address: string | null } {
  const title = [stop.name ?? stop.brand ?? "Fuel stop", stop.exit ? `Exit ${stop.exit}` : null].filter(Boolean).join(" · ");
  const region = [stop.state, stop.zip].filter(Boolean).join(" ");
  const address = [stop.address, [stop.city, region].filter(Boolean).join(", ")].filter(Boolean).join(", ") || null;
  return { title, address };
}

const markersByMap = new WeakMap<object, maplibregl.Marker[]>();

/** The slice of a maplibre map `syncRoute` uses — narrow, so a test can hand it a fake. */
export type RouteMap = Pick<
  maplibregl.Map,
  "getSource" | "addSource" | "removeSource" | "getLayer" | "addLayer" | "removeLayer" | "setPaintProperty" | "fitBounds"
>;

/**
 * Make the map show `route`, or nothing (D-TC7): draw and fit when there is one, clear when there is not.
 *
 * ⚠ NO `isStyleLoaded()` GUARD, and that is the fix for the route that would not close (owner,
 * 2026-10-09: "closing route is not working … when I refresh the page it disappears"). maplibre's
 * `isStyleLoaded()` is false whenever ANY source is still loading — and drawing a route fits the
 * camera to it, so every tile of the new view is loading for a second or two after. A clear that
 * arrived then returned early, and nothing ever retried it. The caller now asks only whether the map
 * has finished its own `load` (its layers exist); adding and removing a GeoJSON source and layer is
 * legal at any time after that.
 */
export function syncRoute(map: RouteMap, route: LiveMapLoadRoute | null, beneathLayerId: string): void {
  if (!route) return clearRoute(map);
  showRoute(map, route, beneathLayerId);
  const bounds = routeBounds(route);
  if (bounds) map.fitBounds(bounds, { padding: 72, duration: 600, maxZoom: 11 });
}

/**
 * Draw (or redraw) a route beneath the truck markers. Idempotent: called again with a new answer or
 * after a theme flip, it updates the two sources and re-reads the colours rather than stacking layers.
 */
export function showRoute(map: RouteMap, route: LiveMapLoadRoute, beneathLayerId: string): void {
  const colour = tokenColor("text-brand-600");
  for (const [id, line, opacity] of [[COVERED, route.covered, 0.35], [AHEAD, route.ahead, 0.9]] as const) {
    const source = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(lineFeature(line));
    else map.addSource(id, { type: "geojson", data: lineFeature(line) });
    if (!map.getLayer(id)) {
      map.addLayer(
        { id, type: "line", source: id, layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-width": 5 } },
        map.getLayer(beneathLayerId) ? beneathLayerId : undefined,
      );
    }
    map.setPaintProperty(id, "line-color", colour);
    map.setPaintProperty(id, "line-opacity", opacity);
  }
  clearFuelStops(map);
  const markers = route.fuelStops.map((stop) => fuelStopMarker(stop));
  if (route.start) markers.push(endPin(route.start, "start"));
  if (route.end) markers.push(endPin(route.end, "end"));
  markersByMap.set(map, markers.map((m) => m.addTo(map as maplibregl.Map)));
}

export function clearRoute(map: RouteMap): void {
  for (const id of [COVERED, AHEAD]) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }
  clearFuelStops(map);
}

function clearFuelStops(map: RouteMap): void {
  for (const m of markersByMap.get(map) ?? []) m.remove();
  markersByMap.delete(map);
}

/**
 * One fuel stop: a small amber dot that opens its name and address on click (D-TC4). Built with
 * `textContent`, never `innerHTML` — a station name comes from a vendor's file.
 */
function fuelStopMarker(stop: LiveMapRouteFuelStop): maplibregl.Marker {
  const { title, address } = fuelStopLines(stop);
  const dot = document.createElement("button");
  dot.type = "button";
  dot.className = "size-4 rounded-full bg-warning-500 ring-2 ring-surface shadow";
  dot.setAttribute("aria-label", `Fuel stop: ${title}`);
  const body = document.createElement("div");
  body.className = "space-y-0.5 text-ink";
  const name = document.createElement("p");
  name.className = "text-sm font-semibold";
  name.textContent = title;
  body.append(name);
  if (address) {
    const line = document.createElement("p");
    line.className = "text-xs text-ink-secondary";
    line.textContent = address;
    body.append(line);
  }
  const popup = new maplibregl.Popup({ offset: 12, closeButton: false, className: "map-panel" }).setDOMContent(body);
  return new maplibregl.Marker({ element: dot }).setLngLat([stop.lng, stop.lat]).setPopup(popup);
}

/**
 * The pin shape, Google Maps' teardrop (owner, 2026-10-09): a circle on a point, 24 × 34, its tip at
 * the bottom centre so `anchor: "bottom"` puts the point exactly on the stop. `currentColor` fills it,
 * so the colour is a token class and flips with the theme like every other ramp here.
 */
const PIN_PATH = "M12 0C5.4 0 0 5.3 0 11.9 0 20.8 12 34 12 34s12-13.2 12-22.1C24 5.3 18.6 0 12 0Z";

/**
 * A pin's element: pickup green, delivery red — the convention every map reader already knows — with
 * the stop's name as its accessible name and tooltip. Built from parts, never `innerHTML`: the name
 * is McLeod's text.
 */
export function pinElement(end: LiveMapRouteEnd, which: "start" | "end"): HTMLElement {
  const word = which === "start" ? "Pickup" : "Delivery";
  const label = end.name ? `${word}: ${end.name}` : word;
  const el = document.createElement("button");
  el.type = "button";
  el.className = `block ${which === "start" ? "text-success-600" : "text-danger-600"} drop-shadow`;
  el.setAttribute("aria-label", label);
  el.title = label;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 34");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "34");
  svg.setAttribute("aria-hidden", "true");
  const body = document.createElementNS(ns, "path");
  body.setAttribute("d", PIN_PATH);
  body.setAttribute("fill", "currentColor");
  const dot = document.createElementNS(ns, "circle");
  dot.setAttribute("cx", "12");
  dot.setAttribute("cy", "12");
  dot.setAttribute("r", "4.5");
  dot.setAttribute("class", "fill-surface");
  svg.append(body, dot);
  el.append(svg);
  return el;
}

/** A start or end pin, opening the stop's name on click like a fuel stop does. Above the line and trucks. */
function endPin(end: LiveMapRouteEnd, which: "start" | "end"): maplibregl.Marker {
  const body = document.createElement("p");
  body.className = "text-sm font-semibold text-ink";
  body.textContent = pinElement(end, which).getAttribute("aria-label");
  const popup = new maplibregl.Popup({ offset: 30, closeButton: false, className: "map-panel" }).setDOMContent(body);
  return new maplibregl.Marker({ element: pinElement(end, which), anchor: "bottom" }).setLngLat([end.lng, end.lat]).setPopup(popup);
}
