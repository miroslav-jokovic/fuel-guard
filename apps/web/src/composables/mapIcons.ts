/**
 * The vector road map's place icons (D-DR35), drawn in the browser from SVGs we serve ourselves.
 *
 * ── WHERE THE ARTWORK COMES FROM, AND ITS LICENCE (read 2026-11-11) ──────────────────────────────
 * `src/assets/map-icons/`: six icons from Maki v8.0.0 (github.com/mapbox/maki) and the truck from
 * Temaki v5.13.0 (github.com/rapideditor/temaki), each repository's own LICENSE file being CC0 1.0,
 * a public-domain dedication; CC0 keeps only trademark and patent rights, neither of which an icon
 * shape carries. They are bundled by Vite, so nothing is fetched from anybody else's host and the
 * page's content security policy is unchanged. `SOURCES.md` beside them pins the tags.
 *
 * ── WHICH PLACES GET ONE, MEASURED NOT GUESSED ───────────────────────────────────────────────────
 * The keys of `MAP_ICON_BY_KIND` are HERE's `kind` values as read off real tiles with our key:
 * `fuel` (700-7600-0116), `parking`, `car_repair` (700-7850-0122), `hospital`, `aerodrome` (O'Hare's
 * terminals, 400-4000-4582) and `station` (Joliet, 400-4100-0035). Every other place keeps a name
 * and no icon, as before.
 *
 * ── HOW THEY ARE COLOURED ───────────────────────────────────────────────────────────────────────
 * A disc in `--map-label` with the glyph in `--map-label-halo`: the two colours a place name already
 * uses, so the night map inverts them with no token of its own. Each icon is rasterised once per
 * colour scheme, before the map is built, and handed to maplibre synchronously from its
 * `styleimagemissing` event, which is the only moment maplibre lets an image arrive without a
 * "could not be loaded" warning for every tile drawn before it.
 */
import fuel from "@/assets/map-icons/maki-fuel.svg?raw";
import parking from "@/assets/map-icons/maki-parking.svg?raw";
import carRepair from "@/assets/map-icons/maki-car-repair.svg?raw";
import hospital from "@/assets/map-icons/maki-hospital.svg?raw";
import airport from "@/assets/map-icons/maki-airport.svg?raw";
import rail from "@/assets/map-icons/maki-rail.svg?raw";
import truck from "@/assets/map-icons/temaki-truck.svg?raw";

const SVGS = { fuel, parking, "car-repair": carRepair, hospital, airport, rail, truck } as const;
export type MapIconName = keyof typeof SVGS;
export const MAP_ICON_NAMES = Object.keys(SVGS) as MapIconName[];

/** HERE `kind` → icon. Keys measured on tiles (header). */
export const MAP_ICON_BY_KIND: Record<string, MapIconName> = {
  fuel: "fuel",
  parking: "parking",
  car_repair: "car-repair",
  hospital: "hospital",
  aerodrome: "airport",
  station: "rail",
};

/** The icon every truck place (D-DR34) carries: truck stop, truck parking, rest area. */
export const TRUCK_ICON: MapIconName = "truck";

/** The maplibre image id for an icon. One prefix, so `styleimagemissing` can tell ours from anybody's. */
export function mapIconId(name: MapIconName): string {
  return `map-icon:${name}`;
}

/** CSS pixels across the disc; drawn at `ICON_PIXEL_RATIO` so it is sharp on a Retina screen. */
const ICON_CSS_PX = 18;
const ICON_PIXEL_RATIO = 2;
/** The glyph's share of the disc: Maki's 15-unit artwork with room around it inside the circle. */
const GLYPH_SHARE = 0.62;

/**
 * The SVG with its glyph painted `colour`. Maki and Temaki paths carry no fill of their own, so a
 * `fill` on the root reaches every path; an explicit `width`/`height` lets the browser decode it at
 * the size it is drawn.
 */
export function tintSvg(svg: string, colour: string, px: number): string {
  const body = svg.replace(/<\?xml[^>]*>\s*/, "");
  return body.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
    const kept = attrs.replace(/\s(width|height|fill)="[^"]*"/g, "");
    return `<svg${kept} width="${px}" height="${px}" fill="${colour}">`;
  });
}

export interface MapIconImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

async function rasterise(svg: string, disc: string, glyph: string): Promise<MapIconImage | null> {
  const size = ICON_CSS_PX * ICON_PIXEL_RATIO;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  // jsdom (the unit tests) has no 2D context: no icons, and the map is built without them.
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const glyphPx = Math.round(size * GLYPH_SHARE);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(tintSvg(svg, glyph, glyphPx))}`;
  await img.decode();
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(img, (size - glyphPx) / 2, (size - glyphPx) / 2, glyphPx, glyphPx);
  const { data } = ctx.getImageData(0, 0, size, size);
  return { width: size, height: size, data };
}

/** Every icon in one colour scheme, keyed by image id. Empty where the browser cannot draw (tests). */
export async function rasteriseMapIcons(disc: string, glyph: string): Promise<Map<string, MapIconImage>> {
  const out = new Map<string, MapIconImage>();
  try {
    const drawn = await Promise.all(MAP_ICON_NAMES.map((n) => rasterise(SVGS[n], disc, glyph)));
    drawn.forEach((img, i) => img && out.set(mapIconId(MAP_ICON_NAMES[i]!), img));
  } catch {
    // An icon that fails to decode leaves the map with names and no icons, never without a map.
  }
  return out;
}

/** The part of a maplibre map the icons touch, so a test can stand in for it. */
export interface IconMap {
  on(type: "styleimagemissing", listener: (e: { id: string }) => void): unknown;
  hasImage(id: string): boolean;
  addImage(id: string, image: MapIconImage, options: { pixelRatio: number }): unknown;
  updateImage(id: string, image: MapIconImage): unknown;
}

/**
 * Serve our icons to `map` on demand, and return the repaint for a scheme change: a fresh set
 * replaces every icon maplibre has already been given, in place, so no layer is rebuilt for it.
 */
export function installMapIcons(map: IconMap, initial: Map<string, MapIconImage>): (next: Map<string, MapIconImage>) => void {
  let icons = initial;
  map.on("styleimagemissing", ({ id }) => {
    const img = icons.get(id);
    if (img && !map.hasImage(id)) map.addImage(id, img, { pixelRatio: ICON_PIXEL_RATIO });
  });
  return (next) => {
    icons = next;
    for (const [id, img] of next) if (map.hasImage(id)) map.updateImage(id, img);
  };
}
