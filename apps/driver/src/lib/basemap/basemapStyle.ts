import roleValues from '@/theme/theme.roles.json';
import upstream from './openfreemap-liberty.json';

/**
 * The basemap in the app's own colours (Visual 2026 D-DV28, Q-DV8 e).
 *
 * The V9 critiques (2026-11-22) found the map was the one surface whose palette we did not control:
 * OpenFreeMap's `liberty` paints yellow and orange roads, green parks and coloured POI labels, which
 * read as amber (our ONE action colour) and as state where there is none. Its `dark` style is a
 * different, sparser map (47 layers to liberty's 111), so the two themes did not even show the same
 * things.
 *
 * So both themes are ONE transform over a bundled copy of liberty (`openfreemap-liberty.json`, fetched
 * 2026-11-24 from https://tiles.openfreemap.org/styles/liberty — its tiles, glyphs and sprite still
 * load from OpenFreeMap). Every colour comes from `theme.roles.json` — the same values every screen
 * uses — through `mix`, never a literal, so a re-valued role re-colours the map too:
 * - land is the canvas; parks, woods and landuse are the canvas a step towards the edge colour;
 * - water is the canvas a step towards the info ink: blue enough to read as water, too muted to read
 *   as our live cyan;
 * - roads are navy-tinted neutrals — minor ones the surface colour, majors a step darker, casings the
 *   edge — so nothing on the map is yellow, orange or amber;
 * - labels are ink-muted over a canvas halo; POI labels, the shaded-relief raster and 3D buildings are
 *   removed (they carried colour and no information a driver needs at a stop).
 * Highway shields stay: an interstate number is how a driver finds the road.
 *
 * Bundling the style also means the map needs one less download before it can draw. An
 * EXPO_PUBLIC_MAP_STYLE_URL(_DARK) override still wins (`env.ts`), for a hosted vendor later (NAV N4).
 */

type Rgb = readonly [number, number, number];
interface Layer { id: string; type: string; 'source-layer'?: string; paint?: Record<string, unknown>; layout?: Record<string, unknown> }
export type BasemapStyle = typeof upstream;

