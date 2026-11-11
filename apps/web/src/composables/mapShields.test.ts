import { describe, expect, it } from "vitest";
import { SHIELD_KINDS, SHIELD_MAX_CHARS, shieldImageExpression, shieldImageId, shieldKindExpression, shieldTextColour } from "./mapShields";
import { MAP_PALETTE_KEYS, vectorBasemapLayers, type MapPalette } from "./vectorBasemap";

/**
 * D-DR36: route-number signs. The rule was evaluated with maplibre's own expression engine against
 * every network measured on tiles (out of tree, see the plan's 2026-11-11 entry); these pin what
 * would rot silently: a sign kind the rule names that no image is drawn for, the measured network
 * shapes, and the number's colour coming from the palette.
 */
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(strings) : typeof v === "string" ? [v] : []);

describe("the road signs", () => {
  it("reads the network shapes measured on tiles: US:I, US, a :CR county suffix, and state for the rest", () => {
    const s = strings(shieldKindExpression);
    for (const literal of ["US:I", "US", ":CR"]) expect(s).toContain(literal);
    expect((shieldKindExpression as unknown[]).flat(2)).toContain("network");
  });

  it("names only sign kinds an image is drawn for, and the image id the layer builds is the one drawn", () => {
    const named = strings(shieldKindExpression).filter((x) => (SHIELD_KINDS as readonly string[]).includes(x));
    expect(new Set(named)).toEqual(new Set(SHIELD_KINDS));
    const [, prefix, , dash, length] = shieldImageExpression as unknown[];
    expect(`${prefix as string}us${dash as string}2`).toBe(shieldImageId("us", 2));
    expect(JSON.stringify(length)).toContain(`${SHIELD_MAX_CHARS}]`);
  });

  it("prints the number white on an interstate, yellow on a county sign, and dark on the others", () => {
    const palette = Object.fromEntries(MAP_PALETTE_KEYS.map((k) => [k, `#${k}`])) as MapPalette;
    const [op, , k1, c1, k2, c2, rest] = shieldTextColour(palette) as unknown[];
    expect([op, k1, c1, k2, c2, rest]).toEqual(["match", "interstate", "#shield-plain", "county", "#shield-county-ink", "#shield-ink"]);
  });

  it("puts every route number on its sign", () => {
    const palette = Object.fromEntries(MAP_PALETTE_KEYS.map((k) => [k, "#000"])) as MapPalette;
    const layer = vectorBasemapLayers(palette, "here", "here:").find((l) => l.id === "here:road-number") as {
      layout: Record<string, unknown>;
      paint: Record<string, unknown>;
    };
    expect(layer.layout["icon-image"]).toBe(shieldImageExpression);
    expect(layer.layout["text-field"]).toEqual(["get", "shield_text"]);
    expect(layer.paint["text-color"]).toEqual(shieldTextColour(palette));
  });
});
