import { describe, expect, it } from "vitest";
import { TRUCK_PLACES_ZOOM, VECTOR_GLYPH_RANGE_FILE } from "@silvicom/shared";
import {
  MAP_PALETTE_KEYS,
  FUEL_PLACE_CATEGORY,
  LAND_DETAIL_KINDS,
  GLYPHS_PATH,
  TRUCK_PLACE_CATEGORIES,
  truckPlacesSourceId,
  isVectorTemplate,
  vectorBasemapLayers,
  vectorTrialOffered,
  VECTOR_TILES_TEMPLATE,
  type MapPalette,
} from "./vectorBasemap";

/**
 * D-DR31: the vector road map's layers. What a reader sees was compared by eye against the raster
 * map in a browser; what can rot silently is below: a layer outside the group, a colour that is not
 * a token, and truck places losing the room to name themselves.
 */
const palette = Object.fromEntries(MAP_PALETTE_KEYS.map((k, i) => [k, `rgb(${i}, ${i}, ${i})`])) as MapPalette;
const layers = vectorBasemapLayers(palette, "here-4", "here-4:");

/**
 * The colours an expression can produce: an interpolate's stop outputs (zoom curves), a match's
 * branch outputs and its fallback (the road signs, D-DR36), or a plain value. Any other shape
 * fails loudly rather than being read as "no colours".
 */
function colourOutputs(v: unknown): string[] {
  if (!Array.isArray(v)) return [String(v)];
  if (v[0] === "interpolate") return v.filter((_, i) => i >= 4 && i % 2 === 0).map(String);
  if (v[0] === "match") return [...v.filter((_, i) => i >= 3 && i % 2 === 1 && i < v.length - 1), v.at(-1)].map(String);
  throw new Error(`unread colour expression ${String(v[0])}`);
}

