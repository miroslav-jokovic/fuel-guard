/**
 * The vector road map (D-DR31): HERE's vector tiles, drawn by maplibre in the browser.
 *
 * ── WHY A VECTOR BASEMAP ─────────────────────────────────────────────────────────────────────────
 * The raster road map is a picture of the map with its labels baked in. To be sharp on a Retina
 * screen it needs a 2× tile over 256 CSS pixels (D-DR26), which is 2.7× the tiles of the old map:
 * 410 requests on one heavy zoom walk against 154. That count is what made zooming slow (D-DR28),
 * what made HERE refuse tiles when an office opens the map together (D-DR30), and the baked-in
 * labels are why a zoom looks like a patchwork (D-DR32). Measured in a rig on the same 18-zoom walk,
 * the vector map asks for 140 tiles against 410, downloads 6.2 MB against 11, at $0.088 per 1 000
 * against $0.12, and maplibre draws the labels itself, so they slide and resize instead of
 * snapping square by square.
 *
 * ── WHY OUR OWN STYLE AND NOT HERE'S ─────────────────────────────────────────────────────────────
 * HERE publishes a maplibre style ("berlin", `assets.vector.hereapi.com/styles/berlin/...`). It is a
 * dark grey demo: no places, no highway numbers, every traffic light drawn as a dot, and its night
 * variant answers 404. So the layers below are written for this product: the colours are design
 * tokens (`--map-*`, sampled from HERE's own explore.day / explore.night tiles so the map keeps its
 * look), and the places drawn are the ones a dispatcher reads a truck's position by.
 *
 * ── PURE ────────────────────────────────────────────────────────────────────────────────────────
 * It takes resolved colours and returns layer specs, so a test can hold it still. `useMapLibre`
 * resolves the tokens and owns adding, showing and hiding the layers.
 */
import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";
import { TRUCK_PLACES_ZOOM, VECTOR_GLYPH_FONTS } from "@silvicom/shared";
import { MAP_ICON_BY_KIND, TRUCK_ICON, mapIconId } from "./mapIcons";
import { shieldImageExpression, shieldKindExpression, shieldTextColour } from "./mapShields";

/** The `--map-*` tokens, without the prefix. A key here that has no token is a type error at the caller. */
export const MAP_PALETTE_KEYS = [
  "land",
  "water",
  "park",
  "urban",
  "building",
  "road",
  "road-casing",
  "highway",
  "highway-casing",
  "boundary",
  "label",
  "label-halo",
  "water-label",
  // D-DR36: route-number signs, in the US federal sign colours (mapShields.ts).
  "shield-interstate",
  "shield-interstate-band",
  "shield-plain",
  "shield-ink",
  "shield-county-ink",
  // D-DR37: land uses measured on tiles that the town/park fills did not cover.
  "industrial",
  "medical",
  "education",
  "airport",
  "runway",
  "beach",
] as const;
export type MapPaletteKey = (typeof MAP_PALETTE_KEYS)[number];
export type MapPalette = Record<MapPaletteKey, string>;

/**
 * The fonts HERE serves glyphs for. Fira GO is HERE's own style font, and the glyph endpoint is
 * keyless; it is still fetched through our API (`/api/fueling/map-glyphs/...`), so the page's
 * content security policy stays `'self'` and HERE never sees a reader's browser.
 */
export const VECTOR_FONT = [VECTOR_GLYPH_FONTS[0]];
export const VECTOR_FONT_BOLD = [VECTOR_GLYPH_FONTS[1]];

/**
 * HERE place categories a dispatcher reads a truck's position by, from the `pois` layer's
 * `pds_category`, split by WHICH TILE carries them (D-DR34, measured with our key 2026-11-11).
 *
 * ⚠ The first draft put all of these on the ordinary vector tile, where the truck codes never
 * appear: there the Joliet Pilot is an ordinary "Parking Lot" (800-8500-0178) and Love's a
 * convenience store, so the "truck places first" rule matched nothing. The truck codes come only
 * with HERE's `advanced_pois` content, which the truck-places source fetches at `TRUCK_PLACES_ZOOM`:
 * truck stop / plaza (700-7900-0132), truck parking (700-7900-0131) and rest area (400-4300-0199,
 * where Love's and TA also appear). Fuel stations (700-7600-0116, `kind=fuel`) ARE on the ordinary
 * tile, so they keep their priority there.
 *
 * ⚠ Truck repair (700-7850-0126) is in NEITHER: 0 of 8 shops HERE's search names, and none in 24
 * advanced tiles. It is left out rather than listed for a tile that does not carry it (Q-DR34).
 *
 * Every other place still draws, as a name when there is room. These only win the room first.
 */
