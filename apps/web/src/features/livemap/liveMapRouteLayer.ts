import maplibregl from "maplibre-gl";
import type { LiveMapLoadRoute, LiveMapRouteFuelStop } from "@silvicom/shared";
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

/** "Pilot #123 · Exit 10" then the street address, for the fuel stop's popup. Null parts are left out. */
export function fuelStopLines(stop: LiveMapRouteFuelStop): { title: string; address: string | null } {
  const title = [stop.name ?? stop.brand ?? "Fuel stop", stop.exit ? `Exit ${stop.exit}` : null].filter(Boolean).join(" · ");
  const region = [stop.state, stop.zip].filter(Boolean).join(" ");
  const address = [stop.address, [stop.city, region].filter(Boolean).join(", ")].filter(Boolean).join(", ") || null;
  return { title, address };
}

const markersByMap = new WeakMap<maplibregl.Map, maplibregl.Marker[]>();

/**
 * Draw (or redraw) a route beneath the truck markers. Idempotent: called again with a new answer or
 * after a theme flip, it updates the two sources and re-reads the colours rather than stacking layers.
 */
export function showRoute(map: maplibregl.Map, route: LiveMapLoadRoute, beneathLayerId: string): void {
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
  markersByMap.set(map, route.fuelStops.map((stop) => fuelStopMarker(stop).addTo(map)));
}

export function clearRoute(map: maplibregl.Map): void {
  for (const id of [COVERED, AHEAD]) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }
  clearFuelStops(map);
}

function clearFuelStops(map: maplibregl.Map): void {
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
