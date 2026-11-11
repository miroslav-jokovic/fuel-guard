import { describe, expect, it } from "vitest";
import { MAP_ICON_BY_KIND, MAP_ICON_NAMES, TRUCK_ICON, installMapIcons, mapIconId, tintSvg, type IconMap, type MapIconImage } from "./mapIcons";
import { MAP_PALETTE_KEYS, vectorBasemapLayers, type MapPalette } from "./vectorBasemap";

/**
 * D-DR35: the place icons. The pixels are checked by eye on staging; what can rot silently is here:
 * an icon id a layer asks for that nothing serves, the colour not reaching the glyph, and the
 * hand-over to maplibre on demand and on a scheme change.
 */
const img = (n: number): MapIconImage => ({ width: 1, height: 1, data: new Uint8ClampedArray([n, n, n, 255]) });

function fakeMap() {
  const images = new Map<string, MapIconImage>();
  let missing: ((e: { id: string }) => void) | null = null;
  const map: IconMap = {
    on: (_t, l) => (missing = l),
    hasImage: (id) => images.has(id),
    addImage: (id, image) => images.set(id, image),
    updateImage: (id, image) => images.set(id, image),
  };
  return { map, images, ask: (id: string) => missing!({ id }) };
}

describe("the map's place icons", () => {
  it("paints the glyph in the colour given, at the size drawn, whatever the artwork said", () => {
    const svg = '<?xml version="1.0"?>\n<svg height="15" viewBox="0 0 15 15" width="15" fill="#000"><path d="m0 0h1"/></svg>';
    const out = tintSvg(svg, "rgb(1, 2, 3)", 22);
    expect(out.startsWith("<svg")).toBe(true);
    expect(out).toContain('fill="rgb(1, 2, 3)"');
    expect(out).toContain('width="22" height="22"');
    expect(out).not.toContain('fill="#000"');
    expect(out).toContain('viewBox="0 0 15 15"');
  });

  it("hands maplibre an icon the moment a tile asks for it, and only our own", () => {
    const { map, images, ask } = fakeMap();
    installMapIcons(map, new Map([[mapIconId("fuel"), img(1)]]));
    ask(mapIconId("fuel"));
    ask("somebody-elses-icon");
    expect([...images.keys()]).toEqual([mapIconId("fuel")]);
  });

  it("repaints the icons maplibre already holds on a scheme change, and serves the new ones after", () => {
    const { map, images, ask } = fakeMap();
    const repaint = installMapIcons(map, new Map([[mapIconId("fuel"), img(1)], [mapIconId("truck"), img(1)]]));
    ask(mapIconId("fuel"));
    repaint(new Map([[mapIconId("fuel"), img(2)], [mapIconId("truck"), img(2)]]));
    expect(images.get(mapIconId("fuel"))!.data[0]).toBe(2);
    expect(images.has(mapIconId("truck"))).toBe(false); // never asked for, so not pushed
    ask(mapIconId("truck"));
    expect(images.get(mapIconId("truck"))!.data[0]).toBe(2);
  });

  /** The kinds read off real tiles on 2026-11-11 (mapIcons.ts header). Written out, not derived. */
  it("gives an icon to exactly the kinds measured on HERE's tiles", () => {
    expect(Object.keys(MAP_ICON_BY_KIND).sort()).toEqual(["aerodrome", "car_repair", "fuel", "hospital", "parking", "station"]);
  });

  it("asks only for icons that exist, for every measured kind and for truck places", () => {
    const palette = Object.fromEntries(MAP_PALETTE_KEYS.map((k) => [k, "#000"])) as MapPalette;
    const layers = vectorBasemapLayers(palette, "here", "here:");
    const icon = (name: string) => (layers.find((l) => l.id === `here:${name}`) as { layout: Record<string, unknown> }).layout["icon-image"];
    const known = new Set(MAP_ICON_NAMES.map(mapIconId));
    const asked = JSON.stringify(icon("place")).match(/map-icon:[a-z-]+/g) ?? [];
    expect(new Set(asked)).toEqual(new Set(Object.values(MAP_ICON_BY_KIND).map(mapIconId)));
    for (const id of asked) expect(known.has(id), id).toBe(true);
    for (const kind of Object.keys(MAP_ICON_BY_KIND)) expect(JSON.stringify(icon("place"))).toContain(`"${kind}"`);
    expect(icon("truck-place")).toBe(mapIconId(TRUCK_ICON));
  });
});