export const TRUCK_PLACE_CATEGORIES = {
  truckStop: ["700-7900-0132"],
  truckParking: ["700-7900-0131"],
  restArea: ["400-4300-0199"],
} as const;

/** The one truck category the ordinary vector tile carries (measured 2026-11-10, `kind=fuel`). */
export const FUEL_PLACE_CATEGORY = "700-7600-0116";

const ALL_TRUCK_PLACES: string[] = Object.values(TRUCK_PLACE_CATEGORIES).flat();

/**
 * The truck-places source that rides beside a vector basemap's own source (D-DR34). Derived from the
 * basemap's source id, never chosen separately, so `useMapLibre` adds it and the layer below reads it
 * from one rule.
 */
export function truckPlacesSourceId(basemapSourceId: string): string {
  return `${basemapSourceId}:truck-places`;
}

/** The land-use kinds `landuse-detail` colours (D-DR37); kept as one list so its filter and match agree. */
export const LAND_DETAIL_KINDS = ["industrial", "military", "hospital", "university", "aerodrome", "runway", "beach"];

/**
 * The zoom from which the vector map draws the local road layer the raster map leaves out at regional
 * zoom: tertiary roads and county road numbers (D-DR38, chosen by comparing staging stills at 7–10).
 */
export const REGIONAL_DETAIL_ZOOM = 11;

/**
 * A road's fill: the highway-casing blue-grey while it is a thin line across open country, fading to
 * white between `from` and `to` as it widens enough to carry an edge line of its own.
 *
 * ⚠ White from the first zoom was the first draft, and on staging every country road vanished
 * against the near-white land (2026-11-10, the side-by-side with the raster map). HERE's own raster
 * map draws them the same way: a coloured line at regional zoom, a white road with a casing in town.
 */
function roadColour(c: MapPalette, from: number, to: number): ExpressionSpecification {
  return ["interpolate", ["linear"], ["zoom"], from, c["highway-casing"], to, c.road] as ExpressionSpecification;
}

/** A place name's size at one zoom stop: neighbourhoods small, regions and countries fixed, towns `town`. */
function sizeByKind(town: number): ExpressionSpecification {
  return ["match", ["get", "kind"], "neighbourhood", 11, ["country", "region"], 13, town] as ExpressionSpecification;
}

/**
 * A place's icon with its name to the right, Google-style (D-DR35). `icon` is an image id or an
 * expression giving one; `""` means no icon, and then the name sits centred where the dot was.
 * ⚠ `text-optional`: when the name does not fit, the icon still shows alone, rather than both going.
 */
function iconBesideName(icon: string | ExpressionSpecification) {
  const has: ExpressionSpecification = typeof icon === "string" ? ["literal", true] : ["!=", icon, ""];
  return {
    "icon-image": icon,
    "text-anchor": ["case", has, "left", "center"],
    "text-offset": ["case", has, ["literal", [0.95, 0]], ["literal", [0, 0]]],
    "text-optional": true,
  } as Record<string, unknown>;
}

/** Zoom → value, interpolated linearly; the only curve shape these layers use. */
function byZoom(...stops: number[]): ExpressionSpecification {
  return ["interpolate", ["linear"], ["zoom"], ...stops] as ExpressionSpecification;
}

/**
 * Every layer the vector road map adds, bottom to top, all on `sourceId` and all prefixed `prefix`.
 *
 * ⚠ The layer ids carry the prefix so `useMapLibre` can tell its own basemap layers from the
 * markers and routes a caller adds, and show or hide the whole basemap as one group.
 */