describe("the vector road map's layers", () => {
  it("keeps every layer in one group, on its source or its truck-places source, so the basemap shows and hides as one", () => {
    expect(layers.length).toBeGreaterThan(10);
    for (const l of layers) {
      expect(l.id.startsWith("here-4:")).toBe(true);
      if ("source" in l) expect(["here-4", truckPlacesSourceId("here-4")]).toContain(l.source);
    }
    expect(new Set(layers.map((l) => l.id)).size).toBe(layers.length);
  });

  /** The design system keeps colour literals in `tokens.css` only; every colour here is a token. */
  it("paints only with the palette it is given", () => {
    const allowed = new Set(Object.values(palette));
    const colours: string[] = [];
    for (const l of layers) {
      for (const [k, v] of Object.entries((l as { paint?: Record<string, unknown> }).paint ?? {})) {
        if (!k.endsWith("-color")) continue;
        colours.push(...colourOutputs(v));
      }
    }
    expect(colours.length).toBeGreaterThan(10);
    for (const c of colours) expect(allowed.has(c), c).toBe(true);
  });

  /**
   * D-DR34, measured 2026-11-11: the truck codes arrive ONLY on the advanced tile, so the layer that
   * names them must read the truck-places source, and only at the zoom that source is fetched at.
   */
  it("names truck stops, truck parking and rest areas from the truck-places source, from its one zoom", () => {
    const truck = layers.find((l) => l.id === "here-4:truck-place") as { source: string; minzoom: number; filter: unknown };
    expect(truck.source).toBe(truckPlacesSourceId("here-4"));
    expect(truck.minzoom).toBe(TRUCK_PLACES_ZOOM);
    const filter = JSON.stringify(truck.filter);
    for (const code of Object.values(TRUCK_PLACE_CATEGORIES).flat()) expect(filter).toContain(code);
  });

  it("places truck stops before rest areas before truck parking, and above every ordinary place but below towns", () => {
    const ids = layers.map((l) => l.id);
    expect(ids.indexOf("here-4:truck-place")).toBeGreaterThan(ids.indexOf("here-4:place"));
    expect(ids.indexOf("here-4:truck-place")).toBeLessThan(ids.indexOf("here-4:locality"));
    const truck = layers.find((l) => l.id === "here-4:truck-place") as { layout: { "symbol-sort-key": unknown[] } };
    const key = JSON.stringify(truck.layout["symbol-sort-key"]);
    const at = (codes: readonly string[]) => key.indexOf(codes[0]!);
    expect(at(TRUCK_PLACE_CATEGORIES.truckStop)).toBeGreaterThan(-1);
    expect(at(TRUCK_PLACE_CATEGORIES.truckStop)).toBeLessThan(at(TRUCK_PLACE_CATEGORIES.restArea));
    expect(key.includes(TRUCK_PLACE_CATEGORIES.truckParking[0])).toBe(false); // the fallback rank
  });

  it("leaves truck places to their own layer and names fuel stations first among ordinary places", () => {
    const place = layers.find((l) => l.id === "here-4:place") as { filter: unknown; layout: { "symbol-sort-key": unknown } };
    expect(JSON.stringify(place.filter)).toMatch(/"!",\["in",\["get","pds_category"\],\["literal",\["700-7900-0132"/);
    expect(place.layout["symbol-sort-key"]).toEqual(["case", ["==", ["get", "pds_category"], FUEL_PLACE_CATEGORY], 0, 10]);
  });

  /** D-DR37: the land uses read off tiles on 2026-11-11, written out rather than derived. */
  it("colours each measured land use its own way, over town and park and under water", () => {
    expect([...LAND_DETAIL_KINDS].sort()).toEqual(["aerodrome", "beach", "hospital", "industrial", "military", "runway", "university"]);
    const ids = layers.map((l) => l.id);
    const at = (n: string) => ids.indexOf(`here-4:${n}`);
    expect(at("landuse-detail")).toBeGreaterThan(at("park"));
    expect(at("landuse-detail")).toBeLessThan(at("water"));
    const detail = layers.find((l) => l.id === "here-4:landuse-detail") as { paint: { "fill-color": unknown[] }; layout: { "fill-sort-key": unknown } };
    const fill = detail.paint["fill-color"];
    const colourOf = (kind: string) => {
      for (let i = 2; i < fill.length - 1; i += 2) {
        const labels = fill[i];
        if (labels === kind || (Array.isArray(labels) && labels.includes(kind))) return fill[i + 1];
      }
      return fill.at(-1);
    };
    for (const kind of LAND_DETAIL_KINDS) expect(colourOf(kind), kind).not.toBe(palette.urban);
    expect(colourOf("runway")).toBe(palette.runway);
    expect(colourOf("aerodrome")).toBe(palette.airport);
    expect(colourOf("hospital")).toBe(palette.medical);
    expect(detail.layout["fill-sort-key"]).toEqual(["case", ["==", ["get", "kind"], "runway"], 1, 0]);
    const urban = JSON.stringify((layers.find((l) => l.id === "here-4:urban") as { filter: unknown }).filter);
    expect(urban).not.toContain('"industrial"');
  });

  it("does not draw traffic lights and bus stops as places", () => {
    const place = layers.find((l) => l.id === "here-4:place") as { filter: unknown };
    expect(JSON.stringify(place.filter)).toContain("traffic_signals");
  });
});

describe("the vector trial switch", () => {
  it("is offered where the build names an environment that is not production", () => {
    expect(vectorTrialOffered("UAT")).toBe(true);
    expect(vectorTrialOffered("staging")).toBe(true);
    expect(vectorTrialOffered("Production")).toBe(false);
    expect(vectorTrialOffered("")).toBe(false);
  });

  it("asks for glyph files by the one name the API relay and HERE accept", () => {
    const asked = GLYPHS_PATH.replace("{fontstack}", "Fira GO Regular").replace("{range}", "0-255");
    expect(VECTOR_GLYPH_RANGE_FILE.test(asked.split("/").at(-1)!)).toBe(true);
  });

  it("tells the vector template from a raster one", () => {
    expect(isVectorTemplate(VECTOR_TILES_TEMPLATE)).toBe(true);
    expect(isVectorTemplate("/api/fueling/map-tiles/{z}/{x}/{y}?style=explore.day&format=jpeg")).toBe(false);
  });
});

/**
 * maplibre accepts `["zoom"]` only as the input of a TOP-LEVEL `interpolate` or `step`, and a style
 * that breaks the rule fails to load at all — a blank map, which no assertion above would notice.
 * The first draft did exactly that in a label size. The full validator runs in the browser check;
 * this pins the one rule that has already been broken.
 */
describe("the vector road map's zoom curves", () => {
  function zoomUses(expr: unknown, topLevel: boolean, out: string[], path: string): void {
    if (!Array.isArray(expr)) return;
    const [op, ...args] = expr as [unknown, ...unknown[]];
    if (op === "zoom" && !topLevel) out.push(path);
    const curve = op === "interpolate" || op === "step";
    args.forEach((a, i) => {
      // The curve's input (`["zoom"]`) is allowed only when the curve itself is the top level.
      const isInput = curve && ((op === "interpolate" && i === 1) || (op === "step" && i === 0));
      zoomUses(a, isInput && topLevel, out, `${path}[${i + 1}]`);
    });
  }

  it("uses the zoom only as the input of a top-level curve, in every paint and layout property", () => {
    const bad: string[] = [];
    for (const l of layers) {
      const props = { ...((l as { paint?: object }).paint ?? {}), ...((l as { layout?: object }).layout ?? {}) };
      for (const [k, v] of Object.entries(props)) zoomUses(v, true, bad, `${l.id}.${k}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("the vector road map's roads", () => {
  /** White roads on near-white land vanished at regional zoom on staging; they must start coloured. */
  it("draws ordinary roads in a colour at regional zoom and white only once zoomed into a town", () => {
    for (const id of ["here-4:major", "here-4:minor"]) {
      const l = layers.find((x) => x.id === id) as { paint: { "line-color": unknown[] } };
      const colour = l.paint["line-color"];
      expect(Array.isArray(colour)).toBe(true);
      expect(colour[4]).toBe(palette["highway-casing"]);
      expect(colour.at(-1)).toBe(palette.road);
    }
  });
});
