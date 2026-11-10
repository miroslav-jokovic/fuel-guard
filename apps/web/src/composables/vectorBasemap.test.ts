import { describe, expect, it } from "vitest";
import {
  MAP_PALETTE_KEYS,
  TRUCK_PLACE_CATEGORIES,
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

describe("the vector road map's layers", () => {
  it("keeps every layer in one group, on one source, so the basemap shows and hides as one", () => {
    expect(layers.length).toBeGreaterThan(10);
    for (const l of layers) {
      expect(l.id.startsWith("here-4:")).toBe(true);
      if ("source" in l) expect(l.source).toBe("here-4");
    }
    expect(new Set(layers.map((l) => l.id)).size).toBe(layers.length);
  });

  /** The design system keeps colour literals in `tokens.css` only; every colour here is a token. */
  it("paints only with the palette it is given", () => {
    const allowed = new Set(Object.values(palette));
    const colours: string[] = [];
    for (const l of layers) {
      for (const [k, v] of Object.entries((l as { paint?: Record<string, unknown> }).paint ?? {})) {
        if (k.endsWith("-color")) colours.push(String(v));
      }
    }
    expect(colours.length).toBeGreaterThan(10);
    for (const c of colours) expect(allowed.has(c), c).toBe(true);
  });

  it("gives truck stops the room to name themselves first, then repair and rest areas, then fuel", () => {
    const place = layers.find((l) => l.id === "here-4:place") as { layout: { "symbol-sort-key": unknown[] } };
    const key = JSON.stringify(place.layout["symbol-sort-key"]);
    const at = (codes: readonly string[]) => key.indexOf(codes[0]!);
    expect(at(TRUCK_PLACE_CATEGORIES.truckStop)).toBeLessThan(at(TRUCK_PLACE_CATEGORIES.truckRepair));
    expect(at(TRUCK_PLACE_CATEGORIES.truckRepair)).toBeLessThan(at(TRUCK_PLACE_CATEGORIES.fuel));
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