export function vectorBasemapLayers(c: MapPalette, sourceId: string, prefix: string): LayerSpecification[] {
  const id = (name: string) => `${prefix}${name}`;
  const src = { source: sourceId } as const;
  const roadKinds = {
    highway: ["==", ["get", "kind"], "highway"],
    // D-DR38: HERE's tertiary roads (`kind_detail`) start at zoom 9 in its data, and they were 71 of
    // the 92 major-road lines in the zoom-9 tile over Joliet (2026-11-11): the dense blue-grey grid
    // the raster map does not draw at 9 or 10. They join from zoom 11, every other major road as before.
    major: ["all", ["==", ["get", "kind"], "major_road"], ["any", ["!=", ["get", "kind_detail"], "tertiary"], [">=", ["zoom"], REGIONAL_DETAIL_ZOOM]]],
    minor: ["==", ["get", "kind"], "minor_road"],
  };
  const line = (name: string, filter: unknown, color: string | ExpressionSpecification, width: ExpressionSpecification, minzoom = 0): LayerSpecification =>
    ({
      id: id(name),
      type: "line",
      ...src,
      "source-layer": "roads",
      minzoom,
      filter: ["all", filter, ["!=", ["get", "is_tunnel"], true]],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": color, "line-width": width },
    }) as LayerSpecification;

  const halo = { "text-halo-color": c["label-halo"], "text-halo-width": 1.4 };

  return [
    { id: id("land"), type: "background", paint: { "background-color": c.land } },
    {
      id: id("urban"),
      type: "fill",
      ...src,
      "source-layer": "landuse",
      filter: ["match", ["get", "kind"], ["urban", "urban_area", "residential", "commercial", "retail"], true, false],
      paint: { "fill-color": c.urban },
    },
    {
      id: id("park"),
      type: "fill",
      ...src,
      "source-layer": "landuse",
      filter: ["match", ["get", "kind"], ["park", "national_park", "nature", "nature_reserve", "forest", "wood", "natural_wood", "grass", "meadow", "golf_course", "cemetery", "sports_centre", "zoo"], true, false],
      paint: { "fill-color": c.park },
    },
    {
      /**
       * D-DR37: the land uses a dispatcher places a truck by, each its own colour, from the kinds
       * read off tiles over Joliet, O'Hare, Indianapolis, Dallas, Columbus and the Loop (2026-11-11):
       * industrial 11, aerodrome 7, runway 4, university 3, hospital 3, military 2, beach 1.
       * A runway lies inside its aerodrome, so it sorts above it.
       */
      id: id("landuse-detail"),
      type: "fill",
      ...src,
      "source-layer": "landuse",
      filter: ["match", ["get", "kind"], LAND_DETAIL_KINDS, true, false],
      layout: { "fill-sort-key": ["case", ["==", ["get", "kind"], "runway"], 1, 0] },
      paint: {
        "fill-color": [
          "match", ["get", "kind"],
          ["industrial", "military"], c.industrial,
          "hospital", c.medical,
          "university", c.education,
          "aerodrome", c.airport,
          "runway", c.runway,
          "beach", c.beach,
          c.urban,
        ],
      },
    } as LayerSpecification,
    {
      id: id("water"),
      type: "fill",
      ...src,
      "source-layer": "water",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": c.water },
    },
    {
      id: id("waterway"),
      type: "line",
      ...src,
      "source-layer": "water",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-color": c.water, "line-width": byZoom(8, 0.5, 14, 2) },
    },
    {
      id: id("building"),
      type: "fill",
      ...src,
      "source-layer": "buildings",
      minzoom: 14,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": c.building, "fill-outline-color": c["road-casing"] },
    },
    {
      id: id("boundary"),
      type: "line",
      ...src,
      "source-layer": "boundaries",
      filter: ["match", ["get", "kind"], ["country", "region"], true, false],
      paint: { "line-color": c.boundary, "line-width": byZoom(3, 0.6, 10, 1.4), "line-dasharray": [3, 2] },
    },
    // Casings first, then fills, so a road's edge line never crosses the road above it.
    line("minor-casing", roadKinds.minor, c["road-casing"], byZoom(13, 0, 14, 3, 16, 9, 18, 22), 13),
    line("major-casing", roadKinds.major, c["road-casing"], byZoom(11, 0, 12, 4, 16, 14, 18, 30), 11),
    line("highway-casing", roadKinds.highway, c["highway-casing"], byZoom(5, 2, 10, 5, 14, 9, 16, 19, 18, 34), 5),
    line("minor", roadKinds.minor, roadColour(c, 13, 15), byZoom(12, 0.5, 16, 7, 18, 19), 12),
    line("major", roadKinds.major, roadColour(c, 11, 13), byZoom(6, 0.6, 9, 1.2, 12, 2.5, 16, 11, 18, 26), 6),
    line("highway", roadKinds.highway, c.highway, byZoom(5, 1.4, 10, 3.6, 14, 7, 16, 16, 18, 30), 5),
    {
      id: id("water-label"),
      type: "symbol",
      ...src,
      "source-layer": "water",
      filter: ["has", "name"],
      layout: { "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]], "text-font": VECTOR_FONT, "text-size": 12, "text-max-width": 8 },
      paint: { "text-color": c["water-label"], ...halo },
    } as LayerSpecification,
    {
      id: id("road-label"),
      type: "symbol",
      ...src,
      "source-layer": "road_labels",
      minzoom: 12,
      filter: ["all", ["has", "name"], ["match", ["get", "kind"], ["highway", "major_road", "minor_road"], true, false]],
      layout: {
        "symbol-placement": "line",
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
        "text-font": VECTOR_FONT,
        "text-size": byZoom(12, 10, 16, 13),
      },
      paint: { "text-color": c.label, ...halo },
    } as LayerSpecification,
    {
      // The interstate / US / state / county number, the first thing a dispatcher reads a position by.
      id: id("road-number"),
      type: "symbol",
      ...src,
      "source-layer": "road_labels",
      minzoom: 6,
      // Highway numbers from zoom 6; an ordinary road's number only from 10. Both from 6 printed a
      // number on every county road across a region, far busier than the raster map (2026-11-10).
      filter: [
        "all",
        ["has", "shield_text"],
        ["any", ["==", ["get", "kind"], "highway"], ["all", ["==", ["get", "kind"], "major_road"], [">=", ["zoom"], 10]]],
        // D-DR38: county numbers (`:CR`) from zoom 11 too: 29 of the 57 numbers in the zoom-10 tile.
        ["any", ["!", ["in", ":CR", ["coalesce", ["get", "network"], ""]]], [">=", ["zoom"], REGIONAL_DETAIL_ZOOM]],
      ],
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 320,
        "text-field": ["get", "shield_text"],
        "text-font": VECTOR_FONT_BOLD,
        "text-size": 11,
        "text-rotation-alignment": "viewport",
        "text-keep-upright": true,
        // D-DR36: the number sits on its road's sign; an interstate's below the red band.
        "icon-image": shieldImageExpression,
        "icon-rotation-alignment": "viewport",
        "text-offset": ["case", ["==", shieldKindExpression, "interstate"], ["literal", [0, 0.12]], ["literal", [0, 0]]],
      },
      paint: { "text-color": shieldTextColour(c) },
    } as LayerSpecification,
    {
      // Every place the ordinary tile names, with its name when there is room. Fuel stations first.
      // ⚠ Truck categories are drawn from the truck-places source below; excluded here so a place
      // on both tiles is never named twice.
      id: id("place"),
      type: "symbol",
      ...src,
      "source-layer": "pois",
      minzoom: 12,
      filter: [
        "all",
        ["has", "name"],
        ["!", ["match", ["get", "kind"], ["traffic_signals", "bus_stop"], true, false]],
        ["!", ["in", ["get", "pds_category"], ["literal", ALL_TRUCK_PLACES]]],
      ],
      layout: {
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
        "text-font": ["case", ["==", ["get", "pds_category"], FUEL_PLACE_CATEGORY], ["literal", VECTOR_FONT_BOLD], ["literal", VECTOR_FONT]],
        "text-size": byZoom(12, 10, 16, 12),
        "text-max-width": 9,
        "symbol-sort-key": ["case", ["==", ["get", "pds_category"], FUEL_PLACE_CATEGORY], 0, 10],
        // D-DR35: an icon for the measured kinds, the name beside it; every other place is a name alone.
        ...iconBesideName(["match", ["get", "kind"], ...Object.entries(MAP_ICON_BY_KIND).flatMap(([k, n]) => [k, mapIconId(n)]), ""] as unknown as ExpressionSpecification),
      },
      paint: { "text-color": c.label, ...halo },
    } as LayerSpecification,
    {
      // D-DR34: truck stops, truck parking and rest areas, from HERE's advanced place content. Above
      // `place`, so maplibre places these names first and an ordinary shop gives way to them; below
      // `locality`, so a town's name still wins over a truck stop's.
      id: id("truck-place"),
      type: "symbol",
      source: truckPlacesSourceId(sourceId),
      "source-layer": "pois",
      minzoom: TRUCK_PLACES_ZOOM,
      filter: ["all", ["has", "name"], ["in", ["get", "pds_category"], ["literal", ALL_TRUCK_PLACES]]],
      layout: {
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
        "text-font": VECTOR_FONT_BOLD,
        "text-size": byZoom(13, 11, 16, 13),
        "text-max-width": 9,
        "symbol-sort-key": [
          "case",
          ["in", ["get", "pds_category"], ["literal", [...TRUCK_PLACE_CATEGORIES.truckStop]]], 0,
          ["in", ["get", "pds_category"], ["literal", [...TRUCK_PLACE_CATEGORIES.restArea]]], 1,
          2,
        ],
        ...iconBesideName(mapIconId(TRUCK_ICON)),
      },
      paint: { "text-color": c.label, ...halo },
    } as LayerSpecification,
    {
      id: id("locality"),
      type: "symbol",
      ...src,
      "source-layer": "places",
      filter: ["match", ["get", "kind"], ["locality", "neighbourhood", "region", "country"], true, false],
      layout: {
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
        "text-font": ["case", ["==", ["get", "kind"], "locality"], ["literal", VECTOR_FONT_BOLD], ["literal", VECTOR_FONT]],
        // ⚠ The zoom curve is the OUTER expression and the kind is decided at each stop: maplibre only
        // accepts `["zoom"]` as the input of a top-level interpolate, and the first draft nested it
        // inside a `case`, which fails the whole style (caught in the browser, 2026-11-10).
        "text-size": ["interpolate", ["linear"], ["zoom"], 5, sizeByKind(11), 10, sizeByKind(14), 14, sizeByKind(17)],
        "text-transform": ["case", ["match", ["get", "kind"], ["neighbourhood", "region"], true, false], "uppercase", "none"],
        "symbol-sort-key": ["-", 0, ["coalesce", ["get", "population"], 0]],
        "text-max-width": 8,
      },
      paint: { "text-color": c.label, ...halo },
    } as LayerSpecification,
  ];
}