function rgbOf(role: string): Rgb {
  const parts = role.split(' ').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** A role as a CSS colour MapLibre reads. */
function css(c: Rgb): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** `a` moved `t` of the way towards `b`, as a CSS colour. */
export function mix(a: Rgb, b: Rgb, t: number): string {
  const channel = (i: 0 | 1 | 2) => Math.round(a[i] + (b[i] - a[i]) * t);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

export interface BasemapPalette {
  land: string;
  green: string;
  water: string;
  waterLabel: string;
  building: string;
  roadMinor: string;
  roadMajor: string;
  casing: string;
  rail: string;
  border: string;
  label: string;
  labelStrong: string;
  halo: string;
}

/** The map's colours for one theme, each derived from a role. */
export function basemapPalette(isDark: boolean): BasemapPalette {
  const r = isDark ? roleValues.dark : roleValues.light;
  const canvas = rgbOf(r.canvas);
  const edge = rgbOf(r.edge);
  const edgeStrong = rgbOf(r['edge-strong']);
  const surface = rgbOf(r.surface);
  const surfaceMuted = rgbOf(r['surface-muted']);
  const info = rgbOf(r.info);
  const inkMuted = rgbOf(r['ink-muted']);
  return {
    land: css(canvas),
    green: mix(canvas, edge, isDark ? 0.35 : 0.45),
    water: mix(canvas, info, isDark ? 0.22 : 0.16),
    waterLabel: mix(inkMuted, info, 0.35),
    building: mix(canvas, edge, isDark ? 0.7 : 0.8),
    // Light: streets are white on the canvas, and the roads a truck uses (motorway, trunk, primary)
    // a step towards edge-strong, so they read first; the first render had them white-on-white.
    roadMinor: isDark ? mix(surfaceMuted, edge, 0.3) : css(surface),
    roadMajor: isDark ? mix(surfaceMuted, edgeStrong, 0.45) : mix(edge, edgeStrong, 0.35),
    casing: isDark ? mix(canvas, edge, 0.6) : mix(edge, edgeStrong, 0.55),
    rail: mix(edge, edgeStrong, 0.6),
    border: mix(edgeStrong, inkMuted, 0.4),
    label: css(inkMuted),
    labelStrong: css(rgbOf(r['ink-secondary'])),
    halo: css(canvas),
  };
}

const REMOVED_SOURCE_LAYERS = new Set(['poi', 'aerodrome_label', 'mountain_peak', 'housenumber']);
const REMOVED_TYPES = new Set(['raster', 'fill-extrusion']);
const COLOUR_PROPS = ['background-color', 'fill-color', 'fill-outline-color', 'line-color', 'text-color', 'text-halo-color'] as const;

function roadColour(id: string, p: BasemapPalette): string {
  if (id.includes('casing')) return p.casing;
  if (id.includes('rail')) return p.rail;
  if (/motorway|trunk|primary/.test(id)) return p.roadMajor;
  return p.roadMinor;
}

/** The colour a layer's fills and lines take, by what it draws. */
function areaColour(layer: Layer, p: BasemapPalette): string {
  if (layer.type === 'background') return p.land;
  const source = layer['source-layer'] ?? '';
  if (source === 'water' || source === 'waterway') return p.water;
  if (source === 'park' || source === 'landcover' || source === 'landuse' || source === 'aeroway') return p.green;
  if (source === 'building') return p.building;
  if (source === 'boundary') return p.border;
  if (source === 'transportation') return roadColour(layer.id, p);
  return p.green;
}

function textColour(layer: Layer, p: BasemapPalette): string {
  const source = layer['source-layer'] ?? '';
  if (source === 'water_name' || source === 'waterway') return p.waterLabel;
  if (source === 'place') return p.labelStrong;
  return p.label;
}

function recolour(layer: Layer, p: BasemapPalette): Layer {
  const paint: Record<string, unknown> = { ...(layer.paint ?? {}) };
  for (const prop of COLOUR_PROPS) {
    if (!(prop in paint) && !(layer.type === 'symbol' && prop.startsWith('text-'))) continue;
    if (layer.type === 'symbol') {
      // A symbol with no text (a one-way arrow, a shield's icon) keeps its icon and gains no text paint.
      if (!layer.layout || !('text-field' in layer.layout)) continue;
      if (prop === 'text-color') paint[prop] = textColour(layer, p);
      if (prop === 'text-halo-color') paint[prop] = p.halo;
      continue;
    }
    paint[prop] = areaColour(layer, p);
  }
  // A fill-pattern paints a sprite image (liberty's wetland and pedestrian-area hatching), which no
  // colour can reach. Without it a fill with no colour of its own draws BLACK, MapLibre's default —
  // seen as a black street in the first render (2026-11-24) — so the area colour takes its place.
  if ('fill-pattern' in paint) {
    delete paint['fill-pattern'];
    paint['fill-color'] = areaColour(layer, p);
  }
  return { ...layer, paint };
}

const cache: Partial<Record<'light' | 'dark', BasemapStyle>> = {};

/** The whole style for a theme. Built once per theme and kept: the transform is ~111 layers of work. */
export function basemapStyle(isDark: boolean): BasemapStyle {
  const key = isDark ? 'dark' : 'light';
  const hit = cache[key];
  if (hit) return hit;
  const p = basemapPalette(isDark);
  const layers = (upstream.layers as Layer[])
    .filter((l) => !REMOVED_TYPES.has(l.type) && !REMOVED_SOURCE_LAYERS.has(l['source-layer'] ?? ''))
    .map((l) => recolour(l, p));
  const sources = Object.fromEntries(Object.entries(upstream.sources).filter(([name]) => name !== 'ne2_shaded'));
  const style = { ...upstream, sources, layers } as BasemapStyle;
  cache[key] = style;
  return style;
}

/** Every colour the style paints, for the test that nothing on the map is amber or off-palette. */
export function paintedColours(style: BasemapStyle): string[] {
  const out: string[] = [];
  for (const layer of style.layers as Layer[]) {
    for (const value of Object.values(layer.paint ?? {})) if (typeof value === 'string') out.push(value);
  }
  return out;
}