/**
 * Whether a tile template is the vector road map (D-DR31) rather than a HERE raster style.
 * The API serves it under `/map-tiles/vector/`, so it shares the tile route's budget and token.
 */
export function isVectorTemplate(template: string): boolean {
  return template.includes("/map-tiles/vector/");
}

/**
 * Where maplibre fetches label glyphs: our API's relay of HERE's two style fonts (D-DR31).
 * ⚠ The `.pbf` is load-bearing: `{range}` becomes `0-255`, and both the relay and HERE refuse a name
 * without it. maplibre then draws the labels with the browser's font and says so only in a console
 * warning (`VECTOR_GLYPH_RANGE_FILE` has the incident).
 */
export const GLYPHS_PATH = "/api/fueling/map-tiles/glyphs/{fontstack}/{range}.pbf";

/** The vector road map's tile template, served by our API (`mapProxies.ts`, D-DR31). */
export const VECTOR_TILES_TEMPLATE = "/api/fueling/map-tiles/vector/{z}/{x}/{y}";

/** The truck places' tile template (D-DR34): zoom `TRUCK_PLACES_ZOOM` only, refused at any other. */
export const TRUCK_PLACES_TILES_TEMPLATE = "/api/fueling/map-tiles/truck-places/{z}/{x}/{y}";

/**
 * ── THE TRIAL SWITCH (D-DR31) — A WORKAROUND, LABELLED ─────────────────────────────────────────
 * The owner ruled on 2026-11-10 that the vector road map is built on staging and compared side by
 * side with today's map BEFORE it replaces anything for a dispatcher. So it is offered as a fourth
 * basemap choice, "Map (vector trial)", only where the build names an environment
 * (`VITE_APP_ENVIRONMENT`, which staging sets and production does not; the same signal the UAT
 * banner reads).
 *
 * ⚠ This works around the missing piece: there is no per-environment feature flag in the web app,
 * so the environment name stands in for one. It is removed when the owner rules. Either the vector
 * map becomes `map` for everybody and this choice goes, or the trial ends and this file's vector
 * half goes with it.
 */
export const VECTOR_TRIAL_CHOICE = { key: "vector" as const, label: "Map (vector trial)" };

export function vectorTrialOffered(environment: string | undefined = import.meta.env.VITE_APP_ENVIRONMENT): boolean {
  const env = (environment ?? "").trim().toLowerCase();
  return env !== "" && env !== "production";
}
